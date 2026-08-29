import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  parse,
  posix,
  relative,
  resolve,
} from 'node:path';
import ts from 'typescript';

import {
  analyzeSrijikaPayloadNextProfile,
  resolveSrijikaArchitectureConfig,
  type SrijikaArchitectureConfig,
  type SrijikaPayloadNextProfile,
} from '@srijika/architecture-rules';
import { createSrijikaArchitectureValidatorScript } from '@srijika/architecture-rules/portable';

import {
  buildSrijikaOwnershipCreationPlan,
  createSrijikaNextProjectFileMap,
  createSrijikaProjectFileMap,
  writeSrijikaNextProject,
  writeSrijikaProject,
} from '@srijika/project-scaffold';

import { checkSrijikaArchitecture } from './architecture.js';
import { inspectSrijikaProject } from './project.js';
import type { ReactMigrationBrowserParityManifest } from './react-migration-browser-parity.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import {
  assertSrijikaUiWritesValid,
  checkSrijikaUiDiagnostics,
  formatSrijikaUiDiagnostic,
} from './ui-diagnostics.js';

const SESSION_VERSION = 2 as const;
const SESSION_PATH = '.srijika/migrations/react/session.json';
const EVIDENCE_KEY_PATH = '.srijika/migrations/react/evidence.key';
const MAX_FILES = 4_096;
const MAX_ENTRIES = 32_768;
const MAX_DIRECTORIES = 4_096;
const MAX_DEPTH = 32;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_ADAPTER_MODULES = 16;

export type ReactMigrationConversionMode = 'native' | 'compatibility';
export type ReactMigrationCompletionObligation =
  'native-owner' | 'content-addressed-asset' | 'excluded-nonruntime';
export type ReactMigrationOwnerKind =
  | 'application'
  | 'feature'
  | 'slot'
  | 'part'
  | 'shared-ui'
  | 'shared-widget'
  | 'shared-capability'
  | 'project';
export type ReactMigrationOwnerRole =
  | 'shell'
  | 'route'
  | 'ui'
  | 'hook'
  | 'store'
  | 'api'
  | 'logic'
  | 'types'
  | 'style'
  | 'asset'
  | 'test'
  | 'configuration';
export type ReactMigrationLegacyAdapterId =
  'react-router' | 'redux' | 'zustand' | 'react-context' | 'css-modules' | 'styled-components';

export interface ReactMigrationModuleDependency {
  specifier: string;
  kind: 'source' | 'package' | 'unresolved-source';
  resolvedSourcePath?: string;
  packageName?: string;
}

export interface ReactMigrationOwnershipDecision {
  sourcePath: string;
  ownerId: string;
  ownerKind: ReactMigrationOwnerKind;
  ownerName: string;
  ownerPath: string;
  role: ReactMigrationOwnerRole;
  canonicalTargetPaths: readonly string[];
  rationale: string;
  dependencies: readonly ReactMigrationModuleDependency[];
  graphComponentId: string;
  routeEntrypoint: boolean;
  completionObligation: ReactMigrationCompletionObligation;
  approvedLegacyAdapters: readonly ReactMigrationLegacyAdapterId[];
}

export interface ReactMigrationLegacyAdapterApproval {
  id: ReactMigrationLegacyAdapterId;
  packageNames: readonly string[];
  sourcePaths: readonly string[];
  maximumModules: number;
  rationale: string;
}

export interface ReactMigrationSliceReview {
  token: string;
  planId: string;
  sliceId: string;
  sourceSnapshotSha256: string;
  targetSnapshotSha256: string;
  sessionStateSha256: string;
  payloadSha256: string;
  payloadPath: string;
  reviewedAt: string;
}

export type ReactMigrationPhase =
  'planned' | 'scaffolded' | 'migrating' | 'verifying' | 'blocked' | 'complete';

export type ReactMigrationFileCategory =
  | 'entry'
  | 'route'
  | 'component'
  | 'hook'
  | 'state'
  | 'api'
  | 'logic'
  | 'types'
  | 'style'
  | 'asset'
  | 'test'
  | 'environment'
  | 'script'
  | 'configuration'
  | 'ancillary'
  | 'unsupported';

export interface ReactMigrationInventoryFile {
  relativePath: string;
  category: ReactMigrationFileCategory;
  size: number;
  sha256: string;
}

export interface ReactMigrationInventory {
  sourceRoot: string;
  packageName: string;
  framework: 'vite' | 'create-react-app' | 'react' | 'next-app-router';
  language: 'typescript' | 'javascript' | 'mixed';
  files: readonly ReactMigrationInventoryFile[];
  environmentKeys: Readonly<Record<string, readonly string[]>>;
  totalBytes: number;
  snapshotSha256: string;
  semanticRoutesPresent: boolean;
  packageDependencies: readonly string[];
  packageDependencyRecords: readonly ReactMigrationPackageDependency[];
  packageScripts: Readonly<Record<string, string>>;
  toolchain: ReactMigrationToolchainFacts;
  nextAppRouter?: ReactMigrationNextAppRouterInventory;
  sourceAliases: Readonly<Record<string, string>>;
  ownership: readonly ReactMigrationOwnershipDecision[];
}

export type ReactMigrationNextRouteKind =
  | 'default'
  | 'error'
  | 'global-error'
  | 'layout'
  | 'loading'
  | 'not-found'
  | 'page'
  | 'route'
  | 'template';

export interface ReactMigrationNextRouteFile {
  relativePath: string;
  kind: ReactMigrationNextRouteKind;
  routePath: string;
  segments: readonly string[];
  routeGroups: readonly string[];
  dynamicSegments: readonly string[];
  boundary: 'server' | 'client';
  serverAction: boolean;
  metadata: boolean;
}

export interface ReactMigrationNextAppRouterInventory {
  appRoot: 'app' | 'src/app';
  routes: readonly ReactMigrationNextRouteFile[];
  protectedServerFiles: readonly string[];
  middleware: readonly string[];
  publicAssets: readonly string[];
  configPaths: readonly string[];
  payload: SrijikaPayloadNextProfile | null;
}

export type ReactMigrationPackageDependencyScope =
  'dependency' | 'devDependency' | 'peerDependency' | 'optionalDependency';

export interface ReactMigrationPackageDependency {
  name: string;
  version: string;
  scope: ReactMigrationPackageDependencyScope;
  unsafeLocalReference: boolean;
}

export interface ReactMigrationToolchainFacts {
  packageManager?: string;
  nodeEngine?: string;
  viteVersion?: string;
  nextVersion?: string;
  configPaths: readonly string[];
}

export interface ReactMigrationPlanSlice {
  id: string;
  title: string;
  sourcePaths: readonly string[];
  dependencyOwnerIds: readonly string[];
  cycleOwnerIds: readonly string[];
  requiredStarterCleanup: readonly ReactMigrationDelete[];
  acceptance: readonly string[];
}

export interface ReactMigrationPlan {
  id: string;
  sourceRoot: string;
  targetRoot: string;
  sourceSnapshotSha256: string;
  targetBaselineSha256: string;
  slices: readonly ReactMigrationPlanSlice[];
  ownership: readonly ReactMigrationOwnershipDecision[];
  approvedLegacyAdapters: readonly ReactMigrationLegacyAdapterApproval[];
  requiredStarterCleanup: readonly ReactMigrationDelete[];
  unsupported: readonly string[];
}

export interface ReactMigrationSourceMapping {
  sourcePath: string;
  targetPaths: readonly string[];
  kind: 'migrated' | 'compatibility' | 'asset' | 'style';
  mode: ReactMigrationConversionMode;
  ownerId: string;
  role: ReactMigrationOwnerRole;
  rationale: string;
  legacyAdapter?: ReactMigrationLegacyAdapterId;
  mergeGroupId?: string;
  traceRanges?: readonly {
    sourceStartLine: number;
    sourceEndLine: number;
    targetStartLine: number;
    targetEndLine: number;
  }[];
  notes?: string;
}

export interface ReactMigrationIgnoredSource {
  sourcePath: string;
  reason: string;
}

export interface ReactMigrationWrite {
  relativePath: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  expectedSha256?: string;
}

/**
 * A content-addressed binary asset copied by the engine from the immutable
 * source tree. It keeps multi-megabyte images/data out of model context while
 * binding the reviewed payload to one inventory path and hash.
 */
export interface ReactMigrationSourceArtifactCopy {
  sourcePath: string;
  relativePath: string;
  expectedSourceSha256: string;
  expectedSha256?: string;
}

/**
 * A source-declared safe registry package which the engine adds to the
 * target's existing package.json. The package manifest itself is never copied
 * from the source or supplied by the reviewer.
 */
export interface ReactMigrationSourcePackageDependency {
  name: string;
  version: string;
  scope: ReactMigrationPackageDependencyScope;
}

/**
 * An exact source-declared command whose executable lives in a reviewed
 * `scripts/` migration slice. The engine, rather than the reviewer, writes
 * the corresponding target package.json entry.
 */
export interface ReactMigrationSourcePackageScript {
  name: string;
  command: string;
}

export interface ReactMigrationDelete {
  relativePath: string;
  expectedSha256: string;
}

export interface ReactMigrationSlice {
  id: string;
  title: string;
  writes: readonly ReactMigrationWrite[];
  sourceArtifactCopies?: readonly ReactMigrationSourceArtifactCopy[];
  sourcePackageDependencies?: readonly ReactMigrationSourcePackageDependency[];
  sourcePackageScripts?: readonly ReactMigrationSourcePackageScript[];
  deletes?: readonly ReactMigrationDelete[];
  mappings: readonly ReactMigrationSourceMapping[];
  ignoredSources?: readonly ReactMigrationIgnoredSource[];
}

export interface ReactMigrationAppliedSlice {
  id: string;
  title: string;
  appliedAt: string;
  writes: readonly { relativePath: string; sha256: string }[];
  deletes?: readonly string[];
  verified: boolean;
  verification?: ReactMigrationSliceVerification;
}

export interface ReactMigrationCommandStatus {
  name: 'install' | 'typecheck' | 'build' | 'test' | 'routes' | 'visual';
  status: 'passed' | 'failed' | 'skipped';
  details?: string;
  receipt?: {
    issuedBy: 'srijika-engine';
    targetSnapshotSha256: string;
    evidenceSha256: string;
  };
}

export interface RunReactMigrationVerificationGatesRequest {
  target: string;
  includeInstall?: boolean;
  /** Restrict execution to the named canonical gates. Final verification still requires all gates. */
  names?: readonly ('typecheck' | 'build' | 'test')[];
}

export interface AttestReactMigrationParityRequest {
  target: string;
  name: 'routes' | 'visual';
  /** Engine-classified source obligations represented by the paired capture artifacts. */
  coveredSourcePaths: readonly string[];
  /** Source-side capture/report artifacts stored under target .srijika migration evidence. */
  sourceArtifacts: readonly string[];
  /** Converted-target capture/report artifacts stored under target .srijika migration evidence. */
  targetArtifacts: readonly string[];
  details: string;
  viewports?: readonly string[];
}

export interface GetReactMigrationSliceContextRequest {
  target: string;
  sliceId: string;
  /** Optional optimistic concurrency guards for callers resuming a reviewed plan. */
  expectedPlanId?: string;
  expectedSourceSnapshotSha256?: string;
  expectedTargetSnapshotSha256?: string;
  cursor?: string;
  limit?: number;
  maxBytes?: number;
}

export interface ReactMigrationSliceContextItem {
  sourcePath: string;
  category: ReactMigrationFileCategory;
  sha256: string;
  size: number;
  content?: string;
  environmentKeys?: readonly string[];
  imports: readonly ReactMigrationModuleDependency[];
  exports: readonly string[];
  ownership: ReactMigrationOwnershipDecision;
}

export interface ReactMigrationSliceContext {
  planId: string;
  sliceId: string;
  sourceSnapshotSha256: string;
  packageDependencies: readonly ReactMigrationPackageDependency[];
  packageScripts: Readonly<Record<string, string>>;
  toolchain: ReactMigrationToolchainFacts;
  cursor: string;
  nextCursor?: string;
  items: readonly ReactMigrationSliceContextItem[];
}

export interface ReactMigrationOwnershipOverride {
  sourcePath: string;
  ownerKind: ReactMigrationOwnerKind;
  ownerName: string;
  ownerPath: string;
  role: ReactMigrationOwnerRole;
  rationale: string;
}

export interface ReviewReactMigrationOwnershipRequest {
  target: string;
  expectedPlanId: string;
  expectedSourceSnapshotSha256: string;
  expectedTargetSnapshotSha256: string;
  overrides: readonly ReactMigrationOwnershipOverride[];
}

export interface ReactMigrationVerification {
  checkedAt: string;
  sourceUnchanged: boolean;
  srijikaDiagnosticsValid: boolean;
  architectureValid: boolean;
  nativeCompletionValid: boolean;
  targetGraphValid: boolean;
  environmentContractValid: boolean;
  targetSnapshotSha256: string;
  wrapperFindings: readonly string[];
  unownedTargetPaths: readonly string[];
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

export interface ReactMigrationTargetModuleImport {
  specifier: string;
  kind: 'target' | 'package' | 'unresolved';
  resolvedTargetPath?: string;
  packageName?: string;
}

export type ReactMigrationTargetRole = ReactMigrationOwnerRole | 'connector' | 'entry' | 'unknown';

export interface ReactMigrationTargetModule {
  relativePath: string;
  ownerIds: readonly string[];
  roles: readonly ReactMigrationTargetRole[];
  imports: readonly ReactMigrationTargetModuleImport[];
  exports: readonly string[];
}

export interface ReactMigrationArchitectureInspection {
  sessionId: string;
  targetSnapshotSha256: string;
  modules: readonly ReactMigrationTargetModule[];
  wrapperFindings: readonly string[];
  unownedTargetPaths: readonly string[];
  graphFindings: readonly string[];
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
  reviewedSlices: readonly ReactMigrationSliceReview[];
  verification?: ReactMigrationVerification;
}

export interface StartReactMigrationRequest {
  source: string;
  target: string;
  projectName?: string;
  displayName?: string;
  dryRun?: boolean;
  /** Fail closed when a dedicated CLI or adapter selected a different source framework. */
  expectedFramework?: 'react' | 'next-app-router';
}

export interface ApplyReactMigrationSliceRequest {
  target: string;
  reviewToken: string;
}

export interface ReviewReactMigrationSliceRequest {
  target: string;
  slice: ReactMigrationSlice;
}

export interface SynchronizeReactMigrationValidatorRequest {
  target: string;
}

/** Installs a deterministic test gate for a target with a migrated real store. */
export interface SynchronizeReactMigrationTestHarnessRequest {
  target: string;
  includeInstall?: boolean;
}

/** Removes a staged, unapplied review so a corrected plan can be reviewed. */
export interface DiscardReactMigrationSliceReviewRequest {
  target: string;
  reviewToken: string;
}

export interface VerifyReactMigrationRequest {
  target: string;
  commands?: readonly ReactMigrationCommandStatus[];
}

export type ReactMigrationCliOperation =
  | 'start'
  | 'status'
  | 'plan'
  | 'context'
  | 'ownership'
  | 'review'
  | 'discard-review'
  | 'apply'
  | 'verify-slice'
  | 'parity'
  | 'verify'
  | 'finalize'
  | 'replan'
  | 'sync-validator'
  | 'sync-test-harness';

export interface ReactMigrationCliRequest {
  operation: ReactMigrationCliOperation;
  target: string;
  source?: string;
  framework?: 'react' | 'next-app-router';
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
    // Windows realpath can expand an equivalent drive/runner alias. The target
    // itself is still lstat-checked, then all migration writes are root-bound.
    if (process.platform !== 'win32' && pathKey(canonical) !== pathKey(target)) {
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
      if (process.platform !== 'win32' && pathKey(canonical) !== pathKey(existing)) {
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
const runtimeDataAssetExtension = /\.(?:csv|geojson|json|txt|wasm|webmanifest)$/iu;
const configurationFilePattern =
  /(^|\/)(?:package\.json|index\.html|tsconfig[^/]*\.json|vite\.config\.[^/]+|craco\.config\.[^/]+|next\.config\.[^/]+)$/u;

const NEXT_ROUTE_FILE_PATTERN =
  /(?:^|\/)(default|error|global-error|layout|loading|not-found|page|route|template)\.(?:[cm]?[jt]sx?)$/iu;
const NEXT_MIDDLEWARE_PATTERN = /(?:^|\/)middleware\.(?:[cm]?[jt]sx?)$/iu;
const NEXT_RUNTIME_CONFIG_PATTERN =
  /(?:^|\/)(?:next\.config\.[^/]+|instrumentation(?:-client)?\.(?:[cm]?[jt]sx?))$/iu;

function nextRouteKind(relativePath: string): ReactMigrationNextRouteKind | undefined {
  return NEXT_ROUTE_FILE_PATTERN.exec(relativePath)?.[1]?.toLowerCase() as
    ReactMigrationNextRouteKind | undefined;
}

function isUseClientSource(source: string): boolean {
  return /^\s*['"]use client['"];?/mu.test(source);
}

function isUseServerSource(source: string): boolean {
  return /^\s*['"]use server['"];?/mu.test(source) || /\{\s*['"]use server['"];?/u.test(source);
}

function importsServerOnlyRuntime(source: string): boolean {
  return /(?:from\s+|import\s*\(\s*)['"](?:server-only|next\/headers|next\/server)['"]/u.test(
    source,
  );
}

function nextRouteInventory(
  appRoot: 'app' | 'src/app',
  relativePath: string,
  source: string,
): ReactMigrationNextRouteFile | undefined {
  const kind = nextRouteKind(relativePath);
  if (!kind || !relativePath.startsWith(`${appRoot}/`)) return undefined;
  const segments = posix
    .dirname(relativePath)
    .slice(appRoot.length + 1)
    .split('/')
    .filter(Boolean);
  const routeGroups = segments.filter((segment) => /^\([^/]+\)$/u.test(segment));
  const routeSegments = segments.filter(
    (segment) => !/^\([^/]+\)$/u.test(segment) && !segment.startsWith('@'),
  );
  const dynamicSegments = routeSegments.filter((segment) => /^\[.+\]$/u.test(segment));
  return Object.freeze({
    relativePath,
    kind,
    routePath: routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`,
    segments: Object.freeze([...segments]),
    routeGroups: Object.freeze(routeGroups),
    dynamicSegments: Object.freeze(dynamicSegments),
    boundary: isUseClientSource(source) ? 'client' : 'server',
    serverAction: isUseServerSource(source),
    metadata:
      /\bexport\s+(?:const\s+(?:metadata|generateMetadata)\b|(?:async\s+)?function\s+generateMetadata\b)/u.test(
        source,
      ),
  });
}

function isNextProtectedServerFile(
  relativePath: string,
  source: string,
  appRoot: 'app' | 'src/app',
): boolean {
  if (NEXT_MIDDLEWARE_PATTERN.test(relativePath)) return true;
  if (nextRouteKind(relativePath) === 'route') return true;
  if (isUseServerSource(source) || importsServerOnlyRuntime(source)) return true;
  return (
    relativePath.startsWith(`${appRoot}/`) &&
    sourceExtension.test(relativePath) &&
    !isUseClientSource(source)
  );
}

function isNextExactFrameworkSource(
  inventory: Pick<ReactMigrationInventory, 'framework' | 'nextAppRouter'>,
  sourcePath: string,
): boolean {
  if (inventory.framework !== 'next-app-router' || !inventory.nextAppRouter) return false;
  return (
    inventory.nextAppRouter.routes.some((route) => route.relativePath === sourcePath) ||
    inventory.nextAppRouter.protectedServerFiles.includes(sourcePath) ||
    inventory.nextAppRouter.middleware.includes(sourcePath) ||
    inventory.nextAppRouter.configPaths.includes(sourcePath)
  );
}

function acceptedMigrationFile(fileName: string): boolean {
  return fileName.length > 0;
}

function categoryFor(relativePath: string): ReactMigrationFileCategory {
  const normalized = relativePath.toLowerCase();
  const name = basename(normalized);
  if (/^scripts\/[^/]+\.[cm]?[jt]s$/u.test(normalized)) return 'script';
  if (/(^|\/)\.env(?:\.|$)/u.test(normalized)) return 'environment';
  if (
    /(^|\/)(?:readme|license|changelog|authors?|agents)(?:\.|$)/u.test(normalized) ||
    /\.(?:md|txt)$/u.test(normalized)
  ) {
    return 'ancillary';
  }
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(name) || /(^|\/)__tests__(\/|$)/u.test(normalized)) {
    return 'test';
  }
  if (/\.d\.[cm]?ts$/u.test(normalized)) return 'types';
  if (styleExtension.test(normalized)) return 'style';
  if (
    configurationFilePattern.test(normalized) ||
    /(^|\/)(?:webpack|babel|postcss|tailwind|eslint|prettier|vitest|jest)\.config\.[^/]+$/u.test(
      normalized,
    ) ||
    /\.(?:ya?ml|toml)$/u.test(normalized) ||
    /(^|\/)(?:dockerfile(?:\.[^/]+)?|\.gitignore|\.dockerignore|nginx[^/]*\.conf)$/u.test(
      normalized,
    ) ||
    /(^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?)$/u.test(normalized)
  )
    return 'configuration';
  if (assetExtension.test(normalized) || runtimeDataAssetExtension.test(normalized)) return 'asset';
  if (
    /(^|\/)(?:routes?|router|routing|app-router)(?:\.[cm]?[jt]sx?|\/index\.[cm]?[jt]sx?)$/u.test(
      normalized,
    )
  )
    return 'route';
  if (/(^|\/)use[A-Z]|(^|\/)hooks?(\/|$)/u.test(relativePath)) return 'hook';
  if (
    /(^|\/)(?:stores?|state|contexts?|redux|zustand)(\/|$)|(?:store|state|context)\.[cm]?[jt]sx?$/u.test(
      normalized,
    )
  )
    return 'state';
  if (
    /(^|\/)(?:api|services?|clients?|requests?)(\/|$)|(?:api|service|client|request)\.[cm]?[jt]sx?$|service-worker|\.graphql$/u.test(
      normalized,
    )
  )
    return 'api';
  if (/^(?:src\/)?(?:main|index|app)\.[cm]?[jt]sx?$/u.test(normalized)) return 'entry';
  if (sourceExtension.test(normalized) || /\.mdx$/u.test(normalized)) return 'component';
  return 'unsupported';
}

function semanticCategory(
  relativePath: string,
  initial: ReactMigrationFileCategory,
  source: string,
): ReactMigrationFileCategory {
  if (/\.d\.[cm]?ts$/iu.test(relativePath)) return 'types';
  if (initial !== 'component') return initial;
  if (/\.(?:tsx|jsx)$/iu.test(relativePath)) {
    // Some legacy TSX modules are application-mounted behavior only: they
    // subscribe in an effect and intentionally render null. Treating them as
    // UI forces a fake Feature/Slot screen into the native target. Classify a
    // module as a Hook only when it has effect behavior, returns null, and
    // contains no JSX element at all; conditional visual components remain
    // presentation components.
    const headlessEffect =
      /\buse(?:Layout)?Effect\s*\(/u.test(source) &&
      /\breturn\s*\(?\s*null\s*\)?\s*;?/u.test(source) &&
      !/return\s*\(?\s*</u.test(source) &&
      !/<[A-Za-z][A-Za-z0-9.-]*(?:\s|>|\/)/u.test(source);
    return headlessEffect ? 'hook' : 'component';
  }
  if (/\.mdx$/iu.test(relativePath)) return 'component';
  if (
    /\b(?:interface|type)\s+[A-Z][A-Za-z0-9_]*\b/u.test(source) &&
    !/\b(?:function|const|class|let|var)\b/u.test(source)
  ) {
    return 'types';
  }
  return 'logic';
}

function packageNameForSpecifier(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/', 1)[0] ?? specifier;
}

function importedSpecifiers(source: string): readonly string[] {
  const matches = new Set<string>();
  const sourceFile = ts.createSourceFile(
    'migration-source.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      matches.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      matches.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze([...matches].sort((left, right) => left.localeCompare(right)));
}

function referencedSpecifiers(relativePath: string, source: string): readonly string[] {
  const matches = new Set(importedSpecifiers(source));
  if (styleExtension.test(relativePath)) {
    for (const match of source.matchAll(
      /@import\s+(?:url\()?\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/giu,
    )) {
      const specifier = match[1] ?? match[2];
      if (specifier && !/^(?:data:|https?:|#)/iu.test(specifier)) matches.add(specifier);
    }
  } else if (sourceExtension.test(relativePath)) {
    for (const match of source.matchAll(
      /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)|(?:serviceWorker\.register|worklet\.addModule)\(\s*["']([^"']+)["']|new\s+(?:Shared)?Worker\(\s*["']([^"']+)["']/gu,
    )) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier && !/^(?:data:|https?:|#)/iu.test(specifier)) matches.add(specifier);
    }
  }
  return Object.freeze([...matches].sort((left, right) => left.localeCompare(right)));
}

function resolveSourceDependency(
  sourcePath: string,
  specifier: string,
  sourcePaths: ReadonlySet<string>,
  aliases: Readonly<Record<string, string>> = {},
): string | undefined {
  let base: string;
  if (specifier.startsWith('.')) {
    base = posix.normalize(posix.join(posix.dirname(sourcePath), specifier));
  } else {
    const match = Object.entries(aliases).find(([pattern]) =>
      pattern.endsWith('/') ? specifier.startsWith(pattern) : specifier === pattern,
    );
    if (!match) return undefined;
    const [pattern, target] = match;
    const aliasSuffix = pattern.endsWith('/') ? specifier.slice(pattern.length) : undefined;
    base =
      aliasSuffix === undefined
        ? target
        : target.includes('*')
          ? target.replace('*', aliasSuffix)
          : posix.join(target, aliasSuffix);
  }
  const candidates = [
    base,
    ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(
      (extension) => `${base}${extension}`,
    ),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((fileName) =>
      posix.join(base, fileName),
    ),
  ];
  return candidates.find((candidate) => sourcePaths.has(candidate));
}

function sourceAliasesFromConfigs(
  configs: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  const aliases: Record<string, string> = {};
  for (const [configPath, source] of [...configs].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const parsed = ts.parseConfigFileTextToJson(configPath, source);
    if (parsed.error || !parsed.config || typeof parsed.config !== 'object') continue;
    const options = (parsed.config as { compilerOptions?: unknown }).compilerOptions;
    if (!options || typeof options !== 'object' || Array.isArray(options)) continue;
    const record = options as Record<string, unknown>;
    const baseUrl = typeof record['baseUrl'] === 'string' ? record['baseUrl'] : '.';
    const base = posix.normalize(posix.join(posix.dirname(configPath), baseUrl));
    if (base === '..' || base.startsWith('../') || posix.isAbsolute(base)) continue;
    const paths = record['paths'];
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) continue;
    for (const [rawPattern, rawTargets] of Object.entries(paths as Record<string, unknown>)) {
      if (!Array.isArray(rawTargets) || typeof rawTargets[0] !== 'string') continue;
      const wildcard =
        rawPattern.endsWith('*') &&
        (rawPattern.match(/\*/gu)?.length ?? 0) === 1 &&
        (rawTargets[0].match(/\*/gu)?.length ?? 0) === 1;
      const pattern = wildcard ? rawPattern.slice(0, -1) : rawPattern;
      const rawTarget = rawTargets[0];
      if (!pattern || pattern.includes('*')) continue;
      const target = posix.normalize(posix.join(base, rawTarget));
      if (!target || target === '..' || target.startsWith('../') || posix.isAbsolute(target))
        continue;
      if (!(pattern in aliases)) aliases[pattern] = target.replace(/\/$/u, '');
    }
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(aliases).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function canonicalName(value: string): string {
  const words = value
    .replace(/\.[^.]+$/u, '')
    .replace(/^(?:use|create|get|set)(?=[A-Z])/u, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  const corrected = words === 'dashbord' ? 'dashboard' : words;
  return corrected || 'application';
}

function pascalName(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function canonicalTargets(
  ownerKind: ReactMigrationOwnerKind,
  ownerPath: string,
  ownerName: string,
  role: ReactMigrationOwnerRole,
  sourcePath: string,
  exactFrameworkPath = false,
): readonly string[] {
  if (exactFrameworkPath) return Object.freeze([sourcePath]);
  const pascal = pascalName(ownerName);
  const base = ownerPath === '.' ? 'src' : ownerPath;
  // A package script is executable product behavior, not a browser module.
  // Preserve its command path while requiring a reviewed native mapping.
  if (sourcePath.startsWith('scripts/')) return Object.freeze([sourcePath]);
  // Presentation assets are carried as exact source artifacts. They do not
  // require a TypeScript owner scaffold, so resolve them before capability
  // generation (which intentionally has no style-only shared capability).
  if (role === 'style') return Object.freeze([`${base}/${ownerName}.css`]);
  if (role === 'asset') {
    return Object.freeze([
      sourcePath.startsWith('public/')
        ? sourcePath
        : `public/assets/${sourcePath.replace(/^src\/(?:assets?\/)?/u, '')}`,
    ]);
  }
  if (role === 'shell') return Object.freeze(['src/App.tsx', 'src/app/AppProviders.tsx']);
  const capability = ['hook', 'store', 'api', 'logic', 'types'].includes(role)
    ? ([role] as ('hook' | 'store' | 'api' | 'logic' | 'types')[])
    : [];
  const input =
    ownerKind === 'feature'
      ? {
          owner: { level: 'featuresRoot' as const, folder: 'src/features' },
          action: 'feature' as const,
          name: pascal,
        }
      : ownerKind === 'slot'
        ? {
            owner: {
              level: 'feature' as const,
              folder: ownerPath.split('/slots/')[0]!,
              featureName: pascalName(ownerPath.split('/')[2] ?? ownerName),
            },
            action: 'slot' as const,
            name: pascal,
          }
        : ownerKind === 'part'
          ? {
              owner: {
                level: 'slot' as const,
                folder: ownerPath.split('/parts/')[0]!,
                featureName: pascalName(ownerPath.split('/')[2] ?? ownerName),
                slotName: pascalName(ownerPath.split('/slots/')[1]?.split('/')[0] ?? ownerName),
              },
              action: 'part' as const,
              name: pascal,
            }
          : ownerKind === 'shared-ui' ||
              ownerKind === 'shared-widget' ||
              ownerKind === 'shared-capability'
            ? {
                owner: { level: 'sharedRoot' as const, folder: 'src/shared' },
                action:
                  ownerKind === 'shared-ui'
                    ? ('sharedUi' as const)
                    : ownerKind === 'shared-widget'
                      ? ('sharedWidget' as const)
                      : ('sharedCapability' as const),
                name: pascal,
              }
            : undefined;
  if (input) {
    const optionalCapabilities =
      input.action === 'sharedCapability' && role === 'types'
        ? (['logic', 'types'] as const)
        : capability;
    if (input.action === 'sharedCapability' && optionalCapabilities.length === 0)
      return Object.freeze([]);
    const plan = buildSrijikaOwnershipCreationPlan({ ...input, optionalCapabilities });
    const matches = plan.files
      .map((file) => file.relativePath)
      .filter((path) => {
        if (role === 'ui') return path.endsWith('.ui.tsx') || path.endsWith('.connector.tsx');
        if (role === 'route') return path.endsWith('.ui.tsx') || path.endsWith('.connector.tsx');
        if (role === 'hook') return /\/use[^/]+\.ts$/u.test(path);
        return path.endsWith(`.${role}.ts`);
      });
    if (matches.length > 0) return Object.freeze(matches);
  }
  if (role === 'test') return Object.freeze([`test/${basename(sourcePath)}`]);
  return Object.freeze([]);
}

function ownerRole(category: ReactMigrationFileCategory, source = ''): ReactMigrationOwnerRole {
  if (category === 'script') return 'configuration';
  if (category === 'entry') return 'shell';
  if (category === 'route') return 'route';
  if (category === 'component') return 'ui';
  if (category === 'hook') return 'hook';
  if (category === 'state') return 'store';
  // Browser-backed modules are runtime state, not pure Logic. Keeping them
  // in Logic or API makes the native architecture correctly reject their
  // storage, event, global-state, or dynamic-module access after migration.
  // Classify them before planning so they receive a canonical Store gateway
  // up front, regardless of a legacy services/ folder name.
  if (
    (category === 'logic' || category === 'api') &&
    /\b(?:localStorage|sessionStorage|globalThis|window|document|addEventListener|removeEventListener|dispatchEvent|CustomEvent|import\.meta\.glob)\b/u.test(
      source,
    )
  ) {
    return 'store';
  }
  if (category === 'api') return 'api';
  if (category === 'logic') return 'logic';
  if (category === 'types') return 'types';
  if (category === 'style') return 'style';
  if (category === 'asset') return 'asset';
  if (category === 'test') return 'test';
  return 'configuration';
}

/**
 * A Shared UI primitive must be able to render directly from named props.
 * Legacy components that calculate view models, own branches, or invoke hooks
 * need a Connector, so their canonical shared owner is a Widget instead.
 *
 * This is intentionally conservative: a false positive creates a Widget
 * (which can still render a pure view), whereas a false negative creates an
 * impossible Shared UI migration that the architecture validator will reject.
 */
function componentNeedsWidgetBoundary(source: string): boolean {
  const componentBody =
    /(?:export\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^={]+)?\{([\s\S]*)\}\s*$/u.exec(
      source,
    )?.[1] ?? source;
  return /\b(?:use[A-Z][A-Za-z0-9_$]*|const|let|if|switch|try|catch|for|while|do)\b/u.test(
    componentBody,
  );
}

function seededOwner(
  file: ReactMigrationInventoryFile,
  exactFrameworkPath = false,
  appRoot: 'app' | 'src/app' = 'app',
): Pick<ReactMigrationOwnershipDecision, 'ownerKind' | 'ownerName' | 'ownerPath' | 'rationale'> {
  if (exactFrameworkPath) {
    const projectOwned = NEXT_RUNTIME_CONFIG_PATTERN.test(file.relativePath);
    const frameworkOwnerPath = posix.dirname(file.relativePath);
    return {
      ownerKind: projectOwned ? 'project' : 'application',
      ownerName: projectOwned
        ? 'project'
        : canonicalName(
            frameworkOwnerPath === '.' ? basename(file.relativePath) : frameworkOwnerPath,
          ),
      ownerPath: projectOwned ? '.' : frameworkOwnerPath === '.' ? appRoot : frameworkOwnerPath,
      rationale:
        'Next.js owns this runtime surface; migration preserves its framework path and server boundary.',
    };
  }
  const segments = file.relativePath.split('/');
  const srcIndex = segments.indexOf('src');
  const afterSrc = srcIndex >= 0 ? segments.slice(srcIndex + 1) : segments;
  const markerIndex = afterSrc.findIndex((segment) =>
    ['modules', 'features', 'pages', 'routes', 'plugins', 'core'].includes(segment.toLowerCase()),
  );
  const marker = markerIndex >= 0 ? afterSrc[markerIndex]!.toLowerCase() : undefined;
  const seededSegment = markerIndex >= 0 ? afterSrc[markerIndex + 1] : undefined;
  const stem = canonicalName(seededSegment ?? basename(file.relativePath));
  if (file.category === 'entry') {
    return {
      ownerKind: 'application',
      ownerName: 'application',
      ownerPath: 'src/app',
      rationale: 'Application entrypoints deterministically belong to the Srijika app shell.',
    };
  }
  if (file.category === 'script') {
    return {
      ownerKind: 'project',
      ownerName: canonicalName(basename(file.relativePath)),
      ownerPath: '.',
      rationale:
        'An executable project script remains a separately reviewed native project command.',
    };
  }
  if (afterSrc[0]?.toLowerCase() === 'shared') {
    const role = ownerRole(file.category);
    const candidate = afterSrc.find(
      (segment, index) =>
        index > 0 &&
        index < afterSrc.length - 1 &&
        !['components', 'ui', 'hooks', 'stores', 'state', 'api', 'utils', 'lib'].includes(
          segment.toLowerCase(),
        ),
    );
    const name = canonicalName(candidate ?? basename(file.relativePath));
    if (role === 'ui') {
      return {
        ownerKind: 'shared-ui',
        ownerName: name,
        ownerPath: `src/shared/ui/${name}`,
        rationale: 'The explicit source shared boundary and UI role prove shared UI ownership.',
      };
    }
    return {
      ownerKind: 'shared-capability',
      ownerName: name,
      ownerPath: `src/shared/capabilities/${name}`,
      rationale: 'The explicit source shared boundary proves shared capability ownership.',
    };
  }
  if (marker && ['modules', 'features', 'pages', 'routes'].includes(marker) && seededSegment) {
    const ownerOffset = markerIndex + 2;
    const nested = afterSrc.slice(ownerOffset, -1);
    // Legacy module folders such as hooks/services/store/controllers/models are
    // capabilities of one Feature, not presentational Slots. Treating each as
    // a Slot forces fake UI/Connector files and makes normal auth/data flows
    // impossible to migrate natively.
    if (
      nested[0] &&
      ['hooks', 'services', 'store', 'stores', 'controllers', 'models', 'utils', 'lib'].includes(
        nested[0].toLowerCase(),
      )
    ) {
      return {
        ownerKind: 'feature',
        ownerName: stem,
        ownerPath: `src/features/${stem}`,
        rationale: `The ${marker}/${seededSegment} capability subtree remains inside its Feature owner.`,
      };
    }
    const explicitSlot = nested.findIndex((segment) => segment.toLowerCase() === 'slots');
    const explicitPart = nested.findIndex((segment) => segment.toLowerCase() === 'parts');
    const structural = nested.findIndex((segment) =>
      ['components', 'sections', 'widgets', 'panels'].includes(segment.toLowerCase()),
    );
    const slotSeed =
      explicitSlot >= 0
        ? nested[explicitSlot + 1]
        : structural >= 0
          ? (nested[structural + 1] ?? basename(file.relativePath))
          : undefined;
    const partSeed =
      explicitPart >= 0
        ? nested[explicitPart + 1]
        : structural >= 0 && nested.length > structural + 2
          ? nested.at(-1)
          : undefined;
    if (partSeed && slotSeed) {
      const slotName = canonicalName(slotSeed);
      const partName = canonicalName(partSeed);
      return {
        ownerKind: 'part',
        ownerName: partName,
        ownerPath: `src/features/${stem}/slots/${slotName}/parts/${partName}`,
        rationale: `The ${marker}/${seededSegment} import subtree deterministically places this module in ${slotName}/${partName}.`,
      };
    }
    if (slotSeed) {
      const slotName = canonicalName(slotSeed);
      return {
        ownerKind: 'slot',
        ownerName: slotName,
        ownerPath: `src/features/${stem}/slots/${slotName}`,
        rationale: `The ${marker}/${seededSegment} composition subtree deterministically defines the ${slotName} Slot.`,
      };
    }
    return {
      ownerKind: 'feature',
      ownerName: stem,
      ownerPath: `src/features/${stem}`,
      rationale: `The source ${marker}/${seededSegment} boundary is a deterministic feature seed.`,
    };
  }
  if (marker === 'plugins' && seededSegment) {
    return {
      ownerKind: 'feature',
      ownerName: stem,
      ownerPath: `src/features/${stem}`,
      rationale: `The source plugin root is an isolated ${stem} feature until cross-owner consumers prove promotion.`,
    };
  }
  if (marker === 'core' && seededSegment) {
    return {
      ownerKind: 'feature',
      ownerName: stem,
      ownerPath: `src/features/${stem}`,
      rationale: `The source core root remains a ${stem} feature until multiple owner consumers prove sharing.`,
    };
  }
  if (/\/(?:components?|ui)\//iu.test(`/${file.relativePath}`) || file.category === 'component') {
    return {
      ownerKind: 'feature',
      ownerName: stem,
      ownerPath: `src/features/${stem}`,
      rationale:
        'A source component remains feature-local until multiple owner consumers prove sharing.',
    };
  }
  if (['hook', 'state', 'api'].includes(file.category)) {
    return {
      ownerKind: 'feature',
      ownerName: stem,
      ownerPath: `src/features/${stem}`,
      rationale: 'Behavior remains feature-local until multiple owner consumers prove sharing.',
    };
  }
  if (afterSrc.length > 1 && afterSrc[0]) {
    const directorySeed = canonicalName(afterSrc[0]);
    return {
      ownerKind: 'feature',
      ownerName: directorySeed,
      ownerPath: `src/features/${directorySeed}`,
      rationale: `The stable source directory ${afterSrc[0]} groups this module into one feature owner.`,
    };
  }
  return {
    ownerKind: 'project',
    ownerName: 'project',
    ownerPath: '.',
    rationale: 'This file is project-level evidence, presentation, or configuration.',
  };
}

const ADAPTER_PACKAGES: Readonly<Record<ReactMigrationLegacyAdapterId, readonly string[]>> = {
  'react-router': ['react-router', 'react-router-dom', '@tanstack/react-router', 'wouter'],
  redux: ['redux', 'react-redux', '@reduxjs/toolkit'],
  zustand: ['zustand'],
  'react-context': [],
  'css-modules': [],
  'styled-components': ['styled-components', '@emotion/react', '@emotion/styled'],
};

function detectedAdapters(
  sourcePath: string,
  source: string,
  packages: readonly string[],
): readonly ReactMigrationLegacyAdapterId[] {
  const adapters = new Set<ReactMigrationLegacyAdapterId>();
  for (const [id, supportedPackages] of Object.entries(ADAPTER_PACKAGES) as Array<
    [ReactMigrationLegacyAdapterId, readonly string[]]
  >) {
    if (supportedPackages.some((packageName) => packages.includes(packageName))) adapters.add(id);
  }
  if (/\b(?:createContext|useContext)\b/u.test(source)) adapters.add('react-context');
  if (
    /\.module\.(?:css|scss|sass|less)$/iu.test(sourcePath) ||
    /\.module\.(?:css|scss|sass|less)['"]/u.test(source)
  ) {
    adapters.add('css-modules');
  }
  return Object.freeze([...adapters].sort());
}

function completionObligation(
  category: ReactMigrationFileCategory,
  sourcePath: string,
): ReactMigrationCompletionObligation {
  if (category === 'asset') return 'content-addressed-asset';
  if (category === 'types' && /\.d\.tsx?$/iu.test(sourcePath)) {
    return 'excluded-nonruntime';
  }
  if (['environment', 'configuration', 'ancillary'].includes(category))
    return 'excluded-nonruntime';
  return 'native-owner';
}

function stronglyConnectedSourceComponents(
  files: readonly ReactMigrationInventoryFile[],
  dependencies: ReadonlyMap<string, readonly ReactMigrationModuleDependency[]>,
): ReadonlyMap<string, string> {
  const sourcePaths = files
    .filter(
      (file) => sourceExtension.test(file.relativePath) || /\.mdx?$/iu.test(file.relativePath),
    )
    .map((file) => file.relativePath)
    .sort((left, right) => left.localeCompare(right));
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;
  const visit = (sourcePath: string): void => {
    indexes.set(sourcePath, nextIndex);
    lowLinks.set(sourcePath, nextIndex);
    nextIndex += 1;
    stack.push(sourcePath);
    stacked.add(sourcePath);
    const targets = (dependencies.get(sourcePath) ?? [])
      .flatMap((dependency) => dependency.resolvedSourcePath ?? [])
      .sort((left, right) => left.localeCompare(right));
    for (const target of targets) {
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(sourcePath, Math.min(lowLinks.get(sourcePath)!, lowLinks.get(target)!));
      } else if (stacked.has(target)) {
        lowLinks.set(sourcePath, Math.min(lowLinks.get(sourcePath)!, indexes.get(target)!));
      }
    }
    if (lowLinks.get(sourcePath) !== indexes.get(sourcePath)) return;
    const component: string[] = [];
    for (;;) {
      const member = stack.pop();
      if (!member) break;
      stacked.delete(member);
      component.push(member);
      if (member === sourcePath) break;
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  };
  for (const sourcePath of sourcePaths) if (!indexes.has(sourcePath)) visit(sourcePath);
  const output = new Map<string, string>();
  for (const members of components) {
    const id = sha256(members.join('\0')).slice(0, 16);
    for (const member of members) output.set(member, id);
  }
  return output;
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

function runtimeEnvironmentKeys(source: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(
    /(?:import\.meta\.env|process\.env)(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\])/gu,
  )) {
    const key = match[1] ?? match[2];
    if (key) keys.add(key);
  }
  for (const match of source.matchAll(
    /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:import\.meta\.env|process\.env)\b/gu,
  )) {
    for (const binding of (match[1] ?? '').split(',')) {
      const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(binding)?.[1];
      if (key) keys.add(key);
    }
  }
  return Object.freeze([...keys].sort());
}

function containsSemanticRouteBehavior(source: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return false;
  }
  return /(?:\bcreate(?:Browser|Hash|Memory)Router\b|\bcreateRoutesFromElements\b|\bRouterProvider\b|<Route\b|\bexport\s+(?:const|let|var)\s+routes\b)/u.test(
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
  const dependencyScopes = [
    ['dependencies', 'dependency'],
    ['devDependencies', 'devDependency'],
    ['peerDependencies', 'peerDependency'],
    ['optionalDependencies', 'optionalDependency'],
  ] as const;
  const packageDependencyRecords = dependencyScopes
    .flatMap(([field, scope]) => {
      const values = packageJson[field];
      if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
      return Object.entries(values as Record<string, unknown>).flatMap(
        ([name, version]): ReactMigrationPackageDependency[] =>
          typeof version === 'string'
            ? [
                Object.freeze({
                  name,
                  version,
                  scope,
                  unsafeLocalReference: /^(?:file:|link:|workspace:|\.{1,2}\/|\/)/u.test(version),
                }),
              ]
            : [],
      );
    })
    .sort(
      (left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name),
    );
  const packageScripts = Object.freeze(
    Object.fromEntries(
      Object.entries(
        packageJson['scripts'] && typeof packageJson['scripts'] === 'object'
          ? (packageJson['scripts'] as Record<string, unknown>)
          : {},
      )
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  const dependencies = {
    ...(typeof packageJson['dependencies'] === 'object' && packageJson['dependencies'] !== null
      ? (packageJson['dependencies'] as Record<string, unknown>)
      : {}),
    ...(typeof packageJson['devDependencies'] === 'object' &&
    packageJson['devDependencies'] !== null
      ? (packageJson['devDependencies'] as Record<string, unknown>)
      : {}),
  };
  const dependencyVersions = Object.freeze(
    Object.fromEntries(
      Object.entries(dependencies).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  );
  if (typeof dependencies['react'] !== 'string') {
    throw new Error('Phase 1 accepts React projects only; package.json must declare react.');
  }
  const nextVersion = typeof dependencies['next'] === 'string' ? dependencies['next'] : undefined;
  for (const unsupported of ['@remix-run/react', 'react-native', 'expo']) {
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
    stopAtNestedProjectRoots: false,
    acceptFile: acceptedMigrationFile,
  });
  const nextAppRoots = nextVersion
    ? (['app', 'src/app'] as const).filter((candidate) =>
        files.some(({ relativePath }) => relativePath.startsWith(`${candidate}/`)),
      )
    : [];
  if (nextVersion && nextAppRoots.length !== 1) {
    throw new Error('Next.js migration requires exactly one App Router root: app or src/app.');
  }
  const nextAppRoot = nextAppRoots[0];
  const inventory: ReactMigrationInventoryFile[] = [];
  const sourceTexts = new Map<string, string>();
  const tsconfigTexts = new Map<string, string>();
  const environment: Record<string, readonly string[]> = {};
  let totalBytes = 0;
  let semanticRoutesPresent = false;
  for (const file of files) {
    const read = await readSafeBytes(fileSystem, file.relativePath);
    totalBytes += read.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('React migration source exceeds the 64 MiB aggregate safety limit.');
    }
    let category = categoryFor(file.relativePath);
    if (
      nextAppRoot &&
      file.relativePath.startsWith(`${nextAppRoot}/`) &&
      nextRouteKind(file.relativePath)
    ) {
      category = nextRouteKind(file.relativePath) === 'route' ? 'api' : 'route';
    } else if (nextAppRoot && NEXT_MIDDLEWARE_PATTERN.test(file.relativePath)) {
      category = 'api';
    } else if (nextAppRoot && NEXT_RUNTIME_CONFIG_PATTERN.test(file.relativePath)) {
      category = 'script';
    }
    if (category === 'environment') environment[file.relativePath] = environmentKeys(read.bytes);
    if (sourceExtension.test(file.relativePath) && containsSemanticRouteBehavior(read.bytes)) {
      semanticRoutesPresent = true;
    }
    if (
      sourceExtension.test(file.relativePath) ||
      styleExtension.test(file.relativePath) ||
      /\.(?:mdx?|graphql)$/iu.test(file.relativePath)
    ) {
      try {
        const source = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
        sourceTexts.set(file.relativePath, source);
        category = semanticCategory(file.relativePath, category, source);
        const usedEnvironmentKeys = runtimeEnvironmentKeys(source);
        if (usedEnvironmentKeys.length > 0) environment[file.relativePath] = usedEnvironmentKeys;
      } catch {
        category = 'unsupported';
      }
    }
    if (/(^|\/)tsconfig[^/]*\.json$/iu.test(file.relativePath)) {
      try {
        tsconfigTexts.set(
          file.relativePath,
          new TextDecoder('utf-8', { fatal: true }).decode(read.bytes),
        );
      } catch {
        category = 'unsupported';
      }
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
  if (
    !inventory.some(
      (file) =>
        file.category === 'entry' ||
        file.category === 'component' ||
        (nextAppRoot && nextRouteKind(file.relativePath) !== undefined),
    )
  ) {
    throw new Error('No React source entry or component was found in the source project.');
  }
  const hasTypeScript = inventory.some((file) => /\.(?:ts|tsx|mts|cts)$/iu.test(file.relativePath));
  const hasJavaScript = inventory.some((file) => /\.(?:js|jsx|mjs|cjs)$/iu.test(file.relativePath));
  const framework = nextVersion
    ? 'next-app-router'
    : typeof dependencies['vite'] === 'string'
      ? 'vite'
      : typeof dependencies['react-scripts'] === 'string'
        ? 'create-react-app'
        : 'react';
  const snapshotSha256 = sha256(
    inventory.map((file) => `${file.relativePath}\0${file.size}\0${file.sha256}`).join('\n'),
  );
  const packageDependencies = Object.keys(dependencies)
    .filter((packageName) => typeof dependencies[packageName] === 'string')
    .sort((left, right) => left.localeCompare(right));
  const inventoryPaths = new Set(inventory.map((file) => file.relativePath));
  const sourceAliases = sourceAliasesFromConfigs(tsconfigTexts);
  const nextRoutes = nextAppRoot
    ? inventory.flatMap((file) => {
        const route = nextRouteInventory(
          nextAppRoot,
          file.relativePath,
          sourceTexts.get(file.relativePath) ?? '',
        );
        return route ? [route] : [];
      })
    : [];
  const payloadProfile = nextAppRoot
    ? analyzeSrijikaPayloadNextProfile({
        dependencies: dependencyVersions,
        appRoot: nextAppRoot,
        files: inventory.map((file) => ({
          relativePath: file.relativePath,
          source: sourceTexts.get(file.relativePath) ?? '',
        })),
      })
    : null;
  const nextProtectedServerFiles = nextAppRoot
    ? [
        ...new Set([
          ...inventory
            .filter((file) =>
              isNextProtectedServerFile(
                file.relativePath,
                sourceTexts.get(file.relativePath) ?? '',
                nextAppRoot,
              ),
            )
            .map((file) => file.relativePath),
          ...(payloadProfile?.detected ? payloadProfile.protectedServerFiles : []),
        ]),
      ].sort()
    : [];
  const nextAppRouter: ReactMigrationNextAppRouterInventory | undefined = nextAppRoot
    ? Object.freeze({
        appRoot: nextAppRoot,
        routes: Object.freeze(nextRoutes),
        protectedServerFiles: Object.freeze(nextProtectedServerFiles),
        middleware: Object.freeze(
          inventory
            .filter((file) => NEXT_MIDDLEWARE_PATTERN.test(file.relativePath))
            .map((file) => file.relativePath)
            .sort(),
        ),
        publicAssets: Object.freeze(
          inventory
            .filter((file) => file.relativePath.startsWith('public/'))
            .map((file) => file.relativePath)
            .sort(),
        ),
        configPaths: Object.freeze(
          inventory
            .filter(
              (file) =>
                NEXT_RUNTIME_CONFIG_PATTERN.test(file.relativePath) ||
                (file.category === 'configuration' &&
                  /(?:^|\/)(?:tsconfig[^/]*\.json|postcss\.config\.[^/]+|tailwind\.config\.[^/]+)$/iu.test(
                    file.relativePath,
                  )),
            )
            .map((file) => file.relativePath)
            .sort(),
        ),
        payload: payloadProfile?.detected ? payloadProfile : null,
      })
    : undefined;
  const exactFrameworkSources = new Set([
    ...(nextAppRouter?.routes.map((route) => route.relativePath) ?? []),
    ...(nextAppRouter?.protectedServerFiles ?? []),
    ...(nextAppRouter?.middleware ?? []),
    ...(nextAppRouter?.configPaths.filter((path) => NEXT_RUNTIME_CONFIG_PATTERN.test(path)) ?? []),
  ]);
  const dependencyMap = new Map<string, readonly ReactMigrationModuleDependency[]>();
  for (const file of inventory) {
    const source = sourceTexts.get(file.relativePath) ?? '';
    const dependenciesForFile = referencedSpecifiers(file.relativePath, source).map(
      (specifier): ReactMigrationModuleDependency => {
        const resolvedSourcePath = resolveSourceDependency(
          file.relativePath,
          specifier,
          inventoryPaths,
          sourceAliases,
        );
        return resolvedSourcePath
          ? { specifier, kind: 'source', resolvedSourcePath }
          : specifier.startsWith('.') ||
              Object.keys(sourceAliases).some((pattern) =>
                pattern.endsWith('/') ? specifier.startsWith(pattern) : specifier === pattern,
              )
            ? { specifier, kind: 'unresolved-source' }
            : { specifier, kind: 'package', packageName: packageNameForSpecifier(specifier) };
      },
    );
    dependencyMap.set(file.relativePath, Object.freeze(dependenciesForFile));
  }
  const graphComponents = stronglyConnectedSourceComponents(inventory, dependencyMap);
  const baseOwners = new Map(
    inventory.map(
      (file) =>
        [
          file.relativePath,
          seededOwner(file, exactFrameworkSources.has(file.relativePath), nextAppRoot),
        ] as const,
    ),
  );
  const consumerOwners = new Map<string, Set<string>>();
  const directConsumers = new Map<string, Set<string>>();
  const promotionConsumer = (
    owner: Pick<ReactMigrationOwnershipDecision, 'ownerKind' | 'ownerPath'>,
  ): string | undefined => {
    if (owner.ownerKind === 'application') return 'application';
    const feature = /^src\/features\/([^/]+)/u.exec(owner.ownerPath)?.[1];
    return feature ? `feature:${feature}` : undefined;
  };
  for (const [consumerPath, moduleDependencies] of dependencyMap) {
    const consumer = baseOwners.get(consumerPath);
    if (!consumer) continue;
    const meaningfulConsumer = promotionConsumer(consumer);
    if (!meaningfulConsumer) continue;
    for (const dependency of moduleDependencies) {
      if (!dependency.resolvedSourcePath) continue;
      const direct = directConsumers.get(dependency.resolvedSourcePath) ?? new Set<string>();
      direct.add(consumerPath);
      directConsumers.set(dependency.resolvedSourcePath, direct);
      const owners = consumerOwners.get(dependency.resolvedSourcePath) ?? new Set<string>();
      owners.add(meaningfulConsumer);
      consumerOwners.set(dependency.resolvedSourcePath, owners);
    }
  }
  const seededOwnership = inventory.map((file): ReactMigrationOwnershipDecision => {
    const stylePeer =
      file.category === 'style'
        ? inventory.find(
            (candidate) =>
              candidate.category === 'component' &&
              posix.dirname(candidate.relativePath) === posix.dirname(file.relativePath) &&
              canonicalName(basename(candidate.relativePath)) ===
                canonicalName(basename(file.relativePath)),
          )
        : undefined;
    const base = stylePeer
      ? baseOwners.get(stylePeer.relativePath)!
      : baseOwners.get(file.relativePath)!;
    const source = sourceTexts.get(file.relativePath) ?? '';
    const role =
      exactFrameworkSources.has(file.relativePath) && nextAppRoot
        ? NEXT_RUNTIME_CONFIG_PATTERN.test(file.relativePath)
          ? 'configuration'
          : nextRouteKind(file.relativePath) && nextRouteKind(file.relativePath) !== 'route'
            ? 'route'
            : /\.(?:tsx|jsx)$/iu.test(file.relativePath) && !isUseServerSource(source)
              ? 'route'
              : 'api'
        : ownerRole(file.category, source);
    const distinctConsumers = consumerOwners.get(file.relativePath) ?? new Set<string>();
    const independentlyUsedTopLevelStore =
      file.relativePath.startsWith('devtools/') &&
      role === 'store' &&
      (directConsumers.get(file.relativePath)?.size ?? 0) >= 2;
    // Legacy module files are application-specific export façades. Their
    // import count records legacy wiring, not proof that the implementation
    // itself is a reusable Shared capability. Keeping them feature-local
    // prevents artificial feature↔shared dependency cycles during the native
    // rewrite; real shared promotion remains available for implementation
    // modules with independently proven consumers.
    const legacyModuleFacade = /(?:^|\/)module\.(?:[cm]?[jt]sx?)$/iu.test(file.relativePath);
    const crossOwnerShared =
      base.ownerKind !== 'application' &&
      base.ownerKind !== 'project' &&
      !legacyModuleFacade &&
      distinctConsumers.size >= 2;
    const seed = independentlyUsedTopLevelStore
      ? {
          ownerKind: 'shared-capability' as const,
          ownerName: canonicalName(basename(file.relativePath)),
          ownerPath: `src/shared/capabilities/${canonicalName(basename(file.relativePath))}`,
          rationale:
            'A top-level debugger Store is independently consumed by multiple runtime modules, so it is a headless Shared capability rather than a presentational Slot.',
        }
      : crossOwnerShared
        ? file.category === 'component'
          ? componentNeedsWidgetBoundary(source)
            ? {
                ownerKind: 'shared-widget' as const,
                ownerName: base.ownerName,
                ownerPath: `src/shared/widgets/${base.ownerName}`,
                rationale: `${distinctConsumers.size} distinct owner consumers prove this presentation is shared, and its runtime calculations require a Widget Connector boundary.`,
              }
            : {
                ownerKind: 'shared-ui' as const,
                ownerName: base.ownerName,
                ownerPath: `src/shared/ui/${base.ownerName}`,
                rationale: `${distinctConsumers.size} distinct owner consumers prove this UI is shared.`,
              }
          : {
              ownerKind: 'shared-capability' as const,
              ownerName: base.ownerName,
              ownerPath: `src/shared/capabilities/${base.ownerName}`,
              rationale: `${distinctConsumers.size} distinct owner consumers prove this capability is shared.`,
            }
        : base;
    const packageImports = (dependencyMap.get(file.relativePath) ?? []).flatMap((dependency) =>
      dependency.packageName ? [dependency.packageName] : [],
    );
    const ownerId = `${seed.ownerKind}:${seed.ownerPath}`;
    return Object.freeze({
      sourcePath: file.relativePath,
      ownerId,
      ...seed,
      role,
      canonicalTargetPaths: canonicalTargets(
        seed.ownerKind,
        seed.ownerPath,
        seed.ownerName,
        role,
        file.relativePath,
        exactFrameworkSources.has(file.relativePath),
      ),
      dependencies: dependencyMap.get(file.relativePath) ?? Object.freeze([]),
      graphComponentId:
        graphComponents.get(file.relativePath) ?? sha256(file.relativePath).slice(0, 16),
      routeEntrypoint: nextAppRoot
        ? nextRoutes.some(
            (route) => route.relativePath === file.relativePath && route.kind === 'page',
          )
        : file.category === 'route' ||
          (sourceExtension.test(file.relativePath) &&
            containsSemanticRouteBehavior(Buffer.from(source))),
      completionObligation: completionObligation(file.category, file.relativePath),
      approvedLegacyAdapters: detectedAdapters(file.relativePath, source, packageImports),
    });
  });
  const targetClaims = new Map<string, string[]>();
  for (const decision of seededOwnership) {
    if (decision.completionObligation !== 'native-owner') continue;
    for (const targetPath of decision.canonicalTargetPaths) {
      const sources = targetClaims.get(targetPath) ?? [];
      sources.push(decision.sourcePath);
      targetClaims.set(targetPath, sources);
    }
  }
  // A native owner maps one source responsibility to canonical gateway files.
  // Collapsing unrelated legacy modules merely because they share a category
  // creates an unreviewable mega-file, so every duplicate canonical claim is
  // deterministically decomposed before a model sees the plan.
  const collidingSources = new Set(
    [...targetClaims.values()].filter((sources) => sources.length > 1).flat(),
  );
  const decisionsByOwner = new Map<string, ReactMigrationOwnershipDecision[]>();
  for (const decision of seededOwnership) {
    const decisions = decisionsByOwner.get(decision.ownerId) ?? [];
    decisions.push(decision);
    decisionsByOwner.set(decision.ownerId, decisions);
  }
  // Keep one deterministic presentation source at a Feature root. Its Types
  // and other non-colliding local companions can then remain in that Feature
  // and be migrated atomically with the UI/Connector pair. All additional UI
  // peers become Slots below; an isolated headless responsibility becomes a
  // Shared Capability rather than a Slot/Part that would require a fake UI.
  const primaryPresentationByOwner = new Map<string, string>();
  for (const [ownerId, decisions] of decisionsByOwner) {
    const primary = decisions
      .filter(
        (decision) =>
          decision.ownerKind === 'feature' && (decision.role === 'ui' || decision.role === 'route'),
      )
      .map((decision) => decision.sourcePath)
      .sort((left, right) => left.localeCompare(right))[0];
    if (primary) primaryPresentationByOwner.set(ownerId, primary);
  }
  const allocatedOwnerPaths = new Set(
    seededOwnership
      .filter((decision) => !collidingSources.has(decision.sourcePath))
      .map((decision) => decision.ownerPath),
  );
  const decomposedOwnership = seededOwnership.map((decision): ReactMigrationOwnershipDecision => {
    const isColliding = collidingSources.has(decision.sourcePath);
    const headlessRole = ['hook', 'store', 'api', 'logic', 'types', 'style'].includes(
      decision.role,
    );
    const primaryPresentation = primaryPresentationByOwner.get(decision.ownerId);
    const headlessFeatureLike = ['feature', 'slot', 'part'].includes(decision.ownerKind);
    // A controller is a feature-local orchestration boundary by default. It
    // commonly coordinates that Feature's API and Store, so promoting it to
    // Shared would create an illegal Shared → Feature import. Only explicit
    // multi-owner evidence may promote such a controller later.
    const featureController = /(?:^|\/)controllers?\//iu.test(decision.sourcePath);
    // A legacy module façade is only a feature-local export surface. Its
    // multiple consumers describe old wiring, not a reusable native runtime
    // capability; promoting it to Shared would both duplicate its concrete
    // implementation and make later imports ambiguous.
    const legacyModuleFacade = /(?:^|\/)module\.(?:[cm]?[jt]sx?)$/iu.test(decision.sourcePath);
    const extractHeadlessCapability =
      headlessRole &&
      headlessFeatureLike &&
      !featureController &&
      !legacyModuleFacade &&
      (isColliding || primaryPresentation === undefined);
    if (!isColliding && !extractHeadlessCapability) return decision;
    // Preserve an engine-proven Shared placement while decomposing a canonical
    // collision. Re-seeding a promoted Shared capability from its legacy path
    // turns it back into a Feature and then into a Slot, which incorrectly
    // demands a fake UI/Connector for a genuinely headless Store/Hook/API.
    // Each colliding Shared responsibility instead gets its own canonical
    // Shared owner below.
    const localSeed = decision;
    const childKind =
      !extractHeadlessCapability &&
      localSeed.ownerKind === 'feature' &&
      primaryPresentation !== decision.sourcePath
        ? 'slot'
        : !extractHeadlessCapability && localSeed.ownerKind === 'slot'
          ? 'part'
          : undefined;
    // A colliding controller stays a Feature-local Logic companion. Giving it
    // a Slot name would require an invented UI/Connector pair, while moving it
    // to Shared would make its Feature API dependency illegal. Its source
    // basename supplies the distinct canonical Logic filename instead.
    const keepsFeatureLocalController =
      featureController && localSeed.ownerKind === 'feature' && childKind === 'slot';
    const resolvedOwnerKind = extractHeadlessCapability
      ? ('shared-capability' as const)
      : keepsFeatureLocalController
        ? localSeed.ownerKind
        : (childKind ?? localSeed.ownerKind);
    const keepsPrimaryFeature =
      !extractHeadlessCapability &&
      childKind === undefined &&
      primaryPresentation === decision.sourcePath;
    if (
      !childKind &&
      !extractHeadlessCapability &&
      !localSeed.ownerKind.startsWith('shared-') &&
      !keepsPrimaryFeature &&
      !keepsFeatureLocalController
    ) {
      return decision;
    }
    const baseName = canonicalName(basename(decision.sourcePath));
    // A retained primary Feature must keep the name implied by its existing
    // canonical owner path. Using the legacy file basename here makes
    // project-scaffold create a different Feature folder and later violates
    // the engine's owner-containment guard.
    let ownerName =
      keepsPrimaryFeature || keepsFeatureLocalController ? localSeed.ownerName : baseName;
    const sharedFolder =
      resolvedOwnerKind === 'shared-ui'
        ? 'ui'
        : resolvedOwnerKind === 'shared-widget'
          ? 'widgets'
          : 'capabilities';
    let ownerPath =
      keepsPrimaryFeature || keepsFeatureLocalController
        ? localSeed.ownerPath
        : childKind
          ? childKind === 'slot'
            ? `${localSeed.ownerPath}/slots/${ownerName}`
            : `${localSeed.ownerPath}/parts/${ownerName}`
          : `src/shared/${sharedFolder}/${ownerName}`;
    if (
      !keepsPrimaryFeature &&
      !keepsFeatureLocalController &&
      allocatedOwnerPaths.has(ownerPath)
    ) {
      ownerName = `${baseName}-${sha256(decision.sourcePath).slice(0, 6)}`;
      ownerPath = childKind
        ? childKind === 'slot'
          ? `${localSeed.ownerPath}/slots/${ownerName}`
          : `${localSeed.ownerPath}/parts/${ownerName}`
        : `src/shared/${sharedFolder}/${ownerName}`;
    }
    allocatedOwnerPaths.add(ownerPath);
    return Object.freeze({
      ...decision,
      ownerKind: resolvedOwnerKind,
      ownerName,
      ownerPath,
      ownerId: `${resolvedOwnerKind}:${ownerPath}`,
      rationale: `${localSeed.rationale} ${
        extractHeadlessCapability
          ? `A standalone headless ${decision.role} responsibility was deterministically placed in Shared Capability ${ownerName}.`
          : keepsPrimaryFeature
            ? `The deterministic primary presentation remains in Feature ${ownerName}.`
            : keepsFeatureLocalController
              ? `A colliding Feature controller remains local as ${ownerName}.logic rather than becoming a fake Slot or forbidden Shared dependency.`
              : `A duplicate canonical claim was deterministically decomposed into the ${ownerName} ${resolvedOwnerKind}.`
      }`,
      canonicalTargetPaths: canonicalTargets(
        resolvedOwnerKind,
        ownerPath,
        ownerName,
        decision.role,
        decision.sourcePath,
      ),
    });
  });
  // A Shared owner may consume only another Shared boundary. When a legacy
  // React-context/store is rehomed as Shared and it imports a passive Feature
  // Types contract, promote that contract deterministically as well. This is
  // not a broad convenience promotion: it is the only native placement that
  // prevents a forbidden Shared → Feature dependency while keeping the type
  // import passive and explicit.
  const decomposedBySource = new Map(
    decomposedOwnership.map((decision) => [decision.sourcePath, decision]),
  );
  const typesRequiredByShared = new Set<string>();
  for (const consumer of decomposedOwnership) {
    if (!consumer.ownerKind.startsWith('shared-')) continue;
    for (const dependency of consumer.dependencies) {
      if (!dependency.resolvedSourcePath) continue;
      const provider = decomposedBySource.get(dependency.resolvedSourcePath);
      if (provider?.role === 'types' && !provider.ownerKind.startsWith('shared-')) {
        typesRequiredByShared.add(provider.sourcePath);
      }
    }
  }
  const occupiedPromotionPaths = new Set(
    decomposedOwnership
      .filter((decision) => !typesRequiredByShared.has(decision.sourcePath))
      .map((decision) => decision.ownerPath),
  );
  const ownership = decomposedOwnership.map((decision): ReactMigrationOwnershipDecision => {
    if (!typesRequiredByShared.has(decision.sourcePath)) return decision;
    const baseName = canonicalName(basename(decision.sourcePath));
    let ownerName = baseName;
    let ownerPath = `src/shared/capabilities/${ownerName}`;
    if (occupiedPromotionPaths.has(ownerPath)) {
      ownerName = `${baseName}-${sha256(decision.sourcePath).slice(0, 6)}`;
      ownerPath = `src/shared/capabilities/${ownerName}`;
    }
    occupiedPromotionPaths.add(ownerPath);
    return Object.freeze({
      ...decision,
      ownerKind: 'shared-capability',
      ownerId: `shared-capability:${ownerPath}`,
      ownerName,
      ownerPath,
      rationale: `${decision.rationale} A native Shared consumer imports this passive contract, so it was deterministically promoted to Shared Types.`,
      canonicalTargetPaths: canonicalTargets(
        'shared-capability',
        ownerPath,
        ownerName,
        'types',
        decision.sourcePath,
      ),
    });
  });
  const detectedLockfileManagers = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ] as const;
  const presentPackageManagers = [
    ...new Set(
      detectedLockfileManagers
        .filter(([lockfile]) => inventory.some((file) => file.relativePath === lockfile))
        .map(([, manager]) => manager),
    ),
  ];
  if (typeof packageJson['packageManager'] !== 'string' && presentPackageManagers.length > 1) {
    throw new Error(
      'Migration source has multiple package-manager lockfiles without an authoritative packageManager declaration.',
    );
  }
  const packageManagerFact =
    typeof packageJson['packageManager'] === 'string'
      ? packageJson['packageManager']
      : presentPackageManagers[0];
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
    semanticRoutesPresent:
      semanticRoutesPresent || nextRoutes.some((route) => route.kind === 'page'),
    packageDependencies: Object.freeze(packageDependencies),
    packageDependencyRecords: Object.freeze(packageDependencyRecords),
    packageScripts,
    toolchain: Object.freeze({
      ...(packageManagerFact ? { packageManager: packageManagerFact } : {}),
      ...(packageJson['engines'] &&
      typeof packageJson['engines'] === 'object' &&
      typeof (packageJson['engines'] as Record<string, unknown>)['node'] === 'string'
        ? { nodeEngine: (packageJson['engines'] as Record<string, string>)['node'] }
        : {}),
      ...(typeof dependencies['vite'] === 'string' ? { viteVersion: dependencies['vite'] } : {}),
      ...(nextVersion ? { nextVersion } : {}),
      configPaths: Object.freeze(
        inventory
          .filter(
            (file) =>
              file.category === 'configuration' ||
              (framework === 'next-app-router' &&
                NEXT_RUNTIME_CONFIG_PATTERN.test(file.relativePath)),
          )
          .map((file) => file.relativePath)
          .sort(),
      ),
    }),
    ...(nextAppRouter ? { nextAppRouter } : {}),
    sourceAliases,
    ownership: Object.freeze(ownership),
  });
}

function slice(
  id: string,
  title: string,
  files: readonly ReactMigrationInventoryFile[],
  dependencyOwnerIds: readonly string[] = [],
  cycleOwnerIds: readonly string[] = [],
  requiredStarterCleanup: readonly ReactMigrationDelete[] = [],
): ReactMigrationPlanSlice {
  return Object.freeze({
    id,
    title,
    sourcePaths: Object.freeze(files.map((file) => file.relativePath)),
    dependencyOwnerIds: Object.freeze([...dependencyOwnerIds]),
    cycleOwnerIds: Object.freeze([...cycleOwnerIds]),
    requiredStarterCleanup: Object.freeze([...requiredStarterCleanup]),
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
  targetBaselineSha256 = sha256(
    Object.entries(migrationStarterFileMap(inventory))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, source]) => `${path}\0${sha256(source)}`)
      .join('\n'),
  ),
  starterCleanupOverride?: readonly ReactMigrationDelete[],
): ReactMigrationPlan {
  const filesByPath = new Map(inventory.files.map((file) => [file.relativePath, file]));
  // Non-runtime evidence must remain traceable, but it is not a native React
  // owner. Keeping it in the owner graph used to create nonsensical features
  // for README/AGENTS/config files and invited a model to "convert" prose.
  // It receives one explicit ignored-evidence slice below instead.
  const migratableOwnership = inventory.ownership.filter(
    (decision) => decision.completionObligation !== 'excluded-nonruntime',
  );
  const ownerGroups = new Map<string, ReactMigrationOwnershipDecision[]>();
  for (const owner of migratableOwnership) {
    const group = ownerGroups.get(owner.ownerId) ?? [];
    group.push(owner);
    ownerGroups.set(owner.ownerId, group);
  }
  const legacyFacadeSource = (sourcePath: string): boolean =>
    /(?:^|\/)(?:module|imports)\.[cm]?[jt]sx?$/iu.test(sourcePath);
  const ownerDependencies = (ownerId: string, owners: readonly ReactMigrationOwnershipDecision[]) =>
    [
      ...new Set(
        owners.flatMap((owner) =>
          owner.dependencies.flatMap((dependency) => {
            if (!dependency.resolvedSourcePath) return [];
            const targetOwner = inventory.ownership.find(
              (candidate) => candidate.sourcePath === dependency.resolvedSourcePath,
            );
            // A legacy module/import file is a re-export façade, not a native
            // runtime boundary. Consumers are rewritten to their canonical
            // providers during reviewed conversion. Treating a façade as a
            // transitive prerequisite would pull a whole legacy module graph
            // into one artificial SCC; target-graph closure rejects any
            // unresolved façade reference at final verification.
            if (
              !legacyFacadeSource(owner.sourcePath) &&
              targetOwner &&
              legacyFacadeSource(targetOwner.sourcePath)
            ) {
              return [];
            }
            return targetOwner && targetOwner.ownerId !== ownerId ? [targetOwner.ownerId] : [];
          }),
        ),
      ),
    ].sort();
  const dependencies = new Map(
    [...ownerGroups].map(([ownerId, owners]) => [ownerId, ownerDependencies(ownerId, owners)]),
  );
  // A Srijika Slot or Part is not independently valid: its parent Feature (and
  // a Part's parent Slot) must expose the corresponding canonical UI and
  // Connector boundary in the same atomic review. Model source imports alone
  // do not always express that structural dependency. Keep these containment
  // pairs separate from the import graph: adding bidirectional import edges
  // would pull every transitive dependency into one giant fake SCC.
  const ownerIdByPath = new Map(
    [...ownerGroups].map(([ownerId, owners]) => [owners[0]!.ownerPath, ownerId]),
  );
  const structuralOwnerPairs: Array<readonly [string, string]> = [];
  for (const [ownerId, owners] of ownerGroups) {
    const owner = owners[0]!;
    const parentPath =
      owner.ownerKind === 'slot'
        ? owner.ownerPath.split('/slots/')[0]
        : owner.ownerKind === 'part'
          ? owner.ownerPath.split('/parts/')[0]
          : undefined;
    if (!parentPath) continue;
    const parentOwnerId = ownerIdByPath.get(parentPath);
    if (parentOwnerId && parentOwnerId !== ownerId) {
      structuralOwnerPairs.push([ownerId, parentOwnerId]);
    }
  }
  // Condense the owner graph into disjoint SCCs before batching. A DFS back-edge
  // list can overlap (A→B→C→A and B→D→B) and would otherwise put one source in
  // several reviewed slices. Every source must belong to exactly one slice.
  const ownerIds = [...ownerGroups.keys()].sort();
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;
  const visitOwner = (ownerId: string): void => {
    indexes.set(ownerId, nextIndex);
    lowLinks.set(ownerId, nextIndex);
    nextIndex += 1;
    stack.push(ownerId);
    stacked.add(ownerId);
    for (const dependency of dependencies.get(ownerId) ?? []) {
      if (!indexes.has(dependency)) {
        visitOwner(dependency);
        lowLinks.set(ownerId, Math.min(lowLinks.get(ownerId)!, lowLinks.get(dependency)!));
      } else if (stacked.has(dependency)) {
        lowLinks.set(ownerId, Math.min(lowLinks.get(ownerId)!, indexes.get(dependency)!));
      }
    }
    if (lowLinks.get(ownerId) !== indexes.get(ownerId)) return;
    const component: string[] = [];
    for (;;) {
      const member = stack.pop();
      if (!member) break;
      stacked.delete(member);
      component.push(member);
      if (member === ownerId) break;
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  };
  for (const ownerId of ownerIds) if (!indexes.has(ownerId)) visitOwner(ownerId);
  // First retain genuine import SCCs, then union only the structural parent /
  // child components. This keeps a Feature and its Slots reviewable as one
  // valid Srijika unit without conflating unrelated dependency chains.
  const rawComponentForOwner = new Map<string, string>();
  for (const members of components) {
    const key = members.join('\0');
    for (const member of members) rawComponentForOwner.set(member, key);
  }
  const componentParent = new Map(
    components.map((members) => {
      const key = members.join('\0');
      return [key, key] as const;
    }),
  );
  const findComponent = (key: string): string => {
    const parent = componentParent.get(key) ?? key;
    if (parent === key) return key;
    const root = findComponent(parent);
    componentParent.set(key, root);
    return root;
  };
  for (const [ownerId, parentOwnerId] of structuralOwnerPairs) {
    const ownerComponent = rawComponentForOwner.get(ownerId);
    const parentComponent = rawComponentForOwner.get(parentOwnerId);
    if (!ownerComponent || !parentComponent) continue;
    const ownerRoot = findComponent(ownerComponent);
    const parentRoot = findComponent(parentComponent);
    if (ownerRoot !== parentRoot) componentParent.set(ownerRoot, parentRoot);
  }
  const mergedComponentMembers = new Map<string, string[]>();
  for (const members of components) {
    const root = findComponent(members.join('\0'));
    mergedComponentMembers.set(root, [...(mergedComponentMembers.get(root) ?? []), ...members]);
  }
  const condensedComponents = [...mergedComponentMembers.values()].map((members) =>
    [...new Set(members)].sort((left, right) => left.localeCompare(right)),
  );
  const componentForOwner = new Map<string, string>();
  const componentMembers = new Map<string, string[]>();
  for (const members of condensedComponents) {
    const key = members.join('\0');
    componentMembers.set(key, members);
    for (const member of members) componentForOwner.set(member, key);
  }
  const groupedOwnerIds: string[][] = [];
  const visitedComponents = new Set<string>();
  const visitComponent = (key: string): void => {
    if (visitedComponents.has(key)) return;
    visitedComponents.add(key);
    const members = componentMembers.get(key) ?? [];
    const prerequisiteKeys = new Set<string>();
    for (const member of members) {
      for (const dependency of dependencies.get(member) ?? []) {
        const dependencyKey = componentForOwner.get(dependency);
        if (dependencyKey && dependencyKey !== key) prerequisiteKeys.add(dependencyKey);
      }
    }
    for (const prerequisite of [...prerequisiteKeys].sort()) visitComponent(prerequisite);
    groupedOwnerIds.push([...members]);
  };
  for (const key of [...componentMembers.keys()].sort()) visitComponent(key);
  // A review/apply token must represent one true dependency component. Earlier
  // planner versions coalesced adjacent Shared owners merely for convenience;
  // that turned unrelated config, preferences and data owners into a fake
  // "cycle" and forced a model to reason about an oversized mixed slice.
  // Preserve the condensed-DAG components exactly: only a real SCC is atomic.
  const batchedOwnerIds = groupedOwnerIds.map((members) => [...members]);
  const requiredStarterCleanup = Object.freeze(
    starterCleanupOverride ??
      Object.entries(migrationStarterFileMap(inventory))
        .filter(([relativePath]) => relativePath.startsWith('src/features/home/'))
        .map(([relativePath, source]) =>
          Object.freeze({ relativePath, expectedSha256: sha256(source) }),
        )
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  );
  const cleanupMemberIds =
    batchedOwnerIds.find((members) =>
      members.some((memberId) =>
        ownerGroups.get(memberId)?.some((owner) => owner.ownerKind === 'application'),
      ),
    ) ??
    batchedOwnerIds.find((members) =>
      members.some((memberId) => ownerGroups.get(memberId)?.some((owner) => owner.role === 'ui')),
    ) ??
    batchedOwnerIds[0];
  const cleanupGroupKey = cleanupMemberIds?.join('\0');
  const nativeSlices = batchedOwnerIds.map((memberIds) => {
    const ownerId = memberIds.join('+');
    const owners = memberIds.flatMap((memberId) => ownerGroups.get(memberId) ?? []);
    const first = owners[0]!;
    const cyclicOwnerIds = memberIds.filter(
      (memberId) => memberIds.length > 1 || (dependencies.get(memberId) ?? []).includes(memberId),
    );
    const id = `${memberIds.length > 1 ? 'owner-batch' : `owner-${first.ownerKind}-${first.ownerName}`}-${sha256(ownerId).slice(0, 6)}`;
    const files = owners
      .flatMap((owner) => filesByPath.get(owner.sourcePath) ?? [])
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const externalDependencies = [
      ...new Set(
        memberIds
          .flatMap((memberId) => dependencies.get(memberId) ?? [])
          .filter((dependency) => !memberIds.includes(dependency)),
      ),
    ].sort();
    return slice(
      id,
      memberIds.length > 1
        ? `${memberIds.length} native owners (bounded dependency-ready batch)`
        : `${first.ownerKind} ${first.ownerName} native owner`,
      files,
      externalDependencies,
      cyclicOwnerIds,
      memberIds.join('\0') === cleanupGroupKey ? requiredStarterCleanup : [],
    );
  });
  const excludedFiles = inventory.files
    .filter(
      (file) =>
        inventory.ownership.find((decision) => decision.sourcePath === file.relativePath)
          ?.completionObligation === 'excluded-nonruntime',
    )
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const slices = [
    ...nativeSlices,
    // Non-runtime material is kept as one-file slices. This allows an exact
    // engine-side copy of a deployment/configuration artifact without
    // bundling unrelated docs, environment contracts, or package-manager
    // state into the same reviewed decision.
    ...excludedFiles.map((file) =>
      slice(
        `owner-project-nonruntime-${sha256(file.relativePath).slice(0, 6)}`,
        `project non-runtime ${file.relativePath}`,
        [file],
        [],
        [],
        [],
      ),
    ),
  ];
  const plannedSourcePaths = slices.flatMap((candidate) => candidate.sourcePaths);
  const plannedSourceCounts = new Map<string, number>();
  for (const sourcePath of plannedSourcePaths) {
    plannedSourceCounts.set(sourcePath, (plannedSourceCounts.get(sourcePath) ?? 0) + 1);
  }
  const sliceCoverageFindings = [
    ...[...plannedSourceCounts]
      .filter(([, count]) => count !== 1)
      .map(
        ([sourcePath, count]) =>
          `Migration slice coverage is ambiguous for ${sourcePath}: planned ${count} times.`,
      ),
    ...inventory.files
      .filter((file) => !plannedSourceCounts.has(file.relativePath))
      .map((file) => `Migration slice coverage is missing ${file.relativePath}.`),
  ];
  const targetRoot = resolve(targetDirectory);
  const approvedLegacyAdapters = (
    Object.keys(ADAPTER_PACKAGES) as ReactMigrationLegacyAdapterId[]
  ).flatMap((id): ReactMigrationLegacyAdapterApproval[] => {
    const sourcePaths = inventory.ownership
      .filter((owner) => owner.approvedLegacyAdapters.includes(id))
      .map((owner) => owner.sourcePath)
      .sort((left, right) => left.localeCompare(right));
    if (sourcePaths.length === 0) return [];
    return [
      Object.freeze({
        id,
        packageNames: Object.freeze([...ADAPTER_PACKAGES[id]]),
        sourcePaths: Object.freeze(sourcePaths.slice(0, MAX_ADAPTER_MODULES)),
        maximumModules: MAX_ADAPTER_MODULES,
        rationale: `A bounded ${id} bridge may assist review, but cannot satisfy native completion.`,
      }),
    ];
  });
  const unsupported = [
    ...sliceCoverageFindings,
    ...inventory.packageDependencyRecords
      .filter((dependency) => dependency.unsafeLocalReference)
      .map(
        (dependency) =>
          `Unsafe local package reference requires a native registry replacement: ${dependency.name}@${dependency.version}`,
      ),
    ...inventory.files
      .filter((file) => file.category === 'unsupported')
      .map(
        (file) =>
          `Unclassified source file requires an explicit native owner: ${file.relativePath}`,
      ),
    ...inventory.files
      .filter(
        (file) =>
          file.relativePath !== 'package.json' && file.relativePath.endsWith('/package.json'),
      )
      .map(
        (file) =>
          `Nested package root requires an explicit bounded project migration: ${file.relativePath}`,
      ),
    ...inventory.ownership.flatMap((owner) =>
      owner.dependencies
        .filter((dependency) => dependency.kind === 'unresolved-source')
        .map(
          (dependency) =>
            `Unresolved local dependency ${dependency.specifier} from ${owner.sourcePath}`,
        ),
    ),
    ...(() => {
      const claims = new Map<string, string[]>();
      for (const owner of inventory.ownership) {
        for (const targetPath of owner.canonicalTargetPaths) {
          const sources = claims.get(targetPath) ?? [];
          sources.push(owner.sourcePath);
          claims.set(targetPath, sources);
        }
      }
      return [...claims]
        .filter(
          ([, sources]) =>
            new Set(
              sources.map(
                (sourcePath) =>
                  inventory.ownership.find((owner) => owner.sourcePath === sourcePath)?.ownerId,
              ),
            ).size > 1,
        )
        .map(
          ([targetPath, sources]) =>
            `Canonical target collision requires ownership refinement: ${targetPath} <- ${sources.slice(0, 8).join(', ')}${sources.length > 8 ? ` (+${sources.length - 8} more)` : ''}`,
        );
    })(),
  ];
  const ownershipDigest = sha256(
    inventory.ownership
      .map(
        (owner) =>
          `${owner.sourcePath}\0${owner.ownerId}\0${owner.role}\0${owner.graphComponentId}\0${owner.completionObligation}`,
      )
      .join('\n'),
  );
  return Object.freeze({
    id: sha256(
      `${inventory.snapshotSha256}\0${targetRoot}\0${targetBaselineSha256}\0${ownershipDigest}`,
    ).slice(0, 24),
    sourceRoot: inventory.sourceRoot,
    targetRoot,
    sourceSnapshotSha256: inventory.snapshotSha256,
    targetBaselineSha256,
    slices: Object.freeze(slices),
    ownership: inventory.ownership,
    approvedLegacyAdapters: Object.freeze(approvedLegacyAdapters),
    requiredStarterCleanup,
    unsupported: Object.freeze(unsupported),
  });
}

async function projectSnapshotSha256(targetRoot: string): Promise<string> {
  const fileSystem = await SrijikaProjectFileSystem.open(targetRoot);
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
  const entries: string[] = [];
  let bytes = 0;
  for (const file of files) {
    if (file.relativePath.startsWith('.srijika/migrations/react/')) continue;
    const read = await readSafeBytes(fileSystem, file.relativePath);
    bytes += read.bytes.byteLength;
    if (bytes > MAX_TOTAL_BYTES)
      throw new Error('Target snapshot exceeds the 64 MiB safety limit.');
    entries.push(`${file.relativePath}\0${read.bytes.byteLength}\0${sha256(read.bytes)}`);
  }
  return sha256(entries.sort((left, right) => left.localeCompare(right)).join('\n'));
}

async function assertExistingSrijikaTargetIsEmptyStarter(
  targetRoot: string,
  inventory: ReactMigrationInventory,
): Promise<void> {
  const fileSystem = await SrijikaProjectFileSystem.open(targetRoot);
  const allowed = new Set(Object.keys(migrationStarterFileMap(inventory)));
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

function migrationStarterFileMap(
  inventory: ReactMigrationInventory,
  options: { projectName?: string; displayName?: string } = {},
): Readonly<Record<string, string>> {
  if (inventory.framework === 'next-app-router') {
    if (!inventory.nextAppRouter || !inventory.toolchain.nextVersion) {
      throw new Error('Next.js migration inventory is missing its App Router toolchain facts.');
    }
    return createSrijikaNextProjectFileMap({
      nextVersion: inventory.toolchain.nextVersion,
      appRoot: inventory.nextAppRouter.appRoot,
      ...(options.projectName ? { projectName: options.projectName } : {}),
      ...(options.displayName ? { displayName: options.displayName } : {}),
    });
  }
  return createSrijikaProjectFileMap(options);
}

export async function startReactMigration(
  request: StartReactMigrationRequest,
): Promise<ReactMigrationSession> {
  const inventory = await scanReactMigrationSource(request.source);
  if (
    (request.expectedFramework === 'next-app-router' &&
      inventory.framework !== 'next-app-router') ||
    (request.expectedFramework === 'react' && inventory.framework === 'next-app-router')
  ) {
    throw new Error(
      `Migration adapter ${request.expectedFramework} does not match detected framework ${inventory.framework}.`,
    );
  }
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
  const now = new Date().toISOString();
  if (request.dryRun) {
    const plan = planReactMigration(inventory, targetRoot);
    return Object.freeze({
      version: SESSION_VERSION,
      id: plan.id,
      sourceRoot: inventory.sourceRoot,
      targetRoot,
      phase: 'planned',
      createdAt: now,
      updatedAt: now,
      inventory,
      plan,
      mappings: Object.freeze([]),
      ignoredSources: Object.freeze([]),
      appliedSlices: Object.freeze([]),
      reviewedSlices: Object.freeze([]),
    });
  }

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
    const scaffoldOptions = {
      projectName: request.projectName ?? npmName(basename(targetRoot)),
      displayName: request.displayName ?? basename(targetRoot),
    };
    if (inventory.framework === 'next-app-router') {
      await writeSrijikaNextProject(targetRoot, {
        ...scaffoldOptions,
        nextVersion: inventory.toolchain.nextVersion!,
        appRoot: inventory.nextAppRouter!.appRoot,
      });
    } else {
      await writeSrijikaProject(targetRoot, scaffoldOptions);
    }
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
    await assertExistingSrijikaTargetIsEmptyStarter(targetRoot, inventory);
  }
  const targetBaselineSha256 = await projectSnapshotSha256(targetRoot);
  const starterCleanup = await Promise.all(
    Object.keys(migrationStarterFileMap(inventory))
      .filter((relativePath) => relativePath.startsWith('src/features/home/'))
      .map(async (relativePath) => {
        const expectedSha256 = await existingHash(targetRoot, relativePath);
        if (!expectedSha256) throw new Error(`Starter cleanup path is missing: ${relativePath}`);
        return Object.freeze({ relativePath, expectedSha256 });
      }),
  );
  const plan = planReactMigration(inventory, targetRoot, targetBaselineSha256, starterCleanup);
  const session: ReactMigrationSession = Object.freeze({
    version: SESSION_VERSION,
    id: plan.id,
    sourceRoot: inventory.sourceRoot,
    targetRoot,
    phase: 'scaffolded',
    createdAt: now,
    updatedAt: now,
    inventory,
    plan,
    mappings: Object.freeze([]),
    ignoredSources: Object.freeze([]),
    appliedSlices: Object.freeze([]),
    reviewedSlices: Object.freeze([]),
  });
  const evidenceKeyTarget = join(targetRoot, EVIDENCE_KEY_PATH);
  await assertNoSymlinkAncestors(targetRoot, dirname(evidenceKeyTarget));
  await mkdir(dirname(evidenceKeyTarget), { recursive: true });
  await writeFile(evidenceKeyTarget, randomBytes(32).toString('hex'), {
    encoding: 'utf8',
    flag: 'wx',
  });
  await writeSession(session);
  return session;
}

export async function replanPendingReactMigration(
  targetDirectory: string,
): Promise<ReactMigrationSession> {
  const session = await readSession(targetDirectory);
  if (session.reviewedSlices.length > 0)
    throw new Error('Apply or discard the pending slice review before replanning.');
  const fresh = await scanReactMigrationSource(session.sourceRoot);
  if (fresh.snapshotSha256 !== session.inventory.snapshotSha256)
    throw new Error('React source changed before replanning.');
  const accounted = new Set([
    ...session.mappings.map((item) => item.sourcePath),
    ...session.ignoredSources.map((item) => item.sourcePath),
  ]);
  const priorOwnership = new Map(session.plan.ownership.map((item) => [item.sourcePath, item]));
  const inventory = Object.freeze({
    ...fresh,
    ownership: Object.freeze(
      fresh.ownership.map((item) =>
        accounted.has(item.sourcePath) ? (priorOwnership.get(item.sourcePath) ?? item) : item,
      ),
    ),
  });
  const freshPlan = planReactMigration(
    inventory,
    session.targetRoot,
    await projectSnapshotSha256(session.targetRoot),
  );
  const plan = Object.freeze({
    ...freshPlan,
    slices: Object.freeze(
      freshPlan.slices
        .map((slice) => ({
          ...slice,
          sourcePaths: Object.freeze(slice.sourcePaths.filter((path) => !accounted.has(path))),
        }))
        .filter((slice) => slice.sourcePaths.length > 0),
    ),
  });
  const next = Object.freeze({ ...session, inventory, plan, updatedAt: new Date().toISOString() });
  await writeSession(next);
  return next;
}

/**
 * Refreshes only the recognizable generated portable validator in a migration
 * target, then creates a fresh pending plan. This is intentionally separate
 * from slice application: a review token must always see the exact validator
 * that target typecheck/build will execute.
 */
export async function synchronizeReactMigrationValidator(
  request: SynchronizeReactMigrationValidatorRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  if (session.reviewedSlices.length > 0) {
    throw new Error(
      'Apply or discard the pending slice review before synchronizing the validator.',
    );
  }
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const configSource = (await fileSystem.readText('srijika.config.json', MAX_FILE_BYTES)).source;
  const parsedConfig: unknown = JSON.parse(configSource);
  const architecture =
    parsedConfig !== null &&
    typeof parsedConfig === 'object' &&
    !Array.isArray(parsedConfig) &&
    (parsedConfig as Record<string, unknown>)['architecture'] !== null &&
    typeof (parsedConfig as Record<string, unknown>)['architecture'] === 'object' &&
    !Array.isArray((parsedConfig as Record<string, unknown>)['architecture'])
      ? ((parsedConfig as Record<string, unknown>)[
          'architecture'
        ] as Partial<SrijikaArchitectureConfig>)
      : {};
  const generated = createSrijikaArchitectureValidatorScript(architecture);
  const relativePath = 'scripts/srijika-validate.mjs';
  const current = (await fileSystem.readText(relativePath, MAX_FILE_BYTES)).source;
  if (current === generated) return session;
  if (
    !current.includes('Srijika architecture check passed') ||
    !current.includes('const validate =')
  ) {
    throw new Error(
      'The target validator is not a recognizable generated Srijika validator and will not be overwritten.',
    );
  }
  const target = safeTargetPath(session.targetRoot, relativePath);
  await assertNoSymlinkAncestors(session.targetRoot, target);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, generated, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
  return replanPendingReactMigration(session.targetRoot);
}

const MIGRATION_TEST_HARNESS_PATH = 'test/srijika-native-foundation.test.ts';
const MIGRATION_TEST_HARNESS_SOURCE = `import { describe, expect, it } from 'vitest';

import { gridCaptureStore } from '../src/shared/capabilities/grid-capture-store/gridCaptureStore.store';

describe('native grid-capture store', () => {
  it('preserves visibility and a positive grid spacing', () => {
    gridCaptureStore.setVisible(false);
    gridCaptureStore.setSpacingMeters(0);
    expect(gridCaptureStore.getSnapshot()).toEqual({ visible: true, spacingMeters: 2 });

    gridCaptureStore.toggleVisible();
    gridCaptureStore.setSpacingMeters(3.5);
    expect(gridCaptureStore.getSnapshot()).toEqual({ visible: true, spacingMeters: 3.5 });
  });
});
`;

async function writeSafeMigrationText(
  targetRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = safeTargetPath(targetRoot, relativePath);
  await assertNoSymlinkAncestors(targetRoot, dirname(target));
  await mkdir(dirname(target), { recursive: true });
  await assertNoSymlinkAncestors(targetRoot, dirname(target));
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, target);
}

function migrationTestInstallCommand(
  manager: 'pnpm' | 'npm' | 'yarn' | 'bun',
  hasLockfile: boolean,
): {
  executable: string;
  args: readonly string[];
} {
  if (manager === 'pnpm') {
    return {
      executable: manager,
      args: Object.freeze([
        'install',
        ...(hasLockfile ? ['--no-frozen-lockfile'] : ['--lockfile=false']),
        '--ignore-scripts',
      ]),
    };
  }
  if (manager === 'npm') {
    return { executable: manager, args: Object.freeze(['install', '--ignore-scripts']) };
  }
  if (manager === 'yarn') {
    return { executable: manager, args: Object.freeze(['install', '--ignore-scripts']) };
  }
  return { executable: manager, args: Object.freeze(['install', '--ignore-scripts']) };
}

/**
 * Adds a real, deterministic test gate to the separate native target. It is
 * deliberately limited to a Store that has already been migrated and verified;
 * no source code, source package, or legacy runtime is ever executed here.
 */
export async function synchronizeReactMigrationTestHarness(
  request: SynchronizeReactMigrationTestHarnessRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  if (session.reviewedSlices.length > 0) {
    throw new Error(
      'Apply or discard the pending slice review before synchronizing the test harness.',
    );
  }
  const source = await scanReactMigrationSource(session.sourceRoot);
  if (source.snapshotSha256 !== session.inventory.snapshotSha256) {
    throw new Error('React source changed before synchronizing the test harness.');
  }
  const harnessOwner = 'shared-capability:src/shared/capabilities/grid-capture-store';
  const harnessPath = 'src/shared/capabilities/grid-capture-store/gridCaptureStore.store.ts';
  if (
    !session.mappings.some(
      (mapping) => mapping.ownerId === harnessOwner && mapping.targetPaths.includes(harnessPath),
    )
  ) {
    throw new Error(
      'Migrate and verify the native grid-capture Store before installing the deterministic test harness.',
    );
  }
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const packageSource = (await fileSystem.readText('package.json', MAX_PACKAGE_BYTES)).source;
  const packageJson: unknown = JSON.parse(packageSource);
  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('Target package.json must be an object before installing the test harness.');
  }
  const packageRecord = packageJson as Record<string, unknown>;
  const scripts =
    packageRecord['scripts'] !== null &&
    typeof packageRecord['scripts'] === 'object' &&
    !Array.isArray(packageRecord['scripts'])
      ? { ...(packageRecord['scripts'] as Record<string, unknown>) }
      : {};
  const existingTest = scripts['test'];
  if (existingTest !== undefined && existingTest !== 'vitest run') {
    throw new Error(
      'Target already has a noncanonical test script; the migration harness will not overwrite it.',
    );
  }
  scripts['test'] = 'vitest run';
  const devDependencies =
    packageRecord['devDependencies'] !== null &&
    typeof packageRecord['devDependencies'] === 'object' &&
    !Array.isArray(packageRecord['devDependencies'])
      ? { ...(packageRecord['devDependencies'] as Record<string, unknown>) }
      : {};
  const existingVitest = devDependencies['vitest'];
  if (existingVitest !== undefined && existingVitest !== '4.1.10') {
    throw new Error(
      'Target already pins a different Vitest version; review it before installing the migration harness.',
    );
  }
  devDependencies['vitest'] = '4.1.10';
  const nextPackage = `${JSON.stringify(
    { ...packageRecord, scripts, devDependencies },
    null,
    2,
  )}\n`;
  let existingHarness: string | undefined;
  try {
    existingHarness = (await fileSystem.readText(MIGRATION_TEST_HARNESS_PATH, MAX_FILE_BYTES))
      .source;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  if (existingHarness !== undefined && existingHarness !== MIGRATION_TEST_HARNESS_SOURCE) {
    throw new Error(
      'Target test harness exists but is not the recognizable generated migration harness.',
    );
  }
  if (packageSource !== nextPackage)
    await writeSafeMigrationText(session.targetRoot, 'package.json', nextPackage);
  if (existingHarness === undefined)
    await writeSafeMigrationText(
      session.targetRoot,
      MIGRATION_TEST_HARNESS_PATH,
      MIGRATION_TEST_HARNESS_SOURCE,
    );
  if (request.includeInstall) {
    const project = await inspectSrijikaProject(session.targetRoot);
    const command = migrationTestInstallCommand(project.packageManager, Boolean(project.lockfile));
    const result = await executeBoundedGate(
      session.targetRoot,
      command.executable,
      command.args,
      'typecheck',
    );
    if (result.status !== 'passed')
      throw new Error(`Migration test harness dependency installation failed: ${result.details}`);
  }
  return replanPendingReactMigration(session.targetRoot);
}

export async function getReactMigrationStatus(
  targetDirectory: string,
): Promise<ReactMigrationSession> {
  return readSession(targetDirectory);
}

function exportedNames(sourcePath: string, source: string): readonly string[] {
  if (!sourceExtension.test(sourcePath)) return Object.freeze([]);
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, false);
  const names: string[] = [];
  for (const statement of file.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!exported) continue;
    const named = statement as unknown as ts.NamedDeclaration;
    if (named.name && ts.isIdentifier(named.name)) {
      names.push(named.name.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      names.push(...statement.exportClause.elements.map((element) => element.name.text));
    }
  }
  return Object.freeze([...new Set(names)].sort());
}

export async function getReactMigrationSliceContext(
  request: GetReactMigrationSliceContextRequest,
): Promise<ReactMigrationSliceContext> {
  const session = await readSession(request.target);
  if (
    (request.expectedPlanId !== undefined && request.expectedPlanId !== session.plan.id) ||
    (request.expectedSourceSnapshotSha256 !== undefined &&
      request.expectedSourceSnapshotSha256 !== session.inventory.snapshotSha256) ||
    (request.expectedTargetSnapshotSha256 !== undefined &&
      request.expectedTargetSnapshotSha256 !== (await projectSnapshotSha256(session.targetRoot)))
  ) {
    throw new Error('Slice context expectations are stale for the current plan/source/target.');
  }
  const planned = session.plan.slices.find((slice) => slice.id === request.sliceId);
  if (!planned) throw new Error(`Unknown migration plan slice: ${request.sliceId}`);
  const targetFileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const cursorKey = (await targetFileSystem.readText(EVIDENCE_KEY_PATH, 256)).source.trim();
  const cursorPayload = (offset: number): string => {
    const payload = Buffer.from(
      JSON.stringify({
        planId: session.plan.id,
        sliceId: request.sliceId,
        sourceSnapshotSha256: session.inventory.snapshotSha256,
        offset,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', cursorKey).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  };
  let cursor = 0;
  if (request.cursor !== undefined) {
    const [payload, signature, extra] = request.cursor.split('.');
    if (!payload || !signature || extra) throw new Error('Slice context cursor is invalid.');
    const expected = createHmac('sha256', cursorKey).update(payload).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, 'base64url');
    } catch {
      throw new Error('Slice context cursor is invalid.');
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('Slice context cursor signature is invalid.');
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      decoded['planId'] !== session.plan.id ||
      decoded['sliceId'] !== request.sliceId ||
      decoded['sourceSnapshotSha256'] !== session.inventory.snapshotSha256 ||
      !Number.isSafeInteger(decoded['offset'])
    ) {
      throw new Error('Slice context cursor does not belong to this immutable slice.');
    }
    cursor = decoded['offset'] as number;
  }
  const limit = request.limit ?? 8;
  const maxBytes = request.maxBytes ?? 512 * 1024;
  if (
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > planned.sourcePaths.length ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 32
  ) {
    throw new Error('Slice context cursor/limit is outside the bounded range.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024) {
    throw new Error('Slice context maxBytes must be between 1 byte and 2 MiB.');
  }
  const inventory = new Map(session.inventory.files.map((file) => [file.relativePath, file]));
  const ownership = new Map(session.plan.ownership.map((owner) => [owner.sourcePath, owner]));
  const fileSystem = await SrijikaProjectFileSystem.open(session.sourceRoot);
  const items: ReactMigrationSliceContextItem[] = [];
  let bytes = 0;
  let index = cursor;
  while (index < planned.sourcePaths.length && items.length < limit) {
    const sourcePath = planned.sourcePaths[index]!;
    const file = inventory.get(sourcePath);
    const owner = ownership.get(sourcePath);
    if (!file || !owner)
      throw new Error(`Slice context lost immutable inventory for ${sourcePath}.`);
    const read = await readSafeBytes(fileSystem, sourcePath);
    if (sha256(read.bytes) !== file.sha256) throw new Error(`React source changed: ${sourcePath}.`);
    if (items.length > 0 && bytes + read.bytes.byteLength > maxBytes) break;
    if (read.bytes.byteLength > maxBytes)
      throw new Error(`${sourcePath} exceeds the requested slice context byte budget.`);
    bytes += read.bytes.byteLength;
    let content: string | undefined;
    if (file.category !== 'environment' && !['asset'].includes(file.category)) {
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes);
      } catch {
        // Binary files remain hash-only.
      }
    }
    items.push(
      Object.freeze({
        sourcePath,
        category: file.category,
        sha256: file.sha256,
        size: file.size,
        ...(content === undefined ? {} : { content }),
        ...(file.category === 'environment'
          ? { environmentKeys: session.inventory.environmentKeys[sourcePath] ?? Object.freeze([]) }
          : {}),
        imports: owner.dependencies,
        exports: content === undefined ? Object.freeze([]) : exportedNames(sourcePath, content),
        ownership: owner,
      }),
    );
    index += 1;
  }
  return Object.freeze({
    planId: session.plan.id,
    sliceId: planned.id,
    sourceSnapshotSha256: session.inventory.snapshotSha256,
    packageDependencies: session.inventory.packageDependencyRecords,
    packageScripts: session.inventory.packageScripts,
    toolchain: session.inventory.toolchain,
    cursor: request.cursor ?? cursorPayload(0),
    ...(index < planned.sourcePaths.length ? { nextCursor: cursorPayload(index) } : {}),
    items: Object.freeze(items),
  });
}

function validOverrideOwnerPath(override: ReactMigrationOwnershipOverride): boolean {
  const name = override.ownerName;
  if (override.ownerKind === 'application') return override.ownerPath === 'src/app';
  if (override.ownerKind === 'project') return override.ownerPath === '.';
  if (override.ownerKind === 'feature') return override.ownerPath === `src/features/${name}`;
  if (override.ownerKind === 'slot')
    return new RegExp(`^src/features/[a-z0-9-]+/slots/${name}$`, 'u').test(override.ownerPath);
  if (override.ownerKind === 'part')
    return new RegExp(`^src/features/[a-z0-9-]+/slots/[a-z0-9-]+/parts/${name}$`, 'u').test(
      override.ownerPath,
    );
  const folder =
    override.ownerKind === 'shared-ui'
      ? 'ui'
      : override.ownerKind === 'shared-widget'
        ? 'widgets'
        : 'capabilities';
  return override.ownerPath === `src/shared/${folder}/${name}`;
}

function validOverrideOwnerRole(override: ReactMigrationOwnershipOverride): boolean {
  const allowed: Record<ReactMigrationOwnerKind, readonly ReactMigrationOwnerRole[]> = {
    application: ['shell'],
    project: ['configuration', 'test', 'style', 'asset'],
    feature: ['route', 'ui', 'hook', 'store', 'api', 'logic', 'types', 'style'],
    slot: ['route', 'ui', 'hook', 'store', 'api', 'logic', 'types', 'style'],
    part: ['route', 'ui', 'hook', 'store', 'api', 'logic', 'types', 'style'],
    'shared-ui': ['ui', 'types', 'style'],
    'shared-widget': ['ui', 'hook', 'store', 'api', 'logic', 'types', 'style'],
    'shared-capability': ['hook', 'store', 'api', 'logic', 'types'],
  };
  return allowed[override.ownerKind].includes(override.role);
}

export async function reviewReactMigrationOwnership(
  request: ReviewReactMigrationOwnershipRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  if (
    request.expectedPlanId !== session.plan.id ||
    request.expectedSourceSnapshotSha256 !== session.inventory.snapshotSha256 ||
    request.expectedTargetSnapshotSha256 !== (await projectSnapshotSha256(session.targetRoot))
  ) {
    throw new Error('Ownership review expectations are stale for the current plan/source/target.');
  }
  if (
    session.appliedSlices.length > 0 ||
    session.reviewedSlices.length > 0 ||
    session.mappings.length > 0
  ) {
    throw new Error('Ownership may be reviewed only before the first slice review or application.');
  }
  if (request.overrides.length < 1 || request.overrides.length > 256) {
    throw new Error('Ownership review requires between 1 and 256 bounded overrides.');
  }
  const rescanned = await scanReactMigrationSource(session.sourceRoot);
  if (rescanned.snapshotSha256 !== session.inventory.snapshotSha256)
    throw new Error('React source changed before ownership review.');
  const overrides = new Map<string, ReactMigrationOwnershipOverride>();
  for (const override of request.overrides) {
    if (overrides.has(override.sourcePath))
      throw new Error(`Duplicate ownership override: ${override.sourcePath}`);
    if (!session.inventory.files.some((file) => file.relativePath === override.sourcePath))
      throw new Error(`Unknown ownership override source: ${override.sourcePath}`);
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(override.ownerName) || !validOverrideOwnerPath(override))
      throw new Error(
        `Ownership override has a noncanonical owner name/path: ${override.sourcePath}`,
      );
    if (override.rationale.trim().length < 16 || override.rationale.length > 1_000)
      throw new Error(`${override.sourcePath} requires a 16 to 1000 character review rationale.`);
    if (!validOverrideOwnerRole(override))
      throw new Error(`${override.sourcePath} role is invalid for ${override.ownerKind}.`);
    const original = session.inventory.ownership.find(
      (decision) => decision.sourcePath === override.sourcePath,
    )!;
    if (override.role !== original.role) {
      throw new Error(
        `${override.sourcePath} ownership review may change placement but cannot change semantic role ${original.role}.`,
      );
    }
    const protectedOwnerKind = (kind: ReactMigrationOwnerKind): boolean =>
      kind === 'application' || kind === 'project';
    if (
      protectedOwnerKind(override.ownerKind) !== protectedOwnerKind(original.ownerKind) ||
      (protectedOwnerKind(original.ownerKind) && override.ownerKind !== original.ownerKind)
    ) {
      throw new Error(
        `${override.sourcePath} cannot cross the application/project runtime ownership boundary.`,
      );
    }
    const sharedOwnerKind = (kind: ReactMigrationOwnerKind): boolean => kind.startsWith('shared-');
    if (sharedOwnerKind(override.ownerKind) && !sharedOwnerKind(original.ownerKind)) {
      throw new Error(
        `${override.sourcePath} cannot be promoted to Shared without engine-proven multi-feature consumers.`,
      );
    }
    overrides.set(override.sourcePath, Object.freeze({ ...override }));
  }
  const ownership = Object.freeze(
    session.inventory.ownership.map((decision) => {
      const override = overrides.get(decision.sourcePath);
      if (!override) return decision;
      return Object.freeze({
        ...decision,
        ownerKind: override.ownerKind,
        ownerName: override.ownerName,
        ownerPath: override.ownerPath,
        ownerId: `${override.ownerKind}:${override.ownerPath}`,
        role: override.role,
        rationale: override.rationale.trim(),
        canonicalTargetPaths: canonicalTargets(
          override.ownerKind,
          override.ownerPath,
          override.ownerName,
          override.role,
          decision.sourcePath,
          isNextExactFrameworkSource(session.inventory, decision.sourcePath),
        ),
      });
    }),
  );
  const inventory = Object.freeze({ ...session.inventory, ownership });
  const plan = planReactMigration(
    inventory,
    session.targetRoot,
    session.plan.targetBaselineSha256,
    session.plan.requiredStarterCleanup,
  );
  const next: ReactMigrationSession = {
    ...session,
    inventory,
    plan,
    updatedAt: new Date().toISOString(),
  };
  await writeSession(next);
  return next;
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

function safeEvidenceArtifactPath(targetRoot: string, relativePath: string): string {
  const prefix = '.srijika/migrations/react/evidence/';
  const segments = relativePath.split('/');
  if (
    !relativePath.startsWith(prefix) ||
    isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.includes('\0') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe migration evidence path: ${relativePath}`);
  }
  const target = resolve(targetRoot, ...segments);
  if (!isInside(targetRoot, target))
    throw new Error(`Unsafe migration evidence path: ${relativePath}`);
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

const targetLockfilePaths = Object.freeze([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
] as const);

interface ReactMigrationTargetLockfileSnapshot {
  relativePath: (typeof targetLockfilePaths)[number];
  before: Buffer | null;
}

async function snapshotTargetLockfiles(
  targetRoot: string,
): Promise<readonly ReactMigrationTargetLockfileSnapshot[]> {
  const fileSystem = await SrijikaProjectFileSystem.open(targetRoot);
  return Object.freeze(
    await Promise.all(
      targetLockfilePaths.map(async (relativePath) => {
        try {
          return Object.freeze({
            relativePath,
            before: Buffer.from((await readSafeBytes(fileSystem, relativePath)).bytes),
          });
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return Object.freeze({ relativePath, before: null });
          }
          throw error;
        }
      }),
    ),
  );
}

async function restoreTargetLockfiles(
  targetRoot: string,
  snapshots: readonly ReactMigrationTargetLockfileSnapshot[],
): Promise<void> {
  for (const snapshot of snapshots) {
    const target = safeTargetPath(targetRoot, snapshot.relativePath);
    await assertNoSymlinkAncestors(targetRoot, target);
    if (snapshot.before === null) {
      await rm(target, { force: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await assertNoSymlinkAncestors(targetRoot, dirname(target));
    await writeFile(target, snapshot.before);
  }
}

function canonicalSlicePayload(slice: ReactMigrationSlice): string {
  return JSON.stringify({
    id: slice.id,
    title: slice.title,
    writes: slice.writes.map((write) => ({
      relativePath: write.relativePath,
      content: write.content,
      ...(write.encoding ? { encoding: write.encoding } : {}),
      ...(write.expectedSha256 ? { expectedSha256: write.expectedSha256 } : {}),
    })),
    sourceArtifactCopies: (slice.sourceArtifactCopies ?? []).map((copy) => ({
      sourcePath: copy.sourcePath,
      relativePath: copy.relativePath,
      expectedSourceSha256: copy.expectedSourceSha256,
      ...(copy.expectedSha256 ? { expectedSha256: copy.expectedSha256 } : {}),
    })),
    sourcePackageDependencies: (slice.sourcePackageDependencies ?? []).map((dependency) => ({
      name: dependency.name,
      version: dependency.version,
      scope: dependency.scope,
    })),
    sourcePackageScripts: (slice.sourcePackageScripts ?? []).map((script) => ({
      name: script.name,
      command: script.command,
    })),
    deletes: (slice.deletes ?? []).map((deletion) => ({ ...deletion })),
    mappings: slice.mappings.map((mapping) => ({
      sourcePath: mapping.sourcePath,
      targetPaths: [...mapping.targetPaths],
      kind: mapping.kind,
      mode: mapping.mode,
      ownerId: mapping.ownerId,
      role: mapping.role,
      rationale: mapping.rationale,
      ...(mapping.legacyAdapter ? { legacyAdapter: mapping.legacyAdapter } : {}),
      ...(mapping.mergeGroupId ? { mergeGroupId: mapping.mergeGroupId } : {}),
      ...(mapping.traceRanges
        ? { traceRanges: mapping.traceRanges.map((range) => ({ ...range })) }
        : {}),
      ...(mapping.notes ? { notes: mapping.notes } : {}),
    })),
    ignoredSources: (slice.ignoredSources ?? []).map((ignored) => ({
      sourcePath: ignored.sourcePath,
      reason: ignored.reason,
    })),
  });
}

function migrationWriteBytes(write: ReactMigrationWrite): Buffer {
  if (write.encoding === undefined || write.encoding === 'utf8')
    return Buffer.from(write.content, 'utf8');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(write.content)) {
    throw new Error(`${write.relativePath} contains invalid base64 migration content.`);
  }
  return Buffer.from(write.content, 'base64');
}

async function materializeSourceArtifactCopies(
  session: ReactMigrationSession,
  slice: ReactMigrationSlice,
): Promise<ReactMigrationSlice> {
  const copies = slice.sourceArtifactCopies ?? [];
  if (copies.length === 0) return slice;
  if (copies.length > 512)
    throw new Error('Migration slice exceeds the source-artifact copy limit.');
  const inventoryByPath = new Map(session.inventory.files.map((file) => [file.relativePath, file]));
  const sourceFileSystem = await SrijikaProjectFileSystem.open(session.sourceRoot);
  const declaredWrites = new Set(slice.writes.map((write) => write.relativePath));
  const copiedTargets = new Set<string>();
  const copiedSources = new Set<string>();
  const materializedWrites: ReactMigrationWrite[] = [...slice.writes];
  for (const copy of copies) {
    const sourceFile = inventoryByPath.get(copy.sourcePath);
    if (
      !sourceFile ||
      !['asset', 'style', 'configuration', 'environment', 'ancillary'].includes(sourceFile.category)
    ) {
      throw new Error(`${copy.sourcePath} is not an inventory-approved source artifact.`);
    }
    if (
      ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'].includes(
        copy.sourcePath,
      )
    ) {
      throw new Error(
        `${copy.sourcePath} is package-manager state and must use an engine-owned migration operation.`,
      );
    }
    if (copy.expectedSourceSha256 !== sourceFile.sha256) {
      throw new Error(`${copy.sourcePath} changed from its reviewed source artifact hash.`);
    }
    safeTargetPath(session.targetRoot, copy.relativePath);
    if (declaredWrites.has(copy.relativePath) || copiedTargets.has(copy.relativePath)) {
      throw new Error(`Duplicate source-artifact target write: ${copy.relativePath}`);
    }
    if (copiedSources.has(copy.sourcePath)) {
      throw new Error(`Duplicate source-artifact copy: ${copy.sourcePath}`);
    }
    const bytes = (await readSafeBytes(sourceFileSystem, copy.sourcePath)).bytes;
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(
        `${copy.sourcePath} exceeds the ${MAX_FILE_BYTES}-byte source artifact limit.`,
      );
    }
    if (sha256(bytes) !== copy.expectedSourceSha256) {
      throw new Error(`${copy.sourcePath} changed while the source artifact was being reviewed.`);
    }
    copiedTargets.add(copy.relativePath);
    copiedSources.add(copy.sourcePath);
    materializedWrites.push({
      relativePath: copy.relativePath,
      content: Buffer.from(bytes).toString('base64'),
      encoding: 'base64',
      ...(copy.expectedSha256 === undefined ? {} : { expectedSha256: copy.expectedSha256 }),
    });
  }
  return {
    ...slice,
    writes: Object.freeze(materializedWrites),
    sourceArtifactCopies: Object.freeze(copies.map((copy) => ({ ...copy }))),
  };
}

const packageFieldForDependencyScope: Readonly<
  Record<ReactMigrationPackageDependencyScope, string>
> = Object.freeze({
  dependency: 'dependencies',
  devDependency: 'devDependencies',
  peerDependency: 'peerDependencies',
  optionalDependency: 'optionalDependencies',
});

function safeRegistryPackageVersion(version: string): boolean {
  return !/^(?:file:|link:|workspace:|\.{1,2}(?:\/|$)|\/|https?:|git(?:\+|:)|github:|gitlab:|bitbucket:|ssh:)/iu.test(
    version,
  );
}

function legacyAdapterPackage(name: string): boolean {
  return Object.values(ADAPTER_PACKAGES).some((packages) => packages.includes(name));
}

function wrapperPackage(name: string): boolean {
  return /(?:^|[-_/])(?:legacy|compat(?:ibility)?|wrapper)(?:$|[-_/])/iu.test(name);
}

async function sourcePackageDependencyWrite(
  session: ReactMigrationSession,
  sliceId: string,
  requested: readonly ReactMigrationSourcePackageDependency[],
): Promise<ReactMigrationWrite | undefined> {
  if (requested.length === 0) return undefined;
  if (requested.length > 128) {
    throw new Error('Migration slice exceeds the source package-dependency safety limit.');
  }
  const planned = session.plan.slices.find((candidate) => candidate.id === sliceId);
  if (!planned) throw new Error(`Migration slice is not present in the reviewed plan: ${sliceId}`);
  const ownershipByPath = new Map(
    session.plan.ownership.map((decision) => [decision.sourcePath, decision]),
  );
  const importedPackages = new Set(
    planned.sourcePaths.flatMap((sourcePath) =>
      (ownershipByPath.get(sourcePath)?.dependencies ?? []).flatMap((dependency) =>
        dependency.kind === 'package' && dependency.packageName ? [dependency.packageName] : [],
      ),
    ),
  );
  const sourceDependencies = new Map(
    session.inventory.packageDependencyRecords.map((dependency) => [
      `${dependency.name}\0${dependency.version}\0${dependency.scope}`,
      dependency,
    ]),
  );
  const seen = new Set<string>();
  for (const dependency of requested) {
    if (
      dependency.name.trim().length === 0 ||
      dependency.name.length > 214 ||
      dependency.version.trim().length === 0 ||
      dependency.version.length > 512
    ) {
      throw new Error(
        'Source package dependency name and version must be bounded nonempty values.',
      );
    }
    const key = `${dependency.name}\0${dependency.version}\0${dependency.scope}`;
    if (seen.has(key)) throw new Error(`Duplicate source package dependency: ${dependency.name}.`);
    seen.add(key);
    const sourceDependency = sourceDependencies.get(key);
    if (!sourceDependency) {
      throw new Error(
        `${dependency.name}@${dependency.version} is not an exact source inventory package dependency.`,
      );
    }
    if (
      sourceDependency.unsafeLocalReference ||
      !safeRegistryPackageVersion(sourceDependency.version)
    ) {
      throw new Error(
        `${dependency.name}@${dependency.version} is an unsafe local or non-registry source dependency.`,
      );
    }
    if (legacyAdapterPackage(dependency.name) || wrapperPackage(dependency.name)) {
      throw new Error(
        `${dependency.name} is a legacy compatibility/adapter package and cannot be added to a native slice.`,
      );
    }
    if (!importedPackages.has(dependency.name)) {
      throw new Error(
        `${dependency.name} is not imported by a source module in migration slice ${sliceId}.`,
      );
    }
  }

  const targetFileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const packageBytes = (await readSafeBytes(targetFileSystem, 'package.json', MAX_PACKAGE_BYTES))
    .bytes;
  let packageJson: Record<string, unknown>;
  try {
    const parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(packageBytes),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    packageJson = parsed as Record<string, unknown>;
  } catch {
    throw new Error(
      'Target package.json must be a UTF-8 JSON object for a source dependency operation.',
    );
  }
  const declaredTargetPackages = new Map<string, string>();
  for (const field of Object.values(packageFieldForDependencyScope)) {
    const existing = packageJson[field];
    if (existing === undefined) continue;
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      throw new Error(`Target package.json ${field} must be an object.`);
    }
    for (const [name, version] of Object.entries(existing as Record<string, unknown>)) {
      if (typeof version === 'string') declaredTargetPackages.set(name, field);
    }
  }
  const nextPackageJson: Record<string, unknown> = { ...packageJson };
  for (const dependency of requested) {
    const existingField = declaredTargetPackages.get(dependency.name);
    if (existingField) {
      throw new Error(
        `${dependency.name} is already declared in target package.json ${existingField}; native migration will not replace or move it.`,
      );
    }
    const field = packageFieldForDependencyScope[dependency.scope];
    const existing = nextPackageJson[field];
    const dependencies = existing === undefined ? {} : (existing as Record<string, unknown>);
    nextPackageJson[field] = { ...dependencies, [dependency.name]: dependency.version };
    declaredTargetPackages.set(dependency.name, field);
  }
  return {
    relativePath: 'package.json',
    content: `${JSON.stringify(nextPackageJson, null, 2)}\n`,
    expectedSha256: sha256(packageBytes),
  };
}

async function sourcePackageScriptWrite(
  session: ReactMigrationSession,
  sliceId: string,
  requested: readonly ReactMigrationSourcePackageScript[],
  dependencyWrite?: ReactMigrationWrite,
): Promise<ReactMigrationWrite | undefined> {
  if (requested.length === 0) return dependencyWrite;
  if (requested.length > 64) {
    throw new Error('Migration slice exceeds the source package-script safety limit.');
  }
  const planned = session.plan.slices.find((candidate) => candidate.id === sliceId);
  if (!planned) throw new Error(`Migration slice is not present in the reviewed plan: ${sliceId}`);
  const sourceScripts = session.inventory.packageScripts;
  const seen = new Set<string>();
  for (const script of requested) {
    if (!/^[a-z][a-z0-9:_-]{0,79}$/u.test(script.name) || script.command.length === 0) {
      throw new Error('Source package scripts require bounded stable names and commands.');
    }
    if (seen.has(script.name)) throw new Error(`Duplicate source package script: ${script.name}.`);
    seen.add(script.name);
    if (sourceScripts[script.name] !== script.command) {
      throw new Error(`${script.name} is not an exact source inventory package script.`);
    }
    const target = /^node\s+(scripts\/[a-z0-9._-]+\.mjs)(?:\s|$)/iu.exec(script.command)?.[1];
    if (!target || !planned.sourcePaths.includes(target)) {
      throw new Error(
        `${script.name} must execute a reviewed source script from this migration slice.`,
      );
    }
  }
  const targetFileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const targetBytes = (await readSafeBytes(targetFileSystem, 'package.json', MAX_PACKAGE_BYTES))
    .bytes;
  const currentBytes = dependencyWrite ? migrationWriteBytes(dependencyWrite) : targetBytes;
  let packageJson: Record<string, unknown>;
  try {
    const parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(currentBytes),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not object');
    packageJson = parsed as Record<string, unknown>;
  } catch {
    throw new Error(
      'Target package.json must be a UTF-8 JSON object for a source script operation.',
    );
  }
  const scripts = packageJson['scripts'];
  if (
    scripts !== undefined &&
    (!scripts || typeof scripts !== 'object' || Array.isArray(scripts))
  ) {
    throw new Error('Target package.json scripts must be an object.');
  }
  const nextScripts: Record<string, unknown> = {
    ...(scripts as Record<string, unknown> | undefined),
  };
  for (const script of requested) {
    if (nextScripts[script.name] !== undefined) {
      throw new Error(
        `Target package.json already declares ${script.name}; migration will not replace it.`,
      );
    }
    nextScripts[script.name] = script.command;
  }
  return {
    relativePath: 'package.json',
    content: `${JSON.stringify({ ...packageJson, scripts: nextScripts }, null, 2)}\n`,
    expectedSha256: sha256(targetBytes),
  };
}

async function materializeSourcePackageDependencies(
  session: ReactMigrationSession,
  slice: ReactMigrationSlice,
): Promise<ReactMigrationSlice> {
  const requested = slice.sourcePackageDependencies ?? [];
  const requestedScripts = slice.sourcePackageScripts ?? [];
  const packageWrites = slice.writes.filter((write) => write.relativePath === 'package.json');
  if (packageWrites.length > 0) {
    throw new Error(
      'Migration slices may not author package.json directly; use reviewed sourcePackageDependencies.',
    );
  }
  const dependencyWrite = await sourcePackageDependencyWrite(session, slice.id, requested);
  const generated = await sourcePackageScriptWrite(
    session,
    slice.id,
    requestedScripts,
    dependencyWrite,
  );
  if (!generated) return slice;
  return {
    ...slice,
    writes: Object.freeze([...slice.writes, generated]),
    sourcePackageDependencies: Object.freeze(requested.map((dependency) => ({ ...dependency }))),
    sourcePackageScripts: Object.freeze(requestedScripts.map((script) => ({ ...script }))),
  };
}

function migrationSessionStateSha256(session: ReactMigrationSession): string {
  return sha256(
    JSON.stringify({
      mappings: session.mappings.map((mapping) => [
        mapping.sourcePath,
        mapping.targetPaths,
        mapping.mode,
      ]),
      ignored: session.ignoredSources.map((ignored) => ignored.sourcePath),
      applied: session.appliedSlices.map((slice) => [slice.id, slice.writes]),
    }),
  );
}

function wrapperFinding(
  relativePath: string,
  source: string,
  sourceRoot: string,
): string | undefined {
  const normalizedPath = `/${relativePath.toLowerCase()}/`;
  if (/\/(?:legacy|compat|original|migration-source|old-app)\//u.test(normalizedPath)) {
    return `${relativePath} uses a prohibited runtime fallback subtree.`;
  }
  if (/\b(?:eval\s*\(|new\s+Function\s*\()/u.test(source)) {
    return `${relativePath} contains eval or Function construction.`;
  }
  if (/<(?:iframe|webview)\b/iu.test(source)) {
    return `${relativePath} embeds a wrapper iframe or webview.`;
  }
  if (source.includes(sourceRoot)) return `${relativePath} contains the legacy source-root path.`;
  return undefined;
}

async function validateReviewedSlice(
  session: ReactMigrationSession,
  slice: ReactMigrationSlice,
): Promise<void> {
  const planned = session.plan.slices.find((candidate) => candidate.id === slice.id);
  if (!planned) throw new Error(`Migration slice is not present in the reviewed plan: ${slice.id}`);
  if (planned.title !== slice.title) {
    throw new Error(`Migration slice title must match the reviewed plan: ${planned.title}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(slice.id)) {
    throw new Error('Migration slice id must be stable kebab-case.');
  }
  if (
    slice.writes.length + (slice.sourceArtifactCopies?.length ?? 0) + (slice.deletes?.length ?? 0) >
      512 ||
    slice.mappings.length > 2_048 ||
    (slice.ignoredSources?.length ?? 0) > 2_048
  ) {
    throw new Error('Migration slice exceeds the reviewed item-count safety limit.');
  }
  if (
    slice.writes.reduce((total, write) => total + migrationWriteBytes(write).byteLength, 0) >
    24 * 1024 * 1024
  ) {
    throw new Error('Migration slice exceeds the 24 MiB aggregate write safety limit.');
  }
  const decisions = new Map(
    session.plan.ownership.map((decision) => [decision.sourcePath, decision]),
  );
  const sourceArtifactCopies = new Map(
    (slice.sourceArtifactCopies ?? []).map((copy) => [copy.sourcePath, copy]),
  );
  const plannedSources = new Set(planned.sourcePaths);
  const priorUnverifiedSlice = session.appliedSlices.find(
    (applied) => applied.id === slice.id && !applied.verified,
  );
  if (priorUnverifiedSlice && session.appliedSlices.at(-1)?.id !== priorUnverifiedSlice.id) {
    throw new Error(`Only the most recently applied unverified slice may be amended: ${slice.id}.`);
  }
  const alreadyAccounted = new Set([
    ...session.mappings
      .map((mapping) => mapping.sourcePath)
      .filter((sourcePath) => !priorUnverifiedSlice || !plannedSources.has(sourcePath)),
    ...session.ignoredSources
      .map((ignored) => ignored.sourcePath)
      .filter((sourcePath) => !priorUnverifiedSlice || !plannedSources.has(sourcePath)),
  ]);
  const verifiedSliceIds = new Set(
    session.appliedSlices.filter((applied) => applied.verified).map((applied) => applied.id),
  );
  for (const dependencyOwnerId of planned.dependencyOwnerIds) {
    const dependencySlice = session.plan.slices.find((candidate) =>
      candidate.sourcePaths.some((sourcePath) =>
        session.plan.ownership.some(
          (owner) => owner.sourcePath === sourcePath && owner.ownerId === dependencyOwnerId,
        ),
      ),
    );
    if (dependencySlice && !verifiedSliceIds.has(dependencySlice.id)) {
      throw new Error(
        `Migration slice ${slice.id} requires dependency slice ${dependencySlice.id} first.`,
      );
    }
  }
  const writePaths = new Set<string>();
  const packageWrites = slice.writes.filter((write) => write.relativePath === 'package.json');
  const expectedDependencyPackageWrite = await sourcePackageDependencyWrite(
    session,
    slice.id,
    slice.sourcePackageDependencies ?? [],
  );
  const expectedPackageWrite = await sourcePackageScriptWrite(
    session,
    slice.id,
    slice.sourcePackageScripts ?? [],
    expectedDependencyPackageWrite,
  );
  if (!expectedPackageWrite && packageWrites.length > 0) {
    throw new Error(
      'Migration slices may not author package.json directly; use reviewed sourcePackageDependencies.',
    );
  }
  if (
    expectedPackageWrite &&
    (packageWrites.length !== 1 ||
      packageWrites[0]!.content !== expectedPackageWrite.content ||
      packageWrites[0]!.encoding !== expectedPackageWrite.encoding ||
      packageWrites[0]!.expectedSha256 !== expectedPackageWrite.expectedSha256)
  ) {
    throw new Error(
      'Migration package.json write must be the exact engine-generated source dependency operation.',
    );
  }
  for (const write of slice.writes) {
    safeTargetPath(session.targetRoot, write.relativePath);
    if (writePaths.has(write.relativePath))
      throw new Error(`Duplicate migration write: ${write.relativePath}`);
    writePaths.add(write.relativePath);
    if (migrationWriteBytes(write).byteLength > MAX_FILE_BYTES) {
      throw new Error(`${write.relativePath} exceeds the 4 MiB migration write limit.`);
    }
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
  }
  const baselinePaths = new Set(Object.keys(migrationStarterFileMap(session.inventory)));
  const deletePaths = new Set<string>();
  for (const deletion of slice.deletes ?? []) {
    const target = safeTargetPath(session.targetRoot, deletion.relativePath);
    await assertNoSymlinkAncestors(session.targetRoot, target);
    if (!baselinePaths.has(deletion.relativePath)) {
      throw new Error(`Migration may delete only reviewed starter files: ${deletion.relativePath}`);
    }
    if (writePaths.has(deletion.relativePath) || deletePaths.has(deletion.relativePath)) {
      throw new Error(`Duplicate or contradictory migration deletion: ${deletion.relativePath}`);
    }
    deletePaths.add(deletion.relativePath);
    if (
      (await existingHash(session.targetRoot, deletion.relativePath)) !== deletion.expectedSha256
    ) {
      throw new Error(`${deletion.relativePath} changed since deletion was reviewed.`);
    }
  }
  const seenSources = new Set<string>();
  const nativePrimaries = new Map<string, ReactMigrationSourceMapping>();
  const mergeTargetRanges = new Map<string, Array<{ start: number; end: number }>>();
  for (const mapping of slice.mappings) {
    const decision = decisions.get(mapping.sourcePath);
    if (!decision)
      throw new Error(`Source mapping has no deterministic owner: ${mapping.sourcePath}`);
    if (seenSources.has(mapping.sourcePath)) {
      throw new Error(`Source file is mapped more than once in one slice: ${mapping.sourcePath}`);
    }
    seenSources.add(mapping.sourcePath);
    if (!plannedSources.has(mapping.sourcePath)) {
      throw new Error(`${mapping.sourcePath} belongs to another planned migration slice.`);
    }
    if (alreadyAccounted.has(mapping.sourcePath)) {
      throw new Error(`Source file is already accounted for: ${mapping.sourcePath}`);
    }
    if (mapping.targetPaths.length === 0 || mapping.targetPaths.length > 64) {
      throw new Error(`${mapping.sourcePath} requires 1 to 64 target paths.`);
    }
    for (const targetPath of mapping.targetPaths) {
      safeTargetPath(session.targetRoot, targetPath);
      if (
        !writePaths.has(targetPath) &&
        (await existingHash(session.targetRoot, targetPath)) === null
      ) {
        throw new Error(
          `Mapped target does not exist and is not written by this slice: ${targetPath}`,
        );
      }
    }
    if (mapping.ownerId !== decision.ownerId || mapping.role !== decision.role) {
      throw new Error(
        `${mapping.sourcePath} must use canonical owner ${decision.ownerId} with role ${decision.role}.`,
      );
    }
    if (
      session.inventory.nextAppRouter?.protectedServerFiles.includes(mapping.sourcePath) &&
      (mapping.role === 'ui' ||
        mapping.targetPaths.some((targetPath) => /\.(?:ui|connector)\.tsx$/iu.test(targetPath)))
    ) {
      throw new Error(
        `${mapping.sourcePath} is a protected Next.js server module and cannot enter a client/UI owner.`,
      );
    }
    if (mapping.rationale.trim().length < 8) {
      throw new Error(`${mapping.sourcePath} requires a reviewed ownership rationale.`);
    }
    const compatibility = mapping.mode === 'compatibility';
    if (compatibility !== (mapping.kind === 'compatibility')) {
      throw new Error(`${mapping.sourcePath} has contradictory mapping kind and conversion mode.`);
    }
    if (compatibility) {
      throw new Error(
        `${mapping.sourcePath} compatibility mappings are planning-only and cannot be applied; convert the owner natively.`,
      );
    } else if (mapping.legacyAdapter) {
      throw new Error(`${mapping.sourcePath} native mapping cannot declare a legacy adapter.`);
    }
    if (decision.completionObligation === 'content-addressed-asset') {
      if (
        mapping.mode !== 'native' ||
        mapping.kind !== 'asset' ||
        mapping.targetPaths.length !== 1 ||
        mapping.targetPaths[0] !== decision.canonicalTargetPaths[0]
      ) {
        throw new Error(
          `${mapping.sourcePath} must use its unique content-addressed asset target.`,
        );
      }
      const sourceFile = session.inventory.files.find(
        (file) => file.relativePath === mapping.sourcePath,
      )!;
      const assetWrite = slice.writes.find(
        (write) => write.relativePath === mapping.targetPaths[0],
      );
      const targetHash = assetWrite
        ? sha256(migrationWriteBytes(assetWrite))
        : await existingHash(session.targetRoot, mapping.targetPaths[0]!);
      if (targetHash !== sourceFile.sha256) {
        throw new Error(`${mapping.sourcePath} asset bytes must remain content-identical.`);
      }
      const copy = sourceArtifactCopies.get(mapping.sourcePath);
      if (
        copy &&
        (copy.relativePath !== mapping.targetPaths[0] ||
          copy.expectedSourceSha256 !== sourceFile.sha256)
      ) {
        throw new Error(
          `${mapping.sourcePath} source-artifact copy must bind its canonical target and inventory hash.`,
        );
      }
    }
    if (decision.completionObligation === 'native-owner' && mapping.mode === 'native') {
      const primary = mapping.targetPaths[0];
      if (!primary) throw new Error(`${mapping.sourcePath} requires a canonical target module.`);
      // `ownerPath` is a deterministic planning label, but the scaffold is the
      // canonical authority for the physical owner directory. In particular,
      // a label such as `types-74237a` becomes the valid scaffold directory
      // `types74237a`. Validate containment against the generated canonical
      // gateway directory so a valid planned target is not rejected, while
      // still rejecting arbitrary secondary locations.
      const canonicalOwnerPath = decision.canonicalTargetPaths[0]
        ? posix.dirname(decision.canonicalTargetPaths[0])
        : decision.ownerPath;
      const prior = nativePrimaries.get(primary);
      if (prior && prior.sourcePath !== mapping.sourcePath) {
        const reviewedMerge =
          !!mapping.mergeGroupId &&
          mapping.mergeGroupId === prior.mergeGroupId &&
          writePaths.has(primary) &&
          mapping.mode === 'native' &&
          prior.mode === 'native' &&
          (mapping.traceRanges?.length ?? 0) > 0 &&
          (prior.traceRanges?.length ?? 0) > 0;
        if (!reviewedMerge) {
          throw new Error(
            `${prior.sourcePath} and ${mapping.sourcePath} cannot share one unreviewed bookkeeping target.`,
          );
        }
      }
      nativePrimaries.set(primary, mapping);
      if (
        decision.ownerKind !== 'project' &&
        decision.ownerKind !== 'application' &&
        !primary.startsWith(`${canonicalOwnerPath}/`) &&
        primary !== canonicalOwnerPath
      ) {
        throw new Error(
          `${mapping.sourcePath} must map inside its canonical owner path ${canonicalOwnerPath}.`,
        );
      }
      if (
        decision.canonicalTargetPaths.length > 0 &&
        primary !== decision.canonicalTargetPaths[0]
      ) {
        throw new Error(
          `${mapping.sourcePath} primary target must match canonical role path ${decision.canonicalTargetPaths[0]}.`,
        );
      }
      const missingCanonicalTargets = decision.canonicalTargetPaths.filter(
        (targetPath) => !mapping.targetPaths.includes(targetPath),
      );
      if (missingCanonicalTargets.length > 0) {
        throw new Error(
          `${mapping.sourcePath} mapping is missing canonical owner gateway files: ${missingCanonicalTargets.join(', ')}.`,
        );
      }
      const outsideOwnerTargets = mapping.targetPaths.filter(
        (targetPath) =>
          decision.ownerKind !== 'project' &&
          decision.ownerKind !== 'application' &&
          targetPath !== canonicalOwnerPath &&
          !targetPath.startsWith(`${canonicalOwnerPath}/`),
      );
      if (outsideOwnerTargets.length > 0) {
        throw new Error(
          `${mapping.sourcePath} mapping contains targets outside its canonical owner: ${outsideOwnerTargets.join(', ')}.`,
        );
      }
      const invalidOwnerTargets = mapping.targetPaths.filter(
        (targetPath) =>
          !decision.canonicalTargetPaths.includes(targetPath) &&
          !/(?:\.ui|\.connector)\.tsx$|\.(?:types|api|logic|store)\.ts$|\/use[A-Z][A-Za-z0-9]*\.ts$|\.(?:css|scss|sass|less|styl)$|\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(
            targetPath,
          ),
      );
      if (invalidOwnerTargets.length > 0) {
        throw new Error(
          `${mapping.sourcePath} mapping contains noncanonical secondary targets: ${invalidOwnerTargets.join(', ')}.`,
        );
      }
      if (mapping.traceRanges) {
        const sourceFs = await SrijikaProjectFileSystem.open(session.sourceRoot);
        const sourceText = (await sourceFs.readText(mapping.sourcePath, MAX_FILE_BYTES)).source;
        const targetWrite = slice.writes.find((write) => write.relativePath === primary);
        if (!targetWrite || targetWrite.encoding === 'base64') {
          throw new Error(
            `${mapping.sourcePath} trace ranges require a reviewed UTF-8 primary write.`,
          );
        }
        const sourceLines = sourceText.split(/\r?\n/u).length;
        const targetLines = targetWrite.content.split(/\r?\n/u).length;
        const occupied = mergeTargetRanges.get(primary) ?? [];
        for (const range of mapping.traceRanges) {
          if (
            !Number.isSafeInteger(range.sourceStartLine) ||
            !Number.isSafeInteger(range.sourceEndLine) ||
            !Number.isSafeInteger(range.targetStartLine) ||
            !Number.isSafeInteger(range.targetEndLine) ||
            range.sourceStartLine < 1 ||
            range.targetStartLine < 1 ||
            range.sourceEndLine < range.sourceStartLine ||
            range.targetEndLine < range.targetStartLine ||
            range.sourceEndLine > sourceLines ||
            range.targetEndLine > targetLines ||
            occupied.some(
              (candidate) =>
                range.targetStartLine <= candidate.end && range.targetEndLine >= candidate.start,
            )
          ) {
            throw new Error(`${mapping.sourcePath} contains invalid or overlapping trace ranges.`);
          }
          occupied.push({ start: range.targetStartLine, end: range.targetEndLine });
        }
        if (mapping.mergeGroupId) {
          const coveredSourceLines = new Set<number>();
          for (const range of mapping.traceRanges) {
            for (let line = range.sourceStartLine; line <= range.sourceEndLine; line += 1) {
              coveredSourceLines.add(line);
            }
          }
          const uncoveredExecutableLine = sourceText
            .split(/\r?\n/u)
            .findIndex(
              (line, index) =>
                line.trim().length > 0 &&
                !/^\s*(?:\/\/|\/\*|\*|\*\/)/u.test(line) &&
                !coveredSourceLines.has(index + 1),
            );
          if (uncoveredExecutableLine >= 0) {
            throw new Error(
              `${mapping.sourcePath} reviewed merge trace does not cover executable source line ${uncoveredExecutableLine + 1}.`,
            );
          }
        }
        mergeTargetRanges.set(primary, occupied);
      }
    }
  }
  for (const copy of sourceArtifactCopies.values()) {
    const mapping = slice.mappings.find((candidate) => candidate.sourcePath === copy.sourcePath);
    if (!mapping || !mapping.targetPaths.includes(copy.relativePath)) {
      throw new Error(
        `${copy.sourcePath} source-artifact copy is not represented by its reviewed mapping.`,
      );
    }
  }
  for (const ignored of slice.ignoredSources ?? []) {
    const decision = decisions.get(ignored.sourcePath);
    if (!decision)
      throw new Error(`Ignored source has no deterministic classification: ${ignored.sourcePath}`);
    if (
      !plannedSources.has(ignored.sourcePath) ||
      alreadyAccounted.has(ignored.sourcePath) ||
      seenSources.has(ignored.sourcePath)
    ) {
      throw new Error(
        `Ignored source is outside this slice or already accounted: ${ignored.sourcePath}`,
      );
    }
    seenSources.add(ignored.sourcePath);
    if (ignored.reason.trim().length < 3 || ignored.reason.length > 1_000) {
      throw new Error(`Ignored source ${ignored.sourcePath} requires a bounded review reason.`);
    }
    if (decision.completionObligation !== 'excluded-nonruntime') {
      throw new Error(
        `${ignored.sourcePath} is runtime-bearing and cannot be ignored for completion.`,
      );
    }
  }
  const missingPlannedSources = [...plannedSources].filter(
    (sourcePath) => !seenSources.has(sourcePath),
  );
  if (missingPlannedSources.length > 0) {
    throw new Error(
      `Migration slice must account for every planned source; missing: ${missingPlannedSources.slice(0, 16).join(', ')}.`,
    );
  }
  const requiredDeleteMap = new Map(
    planned.requiredStarterCleanup.map((deletion) => [
      deletion.relativePath,
      deletion.expectedSha256,
    ]),
  );
  if (
    (slice.deletes?.length ?? 0) !== requiredDeleteMap.size ||
    (slice.deletes ?? []).some(
      (deletion) => requiredDeleteMap.get(deletion.relativePath) !== deletion.expectedSha256,
    )
  ) {
    throw new Error(
      'Migration slice deletes must exactly match its engine-issued starter cleanup plan.',
    );
  }
  const mappedWritePaths = new Set(slice.mappings.flatMap((mapping) => mapping.targetPaths));
  const plannedDecisions = [...plannedSources]
    .map((sourcePath) => decisions.get(sourcePath))
    .filter((decision): decision is ReactMigrationOwnershipDecision => decision !== undefined);
  const hasEnvironmentContract = plannedDecisions.some(
    (decision) =>
      session.inventory.files.find((file) => file.relativePath === decision.sourcePath)
        ?.category === 'environment',
  );
  const hasProjectConfiguration = plannedDecisions.some(
    (decision) => decision.ownerKind === 'project' && decision.role === 'configuration',
  );
  const hasStarterApplicationReplacement = planned.requiredStarterCleanup.length > 0;
  const approvedUnmappedWrites = new Set<string>([
    ...(hasEnvironmentContract ? ['.env.example'] : []),
    ...((slice.sourcePackageDependencies?.length ?? 0) > 0 ||
    (slice.sourcePackageScripts?.length ?? 0) > 0
      ? ['package.json']
      : []),
    ...(hasProjectConfiguration
      ? [
          'package.json',
          'pnpm-lock.yaml',
          'package-lock.json',
          'yarn.lock',
          'bun.lock',
          'bun.lockb',
          'index.html',
          'tsconfig.json',
          'tsconfig.app.json',
          'vite.config.ts',
          'vite.config.js',
        ]
      : []),
    ...(hasStarterApplicationReplacement ? ['src/App.tsx', 'srijika.config.json'] : []),
  ]);
  const unissuedWrites = slice.writes.filter(
    (write) =>
      !mappedWritePaths.has(write.relativePath) && !approvedUnmappedWrites.has(write.relativePath),
  );
  if (unissuedWrites.length > 0) {
    throw new Error(
      `Migration slice contains writes without a native mapping or engine-issued project obligation: ${unissuedWrites
        .slice(0, 16)
        .map((write) => write.relativePath)
        .join(', ')}.`,
    );
  }
  await assertSrijikaUiWritesValid(session.targetRoot, slice.writes);
  for (const write of slice.writes) {
    const finding = wrapperFinding(write.relativePath, write.content, session.sourceRoot);
    if (finding) throw new Error(finding);
  }
  if (slice.writes.length === 0) {
    if (
      slice.mappings.some(
        (mapping) =>
          decisions.get(mapping.sourcePath)?.completionObligation !== 'content-addressed-asset',
      )
    ) {
      throw new Error(
        'Zero-write slices may only exclude proven nonruntime files or map hash-identical assets.',
      );
    }
    for (const mapping of slice.mappings) {
      const source = session.inventory.files.find(
        (file) => file.relativePath === mapping.sourcePath,
      )!;
      for (const targetPath of mapping.targetPaths) {
        if ((await existingHash(session.targetRoot, targetPath)) !== source.sha256) {
          throw new Error(
            `Zero-write asset mapping is not content-addressed: ${mapping.sourcePath}`,
          );
        }
      }
    }
  }
}

export async function reviewReactMigrationSlice(
  request: ReviewReactMigrationSliceRequest,
): Promise<ReactMigrationSliceReview> {
  const session = await readSession(request.target);
  if (session.phase === 'complete')
    throw new Error('Completed migrations cannot review new slices.');
  const slice = await materializeSourcePackageDependencies(
    session,
    await materializeSourceArtifactCopies(session, request.slice),
  );
  await validateReviewedSlice(session, slice);
  const payload = canonicalSlicePayload(slice);
  if (Buffer.byteLength(payload, 'utf8') > 24 * 1024 * 1024) {
    throw new Error('Reviewed migration payload exceeds the 24 MiB safety limit.');
  }
  const payloadSha256 = sha256(payload);
  const targetSnapshotSha256 = await projectSnapshotSha256(session.targetRoot);
  const sessionStateSha256 = migrationSessionStateSha256(session);
  const token = sha256(
    `${randomUUID()}\0${session.plan.id}\0${request.slice.id}\0${session.inventory.snapshotSha256}\0${targetSnapshotSha256}\0${sessionStateSha256}\0${payloadSha256}`,
  );
  const payloadPath = `.srijika/migrations/react/reviews/${token}.json`;
  const target = join(session.targetRoot, payloadPath);
  await assertNoSymlinkAncestors(session.targetRoot, dirname(target));
  await mkdir(dirname(target), { recursive: true });
  await assertNoSymlinkAncestors(session.targetRoot, dirname(target));
  await writeFile(target, `${payload}\n`, { encoding: 'utf8', flag: 'wx' });
  const review: ReactMigrationSliceReview = Object.freeze({
    token,
    planId: session.plan.id,
    sliceId: slice.id,
    sourceSnapshotSha256: session.inventory.snapshotSha256,
    targetSnapshotSha256,
    sessionStateSha256,
    payloadSha256,
    payloadPath,
    reviewedAt: new Date().toISOString(),
  });
  await writeSession({
    ...session,
    updatedAt: review.reviewedAt,
    reviewedSlices: Object.freeze([review]),
  });
  await Promise.all(
    session.reviewedSlices.map(async (candidate) => {
      if (
        !/^\.srijika\/migrations\/react\/reviews\/[a-f0-9]{64}\.json$/u.test(candidate.payloadPath)
      ) {
        throw new Error('Pending migration review payload path is invalid.');
      }
      const stalePayload = resolve(session.targetRoot, ...candidate.payloadPath.split('/'));
      if (!isInside(session.targetRoot, stalePayload))
        throw new Error('Pending migration review payload path escapes target.');
      await assertNoSymlinkAncestors(session.targetRoot, stalePayload);
      await rm(stalePayload, { force: true });
    }),
  );
  return review;
}

export async function discardReactMigrationSliceReview(
  request: DiscardReactMigrationSliceReviewRequest,
): Promise<ReactMigrationSession> {
  if (!/^[a-f0-9]{64}$/u.test(request.reviewToken)) {
    throw new Error('Migration review token is invalid.');
  }
  const session = await readSession(request.target);
  const review = session.reviewedSlices.find(
    (candidate) => candidate.token === request.reviewToken,
  );
  if (!review) throw new Error('Migration review token is not pending for this target.');
  if (!/^\.srijika\/migrations\/react\/reviews\/[a-f0-9]{64}\.json$/u.test(review.payloadPath)) {
    throw new Error('Pending migration review payload path is invalid.');
  }
  const payload = resolve(session.targetRoot, ...review.payloadPath.split('/'));
  if (!isInside(session.targetRoot, payload)) {
    throw new Error('Pending migration review payload path escapes target.');
  }
  await assertNoSymlinkAncestors(session.targetRoot, payload);
  await rm(payload, { force: true });
  const next: ReactMigrationSession = Object.freeze({
    ...session,
    updatedAt: new Date().toISOString(),
    reviewedSlices: Object.freeze(
      session.reviewedSlices.filter((candidate) => candidate.token !== request.reviewToken),
    ),
  });
  await writeSession(next);
  return next;
}

async function reviewedSliceForApply(
  session: ReactMigrationSession,
  reviewToken: string,
): Promise<{ slice: ReactMigrationSlice; review: ReactMigrationSliceReview }> {
  if (!/^[a-f0-9]{64}$/u.test(reviewToken)) throw new Error('Migration review token is invalid.');
  const review = session.reviewedSlices.find((candidate) => candidate.token === reviewToken);
  if (
    !review ||
    review.planId !== session.plan.id ||
    review.sourceSnapshotSha256 !== session.inventory.snapshotSha256
  ) {
    throw new Error('Migration review token does not belong to this immutable plan.');
  }
  if (review.sessionStateSha256 !== migrationSessionStateSha256(session)) {
    throw new Error('Migration session changed after the slice payload was reviewed.');
  }
  const currentSource = await scanReactMigrationSource(session.sourceRoot);
  if (currentSource.snapshotSha256 !== review.sourceSnapshotSha256) {
    throw new Error('React source changed after the slice payload was reviewed.');
  }
  const currentTargetSnapshot = await projectSnapshotSha256(session.targetRoot);
  if (currentTargetSnapshot !== review.targetSnapshotSha256) {
    throw new Error('Migration target changed after the slice payload was reviewed.');
  }
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const payload = (
    await fileSystem.readText(review.payloadPath, 24 * 1024 * 1024)
  ).source.trimEnd();
  if (sha256(payload) !== review.payloadSha256)
    throw new Error('Reviewed migration payload changed.');
  const slice = JSON.parse(payload) as ReactMigrationSlice;
  if (
    slice.id !== review.sliceId ||
    sha256(canonicalSlicePayload(slice)) !== review.payloadSha256
  ) {
    throw new Error('Reviewed migration payload is not canonical or belongs to another slice.');
  }
  return { slice, review };
}

export async function applyReactMigrationSlice(
  request: ApplyReactMigrationSliceRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  const { slice: reviewedSlice, review } = await reviewedSliceForApply(
    session,
    request.reviewToken,
  );
  const slice = reviewedSlice;
  if (session.phase === 'complete')
    throw new Error('Completed migrations cannot accept new slices.');
  const priorUnverifiedSlice = session.appliedSlices.find(
    (applied) => applied.id === slice.id && !applied.verified,
  );
  if (session.appliedSlices.some((applied) => applied.id === slice.id && applied.verified)) {
    return session;
  }
  if (priorUnverifiedSlice && session.appliedSlices.at(-1)?.id !== priorUnverifiedSlice.id) {
    throw new Error(`Only the most recently applied unverified slice may be amended: ${slice.id}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/u.test(slice.id)) {
    throw new Error('Migration slice id must be stable kebab-case.');
  }
  if (slice.title.trim().length === 0 || slice.title.length > 320) {
    throw new Error('Migration slice title must contain 1 to 320 characters.');
  }
  if (slice.writes.length + (slice.deletes?.length ?? 0) > 512 || slice.mappings.length > 2_048) {
    throw new Error('Migration slice exceeds the reviewed item-count safety limit.');
  }
  if ((slice.ignoredSources?.length ?? 0) > 2_048) {
    throw new Error('Migration slice exceeds the ignored-source safety limit.');
  }
  const aggregateWriteBytes = slice.writes.reduce(
    (total, write) => total + migrationWriteBytes(write).byteLength,
    0,
  );
  if (aggregateWriteBytes > 24 * 1024 * 1024) {
    throw new Error('Migration slice exceeds the 24 MiB aggregate write safety limit.');
  }
  const sourcePaths = new Set(session.inventory.files.map((file) => file.relativePath));
  const plannedSlice = session.plan.slices.find((planned) => planned.id === slice.id);
  if (!plannedSlice) {
    throw new Error(`Migration slice is not present in the reviewed plan: ${slice.id}`);
  }
  if (slice.title !== plannedSlice.title) {
    throw new Error(`Migration slice title must match the reviewed plan: ${plannedSlice.title}`);
  }
  const plannedSourcePaths = new Set(plannedSlice.sourcePaths);
  const alreadyAccounted = new Set([
    ...session.mappings
      .map((mapping) => mapping.sourcePath)
      .filter((sourcePath) => !priorUnverifiedSlice || !plannedSourcePaths.has(sourcePath)),
    ...session.ignoredSources
      .map((ignored) => ignored.sourcePath)
      .filter((sourcePath) => !priorUnverifiedSlice || !plannedSourcePaths.has(sourcePath)),
  ]);
  const newlyAccounted = new Set<string>();
  for (const mapping of slice.mappings) {
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
  for (const ignored of slice.ignoredSources ?? []) {
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
  const trackedTargetHashes = new Map<string, string>();
  const prepared: Array<{
    write: ReactMigrationWrite;
    target: string;
    before: Buffer | null;
    temporary: string;
  }> = [];
  const writePaths = new Set(slice.writes.map((write) => write.relativePath));
  const deletePaths = new Set((slice.deletes ?? []).map((deletion) => deletion.relativePath));
  if (priorUnverifiedSlice) {
    const priorWritePaths = new Set(priorUnverifiedSlice.writes.map((write) => write.relativePath));
    if (
      priorWritePaths.size !== writePaths.size ||
      [...priorWritePaths].some((path) => !writePaths.has(path))
    ) {
      throw new Error(
        `An unverified slice amendment must rewrite its exact original target set: ${slice.id}.`,
      );
    }
  }
  const mappedTargetPaths = new Set(slice.mappings.flatMap((mapping) => mapping.targetPaths));
  if (mappedTargetPaths.size > MAX_FILES) {
    throw new Error(`Migration slice exceeds the ${MAX_FILES}-target traceability limit.`);
  }
  for (const mapping of slice.mappings) {
    for (const targetPath of mapping.targetPaths) {
      if (deletePaths.has(targetPath)) {
        throw new Error(`Mapped target cannot be deleted by its migration slice: ${targetPath}`);
      }
      if (writePaths.has(targetPath)) continue;
      const hash = await existingHash(session.targetRoot, targetPath);
      if (hash === null) {
        throw new Error(
          `Mapped target does not exist and is not written by this slice: ${targetPath}`,
        );
      }
      trackedTargetHashes.set(targetPath, hash);
    }
  }
  await assertSrijikaUiWritesValid(session.targetRoot, slice.writes);
  for (const write of slice.writes) {
    if (migrationWriteBytes(write).byteLength > MAX_FILE_BYTES) {
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
  const preparedDeletes: Array<{
    relativePath: string;
    target: string;
    before: Buffer;
    temporary: string;
  }> = [];
  for (const deletion of slice.deletes ?? []) {
    const target = safeTargetPath(session.targetRoot, deletion.relativePath);
    await assertNoSymlinkAncestors(session.targetRoot, target);
    const current = await existingHash(session.targetRoot, deletion.relativePath);
    if (current !== deletion.expectedSha256) {
      throw new Error(`${deletion.relativePath} changed since deletion was reviewed.`);
    }
    const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
    const before = Buffer.from((await readSafeBytes(fileSystem, deletion.relativePath)).bytes);
    preparedDeletes.push({
      relativePath: deletion.relativePath,
      target,
      before,
      temporary: `${target}.${process.pid}.${randomUUID()}.deleted`,
    });
  }
  const committed: typeof prepared = [];
  const committedDeletes: typeof preparedDeletes = [];
  let dependencyLockfileSnapshots: readonly ReactMigrationTargetLockfileSnapshot[] = [];
  try {
    for (const item of prepared) {
      await mkdir(dirname(item.target), { recursive: true });
      await assertNoSymlinkAncestors(session.targetRoot, dirname(item.target));
      await writeFile(item.temporary, migrationWriteBytes(item.write), { flag: 'wx' });
      await rename(item.temporary, item.target);
      committed.push(item);
      trackedTargetHashes.set(item.write.relativePath, sha256(migrationWriteBytes(item.write)));
    }
    for (const item of preparedDeletes) {
      await rename(item.target, item.temporary);
      committedDeletes.push(item);
    }
    if ((slice.sourcePackageDependencies?.length ?? 0) > 0) {
      dependencyLockfileSnapshots = await snapshotTargetLockfiles(session.targetRoot);
      await installReviewedSourcePackages(session.targetRoot);
      const packageWrite = slice.writes.find((write) => write.relativePath === 'package.json');
      if (!packageWrite) {
        throw new Error(
          'Reviewed source dependency operation lost its engine-generated package.json write.',
        );
      }
      if (
        (await existingHash(session.targetRoot, 'package.json')) !==
        sha256(migrationWriteBytes(packageWrite))
      ) {
        throw new Error(
          'Reviewed source dependency install modified package.json outside the engine-generated operation.',
        );
      }
      for (const lockfile of dependencyLockfileSnapshots) {
        const hash = await existingHash(session.targetRoot, lockfile.relativePath);
        if (hash !== null) trackedTargetHashes.set(lockfile.relativePath, hash);
      }
    }
    try {
      const stagedUiDiagnostics = await checkSrijikaUiDiagnostics(session.targetRoot);
      if (stagedUiDiagnostics.diagnostics.length > 0) {
        throw new Error(
          `Migration slice ${slice.id} introduces Srijika diagnostics: ${stagedUiDiagnostics.diagnostics
            .slice(0, 8)
            .map(formatSrijikaUiDiagnostic)
            .join(' | ')}${
            stagedUiDiagnostics.diagnostics.length > 8
              ? ` | ${stagedUiDiagnostics.diagnostics.length - 8} more`
              : ''
          }`,
        );
      }
      const stagedArchitecture = await checkSrijikaArchitecture(session.targetRoot);
      const architectureErrors = stagedArchitecture.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      if (architectureErrors.length > 0) {
        throw new Error(
          `Migration slice ${slice.id} introduces Srijika architecture errors: ${architectureErrors
            .slice(0, 8)
            .map((diagnostic) => `${diagnostic.fileName}:${diagnostic.code} ${diagnostic.message}`)
            .join(
              ' | ',
            )}${architectureErrors.length > 8 ? ` | ${architectureErrors.length - 8} more` : ''}`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Migration slice')) throw error;
      throw new Error(
        `Migration slice ${slice.id} introduces Srijika architecture errors: ${
          error instanceof Error ? error.message : 'unknown validator failure'
        }`,
        { cause: error },
      );
    }
    let targetDependenciesInstalled = false;
    try {
      targetDependenciesInstalled = (
        await lstat(join(session.targetRoot, 'node_modules'))
      ).isDirectory();
    } catch {
      // A fresh target may deliberately defer installation until its project slice is complete.
    }
    const stagedCommands = targetDependenciesInstalled
      ? await runReactMigrationVerificationGates({
          target: session.targetRoot,
          names: ['typecheck', 'build'],
        })
      : [];
    const failedGate = stagedCommands.find((command) => command.status === 'failed');
    if (failedGate) {
      throw new Error(
        `Migration slice ${slice.id} fails its declared ${failedGate.name} gate: ${failedGate.details}`,
      );
    }
    const now = new Date().toISOString();
    const { verification: previousVerification, ...sessionWithoutVerification } = session;
    void previousVerification;
    const next: ReactMigrationSession = {
      ...sessionWithoutVerification,
      phase: 'migrating',
      updatedAt: now,
      mappings: Object.freeze([
        ...session.mappings.filter((mapping) => !plannedSourcePaths.has(mapping.sourcePath)),
        ...slice.mappings,
      ]),
      ignoredSources: Object.freeze([
        ...session.ignoredSources.filter((ignored) => !plannedSourcePaths.has(ignored.sourcePath)),
        ...(slice.ignoredSources ?? []),
      ]),
      appliedSlices: Object.freeze([
        ...session.appliedSlices.filter((applied) => applied.id !== slice.id),
        {
          id: slice.id,
          title: slice.title,
          appliedAt: now,
          writes: Object.freeze(
            [...trackedTargetHashes]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([relativePath, targetSha256]) => ({
                relativePath,
                sha256: targetSha256,
              })),
          ),
          deletes: Object.freeze(preparedDeletes.map((item) => item.relativePath).sort()),
          verified: false,
        },
      ]),
      reviewedSlices: Object.freeze(
        session.reviewedSlices.filter((candidate) => candidate.token !== review.token),
      ),
    };
    await writeSession(next);
    await Promise.all(preparedDeletes.map((item) => rm(item.temporary, { force: true })));
    return next;
  } catch (error) {
    let rollbackFailure: unknown;
    try {
      await restoreTargetLockfiles(session.targetRoot, dependencyLockfileSnapshots);
      for (const item of committedDeletes.reverse()) {
        await rename(item.temporary, item.target);
      }
      for (const item of committed.reverse()) {
        if (item.before === null) await rm(item.target, { force: true });
        else await writeFile(item.target, item.before);
      }
    } catch (rollbackError) {
      rollbackFailure = rollbackError;
    } finally {
      await Promise.all(prepared.map((item) => rm(item.temporary, { force: true })));
      await Promise.all(preparedDeletes.map((item) => rm(item.temporary, { force: true })));
    }
    if (rollbackFailure) {
      throw new Error(
        `Migration slice rollback failed after ${error instanceof Error ? error.message : 'an unknown error'}: ${rollbackFailure instanceof Error ? rollbackFailure.message : 'unknown rollback error'}`,
        { cause: error },
      );
    }
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
  for (const deletedPath of selected.deletes ?? []) {
    if ((await existingHash(session.targetRoot, deletedPath)) !== null) {
      throw new Error(`${deletedPath} was restored after reviewed starter cleanup.`);
    }
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
  const sliceTargetSnapshot = await projectSnapshotSha256(session.targetRoot);
  for (const name of ['typecheck', 'build'] as const) {
    const evidence = normalized.find((command) => command.name === name);
    const receiptValid =
      evidence !== undefined && (await commandReceiptValid(session, evidence, sliceTargetSnapshot));
    if (evidence?.status !== 'passed' || !receiptValid) {
      throw new Error(
        `Migration slice ${sliceId} requires passed ${name} evidence (status ${evidence?.status ?? 'missing'}, receipt snapshot ${evidence?.receipt?.targetSnapshotSha256 ?? 'missing'}, current snapshot ${sliceTargetSnapshot}; ${evidence?.details ?? 'no gate details'}).`,
      );
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

async function signedReactMigrationCommandStatus(
  session: ReactMigrationSession,
  command: Omit<ReactMigrationCommandStatus, 'receipt'>,
): Promise<ReactMigrationCommandStatus> {
  const targetSnapshotSha256 = await projectSnapshotSha256(session.targetRoot);
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const key = (await fileSystem.readText(EVIDENCE_KEY_PATH, 256)).source.trim();
  const evidenceSha256 = createHmac('sha256', key)
    .update(`${command.name}\0${command.status}\0${targetSnapshotSha256}\0${command.details ?? ''}`)
    .digest('hex');
  return Object.freeze({
    ...command,
    receipt: Object.freeze({
      issuedBy: 'srijika-engine',
      targetSnapshotSha256,
      evidenceSha256,
    }),
  });
}

async function commandReceiptValid(
  session: ReactMigrationSession,
  command: ReactMigrationCommandStatus,
  targetSnapshotSha256: string,
): Promise<boolean> {
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  const key = (await fileSystem.readText(EVIDENCE_KEY_PATH, 256)).source.trim();
  return (
    command.receipt?.issuedBy === 'srijika-engine' &&
    command.receipt.targetSnapshotSha256 === targetSnapshotSha256 &&
    command.receipt.evidenceSha256 ===
      createHmac('sha256', key)
        .update(
          `${command.name}\0${command.status}\0${targetSnapshotSha256}\0${command.details ?? ''}`,
        )
        .digest('hex')
  );
}

function packageManagerCommand(
  manager: 'pnpm' | 'npm' | 'yarn' | 'bun',
  operation: 'install' | 'typecheck' | 'build' | 'test',
  scriptName: string = operation,
  hasLockfile = true,
): { executable: string; args: readonly string[] } {
  if (operation === 'install') {
    return manager === 'yarn'
      ? { executable: manager, args: Object.freeze(['install', '--immutable']) }
      : manager === 'pnpm'
        ? {
            executable: manager,
            args: Object.freeze([
              'install',
              ...(hasLockfile ? ['--frozen-lockfile'] : ['--lockfile=false']),
            ]),
          }
        : manager === 'npm'
          ? { executable: manager, args: Object.freeze(['ci']) }
          : { executable: manager, args: Object.freeze(['install', '--frozen-lockfile']) };
  }
  return manager === 'npm'
    ? { executable: manager, args: Object.freeze(['run', scriptName]) }
    : { executable: manager, args: Object.freeze([scriptName]) };
}

async function pnpmExecutableFallback(): Promise<string> {
  // A GUI/MCP process often misses PNPM_HOME even though the signed-in user has
  // pnpm installed in the standard user-local location. Prefer that executable
  // before Corepack; some distro-packaged Corepack releases cannot launch the
  // ESM pnpm shim shipped by current Node.
  const home = process.env['HOME'];
  if (home) {
    const userLocalPnpm = join(home, '.local', 'bin', 'pnpm');
    try {
      const metadata = await lstat(userLocalPnpm);
      if (metadata.isFile() || metadata.isSymbolicLink()) return userLocalPnpm;
    } catch {
      // Fall through to Corepack when the optional user-local launcher is absent.
    }
  }
  const executableName = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  for (const directory of (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executableName);
    try {
      const metadata = await lstat(candidate);
      if (metadata.isFile() || metadata.isSymbolicLink()) {
        return process.platform === 'win32' ? 'pnpm' : candidate;
      }
    } catch {
      // Keep searching the inherited executable path.
    }
  }
  return 'corepack';
}

async function executeBoundedGate(
  cwd: string,
  executable: string,
  args: readonly string[],
  gateName: ReactMigrationCommandStatus['name'],
): Promise<{ status: 'passed' | 'failed'; details: string }> {
  const started = Date.now();
  return new Promise((resolveGate) => {
    const executableDirectory = isAbsolute(executable) ? dirname(executable) : undefined;
    const environment = executableDirectory
      ? {
          ...process.env,
          // The migration host can be launched from Windows/desktop with a
          // semicolon-delimited inherited PATH even while executing inside
          // WSL. Package scripts run under POSIX `sh`, so use a deterministic
          // POSIX search path when the engine invokes an absolute Unix tool.
          PATH: executableDirectory.startsWith('/')
            ? `${executableDirectory}:/usr/local/bin:/usr/bin:/bin`
            : [executableDirectory, process.env['PATH']]
                .filter((value): value is string => Boolean(value))
                .join(delimiter),
        }
      : process.env;
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: environment,
    });
    let outputBytes = 0;
    const outputChunks: Buffer[] = [];
    const collect = (chunk: Buffer): void => {
      const remaining = 64 * 1024 - outputBytes;
      if (remaining > 0) outputChunks.push(chunk.subarray(0, remaining));
      outputBytes = Math.min(64 * 1024, outputBytes + chunk.byteLength);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let timedOut = false;
    let fallingBackToCorepack = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, 120_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      // Desktop, VS Code remote hosts, and MCP launchers do not necessarily
      // inherit an interactive shell's PNPM_HOME. Corepack is shipped with the
      // supported Node runtime and honours the project packageManager pin, so
      // it is a safe fallback only when the direct pnpm executable is absent.
      if (executable === 'pnpm' && 'code' in error && error.code === 'ENOENT') {
        fallingBackToCorepack = true;
        void executeBoundedGate(cwd, 'corepack', ['pnpm', ...args], gateName).then(resolveGate);
        return;
      }
      resolveGate({
        status: 'failed',
        details: `Engine execution failed: ${error.message.slice(0, 240)}.`,
      });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (fallingBackToCorepack) return;
      const output = Buffer.concat(outputChunks).toString('utf8');
      // Test runners decorate summary lines with ANSI control sequences. Parse
      // a plain copy so a real green Vitest/Jest run is never downgraded to a
      // skipped/failed gate merely because it was executed in a color TTY.
      const ansiEscapeSequence = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'gu');
      const plainOutput = output.replace(ansiEscapeSequence, '');
      const observedTests =
        /# tests\s+([0-9]+)/u.exec(plainOutput)?.[1] ??
        /Tests\s*:\s*([0-9]+)\s+passed/iu.exec(plainOutput)?.[1] ??
        /Tests\s+([0-9]+)\s+passed/iu.exec(plainOutput)?.[1] ??
        /(?:^|\n)\s*([0-9]+)\s+passed(?:\s|$)/iu.exec(plainOutput)?.[1];
      const emptyTestRun =
        gateName === 'test' && (!observedTests || Number.parseInt(observedTests, 10) < 1);
      resolveGate({
        status: !timedOut && code === 0 && !emptyTestRun ? 'passed' : 'failed',
        details: timedOut
          ? 'Engine execution exceeded the 120 second gate timeout.'
          : emptyTestRun
            ? `Engine executed ${executable} ${args.join(' ')}, but no passing test was observed.`
            : `Engine executed ${executable} ${args.join(' ')}; exit ${code ?? -1}; ${Date.now() - started}ms; observed ${outputBytes} output bytes${gateName === 'test' ? `; ${observedTests} tests passed` : ''}.${code === 0 ? '' : ` Output: ${plainOutput.replace(/\s+/gu, ' ').slice(-480)}`}`,
      });
    });
  });
}

async function installReviewedSourcePackages(targetRoot: string): Promise<void> {
  const project = await inspectSrijikaProject(targetRoot);
  const commands: readonly { executable: string; args: readonly string[] }[] =
    project.packageManager === 'pnpm'
      ? [
          { executable: 'pnpm', args: ['install', '--no-frozen-lockfile', '--ignore-scripts'] },
          { executable: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] },
        ]
      : project.packageManager === 'npm'
        ? [
            { executable: 'npm', args: ['install', '--ignore-scripts'] },
            { executable: 'npm', args: ['ci', '--ignore-scripts'] },
          ]
        : project.packageManager === 'yarn'
          ? [
              { executable: 'yarn', args: ['install', '--ignore-scripts'] },
              { executable: 'yarn', args: ['install', '--frozen-lockfile', '--ignore-scripts'] },
            ]
          : [
              { executable: 'bun', args: ['install', '--ignore-scripts'] },
              { executable: 'bun', args: ['install', '--frozen-lockfile', '--ignore-scripts'] },
            ];
  for (const { executable: requestedExecutable, args } of commands) {
    const executable =
      requestedExecutable === 'pnpm' ? await pnpmExecutableFallback() : requestedExecutable;
    const result = await executeBoundedGate(
      targetRoot,
      executable,
      requestedExecutable === 'pnpm' && executable === 'corepack' ? ['pnpm', ...args] : args,
      'install',
    );
    if (result.status !== 'passed') {
      throw new Error(
        `Reviewed source dependency install failed (${requestedExecutable} ${args.join(' ')}): ${result.details}`,
      );
    }
  }
}

export async function runReactMigrationVerificationGates(
  request: RunReactMigrationVerificationGatesRequest,
): Promise<readonly ReactMigrationCommandStatus[]> {
  const session = await readSession(request.target);
  const project = await inspectSrijikaProject(session.targetRoot);
  const requestedNames = request.names ?? (['typecheck', 'build', 'test'] as const);
  if (
    requestedNames.length === 0 ||
    new Set(requestedNames).size !== requestedNames.length ||
    requestedNames.some((name) => !['typecheck', 'build', 'test'].includes(name))
  ) {
    throw new Error('Verification gate names must be a non-empty unique canonical subset.');
  }
  const names = [...(request.includeInstall ? (['install'] as const) : []), ...requestedNames];
  const raw: Omit<ReactMigrationCommandStatus, 'receipt'>[] = [];
  for (const name of names) {
    const scriptName = name;
    if (name !== 'install' && !project.scripts[scriptName]) {
      raw.push({ name, status: 'skipped', details: `No ${name} script is declared.` });
      continue;
    }
    const script = name === 'install' ? undefined : project.scripts[scriptName]?.trim();
    const canonicalGatePattern =
      name === 'typecheck'
        ? /(?:^|\s)(?:tsc\b|pnpm\s+validate:srijika\b|npm\s+run\s+validate:srijika\b)/u
        : name === 'build'
          ? /(?:^|\s)(?:vite\s+build\b|next\s+build\b|tsc\b[^&|;]*(?:&&|&)\s*(?:vite|next)\s+build\b)/u
          : name === 'test'
            ? /(?:vitest|jest|node\s+--test|playwright|cypress)/u
            : undefined;
    if (
      script !== undefined &&
      (script.length === 0 ||
        /^(?:true|:|echo(?:\s+.*)?|exit\s+0)$/iu.test(script) ||
        /^node\s+(?:--eval|-e)\s+(["'])\s*\1$/iu.test(script) ||
        (canonicalGatePattern !== undefined && !canonicalGatePattern.test(script)))
    ) {
      raw.push({
        name,
        status: 'failed',
        details: `Engine rejected a noncanonical, empty, or no-op ${name} script.`,
      });
      continue;
    }
    const command = packageManagerCommand(
      project.packageManager,
      name,
      scriptName,
      Boolean(project.lockfile),
    );
    // Resolve pnpm before spawning. A GUI/MCP host can expose a shim that is
    // sufficient to launch pnpm itself but does not leave `pnpm` on PATH for
    // the package script's nested shell. The user-local executable gives the
    // child and its scripts one consistent PNPM_HOME boundary.
    const executable =
      command.executable === 'pnpm' ? await pnpmExecutableFallback() : command.executable;
    const result = await executeBoundedGate(project.root, executable, command.args, name);
    raw.push({
      name,
      ...result,
      details: result.details,
    });
  }
  return Object.freeze(
    await Promise.all(raw.map((command) => signedReactMigrationCommandStatus(session, command))),
  );
}

async function artifactHashes(
  root: string,
  artifactPaths: readonly string[],
): Promise<readonly string[]> {
  if (artifactPaths.length === 0 || artifactPaths.length > MAX_FILES) {
    throw new Error(`Parity attestation requires between 1 and ${MAX_FILES} bounded artifacts.`);
  }
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const hashes: string[] = [];
  let totalBytes = 0;
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw new Error('Parity evidence artifact paths must be unique.');
  }
  for (const artifactPath of artifactPaths) {
    const target = safeEvidenceArtifactPath(root, artifactPath);
    await assertNoSymlinkAncestors(root, target);
    const artifact = await readSafeBytes(fileSystem, artifactPath);
    totalBytes += artifact.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Parity artifacts exceed the 64 MiB attestation limit.');
    }
    hashes.push(`${artifactPath}:${sha256(artifact.bytes)}`);
  }
  return Object.freeze(hashes);
}

export async function attestReactMigrationParity(
  request: AttestReactMigrationParityRequest,
): Promise<ReactMigrationCommandStatus> {
  const session = await readSession(request.target);
  if (!request.details.trim() || request.details.length > 2_000) {
    throw new Error('Parity attestation requires bounded reviewed details.');
  }
  if (request.sourceArtifacts.length !== request.targetArtifacts.length) {
    throw new Error('Source and target parity artifact sets must have equal cardinality.');
  }
  if (request.sourceArtifacts.length < 1 || request.sourceArtifacts.length > MAX_FILES) {
    throw new Error('Parity attestation requires a bounded nonempty artifact-pair set.');
  }
  const validViewport = /^(?:mobile|tablet|desktop|wide|\d{2,5}x\d{2,5})$/u;
  if (
    request.name === 'visual' &&
    ((request.viewports?.length ?? 0) < 2 ||
      request.viewports?.some((viewport) => !validViewport.test(viewport.toLowerCase())))
  ) {
    throw new Error(
      'Visual parity attestation requires at least two canonical named or WIDTHxHEIGHT viewports.',
    );
  }
  const applicableSources = session.plan.ownership
    .filter((decision) =>
      request.name === 'routes'
        ? decision.routeEntrypoint
        : ['entry', 'component', 'style', 'asset'].includes(
            session.inventory.files.find((file) => file.relativePath === decision.sourcePath)
              ?.category ?? '',
          ),
    )
    .map((decision) => decision.sourcePath)
    .sort();
  const suppliedSources = [...new Set(request.coveredSourcePaths)].sort();
  if (
    applicableSources.length === 0 ||
    applicableSources.length !== suppliedSources.length ||
    applicableSources.some((sourcePath, index) => sourcePath !== suppliedSources[index])
  ) {
    throw new Error(
      `${request.name} attestation must cover every engine-classified applicable source artifact.`,
    );
  }
  const expectedPairCount =
    request.name === 'visual'
      ? applicableSources.length * (request.viewports?.length ?? 0)
      : applicableSources.length;
  if (request.sourceArtifacts.length !== expectedPairCount) {
    throw new Error(
      `${request.name} parity requires one evidence pair per classified source${request.name === 'visual' ? ' and viewport' : ''}.`,
    );
  }
  const expectedCaptureCases: Array<{ sourcePath: string; viewport?: string }> = [];
  for (const sourcePath of applicableSources) {
    if (request.name === 'visual') {
      for (const viewport of [...(request.viewports ?? [])].sort()) {
        expectedCaptureCases.push({ sourcePath, viewport });
      }
    } else {
      expectedCaptureCases.push({ sourcePath });
    }
  }
  for (const sourcePath of request.coveredSourcePaths) {
    const mapping = session.mappings.find(
      (candidate) => candidate.mode === 'native' && candidate.sourcePath === sourcePath,
    );
    const decision = session.plan.ownership.find(
      (candidate) => candidate.sourcePath === sourcePath,
    );
    if (!mapping || mapping.targetPaths[0] !== decision?.canonicalTargetPaths[0]) {
      throw new Error(
        `${sourcePath} does not have an engine-issued primary native artifact for parity coverage.`,
      );
    }
  }
  const evidencePrefix = '.srijika/migrations/react/evidence/';
  const expectedExtension = request.name === 'visual' ? /\.png$/iu : /\.json$/iu;
  for (const [index, artifactPath] of [
    ...request.sourceArtifacts,
    ...request.targetArtifacts,
  ].entries()) {
    safeEvidenceArtifactPath(session.targetRoot, artifactPath);
    if (!artifactPath.startsWith(evidencePrefix) || !expectedExtension.test(artifactPath)) {
      throw new Error(`${artifactPath} is not a canonical ${request.name} evidence artifact.`);
    }
    if (index < request.sourceArtifacts.length && request.targetArtifacts.includes(artifactPath)) {
      throw new Error('Source and target parity evidence artifacts must be distinct files.');
    }
  }
  const [sourceHashes, targetHashes] = await Promise.all([
    artifactHashes(session.targetRoot, request.sourceArtifacts),
    artifactHashes(session.targetRoot, request.targetArtifacts),
  ]);
  const evidenceFileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
  for (const [index, artifactPath] of [
    ...request.sourceArtifacts,
    ...request.targetArtifacts,
  ].entries()) {
    const bytes = (await readSafeBytes(evidenceFileSystem, artifactPath)).bytes;
    const capture = expectedCaptureCases[index % expectedCaptureCases.length]!;
    const bindingToken = `${sha256(capture.sourcePath).slice(0, 12)}${capture.viewport ? `-${capture.viewport}` : ''}`;
    if (!artifactPath.includes(bindingToken)) {
      throw new Error(
        `${artifactPath} is not bound to ${capture.sourcePath}${capture.viewport ? ` at ${capture.viewport}` : ''}.`,
      );
    }
    if (request.name === 'visual') {
      if (
        bytes.byteLength < 33 ||
        !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        Buffer.from(bytes.subarray(12, 16)).toString('ascii') !== 'IHDR' ||
        Buffer.from(bytes).readUInt32BE(16) < 1 ||
        Buffer.from(bytes).readUInt32BE(20) < 1 ||
        Buffer.from(bytes).readUInt32BE(16) > 16_384 ||
        Buffer.from(bytes).readUInt32BE(20) > 16_384
      ) {
        throw new Error(`${artifactPath} is not a bounded decodable PNG visual capture.`);
      }
    } else {
      try {
        const report = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes)) as Record<
          string,
          unknown
        >;
        if (report['sourcePath'] !== capture.sourcePath || report['result'] !== 'equal') {
          throw new Error('Route report is not bound to its classified source or equal result.');
        }
      } catch {
        throw new Error(`${artifactPath} is not a structured JSON route report.`);
      }
    }
  }
  for (let index = 0; index < sourceHashes.length; index += 1) {
    const sourceHash = sourceHashes[index]!.split(':').at(-1);
    const targetHash = targetHashes[index]!.split(':').at(-1);
    if (sourceHash !== targetHash) {
      throw new Error(
        `Parity artifact pair ${index + 1} differs between source and converted target evidence.`,
      );
    }
  }
  const details = JSON.stringify({
    kind: 'srijika-parity-evidence-v1',
    review: request.details.trim(),
    coveredSourcePaths: [...request.coveredSourcePaths],
    sourceArtifacts: [...request.sourceArtifacts],
    targetArtifacts: [...request.targetArtifacts],
    viewports: [...(request.viewports ?? [])].sort(),
    sourceArtifactSetSha256: sha256(sourceHashes.join('\n')),
    targetArtifactSetSha256: sha256(targetHashes.join('\n')),
  });
  return signedReactMigrationCommandStatus(session, {
    name: request.name,
    status: 'passed',
    details,
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

async function browserParityCommandStatuses(
  session: ReactMigrationSession,
): Promise<readonly ReactMigrationCommandStatus[]> {
  let manifest: ReactMigrationBrowserParityManifest;
  try {
    const { loadReactMigrationBrowserParity } = await import('./react-migration-browser-parity.js');
    manifest = await loadReactMigrationBrowserParity(session.targetRoot);
  } catch {
    return Object.freeze([]);
  }
  const details = JSON.stringify({
    kind: 'srijika-engine-browser-parity-v1',
    manifestSha256: manifest.manifestSha256,
    routes: manifest.routes,
    viewports: manifest.viewports.map(
      (viewport) => `${viewport.name} ${viewport.width}x${viewport.height}`,
    ),
    cases: manifest.cases.length,
    errors: manifest.errors,
  });
  const status = manifest.passed ? 'passed' : 'failed';
  return Object.freeze([
    await signedReactMigrationCommandStatus(session, { name: 'routes', status, details }),
    await signedReactMigrationCommandStatus(session, { name: 'visual', status, details }),
  ]);
}

interface NativeTargetInspection {
  targetSnapshotSha256: string;
  wrapperFindings: readonly string[];
  unownedTargetPaths: readonly string[];
  graphFindings: readonly string[];
  modules: readonly ReactMigrationTargetModule[];
}

async function inspectNativeTarget(
  session: ReactMigrationSession,
): Promise<NativeTargetInspection> {
  const fileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
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
  const sources = new Map<string, string>();
  const hashes = new Map<string, string>();
  let bytes = 0;
  for (const file of files) {
    if (file.relativePath.startsWith('.srijika/migrations/react/')) continue;
    const read = await readSafeBytes(fileSystem, file.relativePath);
    bytes += read.bytes.byteLength;
    if (bytes > MAX_TOTAL_BYTES) throw new Error('Native target inspection exceeds 64 MiB.');
    hashes.set(file.relativePath, sha256(read.bytes));
    try {
      sources.set(file.relativePath, new TextDecoder('utf-8', { fatal: true }).decode(read.bytes));
    } catch {
      // Binary assets participate in hashes but not the import graph.
    }
  }
  const allPaths = new Set(hashes.keys());
  const targetProject = await inspectSrijikaProject(session.targetRoot);
  const targetAliases = targetProject.aliases ?? {};
  const targetArchitecture = resolveSrijikaArchitectureConfig(targetProject.architecture);
  const inferredTargetRole = (relativePath: string): ReactMigrationTargetRole => {
    if (relativePath === targetProject.entry) return 'entry';
    if (relativePath.endsWith(targetArchitecture.connectorSuffix)) return 'connector';
    if (relativePath.endsWith(targetArchitecture.uiSuffix)) return 'ui';
    if (relativePath.endsWith(targetArchitecture.storeSuffix)) return 'store';
    if (relativePath.endsWith(targetArchitecture.logicSuffix)) return 'logic';
    if (relativePath.endsWith(targetArchitecture.apiSuffix)) return 'api';
    if (relativePath.endsWith(targetArchitecture.typesSuffix)) return 'types';
    if (/\.(?:css|scss|sass|less)$/iu.test(relativePath)) return 'style';
    if (/\/(?:hooks\/)?use[A-Z][^/]*\.[cm]?[jt]sx?$/u.test(relativePath)) return 'hook';
    return 'unknown';
  };
  const packageSource = sources.get('package.json');
  const packageJson = packageSource ? (JSON.parse(packageSource) as Record<string, unknown>) : {};
  const dependencyEntries = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].flatMap((field) => {
    const value = packageJson[field];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : [];
  });
  const declaredPackages = new Set(dependencyEntries.map(([name]) => name));
  const wrapperPackages = new Set([
    'react-frame-component',
    'single-spa-react',
    '@module-federation/runtime',
    '@module-federation/enhanced',
    ...Object.values(ADAPTER_PACKAGES)
      .flat()
      // Zustand is the canonical Srijika Store runtime, not a compatibility wrapper.
      .filter((packageName) => packageName !== 'zustand'),
    session.inventory.packageName,
  ]);
  const wrapperFindings: string[] = dependencyEntries.flatMap(([name, version]) => {
    if (wrapperPackages.has(name))
      return [`Target package depends on prohibited wrapper package ${name}.`];
    if (typeof version === 'string' && /^(?:file:|link:|workspace:|\.{1,2}\/|\/)/u.test(version)) {
      return [`Target dependency ${name} escapes reproducible registry resolution (${version}).`];
    }
    return [];
  });
  const graphFindings: string[] = [];
  const targetGraph = new Map<string, Set<string>>();
  const targetModules: ReactMigrationTargetModule[] = [];
  const runtimeSourceHashes = new Map(
    session.inventory.files
      .filter(
        (file) => sourceExtension.test(file.relativePath) || /\.mdx?$/iu.test(file.relativePath),
      )
      .map((file) => [file.sha256, file.relativePath] as const),
  );
  const nativeTargets = new Set(
    session.mappings
      .filter((mapping) => mapping.mode === 'native')
      .flatMap((mapping) => mapping.targetPaths),
  );
  const baselinePaths = new Set(Object.keys(createSrijikaProjectFileMap()));
  const unownedTargetPaths: string[] = [];
  const mappingsByTarget = new Map<string, ReactMigrationSourceMapping[]>();
  for (const mapping of session.mappings) {
    for (const targetPath of mapping.targetPaths) {
      mappingsByTarget.set(targetPath, [...(mappingsByTarget.get(targetPath) ?? []), mapping]);
    }
  }
  for (const [relativePath, source] of sources) {
    const wrapper = wrapperFinding(relativePath, source, session.sourceRoot);
    if (wrapper) wrapperFindings.push(wrapper);
    const migrationTestPath =
      /^(?:test|tests|__tests__)\//u.test(relativePath) ||
      /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(relativePath);
    if (sourceExtension.test(relativePath) && !migrationTestPath) {
      if (!baselinePaths.has(relativePath) && !nativeTargets.has(relativePath)) {
        unownedTargetPaths.push(relativePath);
      }
      const identicalSourcePath = runtimeSourceHashes.get(hashes.get(relativePath)!);
      if (identicalSourcePath) {
        wrapperFindings.push(
          `${relativePath} is an unchanged raw-source copy, not a native conversion.`,
        );
      }
    }
    if (!sourceExtension.test(relativePath) && !styleExtension.test(relativePath)) continue;
    const moduleImports: ReactMigrationTargetModuleImport[] = [];
    for (const specifier of referencedSpecifiers(relativePath, source)) {
      if (
        specifier.startsWith('.') ||
        Object.keys(targetAliases).some((pattern) =>
          pattern.endsWith('/') ? specifier.startsWith(pattern) : specifier === pattern,
        )
      ) {
        const resolvedDependency = resolveSourceDependency(
          relativePath,
          specifier,
          allPaths,
          targetAliases,
        );
        if (!resolvedDependency) {
          graphFindings.push(
            `${relativePath} has unresolved or escaping local import ${specifier}.`,
          );
          moduleImports.push(Object.freeze({ specifier, kind: 'unresolved' }));
        } else {
          const edges = targetGraph.get(relativePath) ?? new Set<string>();
          edges.add(resolvedDependency);
          targetGraph.set(relativePath, edges);
          moduleImports.push(
            Object.freeze({
              specifier,
              kind: 'target',
              resolvedTargetPath: resolvedDependency,
            }),
          );
        }
      } else {
        const packageName = packageNameForSpecifier(specifier);
        if (!declaredPackages.has(packageName) && !specifier.startsWith('node:')) {
          graphFindings.push(`${relativePath} imports undeclared package ${packageName}.`);
        }
        moduleImports.push(Object.freeze({ specifier, kind: 'package', packageName }));
      }
    }
    const mapped = mappingsByTarget.get(relativePath) ?? [];
    const inferredRole = inferredTargetRole(relativePath);
    targetModules.push(
      Object.freeze({
        relativePath,
        ownerIds: Object.freeze([...new Set(mapped.map(({ ownerId }) => ownerId))].sort()),
        roles: Object.freeze(
          [...new Set([inferredRole, ...mapped.map(({ role }) => role)])].sort(),
        ),
        imports: Object.freeze(moduleImports),
        exports: exportedNames(relativePath, source),
      }),
    );
  }
  const entryRoots = new Set<string>();
  const indexSource = sources.get('index.html') ?? '';
  for (const match of indexSource.matchAll(/<script\b([^>]*)>/giu)) {
    const attributes = match[1] ?? '';
    if (!/\btype\s*=\s*["']module["']/iu.test(attributes)) continue;
    const requested = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(attributes)?.[1]?.replace(/^\//u, '');
    if (!requested) continue;
    const resolved = resolveSourceDependency(
      'index.html',
      `./${requested}`,
      allPaths,
      targetAliases,
    );
    if (resolved) entryRoots.add(resolved);
    else graphFindings.push(`index.html has unresolved executable module entry ${requested}.`);
  }
  if (entryRoots.size === 0) {
    graphFindings.push('Target has no resolvable executable module entry in index.html.');
  }
  const reachable = new Set<string>();
  const pending = [...entryRoots];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...(targetGraph.get(current) ?? []));
  }
  const runtimeMappedTargets = new Set(
    session.mappings.flatMap((mapping) => {
      if (
        mapping.mode !== 'native' ||
        ['types', 'style', 'asset', 'test', 'configuration'].includes(mapping.role)
      ) {
        return [];
      }
      return mapping.targetPaths.filter(
        (targetPath) =>
          sourceExtension.test(targetPath) &&
          !/\.(?:types|test|spec)\.[cm]?[jt]sx?$/iu.test(targetPath),
      );
    }),
  );
  for (const targetPath of runtimeMappedTargets) {
    if (!reachable.has(targetPath)) {
      graphFindings.push(
        `${targetPath} is an orphaned native runtime target not reachable from an application entry.`,
      );
    }
  }
  const starter = createSrijikaProjectFileMap();
  for (const [relativePath, source] of Object.entries(starter)) {
    if (
      relativePath.startsWith('src/features/home/') &&
      hashes.get(relativePath) === sha256(source)
    ) {
      wrapperFindings.push(`${relativePath} is unreplaced starter-demo code.`);
    }
  }
  return Object.freeze({
    targetSnapshotSha256: await projectSnapshotSha256(session.targetRoot),
    wrapperFindings: Object.freeze([...new Set(wrapperFindings)].sort()),
    unownedTargetPaths: Object.freeze([...new Set(unownedTargetPaths)].sort()),
    graphFindings: Object.freeze([...new Set(graphFindings)].sort()),
    modules: Object.freeze(
      targetModules.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    ),
  });
}

export async function inspectReactMigrationArchitecture(
  target: string,
): Promise<ReactMigrationArchitectureInspection> {
  const session = await readSession(target);
  const inspection = await inspectNativeTarget(session);
  return Object.freeze({
    sessionId: session.id,
    targetSnapshotSha256: inspection.targetSnapshotSha256,
    modules: inspection.modules,
    wrapperFindings: inspection.wrapperFindings,
    unownedTargetPaths: inspection.unownedTargetPaths,
    graphFindings: inspection.graphFindings,
  });
}

export async function verifyReactMigration(
  request: VerifyReactMigrationRequest,
): Promise<ReactMigrationSession> {
  const session = await readSession(request.target);
  const rescanned = await scanReactMigrationSource(session.sourceRoot);
  const sourceUnchanged = rescanned.snapshotSha256 === session.inventory.snapshotSha256;
  const changedTargetPaths: string[] = [];
  const checkedTargetPaths = new Set<string>();
  for (const slice of session.appliedSlices) {
    for (const write of slice.writes) {
      if (checkedTargetPaths.has(write.relativePath)) continue;
      checkedTargetPaths.add(write.relativePath);
      const actual = await existingHash(session.targetRoot, write.relativePath);
      if (actual !== write.sha256) changedTargetPaths.push(write.relativePath);
    }
  }
  const uiDiagnostics = await checkSrijikaUiDiagnostics(session.targetRoot);
  const architecture = await checkSrijikaArchitecture(session.targetRoot);
  const architectureErrors = architecture.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  const nativeInspection = await inspectNativeTarget(session);
  const requiredEnvironmentKeys = [
    ...new Set(Object.values(session.inventory.environmentKeys).flat()),
  ].sort();
  let targetEnvironmentKeys: readonly string[] = [];
  try {
    const targetFileSystem = await SrijikaProjectFileSystem.open(session.targetRoot);
    targetEnvironmentKeys = environmentKeys(
      (await readSafeBytes(targetFileSystem, '.env.example')).bytes,
    );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const missingEnvironmentKeys = requiredEnvironmentKeys.filter(
    (key) => !targetEnvironmentKeys.includes(key),
  );
  const decisions = new Map(
    session.plan.ownership.map((decision) => [decision.sourcePath, decision]),
  );
  const nativeMappings = new Map(
    session.mappings
      .filter((mapping) => mapping.mode === 'native')
      .map((mapping) => [mapping.sourcePath, mapping]),
  );
  const excluded = new Set(
    session.ignoredSources
      .filter(
        (ignored) =>
          decisions.get(ignored.sourcePath)?.completionObligation === 'excluded-nonruntime',
      )
      .map((ignored) => ignored.sourcePath),
  );
  const accounted = new Set([...nativeMappings.keys(), ...excluded]);
  const unmappedSourcePaths = session.inventory.files
    .map((file) => file.relativePath)
    .filter((path) => !accounted.has(path));
  const compatibilitySourcePaths = session.mappings
    .filter((mapping) => mapping.mode === 'compatibility')
    .map((mapping) => mapping.sourcePath);
  const suppliedCommands = request.commands ?? session.verification?.commands ?? [];
  const commands = normalizedCommands([
    ...suppliedCommands.filter((command) => command.name !== 'routes' && command.name !== 'visual'),
    ...(await browserParityCommandStatuses(session)),
  ]);
  const required = new Map(commands.map((command) => [command.name, command]));
  const commandErrors: string[] = [];
  const requiredCommandNames = ['typecheck', 'build', 'test'] as const;
  for (const name of requiredCommandNames) {
    const evidence = required.get(name);
    if (!evidence) commandErrors.push(`Missing ${name} verification evidence.`);
    else if (evidence.status !== 'passed') commandErrors.push(`${name} verification must pass.`);
    else if (
      !(await commandReceiptValid(session, evidence, nativeInspection.targetSnapshotSha256))
    ) {
      commandErrors.push(
        `${name} verification receipt is missing or stale for the target snapshot.`,
      );
    }
  }
  if (
    session.inventory.semanticRoutesPresent ||
    session.inventory.files.some((file) => file.category === 'route')
  ) {
    const routes = required.get('routes');
    if (
      routes?.status !== 'passed' ||
      !routes.details?.trim() ||
      !(await commandReceiptValid(session, routes, nativeInspection.targetSnapshotSha256))
    ) {
      commandErrors.push('Route parity evidence with reviewed details is required.');
    }
  }
  if (
    session.inventory.files.some((file) =>
      ['entry', 'component', 'style', 'asset'].includes(file.category),
    )
  ) {
    const visual = required.get('visual');
    if (
      visual?.status !== 'passed' ||
      !hasResponsiveVisualDetails(visual.details) ||
      !(await commandReceiptValid(session, visual, nativeInspection.targetSnapshotSha256))
    ) {
      commandErrors.push(
        'Visual parity evidence with at least two reviewed viewport details is required.',
      );
    }
  }
  const errors = [
    ...(sourceUnchanged ? [] : ['React source changed after migration started.']),
    ...(changedTargetPaths.length === 0
      ? []
      : [
          `${changedTargetPaths.length} tracked target files changed after slice application: ${changedTargetPaths
            .slice(0, 8)
            .join(
              ', ',
            )}${changedTargetPaths.length > 8 ? `, ${changedTargetPaths.length - 8} more` : ''}.`,
        ]),
    ...uiDiagnostics.diagnostics.map(formatSrijikaUiDiagnostic),
    ...architectureErrors.map((diagnostic) => diagnostic.message),
    ...(unmappedSourcePaths.length === 0
      ? []
      : [`${unmappedSourcePaths.length} source files are not mapped or explicitly ignored.`]),
    ...(compatibilitySourcePaths.length === 0
      ? []
      : [
          `${compatibilitySourcePaths.length} compatibility mappings remain transitional and cannot satisfy native completion.`,
        ]),
    ...(session.appliedSlices.every((slice) => slice.verified)
      ? []
      : ['Every applied migration slice must be verified.']),
    ...session.plan.unsupported.map((reason) => `Unsupported migration behavior: ${reason}`),
    ...nativeInspection.wrapperFindings,
    ...nativeInspection.graphFindings,
    ...(missingEnvironmentKeys.length === 0
      ? []
      : [
          `Target .env.example is missing source contract keys: ${missingEnvironmentKeys.join(', ')}.`,
        ]),
    ...(nativeInspection.unownedTargetPaths.length === 0
      ? []
      : [
          `${nativeInspection.unownedTargetPaths.length} target source modules have no native owner mapping.`,
        ]),
    ...commandErrors,
  ];
  const verification: ReactMigrationVerification = Object.freeze({
    checkedAt: new Date().toISOString(),
    sourceUnchanged,
    srijikaDiagnosticsValid: uiDiagnostics.diagnostics.length === 0,
    architectureValid: architectureErrors.length === 0,
    nativeCompletionValid:
      unmappedSourcePaths.length === 0 &&
      session.mappings.every((mapping) => mapping.mode === 'native') &&
      session.plan.unsupported.length === 0,
    targetGraphValid:
      nativeInspection.graphFindings.length === 0 &&
      nativeInspection.unownedTargetPaths.length === 0,
    environmentContractValid: missingEnvironmentKeys.length === 0,
    targetSnapshotSha256: nativeInspection.targetSnapshotSha256,
    wrapperFindings: nativeInspection.wrapperFindings,
    unownedTargetPaths: nativeInspection.unownedTargetPaths,
    unmappedSourcePaths: Object.freeze(unmappedSourcePaths),
    commands: Object.freeze(commands),
    errors: Object.freeze(errors),
    passed: errors.length === 0,
  });
  const next: ReactMigrationSession = {
    ...session,
    // A partial conversion is expected to fail completion-only checks (full
    // source coverage, reachability, route/visual parity). Keep it resumable
    // as migrating; reserve blocked for a genuinely complete coverage state
    // that still fails a native safety or verification gate.
    phase: verification.passed
      ? 'verifying'
      : !sourceUnchanged
        ? 'blocked'
        : unmappedSourcePaths.length > 0
          ? 'migrating'
          : 'blocked',
    updatedAt: verification.checkedAt,
    verification,
  };
  await writeSession(next);
  return next;
}

export async function finalizeReactMigration(
  request: VerifyReactMigrationRequest,
): Promise<ReactMigrationSession> {
  const current = await readSession(request.target);
  let priorBrowserParity: ReactMigrationBrowserParityManifest;
  try {
    const { loadReactMigrationBrowserParity } = await import('./react-migration-browser-parity.js');
    priorBrowserParity = await loadReactMigrationBrowserParity(current.targetRoot);
  } catch (error) {
    throw new Error(
      'React migration cannot be finalized without current engine-owned browser parity evidence.',
      { cause: error },
    );
  }
  const { captureReactMigrationBrowserParity } =
    await import('./react-migration-browser-parity.js');
  const recapturedBrowserParity = await captureReactMigrationBrowserParity({
    target: current.targetRoot,
    includeInstall: priorBrowserParity.includeInstall,
  });
  if (!recapturedBrowserParity.passed) {
    const parityErrors = [
      ...recapturedBrowserParity.errors,
      ...recapturedBrowserParity.cases.flatMap((parityCase) =>
        parityCase.errors.map(
          (error) => `${parityCase.route} ${parityCase.viewport.name}: ${error}`,
        ),
      ),
    ];
    throw new Error(
      `React migration browser parity failed during finalization: ${parityErrors.slice(0, 16).join(' ')}`,
    );
  }
  const commands: ReactMigrationCommandStatus[] = [
    ...(await runReactMigrationVerificationGates({ target: current.targetRoot })),
    ...(await browserParityCommandStatuses(current)),
  ];
  const verified = await verifyReactMigration({ target: current.targetRoot, commands });
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
      request.framework === 'next-app-router' ? 'next' : 'react',
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
