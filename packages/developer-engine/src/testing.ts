import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  affectedSrijikaTestPlan,
  buildSrijikaTestContract,
  type SrijikaAffectedTestPlan,
  type SrijikaTestContract,
} from '@srijika/architecture-rules';
import {
  applySrijikaNextAppRouterPlan,
  applySrijikaNextTestAdapterPlan,
  applySrijikaTestPackagePlan,
  applySrijikaViteTestAdapterPlan,
  buildSrijikaNextAppRouterPlan,
  buildSrijikaNextTestAdapterPlan,
  buildSrijikaTestEvidenceManifest,
  buildSrijikaViteTestAdapterPlan,
  type ApplySrijikaNextAppRouterResult,
  type ApplySrijikaNextTestAdapterResult,
  type ApplySrijikaTestPackageResult,
  type ApplySrijikaViteTestAdapterResult,
  type SrijikaNextAppRouterPlan,
  type SrijikaNextRouteMapping,
  type SrijikaNextTestAdapterPlan,
  type SrijikaTestEvidenceManifest,
  type SrijikaViteTestAdapterPlan,
} from '@srijika/project-scaffold';

import { findSrijikaProjectRoot, inspectSrijikaProject } from './project.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import { checkSrijikaArchitecture } from './architecture.js';
import { checkSrijikaUiDiagnostics } from './ui-diagnostics.js';
import type { SrijikaPackageManager, SrijikaProjectMetadata } from './types.js';

const MAX_TEST_CONTRACT_FILES = 8_192;
const MAX_TEST_CONTRACT_ENTRIES = 65_536;
const MAX_TEST_CONTRACT_DIRECTORIES = 8_192;
const MAX_TEST_CONTRACT_DEPTH = 48;
const MAX_TEST_CONTRACT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TEST_CONTRACT_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_TEST_REPORT_BYTES = 16 * 1024 * 1024;

export interface InspectSrijikaTestContractRequest {
  project?: string;
  changedFiles?: readonly string[];
}

export interface InspectSrijikaTestContractResult {
  root: string;
  contract: SrijikaTestContract;
  affected?: SrijikaAffectedTestPlan;
}

export interface PlanSrijikaViteTestsRequest extends InspectSrijikaTestContractRequest {
  port?: number;
  packageManager?: SrijikaPackageManager;
}

export interface PlanSrijikaViteTestsResult extends InspectSrijikaTestContractResult {
  adapter: SrijikaViteTestAdapterPlan;
}

export interface SynchronizeSrijikaViteTestsRequest extends PlanSrijikaViteTestsRequest {
  dryRun?: boolean;
}

export interface SynchronizeSrijikaViteTestsResult extends PlanSrijikaViteTestsResult {
  write: ApplySrijikaViteTestAdapterResult | null;
  packageWrite: ApplySrijikaTestPackageResult | null;
}

export interface PlanSrijikaNextTestsRequest extends InspectSrijikaTestContractRequest {
  port?: number;
  packageManager?: SrijikaPackageManager;
}

export interface PlanSrijikaNextTestsResult extends InspectSrijikaTestContractResult {
  adapter: SrijikaNextTestAdapterPlan;
}

export interface SynchronizeSrijikaNextTestsRequest extends PlanSrijikaNextTestsRequest {
  dryRun?: boolean;
}

export interface SynchronizeSrijikaNextTestsResult extends PlanSrijikaNextTestsResult {
  write: ApplySrijikaNextTestAdapterResult | null;
  packageWrite: ApplySrijikaTestPackageResult | null;
}

export interface PlanSrijikaNextAppRequest extends InspectSrijikaTestContractRequest {
  routes: readonly SrijikaNextRouteMapping[];
  appRoot?: string;
}

export interface PlanSrijikaNextAppResult extends InspectSrijikaTestContractResult {
  adapter: SrijikaNextAppRouterPlan;
}

export interface SynchronizeSrijikaNextAppRequest extends PlanSrijikaNextAppRequest {
  dryRun?: boolean;
}

export interface SynchronizeSrijikaNextAppResult extends PlanSrijikaNextAppResult {
  write: ApplySrijikaNextAppRouterResult | null;
}

export interface CollectSrijikaTestEvidenceRequest extends InspectSrijikaTestContractRequest {
  framework?: 'vite' | 'next-app-router';
  architecturePassed?: boolean;
  typecheckPassed?: boolean;
  minimumReportModifiedMillis?: number;
}

export interface CollectSrijikaTestEvidenceResult {
  root: string;
  manifest: SrijikaTestEvidenceManifest;
  reportFiles: { vitestJson: string; playwrightJson: string };
}

export type SrijikaTestVerificationGateName =
  'install' | 'architecture' | 'typecheck' | 'vitest' | 'playwright-browser' | 'playwright';

export interface SrijikaTestVerificationGate {
  name: SrijikaTestVerificationGateName;
  status: 'passed' | 'failed' | 'not-run';
  durationMillis: number;
  exitCode?: number;
  message?: string;
}

export interface SrijikaTestVerificationCommand {
  gate: 'install' | 'typecheck' | 'vitest' | 'playwright-browser' | 'playwright';
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMillis: number;
}

export interface VerifySrijikaOwnerTestsRequest extends InspectSrijikaTestContractRequest {
  framework?: 'vite' | 'next-app-router';
  port?: number;
  skipInstall?: boolean;
  packageManager?: SrijikaPackageManager;
}

export interface VerifySrijikaOwnerTestsResult {
  root: string;
  framework: 'vite' | 'next-app-router';
  status: 'passed' | 'failed';
  gates: readonly SrijikaTestVerificationGate[];
  synchronization: {
    created: readonly string[];
    updated: readonly string[];
    unchanged: readonly string[];
    preserved: readonly string[];
    packageWrite: SynchronizeSrijikaViteTestsResult['packageWrite'];
  };
  evidence: CollectSrijikaTestEvidenceResult;
}

function packageManagerExecutable(manager: SrijikaPackageManager): string {
  return process.platform === 'win32' ? `${manager}.cmd` : manager;
}

function packageExecArgs(
  manager: SrijikaPackageManager,
  binary: string,
  args: readonly string[],
): readonly string[] {
  if (manager === 'npm') return ['exec', '--', binary, ...args];
  if (manager === 'bun') return ['x', binary, ...args];
  return ['exec', binary, ...args];
}

export function planSrijikaTestVerificationCommands(
  project: SrijikaProjectMetadata,
  framework: 'vite' | 'next-app-router',
): readonly SrijikaTestVerificationCommand[] {
  const executable = packageManagerExecutable(project.packageManager);
  const testRoot = framework === 'vite' ? 'tests/srijika' : 'tests/srijika-next';
  return Object.freeze([
    {
      gate: 'install',
      executable,
      args: Object.freeze(['install']),
      cwd: project.root,
      timeoutMillis: 5 * 60_000,
    },
    {
      gate: 'typecheck',
      executable,
      args: Object.freeze(
        packageExecArgs(project.packageManager, 'tsc', ['-p', 'tsconfig.json', '--noEmit']),
      ),
      cwd: project.root,
      timeoutMillis: 2 * 60_000,
    },
    {
      gate: 'vitest',
      executable,
      args: Object.freeze(
        packageExecArgs(project.packageManager, 'vitest', [
          'run',
          '--config',
          `${testRoot}/vitest.config.ts`,
        ]),
      ),
      cwd: project.root,
      timeoutMillis: 2 * 60_000,
    },
    {
      gate: 'playwright-browser',
      executable,
      args: Object.freeze(
        packageExecArgs(project.packageManager, 'playwright', ['install', 'chromium']),
      ),
      cwd: project.root,
      timeoutMillis: 5 * 60_000,
    },
    {
      gate: 'playwright',
      executable,
      args: Object.freeze(
        packageExecArgs(project.packageManager, 'playwright', [
          'test',
          '--config',
          `${testRoot}/playwright.config.ts`,
          '--update-snapshots=missing',
        ]),
      ),
      cwd: project.root,
      timeoutMillis: 3 * 60_000,
    },
  ]);
}

async function runVerificationCommand(
  command: SrijikaTestVerificationCommand,
): Promise<SrijikaTestVerificationGate> {
  const started = performance.now();
  return new Promise((resolveGate) => {
    let completed = false;
    let timedOut = false;
    const finish = (gate: Omit<SrijikaTestVerificationGate, 'durationMillis'>): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      resolveGate({
        ...gate,
        durationMillis: Math.max(0, Math.round((performance.now() - started) * 10) / 10),
      });
    };
    const child = spawn(command.executable, [...command.args], {
      cwd: command.cwd,
      env: process.env,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, command.timeoutMillis);
    timer.unref();
    child.once('error', (error) => {
      finish({ name: command.gate, status: 'failed', message: error.message });
    });
    child.once('exit', (code) => {
      const exitCode = code ?? 1;
      finish({
        name: command.gate,
        status: !timedOut && exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        ...(timedOut ? { message: `${command.gate} exceeded its bounded timeout.` } : {}),
      });
    });
  });
}

async function visualSnapshotCount(root: string, framework: 'vite' | 'next-app-router') {
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const ownerRoot = framework === 'vite' ? 'tests/srijika/owners' : 'tests/srijika-next/owners';
  const files = await fileSystem.walkFiles([ownerRoot], {
    maximumFiles: 2_048,
    maximumEntries: 8_192,
    maximumDirectories: 2_048,
    maximumDepth: 4,
    acceptFile: (fileName) => fileName.toLowerCase().endsWith('.png'),
  });
  return files.length;
}

function isContractTextFile(fileName: string): boolean {
  return /\.(?:[cm]?[jt]sx?|css|scss|sass|less|styl|json)$/iu.test(fileName);
}

function projectRelativePath(root: string, value: string): string {
  const absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
  const fromRoot = relative(root, absolute).replaceAll('\\', '/');
  if (!fromRoot || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    throw new Error('Changed test-contract files must remain inside the Srijika project.');
  }
  return fromRoot;
}

async function inspectSrijikaTestContractWithSources(
  request: InspectSrijikaTestContractRequest = {},
): Promise<
  InspectSrijikaTestContractResult & {
    project: Awaited<ReturnType<typeof inspectSrijikaProject>>;
    sources: Readonly<Record<string, string>>;
  }
> {
  const root = await findSrijikaProjectRoot(request.project ?? process.cwd());
  const project = await inspectSrijikaProject(root);
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const files = await fileSystem.walkFiles([''], {
    maximumFiles: MAX_TEST_CONTRACT_FILES,
    maximumEntries: MAX_TEST_CONTRACT_ENTRIES,
    maximumDirectories: MAX_TEST_CONTRACT_DIRECTORIES,
    maximumDepth: MAX_TEST_CONTRACT_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: true,
    stopAtNestedProjectRoots: true,
    acceptFile: isContractTextFile,
  });
  let totalBytes = 0;
  const sourceFiles = [];
  const sources: Record<string, string> = {};
  for (const file of files) {
    const read = await fileSystem.readText(file.absolutePath, MAX_TEST_CONTRACT_FILE_BYTES);
    totalBytes += read.size;
    if (totalBytes > MAX_TEST_CONTRACT_TOTAL_BYTES) {
      throw new Error('Test-contract source exceeds the 32 MiB aggregate safety limit.');
    }
    sourceFiles.push({ fileName: file.relativePath, source: read.source });
    sources[file.relativePath] = read.source;
  }
  const contract = buildSrijikaTestContract(sourceFiles, {
    ...(project.architecture ? { architecture: project.architecture } : {}),
    ...(project.aliases ? { aliases: project.aliases } : {}),
  });
  const changedFiles = request.changedFiles?.map((fileName) => projectRelativePath(root, fileName));
  return {
    root,
    project,
    sources,
    contract,
    ...(changedFiles ? { affected: affectedSrijikaTestPlan(contract, changedFiles) } : {}),
  };
}

export async function inspectSrijikaTestContract(
  request: InspectSrijikaTestContractRequest = {},
): Promise<InspectSrijikaTestContractResult> {
  const inspected = await inspectSrijikaTestContractWithSources(request);
  return {
    root: inspected.root,
    contract: inspected.contract,
    ...(inspected.affected ? { affected: inspected.affected } : {}),
  };
}

export async function planSrijikaViteTests(
  request: PlanSrijikaViteTestsRequest = {},
): Promise<PlanSrijikaViteTestsResult> {
  const inspected = await inspectSrijikaTestContractWithSources(request);
  if (!inspected.project.viteProject) {
    throw new Error(
      'The Vite test adapter requires a Vite project. Use the Next.js adapter for App Router projects.',
    );
  }
  return {
    root: inspected.root,
    contract: inspected.contract,
    ...(inspected.affected ? { affected: inspected.affected } : {}),
    adapter: buildSrijikaViteTestAdapterPlan(inspected.contract, {
      packageManager: request.packageManager ?? inspected.project.packageManager,
      ...(request.port === undefined ? {} : { port: request.port }),
    }),
  };
}

export async function synchronizeSrijikaViteTests(
  request: SynchronizeSrijikaViteTestsRequest = {},
): Promise<SynchronizeSrijikaViteTestsResult> {
  const planned = await planSrijikaViteTests(request);
  if (request.dryRun) return { ...planned, write: null, packageWrite: null };
  const write = await applySrijikaViteTestAdapterPlan(planned.root, planned.adapter);
  const packageWrite = await applySrijikaTestPackagePlan(planned.root, planned.adapter);
  return { ...planned, write, packageWrite };
}

export async function planSrijikaNextTests(
  request: PlanSrijikaNextTestsRequest = {},
): Promise<PlanSrijikaNextTestsResult> {
  const inspected = await inspectSrijikaTestContractWithSources(request);
  if (!inspected.project.nextProject) {
    throw new Error(
      'The Next.js test adapter requires a Next.js project. Use the Vite adapter for Vite projects.',
    );
  }
  return {
    root: inspected.root,
    contract: inspected.contract,
    ...(inspected.affected ? { affected: inspected.affected } : {}),
    adapter: buildSrijikaNextTestAdapterPlan(inspected.contract, {
      packageManager: request.packageManager ?? inspected.project.packageManager,
      ...(request.port === undefined ? {} : { port: request.port }),
    }),
  };
}

export async function synchronizeSrijikaNextTests(
  request: SynchronizeSrijikaNextTestsRequest = {},
): Promise<SynchronizeSrijikaNextTestsResult> {
  const planned = await planSrijikaNextTests(request);
  if (request.dryRun) return { ...planned, write: null, packageWrite: null };
  const write = await applySrijikaNextTestAdapterPlan(planned.root, planned.adapter);
  const packageWrite = await applySrijikaTestPackagePlan(planned.root, planned.adapter);
  return { ...planned, write, packageWrite };
}

export async function planSrijikaNextApp(
  request: PlanSrijikaNextAppRequest,
): Promise<PlanSrijikaNextAppResult> {
  const { project, sources, ...inspected } = await inspectSrijikaTestContractWithSources(request);
  if (!project.nextProject) {
    throw new Error('The Next App Router adapter requires a Next.js project.');
  }
  return {
    ...inspected,
    adapter: buildSrijikaNextAppRouterPlan(inspected.contract, {
      routes: request.routes,
      sources,
      ...(request.appRoot === undefined ? {} : { appRoot: request.appRoot }),
    }),
  };
}

export async function synchronizeSrijikaNextApp(
  request: SynchronizeSrijikaNextAppRequest,
): Promise<SynchronizeSrijikaNextAppResult> {
  const planned = await planSrijikaNextApp(request);
  return {
    ...planned,
    write: request.dryRun
      ? null
      : await applySrijikaNextAppRouterPlan(planned.root, planned.adapter),
  };
}

async function readOptionalTestReport(
  fileSystem: SrijikaProjectFileSystem,
  relativePath: string,
  minimumModifiedMillis?: number,
): Promise<unknown> {
  if (!(await fileSystem.isRegularFile(relativePath))) return undefined;
  if (minimumModifiedMillis !== undefined) {
    const metadata = await fileSystem.inspectRegularFile(relativePath);
    if (metadata.mtimeMs < minimumModifiedMillis) return undefined;
  }
  const source = (await fileSystem.readText(relativePath, MAX_TEST_REPORT_BYTES)).source;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`${relativePath} is not valid JSON test evidence.`);
  }
}

export async function collectSrijikaTestEvidence(
  request: CollectSrijikaTestEvidenceRequest = {},
): Promise<CollectSrijikaTestEvidenceResult> {
  const inspected = await inspectSrijikaTestContractWithSources(request);
  const framework =
    request.framework ??
    (inspected.project.nextProject && !inspected.project.viteProject
      ? 'next-app-router'
      : inspected.project.viteProject && !inspected.project.nextProject
        ? 'vite'
        : undefined);
  if (!framework) {
    throw new Error('Select vite or next-app-router evidence for this project.');
  }
  if (framework === 'vite' && !inspected.project.viteProject) {
    throw new Error('Vite evidence requires a Vite project.');
  }
  if (framework === 'next-app-router' && !inspected.project.nextProject) {
    throw new Error('Next App Router evidence requires a Next.js project.');
  }
  const adapter =
    framework === 'vite'
      ? buildSrijikaViteTestAdapterPlan(inspected.contract, {
          packageManager: inspected.project.packageManager,
        })
      : buildSrijikaNextTestAdapterPlan(inspected.contract, {
          packageManager: inspected.project.packageManager,
        });
  const fileSystem = await SrijikaProjectFileSystem.open(inspected.root);
  const [vitest, playwright] = await Promise.all([
    readOptionalTestReport(
      fileSystem,
      adapter.evidence.vitestJson,
      request.minimumReportModifiedMillis,
    ),
    readOptionalTestReport(
      fileSystem,
      adapter.evidence.playwrightJson,
      request.minimumReportModifiedMillis,
    ),
  ]);
  return {
    root: inspected.root,
    reportFiles: adapter.evidence,
    manifest: buildSrijikaTestEvidenceManifest(inspected.contract, adapter, {
      ...(vitest === undefined ? {} : { vitest }),
      ...(playwright === undefined ? {} : { playwright }),
      ...(request.architecturePassed === undefined
        ? {}
        : { architecturePassed: request.architecturePassed }),
      ...(request.typecheckPassed === undefined
        ? {}
        : { typecheckPassed: request.typecheckPassed }),
    }),
  };
}

export async function verifySrijikaOwnerTests(
  request: VerifySrijikaOwnerTestsRequest = {},
): Promise<VerifySrijikaOwnerTestsResult> {
  const inspectedProject = await inspectSrijikaProject(request.project ?? process.cwd());
  const project = request.packageManager
    ? { ...inspectedProject, packageManager: request.packageManager }
    : inspectedProject;
  const framework =
    request.framework ??
    (project.nextProject && !project.viteProject
      ? 'next-app-router'
      : project.viteProject && !project.nextProject
        ? 'vite'
        : undefined);
  if (!framework) throw new Error('Select vite or next-app-router verification for this project.');
  if (framework === 'vite' && !project.viteProject) {
    throw new Error('Vite verification requires a Vite project.');
  }
  if (framework === 'next-app-router' && !project.nextProject) {
    throw new Error('Next App Router verification requires a Next.js project.');
  }
  const synchronization =
    framework === 'vite'
      ? await synchronizeSrijikaViteTests({
          project: project.root,
          ...(request.packageManager ? { packageManager: request.packageManager } : {}),
          ...(request.changedFiles ? { changedFiles: request.changedFiles } : {}),
          ...(request.port === undefined ? {} : { port: request.port }),
        })
      : await synchronizeSrijikaNextTests({
          project: project.root,
          ...(request.packageManager ? { packageManager: request.packageManager } : {}),
          ...(request.changedFiles ? { changedFiles: request.changedFiles } : {}),
          ...(request.port === undefined ? {} : { port: request.port }),
        });
  const commands = planSrijikaTestVerificationCommands(project, framework);
  const gates: SrijikaTestVerificationGate[] = [];
  let processGatesReady = true;
  if (request.skipInstall) {
    gates.push({ name: 'install', status: 'not-run', durationMillis: 0 });
  } else {
    const install = await runVerificationCommand(commands[0]!);
    gates.push(install);
    processGatesReady = install.status === 'passed';
  }

  const architectureStarted = performance.now();
  let architecturePassed = false;
  try {
    const [architecture, ui] = await Promise.all([
      checkSrijikaArchitecture(project.root),
      checkSrijikaUiDiagnostics(project.root),
    ]);
    const architectureErrors = architecture.diagnostics.filter(
      ({ severity }) => severity === 'error',
    ).length;
    architecturePassed = architectureErrors === 0 && ui.diagnostics.length === 0;
    gates.push({
      name: 'architecture',
      status: architecturePassed ? 'passed' : 'failed',
      durationMillis: Math.max(0, Math.round((performance.now() - architectureStarted) * 10) / 10),
      ...(architecturePassed
        ? {}
        : {
            message: `${architectureErrors} architecture error(s), ${ui.diagnostics.length} UI diagnostic(s).`,
          }),
    });
  } catch (error) {
    gates.push({
      name: 'architecture',
      status: 'failed',
      durationMillis: Math.max(0, Math.round((performance.now() - architectureStarted) * 10) / 10),
      message: error instanceof Error ? error.message : String(error),
    });
  }

  let typecheckPassed = false;
  const reportFreshnessMillis = Date.now() - 1_000;
  let snapshotCount = await visualSnapshotCount(project.root, framework);
  const vitestRequired = synchronization.adapter.artifacts.some(
    ({ relativePath }) => !relativePath.endsWith('.spec.ts'),
  );
  const playwrightRequired = synchronization.adapter.artifacts.some(({ relativePath }) =>
    relativePath.endsWith('.spec.ts'),
  );
  for (const command of commands.slice(1)) {
    if (!processGatesReady) {
      gates.push({ name: command.gate, status: 'not-run', durationMillis: 0 });
      continue;
    }
    if (command.gate === 'vitest' && !vitestRequired) {
      gates.push({
        name: command.gate,
        status: 'passed',
        durationMillis: 0,
        message: 'No Vitest artifacts are required by this owner contract.',
      });
      continue;
    }
    if (
      (command.gate === 'playwright-browser' || command.gate === 'playwright') &&
      !playwrightRequired
    ) {
      gates.push({
        name: command.gate,
        status: 'passed',
        durationMillis: 0,
        message: 'No Playwright artifacts are required by this owner contract.',
      });
      continue;
    }
    let gate = await runVerificationCommand(command);
    if (command.gate === 'playwright' && gate.status === 'failed') {
      const nextSnapshotCount = await visualSnapshotCount(project.root, framework);
      if (nextSnapshotCount > snapshotCount) {
        const confirmation = await runVerificationCommand({
          ...command,
          args: command.args.map((argument) =>
            argument === '--update-snapshots=missing' ? '--update-snapshots=none' : argument,
          ),
        });
        gate = {
          ...confirmation,
          durationMillis: Math.round((gate.durationMillis + confirmation.durationMillis) * 10) / 10,
          ...(confirmation.status === 'passed'
            ? {
                message: `Created and confirmed ${nextSnapshotCount - snapshotCount} missing visual baseline(s).`,
              }
            : {}),
        };
        snapshotCount = nextSnapshotCount;
      }
    }
    gates.push(gate);
    if (command.gate === 'typecheck') typecheckPassed = gate.status === 'passed';
  }
  const evidence = await collectSrijikaTestEvidence({
    project: project.root,
    framework,
    architecturePassed,
    typecheckPassed,
    minimumReportModifiedMillis: reportFreshnessMillis,
  });
  const status =
    evidence.manifest.status === 'passed' &&
    gates.every(({ name, status: gateStatus }) =>
      name === 'install' && request.skipInstall ? true : gateStatus === 'passed',
    )
      ? 'passed'
      : 'failed';
  return {
    root: project.root,
    framework,
    status,
    gates: Object.freeze(gates),
    synchronization: {
      created: synchronization.write?.created ?? [],
      updated: synchronization.write?.updated ?? [],
      unchanged: synchronization.write?.unchanged ?? [],
      preserved: synchronization.write?.preserved ?? [],
      packageWrite: synchronization.packageWrite,
    },
    evidence,
  };
}
