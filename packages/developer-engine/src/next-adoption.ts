import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import {
  analyzeSrijikaPayloadNextProfile,
  buildSrijikaTestContract,
  resolveSrijikaArchitectureConfig,
  type SrijikaPayloadNextProfile,
} from '@srijika/architecture-rules';
import {
  applySrijikaOwnershipCreationPlan,
  buildSrijikaNextTestAdapterPlan,
} from '@srijika/project-scaffold';
import ts from 'typescript';

import { checkSrijikaArchitecture } from './architecture.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import type { SrijikaPackageManager } from './types.js';
import { checkSrijikaUiDiagnostics } from './ui-diagnostics.js';

export const SRIJIKA_NEXT_ADOPTION_VERSION = 'srijika-next-adoption-v1' as const;

const MAX_PACKAGE_BYTES = 1024 * 1024;
const MAX_TSCONFIG_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_FILES = 4_096;
const MAX_SCAN_ENTRIES = 32_768;
const MAX_SCAN_DIRECTORIES = 4_096;
const MAX_SCAN_DEPTH = 32;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;

const LOCKFILES: readonly {
  manager: SrijikaPackageManager;
  fileName: string;
  text: boolean;
}[] = Object.freeze([
  { manager: 'pnpm', fileName: 'pnpm-lock.yaml', text: true },
  { manager: 'npm', fileName: 'package-lock.json', text: true },
  { manager: 'yarn', fileName: 'yarn.lock', text: true },
  { manager: 'bun', fileName: 'bun.lock', text: true },
  { manager: 'bun', fileName: 'bun.lockb', text: false },
]);

const NEXT_FRAMEWORK_FILE_KINDS = new Set([
  'default',
  'error',
  'global-error',
  'layout',
  'loading',
  'not-found',
  'page',
  'route',
  'template',
]);

export interface SrijikaNextAdoptionRequest {
  project: string;
  dryRun?: boolean;
}

export interface SrijikaNextAdoptionBaselineFile {
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface SrijikaNextAdoptionRouteFile {
  relativePath: string;
  kind: string;
  classification: 'framework-owned-server-surface';
}

export interface SrijikaNextAdoptionFinding {
  code:
    | 'SRIJIKA-ADOPT-EXTRA-LOCKFILE'
    | 'SRIJIKA-ADOPT-FRAMEWORK-OWNED'
    | 'SRIJIKA-ADOPT-REPORT-ONLY'
    | 'SRIJIKA-ADOPT-SERVER-ONLY';
  severity: 'information' | 'warning';
  relativePath?: string;
  message: string;
  guidance: string;
}

export interface SrijikaNextAdoptionMergeInstruction {
  relativePath: string;
  reason: string;
  required: unknown;
}

export interface SrijikaNextAdoptionFile {
  relativePath: string;
  source: string;
}

export interface SrijikaNextAdoptionCommand {
  name: 'typecheck' | 'build';
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMillis: number;
}

export interface SrijikaNextAdoptionProcess {
  executable: string;
  args: readonly string[];
}

export interface SrijikaNextAdoptionPlan {
  version: typeof SRIJIKA_NEXT_ADOPTION_VERSION;
  framework: 'next-app-router';
  root: string;
  packageManager: SrijikaPackageManager;
  lockfile: string;
  nextVersion: string;
  appRoot: 'app' | 'src/app';
  entry: string;
  aliases: Readonly<Record<string, string>>;
  nextTypeScriptPlugin: boolean;
  routes: readonly SrijikaNextAdoptionRouteFile[];
  protectedServerFiles: readonly string[];
  payload: SrijikaPayloadNextProfile | null;
  baseline: readonly SrijikaNextAdoptionBaselineFile[];
  files: readonly SrijikaNextAdoptionFile[];
  unchanged: readonly string[];
  preserved: readonly string[];
  mergeInstructions: readonly SrijikaNextAdoptionMergeInstruction[];
  findings: readonly SrijikaNextAdoptionFinding[];
  verification: readonly SrijikaNextAdoptionCommand[];
}

export interface SrijikaNextAdoptionVerificationGate {
  name: 'typecheck' | 'build';
  status: 'passed' | 'failed';
  exitCode: number;
  durationMillis: number;
  output: string;
}

export interface SrijikaNextAdoptionResult {
  plan: SrijikaNextAdoptionPlan;
  dryRun: boolean;
  created: readonly string[];
  verification: readonly SrijikaNextAdoptionVerificationGate[];
  reportOnly: {
    architectureErrors: number;
    architectureRecommendations: number;
    uiDiagnostics: number;
  } | null;
}

type PackageJson = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  const candidate = record(value, label);
  for (const [key, entry] of Object.entries(candidate)) {
    if (typeof entry !== 'string') throw new Error(`${label}.${key} must be a string.`);
  }
  return candidate as Readonly<Record<string, string>>;
}

function jsonSource(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function packageManagerExecutable(manager: SrijikaPackageManager): string {
  return process.platform === 'win32' ? `${manager}.cmd` : manager;
}

function packageExecArguments(
  manager: SrijikaPackageManager,
  binary: string,
  args: readonly string[],
): readonly string[] {
  if (manager === 'npm') return ['exec', '--', binary, ...args];
  if (manager === 'bun') return ['x', binary, ...args];
  return ['exec', binary, ...args];
}

const WINDOWS_COMMAND_TOKEN = /^[A-Za-z0-9_./:@=-]+$/u;

export function resolveSrijikaNextAdoptionProcess(
  command: SrijikaNextAdoptionCommand,
  platform: NodeJS.Platform = process.platform,
  commandShell: string | undefined = process.env['ComSpec'],
): SrijikaNextAdoptionProcess {
  if (platform !== 'win32') {
    return Object.freeze({ executable: command.executable, args: command.args });
  }
  const tokens = [command.executable, ...command.args];
  const unsafe = tokens.find((token) => !WINDOWS_COMMAND_TOKEN.test(token));
  if (unsafe !== undefined) {
    throw new Error(`Windows adoption command contains an unsafe token: ${unsafe}`);
  }
  return Object.freeze({
    executable: commandShell?.trim() || 'cmd.exe',
    args: Object.freeze(['/d', '/s', '/c', tokens.join(' ')]),
  });
}

function declaredPackageManager(value: unknown): SrijikaPackageManager | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') throw new Error('package.json packageManager must be a string.');
  const match = /^(pnpm|npm|yarn|bun)(?:@[^\s]+)?$/u.exec(value.trim());
  if (!match?.[1]) {
    throw new Error('package.json packageManager must select pnpm, npm, yarn, or bun.');
  }
  return match[1] as SrijikaPackageManager;
}

async function pathIsDirectory(
  fileSystem: SrijikaProjectFileSystem,
  relativePath: string,
): Promise<boolean> {
  try {
    await fileSystem.inspectDirectory(relativePath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function hasNextTypeScriptPlugin(source: string): boolean {
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', source);
  if (parsed.error) {
    throw new Error(
      `tsconfig.json is not valid JSONC: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
    );
  }
  const root = record(parsed.config, 'tsconfig.json');
  const compilerOptions = root['compilerOptions'];
  if (compilerOptions === undefined) return false;
  const compiler = record(compilerOptions, 'tsconfig.json compilerOptions');
  const plugins = compiler['plugins'];
  if (plugins === undefined) return false;
  if (!Array.isArray(plugins))
    throw new Error('tsconfig.json compilerOptions.plugins must be an array.');
  return plugins.some((plugin) => record(plugin, 'tsconfig.json plugin')['name'] === 'next');
}

function normalizedTsconfigPath(value: string, label: string, allowEmpty = false): string {
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error(`${label} must remain inside the project root.`);
  }
  const output: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (output.length === 0) throw new Error(`${label} must not traverse outside the project.`);
      output.pop();
    } else output.push(segment);
  }
  const normalized = output.join('/');
  if (!allowEmpty && !normalized) throw new Error(`${label} must be nonempty.`);
  return normalized;
}

function parseNextAdoptionAliases(source: string): Readonly<Record<string, string>> {
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', source);
  if (parsed.error) {
    throw new Error(
      `tsconfig.json is not valid JSONC: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
    );
  }
  const root = record(parsed.config, 'tsconfig.json');
  const compilerValue = root['compilerOptions'];
  if (compilerValue === undefined) return Object.freeze({});
  const compiler = record(compilerValue, 'tsconfig.json compilerOptions');
  const baseUrlValue = compiler['baseUrl'];
  if (baseUrlValue !== undefined && typeof baseUrlValue !== 'string') {
    throw new Error('tsconfig.json compilerOptions.baseUrl must be a string.');
  }
  const baseUrl = normalizedTsconfigPath(
    typeof baseUrlValue === 'string' ? baseUrlValue : '',
    'tsconfig.json compilerOptions.baseUrl',
    true,
  );
  const pathsValue = compiler['paths'];
  if (pathsValue === undefined) return Object.freeze({});
  const paths = record(pathsValue, 'tsconfig.json compilerOptions.paths');
  const aliases: Array<readonly [string, string]> = [];
  for (const [pattern, rawTargets] of Object.entries(paths)) {
    if (
      !pattern ||
      pattern.includes('\0') ||
      pattern.includes('\\') ||
      (pattern.includes('*') && !pattern.endsWith('*')) ||
      (pattern.match(/\*/gu)?.length ?? 0) > 1
    ) {
      throw new Error(`tsconfig.json path alias ${pattern || '<empty>'} is not deterministic.`);
    }
    if (
      !Array.isArray(rawTargets) ||
      rawTargets.length === 0 ||
      typeof rawTargets[0] !== 'string'
    ) {
      throw new Error(`tsconfig.json path alias ${pattern} must have at least one string target.`);
    }
    const wildcard = pattern.endsWith('*');
    const firstTarget = rawTargets[0];
    if ((wildcard && !pattern.endsWith('/*')) || (!wildcard && pattern.endsWith('/'))) {
      throw new Error(
        `tsconfig.json path alias ${pattern} must be an exact alias or a slash-delimited /* wildcard.`,
      );
    }
    if (
      firstTarget.includes('*') !== wildcard ||
      (firstTarget.includes('*') && !firstTarget.endsWith('*')) ||
      (firstTarget.match(/\*/gu)?.length ?? 0) > 1 ||
      (wildcard && !firstTarget.endsWith('/*'))
    ) {
      throw new Error(`tsconfig.json path alias ${pattern} must use a matching terminal wildcard.`);
    }
    const alias = wildcard ? pattern.slice(0, -1) : pattern;
    const targetWithoutWildcard = wildcard ? firstTarget.slice(0, -1) : firstTarget;
    const target = normalizedTsconfigPath(
      [baseUrl, targetWithoutWildcard].filter(Boolean).join('/'),
      `tsconfig.json path alias ${pattern}`,
      true,
    );
    aliases.push([alias, target]);
  }
  return Object.freeze(Object.fromEntries(aliases));
}

function isSourceFile(fileName: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(fileName) && !/\.d\.(?:ts|tsx|mts|cts)$/iu.test(fileName);
}

function isServerOnlySource(relativePath: string, source: string, appRoot: string): boolean {
  if (
    relativePath.startsWith(`${appRoot}/`) &&
    /(?:^|\/)route\.(?:[cm]?[jt]sx?)$/iu.test(relativePath)
  ) {
    return true;
  }
  return (
    /^\s*['"]use server['"];?/mu.test(source) ||
    /from\s+['"](?:server-only|next\/headers|next\/server)['"]/u.test(source)
  );
}

function routeKind(fileName: string): string {
  return fileName.replace(/\.(?:[cm]?[jt]sx?)$/iu, '');
}

function mergeRequiredContent(file: SrijikaNextAdoptionFile): unknown {
  return file.relativePath.endsWith('.json')
    ? (JSON.parse(file.source) as unknown)
    : { source: file.source };
}

function desiredEditorAndMcpFiles(): readonly SrijikaNextAdoptionFile[] {
  return Object.freeze([
    {
      relativePath: '.mcp.json',
      source: jsonSource({
        mcpServers: {
          'srijika-project': {
            command: 'npx',
            args: ['-y', '@srijika/mcp-server@0.5.0', '--project', '.'],
            cwd: '.',
          },
        },
      }),
    },
    {
      relativePath: '.vscode/extensions.json',
      source: jsonSource({ recommendations: ['srijika.srijika-language-support'] }),
    },
    {
      relativePath: '.vscode/mcp.json',
      source: jsonSource({
        servers: {
          'srijika-project': {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@srijika/mcp-server@0.5.0', '--project', '${workspaceFolder}'],
          },
        },
      }),
    },
    {
      relativePath: '.vscode/settings.json',
      source: jsonSource({
        'editor.codeActionsOnSave': { 'source.fixAll.srijika': 'explicit' },
        'files.associations': { '*.ui.tsx': 'typescriptreact' },
      }),
    },
  ]);
}

async function selectedLockfile(
  fileSystem: SrijikaProjectFileSystem,
  packageJson: PackageJson,
): Promise<{
  manager: SrijikaPackageManager;
  lockfile: string;
  extras: readonly string[];
}> {
  const available = [] as Array<(typeof LOCKFILES)[number]>;
  for (const candidate of LOCKFILES) {
    if (await fileSystem.isRegularFile(candidate.fileName)) available.push(candidate);
  }
  if (available.length === 0) {
    throw new Error('Adoption requires an npm, pnpm, yarn, or bun root lockfile.');
  }
  const declared = declaredPackageManager(packageJson['packageManager']);
  const managers = [...new Set(available.map(({ manager }) => manager))];
  if (!declared && managers.length > 1) {
    throw new Error(
      'Multiple package-manager lockfiles were found. Declare the authoritative packageManager in package.json.',
    );
  }
  const manager = declared ?? managers[0]!;
  const matches = available.filter((candidate) => candidate.manager === manager);
  if (matches.length === 0) {
    throw new Error(`packageManager selects ${manager}, but its root lockfile is missing.`);
  }
  const selected = matches.find(({ text }) => text) ?? matches[0]!;
  if (!selected.text) {
    throw new Error(
      'bun.lockb is not supported for adoption; migrate it to the text bun.lock format.',
    );
  }
  return {
    manager,
    lockfile: selected.fileName,
    extras: available
      .filter(({ fileName }) => fileName !== selected.fileName)
      .map(({ fileName }) => fileName)
      .sort(),
  };
}

function nextVersionFromPackage(packageJson: PackageJson): string {
  const dependencies = {
    ...stringRecord(packageJson['dependencies'], 'package.json dependencies'),
    ...stringRecord(packageJson['devDependencies'], 'package.json devDependencies'),
  };
  const version = dependencies['next'];
  if (!version) throw new Error('Adoption requires Next.js in package.json dependencies.');
  return version;
}

function verificationCommands(
  root: string,
  manager: SrijikaPackageManager,
  scripts: Readonly<Record<string, string>>,
): readonly SrijikaNextAdoptionCommand[] {
  if (!scripts['build']) {
    throw new Error('package.json must provide the authoritative Next production build script.');
  }
  const executable = packageManagerExecutable(manager);
  return Object.freeze([
    {
      name: 'typecheck',
      executable,
      args: Object.freeze(
        scripts['typecheck']
          ? ['run', 'typecheck']
          : packageExecArguments(manager, 'tsc', ['-p', 'tsconfig.json', '--noEmit']),
      ),
      cwd: root,
      timeoutMillis: 2 * 60_000,
    },
    {
      name: 'build',
      executable,
      args: Object.freeze(['run', 'build']),
      cwd: root,
      timeoutMillis: 5 * 60_000,
    },
  ]);
}

async function fileState(
  fileSystem: SrijikaProjectFileSystem,
  file: SrijikaNextAdoptionFile,
): Promise<'missing' | 'unchanged' | 'preserved'> {
  if (!(await fileSystem.isRegularFile(file.relativePath))) return 'missing';
  const current = (await fileSystem.readText(file.relativePath, MAX_SOURCE_BYTES)).source;
  return current === file.source ? 'unchanged' : 'preserved';
}

async function assertBaseline(
  fileSystem: SrijikaProjectFileSystem,
  baseline: readonly SrijikaNextAdoptionBaselineFile[],
): Promise<void> {
  for (const expected of baseline) {
    const current = await fileSystem.readText(
      expected.relativePath,
      Math.max(MAX_SOURCE_BYTES, expected.bytes + 1),
    );
    if (current.size !== expected.bytes || sha256(current.source) !== expected.sha256) {
      throw new Error(`${expected.relativePath} changed after adoption planning; run adopt again.`);
    }
  }
}

export async function planSrijikaNextAdoption(
  request: SrijikaNextAdoptionRequest,
): Promise<SrijikaNextAdoptionPlan> {
  const root = resolve(request.project);
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  if (!(await fileSystem.isRegularFile('package.json'))) {
    throw new Error('Adoption requires package.json at the Next.js project root.');
  }
  if (await fileSystem.isRegularFile('srijika.config.json')) {
    throw new Error('This project already has srijika.config.json; use Srijika check instead.');
  }
  if (!(await fileSystem.isRegularFile('tsconfig.json'))) {
    throw new Error('Adoption requires the authoritative Next.js tsconfig.json.');
  }

  const packageSource = (await fileSystem.readText('package.json', MAX_PACKAGE_BYTES)).source;
  const packageJson = record(JSON.parse(packageSource) as unknown, 'package.json');
  const scripts = stringRecord(packageJson['scripts'], 'package.json scripts');
  const dependencies = {
    ...stringRecord(packageJson['dependencies'], 'package.json dependencies'),
    ...stringRecord(packageJson['devDependencies'], 'package.json devDependencies'),
    ...stringRecord(packageJson['optionalDependencies'], 'package.json optionalDependencies'),
  };
  const nextVersion = nextVersionFromPackage(packageJson);
  const lock = await selectedLockfile(fileSystem, packageJson);
  const appRoots = (
    await Promise.all(
      (['src/app', 'app'] as const).map(async (candidate) => ({
        candidate,
        present: await pathIsDirectory(fileSystem, candidate),
      })),
    )
  ).filter(({ present }) => present);
  if (appRoots.length !== 1) {
    throw new Error('Adoption requires exactly one App Router root: app or src/app.');
  }
  const appRoot = appRoots[0]!.candidate;
  const tsconfigSource = (await fileSystem.readText('tsconfig.json', MAX_TSCONFIG_BYTES)).source;
  const aliases = parseNextAdoptionAliases(tsconfigSource);
  const sourceFiles = await fileSystem.walkFiles([''], {
    maximumFiles: MAX_SOURCE_FILES,
    maximumEntries: MAX_SCAN_ENTRIES,
    maximumDirectories: MAX_SCAN_DIRECTORIES,
    maximumDepth: MAX_SCAN_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: true,
    acceptFile: isSourceFile,
  });
  let sourceTotalBytes = 0;
  const sources: Record<string, string> = {};
  const baseline: SrijikaNextAdoptionBaselineFile[] = [];
  for (const file of sourceFiles) {
    const read = await fileSystem.readText(file.relativePath, MAX_SOURCE_BYTES);
    sourceTotalBytes += read.size;
    if (sourceTotalBytes > MAX_SOURCE_TOTAL_BYTES) {
      throw new Error('Adoption source exceeds the 32 MiB aggregate safety limit.');
    }
    sources[file.relativePath] = read.source;
    baseline.push({
      relativePath: file.relativePath,
      bytes: read.size,
      sha256: sha256(read.source),
    });
  }
  for (const relativePath of ['package.json', 'tsconfig.json', lock.lockfile]) {
    if (baseline.some((entry) => entry.relativePath === relativePath)) continue;
    const read = await fileSystem.readText(
      relativePath,
      relativePath === lock.lockfile ? MAX_LOCKFILE_BYTES : MAX_SOURCE_BYTES,
    );
    baseline.push({ relativePath, bytes: read.size, sha256: sha256(read.source) });
  }
  baseline.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const uiFiles = sourceFiles
    .map(({ relativePath }) => relativePath)
    .filter((relativePath) => relativePath.endsWith('.ui.tsx'))
    .filter((relativePath) => !/\.(?:test|spec)\.[^/]+$/iu.test(relativePath))
    .sort();
  const entry = uiFiles[0];
  if (!entry) {
    throw new Error(
      'Adoption requires at least one explicit .ui.tsx presentation source; route files are never inferred as UI owners.',
    );
  }

  const routes = sourceFiles
    .filter(({ relativePath }) => relativePath.startsWith(`${appRoot}/`))
    .filter(({ relativePath }) =>
      NEXT_FRAMEWORK_FILE_KINDS.has(routeKind(relativePath.split('/').at(-1)!)),
    )
    .map(({ relativePath }): SrijikaNextAdoptionRouteFile => ({
      relativePath,
      kind: routeKind(relativePath.split('/').at(-1)!),
      classification: 'framework-owned-server-surface',
    }));
  const payload = analyzeSrijikaPayloadNextProfile({
    dependencies,
    appRoot,
    files: sourceFiles.map(({ relativePath }) => ({
      relativePath,
      source: sources[relativePath]!,
    })),
  });
  const protectedServerFiles = [
    ...new Set([
      ...sourceFiles
        .filter(({ relativePath }) =>
          isServerOnlySource(relativePath, sources[relativePath]!, appRoot),
        )
        .map(({ relativePath }) => relativePath),
      ...(payload.detected ? payload.protectedServerFiles : []),
    ]),
  ].sort();
  const architecture = resolveSrijikaArchitectureConfig();
  const contract = buildSrijikaTestContract(
    sourceFiles.map(({ relativePath }) => ({
      fileName: relativePath,
      source: sources[relativePath]!,
    })),
    { architecture, aliases },
  );
  const testAdapter = buildSrijikaNextTestAdapterPlan(contract, {
    packageManager: lock.manager,
  });
  const config = {
    version: 1,
    sourceOfTruth: 'tsx',
    entry,
    architecture,
    adoption: {
      version: 1,
      framework: 'next-app-router',
      enforcement: 'report-only',
    },
  };
  const desired: SrijikaNextAdoptionFile[] = [
    { relativePath: 'srijika.config.json', source: jsonSource(config) },
    ...desiredEditorAndMcpFiles(),
    ...testAdapter.files.map(({ relativePath, source }) => ({ relativePath, source })),
  ];
  const mergeInstructions: SrijikaNextAdoptionMergeInstruction[] = [
    {
      relativePath: 'package.json',
      reason:
        'Package metadata remains authoritative and is never rewritten by adoption. Review these additive entries explicitly.',
      required: {
        srijika: { sourceOfTruth: 'tsx', config: 'srijika.config.json' },
        scripts: testAdapter.scripts,
        devDependencies: Object.fromEntries(
          testAdapter.devDependencies.map(({ name, version }) => [name, version]),
        ),
      },
    },
  ];
  const files: SrijikaNextAdoptionFile[] = [];
  const unchanged: string[] = [];
  const preserved: string[] = [];
  for (const file of desired) {
    const state = await fileState(fileSystem, file);
    if (state === 'missing') files.push(file);
    else if (state === 'unchanged') unchanged.push(file.relativePath);
    else {
      preserved.push(file.relativePath);
      mergeInstructions.push({
        relativePath: file.relativePath,
        reason: 'The existing file is authoritative and adoption will not overwrite it.',
        required: mergeRequiredContent(file),
      });
    }
  }
  const findings: SrijikaNextAdoptionFinding[] = [
    ...lock.extras.map((relativePath): SrijikaNextAdoptionFinding => ({
      code: 'SRIJIKA-ADOPT-EXTRA-LOCKFILE',
      severity: 'warning',
      relativePath,
      message: `${relativePath} is not the authoritative ${lock.manager} lockfile.`,
      guidance: `Keep ${lock.lockfile} authoritative and remove stale lockfiles after review.`,
    })),
    ...routes.map(({ relativePath }): SrijikaNextAdoptionFinding => ({
      code: 'SRIJIKA-ADOPT-FRAMEWORK-OWNED',
      severity: 'information',
      relativePath,
      message: `${relativePath} remains owned by the Next App Router.`,
      guidance:
        'Compose Srijika UI through serializable props; do not convert route files into UI owners.',
    })),
    ...protectedServerFiles.map((relativePath): SrijikaNextAdoptionFinding => ({
      code: 'SRIJIKA-ADOPT-SERVER-ONLY',
      severity: 'information',
      relativePath,
      message: `${relativePath} is protected as a server-only module.`,
      guidance:
        'Keep server access outside .ui.tsx and cross the boundary through a Server Component or Connector.',
    })),
    {
      code: 'SRIJIKA-ADOPT-REPORT-ONLY',
      severity: 'information',
      message: 'Architecture enforcement starts in report-only mode for this populated project.',
      guidance: 'Review coverage and diagnostics before marking individual owners as enforced.',
    },
  ];
  const adoptionManifest: SrijikaNextAdoptionFile = {
    relativePath: '.srijika/adoption/next-app-router.json',
    source: jsonSource({
      version: SRIJIKA_NEXT_ADOPTION_VERSION,
      framework: 'next-app-router',
      packageManager: lock.manager,
      lockfile: lock.lockfile,
      appRoot,
      entry,
      aliases,
      nextTypeScriptPlugin: hasNextTypeScriptPlugin(tsconfigSource),
      routes,
      protectedServerFiles,
      payload: payload.detected ? payload : null,
      sourceBaseline: baseline,
      mergeInstructions,
    }),
  };
  const manifestState = await fileState(fileSystem, adoptionManifest);
  if (manifestState === 'missing') files.push(adoptionManifest);
  else if (manifestState === 'unchanged') unchanged.push(adoptionManifest.relativePath);
  else {
    preserved.push(adoptionManifest.relativePath);
    mergeInstructions.push({
      relativePath: adoptionManifest.relativePath,
      reason: 'An existing adoption manifest requires explicit review before replacement.',
      required: JSON.parse(adoptionManifest.source) as unknown,
    });
  }

  return Object.freeze({
    version: SRIJIKA_NEXT_ADOPTION_VERSION,
    framework: 'next-app-router',
    root: fileSystem.root,
    packageManager: lock.manager,
    lockfile: lock.lockfile,
    nextVersion,
    appRoot,
    entry,
    aliases: Object.freeze({ ...aliases }),
    nextTypeScriptPlugin: hasNextTypeScriptPlugin(tsconfigSource),
    routes: Object.freeze(routes),
    protectedServerFiles: Object.freeze(protectedServerFiles),
    payload: payload.detected ? payload : null,
    baseline: Object.freeze(baseline),
    files: Object.freeze(
      files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    ),
    unchanged: Object.freeze(unchanged.sort()),
    preserved: Object.freeze(preserved.sort()),
    mergeInstructions: Object.freeze(mergeInstructions),
    findings: Object.freeze(findings),
    verification: verificationCommands(fileSystem.root, lock.manager, scripts),
  });
}

async function runAdoptionCommand(
  command: SrijikaNextAdoptionCommand,
): Promise<SrijikaNextAdoptionVerificationGate> {
  const started = performance.now();
  const processCommand = resolveSrijikaNextAdoptionProcess(command);
  return new Promise((resolveGate) => {
    let output = '';
    let timedOut = false;
    let completed = false;
    const child = spawn(processCommand.executable, [...processCommand.args], {
      cwd: command.cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer): void => {
      if (Buffer.byteLength(output) >= MAX_PROCESS_OUTPUT_BYTES) return;
      output += chunk
        .toString('utf8')
        .slice(0, MAX_PROCESS_OUTPUT_BYTES - Buffer.byteLength(output));
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, command.timeoutMillis);
    timer.unref();
    const finish = (exitCode: number, failure?: string): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      const normalizedOutput = [
        output.trim(),
        failure,
        timedOut ? 'Command exceeded its bounded timeout.' : '',
      ]
        .filter(Boolean)
        .join('\n');
      resolveGate({
        name: command.name,
        status: !timedOut && exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        durationMillis: Math.max(0, Math.round((performance.now() - started) * 10) / 10),
        output: normalizedOutput,
      });
    };
    child.once('error', (error) => finish(1, error.message));
    child.once('exit', (code) => finish(code ?? 1));
  });
}

export async function verifySrijikaNextAdoption(
  plan: SrijikaNextAdoptionPlan,
): Promise<readonly SrijikaNextAdoptionVerificationGate[]> {
  const gates: SrijikaNextAdoptionVerificationGate[] = [];
  for (const command of plan.verification) {
    const gate = await runAdoptionCommand(command);
    gates.push(gate);
    if (gate.status === 'failed') break;
  }
  return Object.freeze(gates);
}

export async function adoptSrijikaNextProject(
  request: SrijikaNextAdoptionRequest,
): Promise<SrijikaNextAdoptionResult> {
  const plan = await planSrijikaNextAdoption(request);
  if (request.dryRun) {
    return Object.freeze({
      plan,
      dryRun: true,
      created: Object.freeze([]),
      verification: Object.freeze([]),
      reportOnly: null,
    });
  }
  const verification = await verifySrijikaNextAdoption(plan);
  const failed = verification.find(({ status }) => status === 'failed');
  if (failed) {
    throw new Error(
      `Next adoption ${failed.name} verification failed before any metadata was written.${failed.output ? `\n${failed.output}` : ''}`,
    );
  }
  const fileSystem = await SrijikaProjectFileSystem.open(plan.root);
  await assertBaseline(fileSystem, plan.baseline);
  const write = await applySrijikaOwnershipCreationPlan(plan.root, {
    ownerName: 'SrijikaNextAdoption',
    ownerFolder: '.',
    files: plan.files,
    updates: [],
  });
  await assertBaseline(fileSystem, plan.baseline);
  const [architecture, ui] = await Promise.all([
    checkSrijikaArchitecture(plan.root),
    checkSrijikaUiDiagnostics(plan.root),
  ]);
  return Object.freeze({
    plan,
    dryRun: false,
    created: write.created,
    verification,
    reportOnly: Object.freeze({
      architectureErrors: architecture.diagnostics.filter(({ severity }) => severity === 'error')
        .length,
      architectureRecommendations: architecture.recommendations.length,
      uiDiagnostics: ui.diagnostics.length,
    }),
  });
}
