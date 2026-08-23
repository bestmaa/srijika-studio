import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';

import { checkSrijikaArchitecture } from './architecture.js';
import { inspectSrijikaProject } from './project.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import {
  synchronizeSrijikaNextTests,
  synchronizeSrijikaViteTests,
  verifySrijikaOwnerTests,
} from './testing.js';
import type { SrijikaPackageManager, SrijikaProjectMetadata } from './types.js';
import { checkSrijikaUiDiagnostics } from './ui-diagnostics.js';

const WORKSPACE_FILE = 'srijika.workspace.json';
const WORKSPACE_VERSION = 1 as const;
const MAX_WORKSPACE_BYTES = 256 * 1024;
const MAX_WORKSPACE_PROJECTS = 128;
const MAX_WORKSPACE_SHARED_PACKAGES = 128;
const WORKSPACE_SCAN_FILES = 512;
const WORKSPACE_SCAN_ENTRIES = 65_536;
const WORKSPACE_SCAN_DIRECTORIES = 8_192;
const WORKSPACE_SCAN_DEPTH = 12;
const MCP_SERVER_VERSION = '0.3.2';

export type SrijikaWorkspaceFramework = 'vite' | 'next';

export interface SrijikaWorkspaceProjectConfig {
  id: string;
  root: string;
  framework: SrijikaWorkspaceFramework;
  testPort: number;
}

export interface SrijikaWorkspaceManifest {
  version: typeof WORKSPACE_VERSION;
  packageManager: SrijikaPackageManager;
  projects: readonly SrijikaWorkspaceProjectConfig[];
  sharedPackages: readonly string[];
}

export interface SrijikaWorkspaceProject {
  id: string;
  relativeRoot: string;
  framework: SrijikaWorkspaceFramework;
  testPort: number;
  project: SrijikaProjectMetadata;
}

export interface SrijikaWorkspaceMetadata {
  root: string;
  manifestPath: string;
  packageManager: SrijikaPackageManager;
  lockfile: string;
  projects: readonly SrijikaWorkspaceProject[];
  sharedPackages: readonly string[];
}

export interface InitializeSrijikaWorkspaceRequest {
  workspace?: string;
  dryRun?: boolean;
}

export interface InitializeSrijikaWorkspaceResult {
  root: string;
  manifest: SrijikaWorkspaceManifest;
  files: Readonly<Record<string, string>>;
  created: readonly string[];
  preserved: readonly string[];
  dryRun: boolean;
}

export interface CheckSrijikaWorkspaceRequest {
  workspace?: string;
  projectId?: string;
}

export interface SrijikaWorkspaceProjectCheck {
  id: string;
  root: string;
  framework: SrijikaWorkspaceFramework;
  checkedFiles: number;
  uiFiles: number;
  errors: number;
  recommendations: number;
}

export interface CheckSrijikaWorkspaceResult {
  root: string;
  status: 'passed' | 'failed';
  projects: readonly SrijikaWorkspaceProjectCheck[];
}

export interface SynchronizeSrijikaWorkspaceTestsRequest extends CheckSrijikaWorkspaceRequest {
  dryRun?: boolean;
}

export interface SrijikaWorkspaceTestSynchronization {
  id: string;
  root: string;
  framework: SrijikaWorkspaceFramework;
  created: readonly string[];
  updated: readonly string[];
  unchanged: readonly string[];
  preserved: readonly string[];
}

export interface SynchronizeSrijikaWorkspaceTestsResult {
  root: string;
  dryRun: boolean;
  projects: readonly SrijikaWorkspaceTestSynchronization[];
}

export interface VerifySrijikaWorkspaceTestsRequest extends CheckSrijikaWorkspaceRequest {
  skipInstall?: boolean;
}

export interface SrijikaWorkspaceTestVerification {
  id: string;
  root: string;
  framework: SrijikaWorkspaceFramework;
  status: 'passed' | 'failed';
  gates: Awaited<ReturnType<typeof verifySrijikaOwnerTests>>['gates'];
  evidenceStatus: Awaited<
    ReturnType<typeof verifySrijikaOwnerTests>
  >['evidence']['manifest']['status'];
}

export interface VerifySrijikaWorkspaceTestsResult {
  root: string;
  status: 'passed' | 'failed';
  projects: readonly SrijikaWorkspaceTestVerification[];
}

const lockfiles: Readonly<Record<SrijikaPackageManager, string>> = Object.freeze({
  pnpm: 'pnpm-lock.yaml',
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  bun: 'bun.lock',
});

function recordValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknown) throw new Error(`${label}.${unknown} is not supported.`);
}

function validatedRelativePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new Error(`${label} must be a nonempty project-relative path.`);
  }
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`${label} must remain inside the workspace root.`);
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} must be a normalized project-relative path.`);
  }
  return segments.join('/');
}

function pathsOverlap(left: string, right: string): boolean {
  const leftKey = left.toLowerCase();
  const rightKey = right.toLowerCase();
  return (
    leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`)
  );
}

function parsePackageManager(value: unknown, label: string): SrijikaPackageManager {
  if (value !== 'pnpm' && value !== 'npm' && value !== 'yarn' && value !== 'bun') {
    throw new Error(`${label} must be pnpm, npm, yarn, or bun.`);
  }
  return value;
}

export function parseSrijikaWorkspaceManifest(source: string): SrijikaWorkspaceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${WORKSPACE_FILE} must contain valid JSON.`, { cause: error });
  }
  const root = recordValue(parsed, WORKSPACE_FILE);
  exactKeys(
    root,
    ['$schema', 'version', 'packageManager', 'projects', 'sharedPackages'],
    WORKSPACE_FILE,
  );
  if (root['version'] !== WORKSPACE_VERSION) {
    throw new Error(`${WORKSPACE_FILE} version must be ${WORKSPACE_VERSION}.`);
  }
  const packageManager = parsePackageManager(
    root['packageManager'],
    `${WORKSPACE_FILE}.packageManager`,
  );
  if (!Array.isArray(root['projects']) || root['projects'].length === 0) {
    throw new Error(`${WORKSPACE_FILE}.projects must contain at least one project.`);
  }
  if (root['projects'].length > MAX_WORKSPACE_PROJECTS) {
    throw new Error(
      `${WORKSPACE_FILE}.projects exceeds the ${MAX_WORKSPACE_PROJECTS}-project limit.`,
    );
  }
  const ids = new Set<string>();
  const projectRoots = new Set<string>();
  const ports = new Set<number>();
  const projects = root['projects'].map((value, index): SrijikaWorkspaceProjectConfig => {
    const project = recordValue(value, `${WORKSPACE_FILE}.projects[${index}]`);
    exactKeys(
      project,
      ['id', 'root', 'framework', 'testPort'],
      `${WORKSPACE_FILE}.projects[${index}]`,
    );
    const id = project['id'];
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
      throw new Error(
        `${WORKSPACE_FILE}.projects[${index}].id must be a lowercase kebab-case identifier.`,
      );
    }
    if (ids.has(id)) throw new Error(`Duplicate Srijika workspace project id: ${id}.`);
    ids.add(id);
    const projectRoot = validatedRelativePath(
      project['root'],
      `${WORKSPACE_FILE}.projects[${index}].root`,
    );
    const rootKey = projectRoot.toLowerCase();
    if (projectRoots.has(rootKey))
      throw new Error(`Duplicate Srijika workspace project root: ${projectRoot}.`);
    if ([...projectRoots].some((other) => pathsOverlap(projectRoot, other))) {
      throw new Error(`Srijika workspace project roots must not overlap: ${projectRoot}.`);
    }
    projectRoots.add(rootKey);
    const framework = project['framework'];
    if (framework !== 'vite' && framework !== 'next') {
      throw new Error(`${WORKSPACE_FILE}.projects[${index}].framework must be vite or next.`);
    }
    const testPort = project['testPort'];
    if (!Number.isInteger(testPort) || (testPort as number) < 1 || (testPort as number) > 65_535) {
      throw new Error(
        `${WORKSPACE_FILE}.projects[${index}].testPort must be an integer between 1 and 65535.`,
      );
    }
    if (ports.has(testPort as number))
      throw new Error(`Duplicate Srijika workspace test port: ${String(testPort)}.`);
    ports.add(testPort as number);
    return Object.freeze({ id, root: projectRoot, framework, testPort: testPort as number });
  });
  const sharedInput = root['sharedPackages'] ?? [];
  if (!Array.isArray(sharedInput))
    throw new Error(`${WORKSPACE_FILE}.sharedPackages must be an array.`);
  if (sharedInput.length > MAX_WORKSPACE_SHARED_PACKAGES) {
    throw new Error(
      `${WORKSPACE_FILE}.sharedPackages exceeds the ${MAX_WORKSPACE_SHARED_PACKAGES}-package limit.`,
    );
  }
  const sharedKeys = new Set<string>();
  const sharedPackages = sharedInput.map((value, index) => {
    const path = validatedRelativePath(value, `${WORKSPACE_FILE}.sharedPackages[${index}]`);
    const key = path.toLowerCase();
    if (sharedKeys.has(key)) throw new Error(`Duplicate shared package path: ${path}.`);
    if (projects.some((project) => pathsOverlap(project.root, path))) {
      throw new Error(`Shared package path must not overlap a Srijika project root: ${path}.`);
    }
    sharedKeys.add(key);
    return path;
  });
  return Object.freeze({
    version: WORKSPACE_VERSION,
    packageManager,
    projects: Object.freeze(projects),
    sharedPackages: Object.freeze(sharedPackages),
  });
}

function idFromProject(project: SrijikaProjectMetadata, relativeRoot: string): string {
  const candidate = project.projectName
    .replace(/^@[^/]+\//, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return candidate || relativeRoot.split('/').at(-1) || 'app';
}

function frameworkForProject(project: SrijikaProjectMetadata): SrijikaWorkspaceFramework {
  if (project.viteProject === project.nextProject) {
    throw new Error(
      `${project.root} must resolve to exactly one supported framework (Vite or Next.js).`,
    );
  }
  return project.nextProject ? 'next' : 'vite';
}

async function packageManagerAtWorkspaceRoot(
  fileSystem: SrijikaProjectFileSystem,
): Promise<{ packageManager: SrijikaPackageManager; lockfile: string }> {
  const packageSource = (await fileSystem.readText('package.json', 1024 * 1024)).source;
  const packageJson = recordValue(JSON.parse(packageSource) as unknown, 'package.json');
  const declared = packageJson['packageManager'];
  const declaredName = typeof declared === 'string' ? declared.trim().split('@')[0] : undefined;
  const detected = Object.entries(lockfiles) as Array<[SrijikaPackageManager, string]>;
  const available: Array<[SrijikaPackageManager, string]> = [];
  for (const entry of detected) {
    if (await fileSystem.isRegularFile(entry[1])) available.push(entry);
  }
  const selected = available.find(([manager]) => manager === declaredName) ?? available[0];
  if (!selected) throw new Error('The Srijika workspace root must contain a supported lockfile.');
  if (declaredName && declaredName !== selected[0]) {
    throw new Error(
      `Root packageManager selects ${declaredName}, but ${selected[1]} belongs to ${selected[0]}.`,
    );
  }
  return { packageManager: selected[0], lockfile: selected[1] };
}

async function discoverProjects(root: string): Promise<SrijikaWorkspaceProject[]> {
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const configs = await fileSystem.walkFiles([''], {
    maximumFiles: WORKSPACE_SCAN_FILES,
    maximumEntries: WORKSPACE_SCAN_ENTRIES,
    maximumDirectories: WORKSPACE_SCAN_DIRECTORIES,
    maximumDepth: WORKSPACE_SCAN_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: true,
    acceptFile: (fileName) => fileName === 'srijika.config.json',
  });
  if (configs.length === 0) {
    throw new Error('No Srijika projects were discovered below the workspace root.');
  }
  if (configs.length > MAX_WORKSPACE_PROJECTS) {
    throw new Error(`Workspace discovery exceeds the ${MAX_WORKSPACE_PROJECTS}-project limit.`);
  }
  const discovered: SrijikaWorkspaceProject[] = [];
  const ids = new Set<string>();
  for (const [index, config] of configs.entries()) {
    const relativeRoot = posix.dirname(config.relativePath);
    if (relativeRoot === '.') {
      throw new Error('A monorepo Srijika project must live below the workspace root.');
    }
    const projectRoot = resolve(root, ...relativeRoot.split('/'));
    if (!(await fileSystem.isRegularFile(`${relativeRoot}/package.json`))) {
      throw new Error(`${relativeRoot} contains srijika.config.json but no package.json.`);
    }
    const project = await inspectSrijikaProject(projectRoot);
    if (project.root !== projectRoot) {
      throw new Error(`${relativeRoot} must be an independent Srijika project root.`);
    }
    const baseId = idFromProject(project, relativeRoot);
    let id = baseId;
    let suffix = 2;
    while (ids.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    ids.add(id);
    discovered.push({
      id,
      relativeRoot,
      framework: frameworkForProject(project),
      testPort: 4174 + index,
      project,
    });
  }
  return discovered;
}

function manifestSource(manifest: SrijikaWorkspaceManifest): string {
  return `${JSON.stringify(
    {
      $schema: 'https://srijika.com/schemas/srijika-workspace-v1.schema.json',
      ...manifest,
    },
    null,
    2,
  )}\n`;
}

function workspaceArtifacts(manifest: SrijikaWorkspaceManifest): Readonly<Record<string, string>> {
  const workspaceFolders = [
    ...manifest.projects.map((project) => ({ name: project.id, path: project.root })),
    ...manifest.sharedPackages.map((path) => ({ name: path.split('/').at(-1) ?? path, path })),
  ];
  const mcpServers = Object.fromEntries(
    manifest.projects.map((project) => [
      `srijika-${project.id}`,
      {
        command: 'npx',
        args: ['-y', `@srijika/mcp-server@${MCP_SERVER_VERSION}`, '--project', project.root],
        cwd: '.',
      },
    ]),
  );
  return Object.freeze({
    [WORKSPACE_FILE]: manifestSource(manifest),
    'srijika.code-workspace': `${JSON.stringify(
      {
        folders: workspaceFolders,
        settings: {
          'files.associations': { '*.ui.tsx': 'typescriptreact' },
          'typescript.preferences.includePackageJsonAutoImports': 'on',
        },
        extensions: { recommendations: ['srijika.srijika-language-support'] },
      },
      null,
      2,
    )}\n`,
    '.mcp.json': `${JSON.stringify({ mcpServers }, null, 2)}\n`,
  });
}

async function writeNewWorkspaceFiles(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<{ created: string[]; preserved: string[] }> {
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  if (await fileSystem.isRegularFile(WORKSPACE_FILE)) {
    throw new Error(`${WORKSPACE_FILE} already exists; inspect it instead of overwriting it.`);
  }
  const created: string[] = [];
  const preserved: string[] = [];
  for (const [relativePath, source] of Object.entries(files)) {
    if (await fileSystem.isRegularFile(relativePath)) {
      preserved.push(relativePath);
      continue;
    }
    const target = fileSystem.resolve(relativePath);
    const temporary = `${target}.srijika-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, target);
      created.push(relativePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
  return { created, preserved };
}

export async function initializeSrijikaWorkspace(
  request: InitializeSrijikaWorkspaceRequest = {},
): Promise<InitializeSrijikaWorkspaceResult> {
  const root = resolve(request.workspace ?? process.cwd());
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const toolchain = await packageManagerAtWorkspaceRoot(fileSystem);
  const projects = await discoverProjects(root);
  const manifest: SrijikaWorkspaceManifest = Object.freeze({
    version: WORKSPACE_VERSION,
    packageManager: toolchain.packageManager,
    projects: Object.freeze(
      projects.map(({ id, relativeRoot: projectRoot, framework, testPort }) =>
        Object.freeze({ id, root: projectRoot, framework, testPort }),
      ),
    ),
    sharedPackages: Object.freeze([]),
  });
  const files = workspaceArtifacts(manifest);
  if (request.dryRun) {
    return { root, manifest, files, created: [], preserved: [], dryRun: true };
  }
  const write = await writeNewWorkspaceFiles(root, files);
  return { root, manifest, files, ...write, dryRun: false };
}

export async function findSrijikaWorkspaceRoot(startDirectory = process.cwd()): Promise<string> {
  let candidate = resolve(startDirectory);
  for (;;) {
    try {
      const fileSystem = await SrijikaProjectFileSystem.open(candidate);
      if (await fileSystem.isRegularFile(WORKSPACE_FILE)) return fileSystem.root;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`No ${WORKSPACE_FILE} was found from ${resolve(startDirectory)}.`);
}

export async function inspectSrijikaWorkspace(
  startDirectory = process.cwd(),
): Promise<SrijikaWorkspaceMetadata> {
  const root = await findSrijikaWorkspaceRoot(startDirectory);
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const manifest = parseSrijikaWorkspaceManifest(
    (await fileSystem.readText(WORKSPACE_FILE, MAX_WORKSPACE_BYTES)).source,
  );
  const toolchain = await packageManagerAtWorkspaceRoot(fileSystem);
  if (toolchain.packageManager !== manifest.packageManager) {
    throw new Error(
      `${WORKSPACE_FILE} selects ${manifest.packageManager}, but the root lockfile selects ${toolchain.packageManager}.`,
    );
  }
  const projects: SrijikaWorkspaceProject[] = [];
  for (const configured of manifest.projects) {
    await fileSystem.inspectDirectory(configured.root);
    const absoluteRoot = resolve(root, ...configured.root.split('/'));
    const project = await inspectSrijikaProject(absoluteRoot);
    if (project.root !== absoluteRoot) {
      throw new Error(`${configured.root} must contain its own Srijika project contract.`);
    }
    const detectedFramework = frameworkForProject(project);
    if (detectedFramework !== configured.framework) {
      throw new Error(
        `${configured.id} declares ${configured.framework}, but its package metadata resolves to ${detectedFramework}.`,
      );
    }
    projects.push({
      id: configured.id,
      relativeRoot: configured.root,
      framework: configured.framework,
      testPort: configured.testPort,
      project,
    });
  }
  for (const sharedPackage of manifest.sharedPackages) {
    await fileSystem.inspectDirectory(sharedPackage);
    if (!(await fileSystem.isRegularFile(`${sharedPackage}/package.json`))) {
      throw new Error(`${sharedPackage} must contain package.json.`);
    }
  }
  return Object.freeze({
    root,
    manifestPath: resolve(root, WORKSPACE_FILE),
    packageManager: manifest.packageManager,
    lockfile: toolchain.lockfile,
    projects: Object.freeze(projects),
    sharedPackages: manifest.sharedPackages,
  });
}

function selectedProjects(
  workspace: SrijikaWorkspaceMetadata,
  projectId?: string,
): readonly SrijikaWorkspaceProject[] {
  if (!projectId) return workspace.projects;
  const selected = workspace.projects.find((project) => project.id === projectId);
  if (!selected) throw new Error(`Unknown Srijika workspace project id: ${projectId}.`);
  return [selected];
}

export async function checkSrijikaWorkspace(
  request: CheckSrijikaWorkspaceRequest = {},
): Promise<CheckSrijikaWorkspaceResult> {
  const workspace = await inspectSrijikaWorkspace(request.workspace);
  const results: SrijikaWorkspaceProjectCheck[] = [];
  for (const selected of selectedProjects(workspace, request.projectId)) {
    const [architecture, ui] = await Promise.all([
      checkSrijikaArchitecture(selected.project.root),
      checkSrijikaUiDiagnostics(selected.project.root),
    ]);
    results.push({
      id: selected.id,
      root: selected.project.root,
      framework: selected.framework,
      checkedFiles: architecture.checkedFiles,
      uiFiles: ui.checkedFiles,
      errors:
        architecture.diagnostics.filter(({ severity }) => severity === 'error').length +
        ui.diagnostics.length,
      recommendations: architecture.recommendations.length,
    });
  }
  return {
    root: workspace.root,
    status: results.every(({ errors }) => errors === 0) ? 'passed' : 'failed',
    projects: Object.freeze(results),
  };
}

export async function synchronizeSrijikaWorkspaceTests(
  request: SynchronizeSrijikaWorkspaceTestsRequest = {},
): Promise<SynchronizeSrijikaWorkspaceTestsResult> {
  const workspace = await inspectSrijikaWorkspace(request.workspace);
  const results: SrijikaWorkspaceTestSynchronization[] = [];
  for (const selected of selectedProjects(workspace, request.projectId)) {
    const synchronized =
      selected.framework === 'next'
        ? await synchronizeSrijikaNextTests({
            project: selected.project.root,
            packageManager: workspace.packageManager,
            port: selected.testPort,
            ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
          })
        : await synchronizeSrijikaViteTests({
            project: selected.project.root,
            packageManager: workspace.packageManager,
            port: selected.testPort,
            ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
          });
    results.push({
      id: selected.id,
      root: selected.project.root,
      framework: selected.framework,
      created: synchronized.write?.created ?? [],
      updated: synchronized.write?.updated ?? [],
      unchanged: synchronized.write?.unchanged ?? [],
      preserved: synchronized.write?.preserved ?? [],
    });
  }
  return {
    root: workspace.root,
    dryRun: Boolean(request.dryRun),
    projects: Object.freeze(results),
  };
}

export async function verifySrijikaWorkspaceTests(
  request: VerifySrijikaWorkspaceTestsRequest = {},
): Promise<VerifySrijikaWorkspaceTestsResult> {
  const workspace = await inspectSrijikaWorkspace(request.workspace);
  const results: SrijikaWorkspaceTestVerification[] = [];
  for (const selected of selectedProjects(workspace, request.projectId)) {
    const verified = await verifySrijikaOwnerTests({
      project: selected.project.root,
      framework: selected.framework === 'next' ? 'next-app-router' : 'vite',
      packageManager: workspace.packageManager,
      port: selected.testPort,
      ...(request.skipInstall === undefined ? {} : { skipInstall: request.skipInstall }),
    });
    results.push({
      id: selected.id,
      root: selected.project.root,
      framework: selected.framework,
      status: verified.status,
      gates: verified.gates,
      evidenceStatus: verified.evidence.manifest.status,
    });
  }
  return {
    root: workspace.root,
    status: results.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
    projects: Object.freeze(results),
  };
}
