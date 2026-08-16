import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

import { createSrijikaProjectFileMap, writeSrijikaProject } from '@srijika/project-scaffold';

import { checkSrijikaArchitecture } from './architecture.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import {
  assertSrijikaUiWritesValid,
  checkSrijikaUiDiagnostics,
  formatSrijikaUiDiagnostic,
} from './ui-diagnostics.js';

const SESSION_VERSION = 1 as const;
const SESSION_PATH = '.srijika/migrations/react/session.json';
const MAX_FILES = 4_096;
const MAX_ENTRIES = 32_768;
const MAX_DIRECTORIES = 4_096;
const MAX_DEPTH = 32;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;

export type ReactMigrationPhase =
  'planned' | 'scaffolded' | 'migrating' | 'verifying' | 'blocked' | 'complete';

export type ReactMigrationFileCategory =
  | 'entry'
  | 'route'
  | 'component'
  | 'hook'
  | 'state'
  | 'api'
  | 'style'
  | 'asset'
  | 'test'
  | 'environment'
  | 'configuration';

export interface ReactMigrationInventoryFile {
  relativePath: string;
  category: ReactMigrationFileCategory;
  size: number;
  sha256: string;
}

export interface ReactMigrationInventory {
  sourceRoot: string;
  packageName: string;
  framework: 'vite' | 'create-react-app' | 'react';
  language: 'typescript' | 'javascript' | 'mixed';
  files: readonly ReactMigrationInventoryFile[];
  environmentKeys: Readonly<Record<string, readonly string[]>>;
  totalBytes: number;
  snapshotSha256: string;
  semanticRoutesPresent: boolean;
}

export interface ReactMigrationPlanSlice {
  id: string;
  title: string;
  sourcePaths: readonly string[];
  acceptance: readonly string[];
}

export interface ReactMigrationPlan {
  id: string;
  sourceRoot: string;
  targetRoot: string;
  sourceSnapshotSha256: string;
  slices: readonly ReactMigrationPlanSlice[];
  unsupported: readonly string[];
}

export interface ReactMigrationSourceMapping {
  sourcePath: string;
  targetPaths: readonly string[];
  kind: 'migrated' | 'compatibility' | 'asset' | 'style';
  notes?: string;
}

export interface ReactMigrationIgnoredSource {
  sourcePath: string;
  reason: string;
}

export interface ReactMigrationWrite {
  relativePath: string;
  content: string;
  expectedSha256?: string;
}

export interface ReactMigrationSlice {
  id: string;
  title: string;
  writes: readonly ReactMigrationWrite[];
  mappings: readonly ReactMigrationSourceMapping[];
  ignoredSources?: readonly ReactMigrationIgnoredSource[];
}

export interface ReactMigrationAppliedSlice {
  id: string;
  title: string;
  appliedAt: string;
  writes: readonly { relativePath: string; sha256: string }[];
  verified: boolean;
  verification?: ReactMigrationSliceVerification;
}

export interface ReactMigrationCommandStatus {
  name: 'install' | 'typecheck' | 'build' | 'test' | 'routes' | 'visual';
  status: 'passed' | 'failed' | 'skipped';
  details?: string;
}

export interface ReactMigrationVerification {
  checkedAt: string;
  sourceUnchanged: boolean;
  srijikaDiagnosticsValid: boolean;
  architectureValid: boolean;
  unmappedSourcePaths: readonly string[];
  commands: readonly ReactMigrationCommandStatus[];
  errors: readonly string[];
  passed: boolean;
}

export interface ReactMigrationSliceVerification {
  checkedAt: string;
  srijikaDiagnosticsValid: boolean;
  architectureValid: boolean;
  commands: readonly ReactMigrationCommandStatus[];
}

export interface ReactMigrationSession {
  version: typeof SESSION_VERSION;
  id: string;
  sourceRoot: string;
  targetRoot: string;
  phase: ReactMigrationPhase;
  createdAt: string;
  updatedAt: string;
  inventory: ReactMigrationInventory;
  plan: ReactMigrationPlan;
  mappings: readonly ReactMigrationSourceMapping[];
  ignoredSources: readonly ReactMigrationIgnoredSource[];
  appliedSlices: readonly ReactMigrationAppliedSlice[];
  verification?: ReactMigrationVerification;
}

export interface StartReactMigrationRequest {
  source: string;
  target: string;
  projectName?: string;
  displayName?: string;
  dryRun?: boolean;
}

export interface ApplyReactMigrationSliceRequest {
  target: string;
  slice: ReactMigrationSlice;
}

export interface VerifyReactMigrationRequest {
  target: string;
  commands?: readonly ReactMigrationCommandStatus[];
}

export type ReactMigrationCliOperation = 'start' | 'status' | 'verify';

export interface ReactMigrationCliRequest {
  operation: ReactMigrationCliOperation;
  target: string;
  source?: string;
}

const sha256 = (value: Uint8Array | string): string =>
  createHash('sha256').update(value).digest('hex');

const pathKey = (value: string): string =>
  process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);

function isInside(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (!fromParent.startsWith('..') && !isAbsolute(fromParent));
}

function assertDistinctRoots(source: string, target: string): void {
  if (isInside(source, target) || isInside(target, source)) {
    throw new Error(
      'React source and Srijika target must be separate, non-overlapping directories. The source is never modified.',
    );
  }
}

async function canonicalFutureTarget(targetDirectory: string): Promise<string> {
  if (!isAbsolute(targetDirectory) || targetDirectory.trim().length === 0) {
    throw new Error('Migration target must be an explicit absolute path.');
  }
  const target = resolve(targetDirectory);
  if (target === parse(target).root)
    throw new Error('A filesystem root cannot be a migration target.');
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Migration target must be a real directory, not a file or symbolic link.');
    }
    const canonical = await realpath(target);
    if (pathKey(canonical) !== pathKey(target)) {
      throw new Error('Migration target must not be reached through a symbolic-link ancestor.');
    }
    return canonical;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }

  let existing = dirname(target);
  while (existing !== parse(existing).root) {
    try {
      const metadata = await lstat(existing);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error('Migration target parent must be a real directory.');
      }
      const canonical = await realpath(existing);
      if (pathKey(canonical) !== pathKey(existing)) {
        throw new Error('Migration target must not be reached through a symbolic-link ancestor.');
      }
      return resolve(canonical, relative(existing, target));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      existing = dirname(existing);
    }
  }
  throw new Error('Migration target has no safe existing parent directory.');
}

function sameIdentity(left: Stats, right: Stats): boolean {
  const stable = left.dev !== 0 && left.ino !== 0 && right.dev !== 0 && right.ino !== 0;
  return (
    (!stable || (left.dev === right.dev && left.ino === right.ino)) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

async function readSafeBytes(
  fileSystem: SrijikaProjectFileSystem,
  relativePath: string,
  maximumBytes = MAX_FILE_BYTES,
): Promise<{ bytes: Uint8Array; metadata: Stats }> {
  const path = fileSystem.resolve(relativePath);
  const before = await fileSystem.inspectRegularFile(path);
  if (before.size > maximumBytes)
    throw new Error(`${relativePath} exceeds the migration read limit.`);
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw new Error(`${relativePath} changed while the migration opened it.`);
    }
    const bytes = Buffer.allocUnsafe(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) throw new Error(`${relativePath} changed while it was read.`);
    const after = await fileSystem.inspectRegularFile(path);
    if (!sameIdentity(opened, after)) throw new Error(`${relativePath} changed while it was read.`);
    return { bytes, metadata: opened };
  } finally {
    await handle.close();
  }
}

const sourceExtension = /\.(?:[cm]?[jt]s|[jt]sx)$/iu;
const styleExtension = /\.(?:css|scss|sass|less|styl)$/iu;
const assetExtension =
  /\.(?:avif|bmp|eot|gif|ico|jpe?g|mp3|mp4|ogg|otf|png|svg|ttf|wav|webm|webp|woff2?)$/iu;

function acceptedMigrationFile(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return (
    sourceExtension.test(normalized) ||
    styleExtension.test(normalized) ||
    assetExtension.test(normalized) ||
    /(^|\/)(?:package\.json|index\.html|tsconfig[^/]*\.json|vite\.config\.[^/]+|craco\.config\.[^/]+)$/u.test(
      normalized,
    ) ||
    /(^|\/)\.env(?:\.[^/]+)?$/u.test(normalized)
  );
}

function categoryFor(relativePath: string): ReactMigrationFileCategory {
  const normalized = relativePath.toLowerCase();
  const name = basename(normalized);
  if (/(^|\/)\.env(?:\.|$)/u.test(normalized)) return 'environment';
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(name) || /(^|\/)__tests__(\/|$)/u.test(normalized)) {
    return 'test';
  }
  if (styleExtension.test(normalized)) return 'style';
  if (assetExtension.test(normalized)) return 'asset';
  if (/route|router|(^|\/)pages?(\/|$)/u.test(normalized)) return 'route';
  if (/(^|\/)use[A-Z]|(^|\/)hooks?(\/|$)/u.test(relativePath)) return 'hook';
  if (/store|state|context|redux|zustand/u.test(normalized)) return 'state';
  if (/api|service|client|request/u.test(normalized)) return 'api';
  if (/^(?:src\/)?(?:main|index|app)\.[cm]?[jt]sx?$/u.test(normalized)) return 'entry';
  if (sourceExtension.test(normalized)) return 'component';
  return 'configuration';
}

function environmentKeys(source: Uint8Array): readonly string[] {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return [];
  }
  return Object.freeze(
    [
      ...new Set(
        text
          .split(/\r?\n/u)
          .flatMap((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1] ?? []),
      ),
    ].sort(),
  );
}

function containsSemanticRouteBehavior(source: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return false;
  }
  return /(?:react-router(?:-dom)?|@tanstack\/react-router|\bwouter\b|\bcreate(?:Browser|Hash|Memory)Router\b|\buse(?:Routes|Navigate|Location)\b|<Route\b|\b(?:window\.)?location\.pathname\b|\bhistory\.(?:pushState|replaceState)\b)/u.test(
    text,
  );
}

export async function scanReactMigrationSource(
  sourceDirectory: string,
): Promise<ReactMigrationInventory> {
  const fileSystem = await SrijikaProjectFileSystem.open(sourceDirectory);
  if (!(await fileSystem.isRegularFile('package.json'))) {
    throw new Error('React migration source must contain package.json.');
  }
  const packageSource = (await fileSystem.readText('package.json', MAX_PACKAGE_BYTES)).source;
  const packageJson = JSON.parse(packageSource) as Record<string, unknown>;
  const dependencies = {
    ...(typeof packageJson['dependencies'] === 'object' && packageJson['dependencies'] !== null
      ? (packageJson['dependencies'] as Record<string, unknown>)
      : {}),
    ...(typeof packageJson['devDependencies'] === 'object' &&
    packageJson['devDependencies'] !== null
      ? (packageJson['devDependencies'] as Record<string, unknown>)
      : {}),
  };
  if (typeof dependencies['react'] !== 'string') {
    throw new Error('Phase 1 accepts React projects only; package.json must declare react.');
  }
  for (const unsupported of ['next', '@remix-run/react', 'react-native', 'expo']) {
    if (typeof dependencies[unsupported] === 'string') {
      throw new Error(
        `Phase 1 does not yet migrate ${unsupported} projects; use a reviewed framework adapter instead.`,
      );
    }
  }
  const files = await fileSystem.walkFiles([''], {
    maximumFiles: MAX_FILES,
    maximumEntries: MAX_ENTRIES,
    maximumDirectories: MAX_DIRECTORIES,
    maximumDepth: MAX_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: false,
    stopAtNestedProjectRoots: true,
    acceptFile: acceptedMigrationFile,
  });
  const inventory: ReactMigrationInventoryFile[] = [];
  const environment: Record<string, readonly string[]> = {};
  let totalBytes = 0;
  let semanticRoutesPresent = false;
  for (const file of files) {
    const read = await readSafeBytes(fileSystem, file.relativePath);
    totalBytes += read.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('React migration source exceeds the 64 MiB aggregate safety limit.');
    }
    const category = categoryFor(file.relativePath);
    if (category === 'environment') environment[file.relativePath] = environmentKeys(read.bytes);
    if (sourceExtension.test(file.relativePath) && containsSemanticRouteBehavior(read.bytes)) {
      semanticRoutesPresent = true;
    }
    inventory.push({
      relativePath: file.relativePath,
      category,
      size: read.bytes.byteLength,
      sha256: sha256(read.bytes),
    });
  }
  inventory.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  if (!inventory.some((file) => file.category === 'entry' || file.category === 'component')) {
    throw new Error('No React source entry or component was found in the source project.');
  }
  const hasTypeScript = inventory.some((file) => /\.(?:ts|tsx|mts|cts)$/iu.test(file.relativePath));
  const hasJavaScript = inventory.some((file) => /\.(?:js|jsx|mjs|cjs)$/iu.test(file.relativePath));
  const framework =
    typeof dependencies['vite'] === 'string'
      ? 'vite'
      : typeof dependencies['react-scripts'] === 'string'
        ? 'create-react-app'
        : 'react';
  const snapshotSha256 = sha256(
    inventory.map((file) => `${file.relativePath}\0${file.size}\0${file.sha256}`).join('\n'),
  );
  return Object.freeze({
    sourceRoot: fileSystem.root,
    packageName:
      typeof packageJson['name'] === 'string' ? packageJson['name'] : basename(fileSystem.root),
    framework,
    language:
      hasTypeScript && hasJavaScript ? 'mixed' : hasTypeScript ? 'typescript' : 'javascript',
    files: Object.freeze(inventory),
    environmentKeys: Object.freeze(environment),
    totalBytes,
    snapshotSha256,
    semanticRoutesPresent,
  });
}

function slice(
  id: string,
  title: string,
  files: readonly ReactMigrationInventoryFile[],
): ReactMigrationPlanSlice {
  return Object.freeze({
    id,
    title,
    sourcePaths: Object.freeze(files.map((file) => file.relativePath)),
    acceptance: Object.freeze([
      'Preserve visible behavior and source semantics in canonical Srijika owners.',
      'Record source-to-target mappings for every reviewed file.',
      'Run architecture validation before marking the slice verified.',
    ]),
  });
}

export function planReactMigration(
  inventory: ReactMigrationInventory,
  targetDirectory: string,
): ReactMigrationPlan {
  const groups: Array<[string, string, ReactMigrationFileCategory[]]> = [
    ['shell-routes', 'Application shell and routes', ['entry', 'route']],
    ['state-data', 'Hooks, state, API, and business behavior', ['hook', 'state', 'api']],
    ['ui', 'React components and widgets', ['component']],
    ['presentation', 'Styles and static assets', ['style', 'asset']],
    [
      'verification',
      'Tests, configuration, and environment contract',
      ['test', 'configuration', 'environment'],
    ],
  ];
  const slices = groups.flatMap(([id, title, categories]) => {
    const files = inventory.files.filter((file) => categories.includes(file.category));
    return files.length === 0 ? [] : [slice(id, title, files)];
  });
  const targetRoot = resolve(targetDirectory);
  return Object.freeze({
    id: sha256(`${inventory.snapshotSha256}\0${targetRoot}`).slice(0, 24),
    sourceRoot: inventory.sourceRoot,
    targetRoot,
    sourceSnapshotSha256: inventory.snapshotSha256,
    slices: Object.freeze(slices),
    unsupported: Object.freeze([]),
  });
}

async function assertExistingSrijikaTargetIsEmptyStarter(targetRoot: string): Promise<void> {
  const fileSystem = await SrijikaProjectFileSystem.open(targetRoot);
  const allowed = new Set(Object.keys(createSrijikaProjectFileMap()));
  const files = await fileSystem.walkFiles([''], {
    maximumFiles: MAX_FILES,
    maximumEntries: MAX_ENTRIES,
    maximumDirectories: MAX_DIRECTORIES,
    maximumDepth: MAX_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: false,
    stopAtNestedProjectRoots: false,
    acceptFile: () => true,
  });
  const unexpected = files.map((file) => file.relativePath).filter((path) => !allowed.has(path));
  if (unexpected.length > 0) {
    throw new Error(
      `Existing Srijika migration target is not an empty generated starter; unexpected file: ${unexpected[0]}`,
    );
  }
}

async function readSession(targetDirectory: string): Promise<ReactMigrationSession> {
  const fileSystem = await SrijikaProjectFileSystem.open(targetDirectory);
  const source = (await fileSystem.readText(SESSION_PATH, 8 * 1024 * 1024)).source;
  const session = JSON.parse(source) as ReactMigrationSession;
  if (session.version !== SESSION_VERSION || session.targetRoot !== fileSystem.root) {
    throw new Error('React migration session is invalid or belongs to another target.');
  }
  return session;
}

async function writeSession(session: ReactMigrationSession): Promise<void> {
  const directory = dirname(join(session.targetRoot, SESSION_PATH));
  await assertNoSymlinkAncestors(session.targetRoot, directory);
  await mkdir(directory, { recursive: true });
  await assertNoSymlinkAncestors(session.targetRoot, directory);
  const target = join(session.targetRoot, SESSION_PATH);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporary, target);
}

function npmName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,213}$/u.test(normalized)) {
    throw new Error('Migration project name must normalize to a valid npm package name.');
  }
  return normalized;
}

export async function startReactMigration(
  request: StartReactMigrationRequest,
): Promise<ReactMigrationSession> {
  const inventory = await scanReactMigrationSource(request.source);
  const targetRoot = await canonicalFutureTarget(request.target);
  assertDistinctRoots(inventory.sourceRoot, targetRoot);
  try {
    const existing = await readSession(targetRoot);
    if (
      existing.sourceRoot !== inventory.sourceRoot ||
      existing.inventory.snapshotSha256 !== inventory.snapshotSha256
    ) {
      throw new Error('The existing migration session belongs to a different or changed source.');
    }
    return existing;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      if (error instanceof Error && /session is invalid|different or changed/u.test(error.message))
        throw error;
    }
  }
  const plan = planReactMigration(inventory, targetRoot);
  const now = new Date().toISOString();
  const session: ReactMigrationSession = Object.freeze({
    version: SESSION_VERSION,
    id: plan.id,
    sourceRoot: inventory.sourceRoot,
    targetRoot,
    phase: request.dryRun ? 'planned' : 'scaffolded',
    createdAt: now,
    updatedAt: now,
    inventory,
    plan,
    mappings: Object.freeze([]),
    ignoredSources: Object.freeze([]),
    appliedSlices: Object.freeze([]),
  });
  if (request.dryRun) return session;

  let targetHasProject = false;
  try {
    const targetFs = await SrijikaProjectFileSystem.open(targetRoot);
    targetHasProject =
      (await targetFs.isRegularFile('srijika.config.json')) &&
      (await targetFs.isRegularFile('package.json'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (!targetHasProject) {
    await writeSrijikaProject(targetRoot, {
      projectName: request.projectName ?? npmName(basename(targetRoot)),
      displayName: request.displayName ?? basename(targetRoot),
    });
  } else {
    const entries = await SrijikaProjectFileSystem.open(targetRoot);
    if (await entries.isRegularFile(SESSION_PATH)) {
      throw new Error('The target already contains an unrelated React migration session.');
    }
    const architecture = await checkSrijikaArchitecture(targetRoot);
    if (architecture.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      throw new Error(
        'Existing Srijika target must pass architecture validation before migration.',
      );
    }
    await assertExistingSrijikaTargetIsEmptyStarter(targetRoot);
  }
  await writeSession(session);
  return session;
}

export async function getReactMigrationStatus(
  targetDirectory: string,
): Promise<ReactMigrationSession> {
  return readSession(targetDirectory);
}

function safeTargetPath(targetRoot: string, relativePath: string): string {
  const segments = relativePath.split('/');
  if (
    !relativePath ||
    isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Migration write path must be project-relative: ${relativePath}`);
  }
  const target = resolve(targetRoot, ...relativePath.split('/'));
  if (
    !isInside(targetRoot, target) ||
    relativePath === SESSION_PATH ||
    relativePath.startsWith('.srijika/migrations/react/')
  ) {
    throw new Error(`Unsafe migration write path: ${relativePath}`);
  }
  return target;
}

async function assertNoSymlinkAncestors(targetRoot: string, target: string): Promise<void> {
  const fromRoot = relative(targetRoot, target);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('Migration write must remain inside the target root.');
  }
  let current = targetRoot;
  for (const segment of fromRoot.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Migration write path must not contain a symbolic link: ${current}`);
      }
      if (current !== target && !metadata.isDirectory()) {
        throw new Error(`Migration write parent must be a directory: ${current}`);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function existingHash(targetRoot: string, relativePath: string): Promise<string | null> {
  try {
    const fileSystem = await SrijikaProjectFileSystem.open(targetRoot);
    return sha256((await readSafeBytes(fileSystem, relativePath)).bytes);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function applyReactMigrationSlice(
  request: ApplyReactMigrationSliceRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  if (session.phase === 'complete')
    throw new Error('Completed migrations cannot accept new slices.');
  if (session.appliedSlices.some((slice) => slice.id === request.slice.id)) return session;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(request.slice.id)) {
    throw new Error('Migration slice id must be stable kebab-case.');
  }
  if (request.slice.title.trim().length === 0 || request.slice.title.length > 320) {
    throw new Error('Migration slice title must contain 1 to 320 characters.');
  }
  if (request.slice.writes.length > 512 || request.slice.mappings.length > 2_048) {
    throw new Error('Migration slice exceeds the reviewed item-count safety limit.');
  }
  if ((request.slice.ignoredSources?.length ?? 0) > 2_048) {
    throw new Error('Migration slice exceeds the ignored-source safety limit.');
  }
  const aggregateWriteBytes = request.slice.writes.reduce(
    (total, write) => total + Buffer.byteLength(write.content, 'utf8'),
    0,
  );
  if (aggregateWriteBytes > 24 * 1024 * 1024) {
    throw new Error('Migration slice exceeds the 24 MiB aggregate write safety limit.');
  }
  const sourcePaths = new Set(session.inventory.files.map((file) => file.relativePath));
  const plannedSlice = session.plan.slices.find((slice) => slice.id === request.slice.id);
  if (!plannedSlice) {
    throw new Error(`Migration slice is not present in the reviewed plan: ${request.slice.id}`);
  }
  if (request.slice.title !== plannedSlice.title) {
    throw new Error(`Migration slice title must match the reviewed plan: ${plannedSlice.title}`);
  }
  const plannedSourcePaths = new Set(plannedSlice.sourcePaths);
  const alreadyAccounted = new Set([
    ...session.mappings.map((mapping) => mapping.sourcePath),
    ...session.ignoredSources.map((ignored) => ignored.sourcePath),
  ]);
  const newlyAccounted = new Set<string>();
  for (const mapping of request.slice.mappings) {
    if (!sourcePaths.has(mapping.sourcePath))
      throw new Error(`Unknown source mapping: ${mapping.sourcePath}`);
    if (!plannedSourcePaths.has(mapping.sourcePath)) {
      throw new Error(`${mapping.sourcePath} belongs to another planned migration slice.`);
    }
    if (alreadyAccounted.has(mapping.sourcePath) || newlyAccounted.has(mapping.sourcePath)) {
      throw new Error(`Source file is already accounted for: ${mapping.sourcePath}`);
    }
    newlyAccounted.add(mapping.sourcePath);
    if (mapping.targetPaths.length === 0)
      throw new Error(`Mapping ${mapping.sourcePath} requires a target path.`);
    if (mapping.targetPaths.length > 64) {
      throw new Error(`Mapping ${mapping.sourcePath} exceeds the target-path safety limit.`);
    }
    for (const path of mapping.targetPaths) safeTargetPath(session.targetRoot, path);
  }
  for (const ignored of request.slice.ignoredSources ?? []) {
    if (!sourcePaths.has(ignored.sourcePath))
      throw new Error(`Unknown ignored source: ${ignored.sourcePath}`);
    if (!plannedSourcePaths.has(ignored.sourcePath)) {
      throw new Error(`${ignored.sourcePath} belongs to another planned migration slice.`);
    }
    if (alreadyAccounted.has(ignored.sourcePath) || newlyAccounted.has(ignored.sourcePath)) {
      throw new Error(`Source file is already accounted for: ${ignored.sourcePath}`);
    }
    newlyAccounted.add(ignored.sourcePath);
    if (ignored.reason.trim().length < 3)
      throw new Error(`Ignored source ${ignored.sourcePath} requires a reason.`);
  }
  const seenWrites = new Set<string>();
  const prepared: Array<{
    write: ReactMigrationWrite;
    target: string;
    before: Buffer | null;
    temporary: string;
  }> = [];
  const writePaths = new Set(request.slice.writes.map((write) => write.relativePath));
  for (const mapping of request.slice.mappings) {
    for (const targetPath of mapping.targetPaths) {
      if (
        !writePaths.has(targetPath) &&
        (await existingHash(session.targetRoot, targetPath)) === null
      ) {
        throw new Error(
          `Mapped target does not exist and is not written by this slice: ${targetPath}`,
        );
      }
    }
  }
  await assertSrijikaUiWritesValid(session.targetRoot, request.slice.writes);
  for (const write of request.slice.writes) {
    if (Buffer.byteLength(write.content, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`${write.relativePath} exceeds the 4 MiB migration write limit.`);
    }
    if (seenWrites.has(write.relativePath))
      throw new Error(`Duplicate migration write: ${write.relativePath}`);
    seenWrites.add(write.relativePath);
    const target = safeTargetPath(session.targetRoot, write.relativePath);
    await assertNoSymlinkAncestors(session.targetRoot, target);
    const current = await existingHash(session.targetRoot, write.relativePath);
    if (current !== null && write.expectedSha256 === undefined) {
      throw new Error(
        `${write.relativePath} already exists; expectedSha256 is required to update it.`,
      );
    }
    if (write.expectedSha256 !== undefined && current !== write.expectedSha256) {
      throw new Error(`${write.relativePath} changed since the migration slice was reviewed.`);
    }
    let before: Buffer | null = null;
    if (current !== null) {
      const targetFileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
      before = Buffer.from((await readSafeBytes(targetFileSystem, write.relativePath)).bytes);
    }
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    prepared.push({ write, target, before, temporary });
  }
  const committed: typeof prepared = [];
  try {
    for (const item of prepared) {
      await mkdir(dirname(item.target), { recursive: true });
      await assertNoSymlinkAncestors(session.targetRoot, dirname(item.target));
      await writeFile(item.temporary, item.write.content, { encoding: 'utf8', flag: 'wx' });
      await rename(item.temporary, item.target);
      committed.push(item);
    }
    const now = new Date().toISOString();
    const { verification: previousVerification, ...sessionWithoutVerification } = session;
    void previousVerification;
    const next: ReactMigrationSession = {
      ...sessionWithoutVerification,
      phase: 'migrating',
      updatedAt: now,
      mappings: Object.freeze([...session.mappings, ...request.slice.mappings]),
      ignoredSources: Object.freeze([
        ...session.ignoredSources,
        ...(request.slice.ignoredSources ?? []),
      ]),
      appliedSlices: Object.freeze([
        ...session.appliedSlices,
        {
          id: request.slice.id,
          title: request.slice.title,
          appliedAt: now,
          writes: Object.freeze(
            request.slice.writes.map((write) => ({
              relativePath: write.relativePath,
              sha256: sha256(write.content),
            })),
          ),
          verified: false,
        },
      ]),
    };
    await writeSession(next);
    return next;
  } catch (error) {
    for (const item of committed.reverse()) {
      if (item.before === null) await rm(item.target, { force: true });
      else await writeFile(item.target, item.before);
    }
    await Promise.all(prepared.map((item) => rm(item.temporary, { force: true })));
    throw error;
  }
}

export async function verifyReactMigrationSlice(
  targetDirectory: string,
  sliceId: string,
  commands: readonly ReactMigrationCommandStatus[] = [],
): Promise<ReactMigrationSession> {
  const session = await readSession(targetDirectory);
  const selected = session.appliedSlices.find((slice) => slice.id === sliceId);
  if (!selected) throw new Error(`Migration slice was not applied: ${sliceId}`);
  const rescanned = await scanReactMigrationSource(session.sourceRoot);
  if (rescanned.snapshotSha256 !== session.inventory.snapshotSha256) {
    throw new Error('React source changed after the migration started.');
  }
  for (const write of selected.writes) {
    const actual = await existingHash(session.targetRoot, write.relativePath);
    if (actual !== write.sha256)
      throw new Error(`${write.relativePath} changed after slice application.`);
  }
  const uiDiagnostics = await checkSrijikaUiDiagnostics(session.targetRoot);
  if (uiDiagnostics.diagnostics.length > 0) {
    throw new Error(
      `Migration slice ${sliceId} requires zero Srijika diagnostics: ${uiDiagnostics.diagnostics
        .slice(0, 8)
        .map(formatSrijikaUiDiagnostic)
        .join(
          ' | ',
        )}${uiDiagnostics.diagnostics.length > 8 ? ` | ${uiDiagnostics.diagnostics.length - 8} more` : ''}`,
    );
  }
  const architecture = await checkSrijikaArchitecture(session.targetRoot);
  if (architecture.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new Error(`Migration slice ${sliceId} does not pass Srijika architecture validation.`);
  }
  const normalized = normalizedCommands(commands);
  for (const name of ['typecheck', 'build'] as const) {
    const evidence = normalized.find((command) => command.name === name);
    if (evidence?.status !== 'passed') {
      throw new Error(`Migration slice ${sliceId} requires passed ${name} evidence.`);
    }
  }
  const checkedAt = new Date().toISOString();
  const next: ReactMigrationSession = {
    ...session,
    updatedAt: checkedAt,
    appliedSlices: Object.freeze(
      session.appliedSlices.map((slice) =>
        slice.id === sliceId
          ? Object.freeze({
              ...slice,
              verified: true,
              verification: Object.freeze({
                checkedAt,
                srijikaDiagnosticsValid: true,
                architectureValid: true,
                commands: Object.freeze(normalized),
              }),
            })
          : slice,
      ),
    ),
  };
  await writeSession(next);
  return next;
}

function normalizedCommands(
  commands: readonly ReactMigrationCommandStatus[],
): ReactMigrationCommandStatus[] {
  if (commands.length > 32) throw new Error('Migration verification evidence exceeds 32 entries.');
  const seen = new Set<ReactMigrationCommandStatus['name']>();
  for (const command of commands) {
    if (seen.has(command.name)) {
      throw new Error(`Duplicate migration verification evidence: ${command.name}`);
    }
    seen.add(command.name);
    if ((command.details?.length ?? 0) > 8_192) {
      throw new Error(`Migration verification details are too large: ${command.name}`);
    }
  }
  const byName = new Map(commands.map((command) => [command.name, command]));
  return ['install', 'typecheck', 'build', 'test', 'routes', 'visual'].flatMap((name) => {
    const command = byName.get(name as ReactMigrationCommandStatus['name']);
    return command ? [command] : [];
  });
}

function hasResponsiveVisualDetails(details: string | undefined): boolean {
  if (!details?.trim()) return false;
  const normalized = details.toLowerCase();
  const namedViewports = ['mobile', 'tablet', 'desktop', 'wide'].filter((name) =>
    normalized.includes(name),
  );
  const measuredViewports = normalized.match(/\b\d{2,5}\s*[x×]\s*\d{2,5}\b/gu) ?? [];
  return namedViewports.length >= 2 || measuredViewports.length >= 2;
}

export async function verifyReactMigration(
  request: VerifyReactMigrationRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  const rescanned = await scanReactMigrationSource(session.sourceRoot);
  const sourceUnchanged = rescanned.snapshotSha256 === session.inventory.snapshotSha256;
  const uiDiagnostics = await checkSrijikaUiDiagnostics(session.targetRoot);
  const architecture = await checkSrijikaArchitecture(session.targetRoot);
  const architectureErrors = architecture.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  const accounted = new Set([
    ...session.mappings.map((mapping) => mapping.sourcePath),
    ...session.ignoredSources.map((ignored) => ignored.sourcePath),
  ]);
  const unmappedSourcePaths = session.inventory.files
    .map((file) => file.relativePath)
    .filter((path) => !accounted.has(path));
  const commands = normalizedCommands(request.commands ?? session.verification?.commands ?? []);
  const required = new Map(commands.map((command) => [command.name, command]));
  const commandErrors: string[] = [];
  for (const name of ['typecheck', 'build', 'test'] as const) {
    const evidence = required.get(name);
    if (!evidence) commandErrors.push(`Missing ${name} verification evidence.`);
    else if (evidence.status !== 'passed') commandErrors.push(`${name} verification must pass.`);
  }
  if (
    session.inventory.semanticRoutesPresent ||
    session.inventory.files.some((file) => file.category === 'route')
  ) {
    const routes = required.get('routes');
    if (routes?.status !== 'passed' || !routes.details?.trim()) {
      commandErrors.push('Route parity evidence with reviewed details is required.');
    }
  }
  if (
    session.inventory.files.some((file) =>
      ['entry', 'component', 'style', 'asset'].includes(file.category),
    )
  ) {
    const visual = required.get('visual');
    if (visual?.status !== 'passed' || !hasResponsiveVisualDetails(visual.details)) {
      commandErrors.push(
        'Visual parity evidence with at least two reviewed viewport details is required.',
      );
    }
  }
  const errors = [
    ...(sourceUnchanged ? [] : ['React source changed after migration started.']),
    ...uiDiagnostics.diagnostics.map(formatSrijikaUiDiagnostic),
    ...architectureErrors.map((diagnostic) => diagnostic.message),
    ...(unmappedSourcePaths.length === 0
      ? []
      : [`${unmappedSourcePaths.length} source files are not mapped or explicitly ignored.`]),
    ...(session.appliedSlices.every((slice) => slice.verified)
      ? []
      : ['Every applied migration slice must be verified.']),
    ...session.plan.unsupported.map((reason) => `Unsupported migration behavior: ${reason}`),
    ...commandErrors,
  ];
  const verification: ReactMigrationVerification = Object.freeze({
    checkedAt: new Date().toISOString(),
    sourceUnchanged,
    srijikaDiagnosticsValid: uiDiagnostics.diagnostics.length === 0,
    architectureValid: architectureErrors.length === 0,
    unmappedSourcePaths: Object.freeze(unmappedSourcePaths),
    commands: Object.freeze(commands),
    errors: Object.freeze(errors),
    passed: errors.length === 0,
  });
  const next: ReactMigrationSession = {
    ...session,
    phase: verification.passed ? 'verifying' : 'blocked',
    updatedAt: verification.checkedAt,
    verification,
  };
  await writeSession(next);
  return next;
}

export async function finalizeReactMigration(
  request: VerifyReactMigrationRequest,
): Promise<ReactMigrationSession> {
  const verified = await verifyReactMigration(request);
  if (!verified.verification?.passed) {
    throw new Error(
      `React migration cannot be finalized: ${verified.verification?.errors.join(' ') ?? 'verification failed.'}`,
    );
  }
  const next: ReactMigrationSession = {
    ...verified,
    phase: 'complete',
    updatedAt: new Date().toISOString(),
  };
  await writeSession(next);
  return next;
}

export function buildReactMigrationCliArguments(
  request: ReactMigrationCliRequest,
): readonly string[] {
  if (!isAbsolute(request.target)) throw new Error('Migration target must be an absolute path.');
  if (request.operation === 'start') {
    if (!request.source || !isAbsolute(request.source)) {
      throw new Error('React migration source must be an absolute path.');
    }
    assertDistinctRoots(resolve(request.source), resolve(request.target));
    return Object.freeze([
      'migrate',
      'react',
      '--source',
      resolve(request.source),
      '--target',
      resolve(request.target),
      '--json',
    ]);
  }
  return Object.freeze([
    'migrate',
    request.operation,
    '--target',
    resolve(request.target),
    '--json',
  ]);
}
