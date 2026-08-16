import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  checkSrijikaArchitecture,
  checkSrijikaUiDiagnostics,
  createSrijikaDoctorReport,
  finalizeReactMigration,
  findSrijikaProjectRoot,
  formatSrijikaCommand,
  formatSrijikaUiDiagnostic,
  inspectSrijikaProject,
  planSrijikaProjectCommand,
  runSrijikaCommand,
  startReactMigration,
  getReactMigrationStatus,
  verifyReactMigration,
  SrijikaArchitectureIndex,
  type ReactMigrationCommandStatus,
  type ReactMigrationSession,
  type SrijikaProjectCommandKind,
  type SrijikaRuntimePreference,
} from '@srijika/developer-engine';
import {
  resolveSrijikaArchitectureConfig,
  type SrijikaArchitectureConfig,
} from '@srijika/architecture-rules';
import { writeSrijikaProject } from '@srijika/project-scaffold';

import { addSrijikaStructure } from './add.js';
import {
  assertKnownOptions,
  booleanOption,
  parseSrijikaArguments,
  stringOption,
  type ParsedArguments,
} from './arguments.js';
import { findSrijikaStudioExecutable, openSrijikaStudio } from './studio.js';
import {
  installSrijikaVSCodeExtension,
  openProjectInVSCode,
  resolveVSCodeLaunch,
  SRIJIKA_VSCODE_EXTENSION_ID,
} from './vscode.js';

export const SRIJIKA_CLI_VERSION = '0.3.2';

const HELP = `Srijika CLI ${SRIJIKA_CLI_VERSION}

Usage:
  srijika create [directory] [--name package-name] [--display-name "App Name"]
                 [--react-query] [--no-install] [--no-vscode] [--no-extension] [--no-studio]
  srijika init [directory] [--name package-name] [--display-name "App Name"] [--react-query] [--install]
  srijika add feature <Name> [--hook] [--store] [--logic] [--api] [--types]
  srijika add slot <Name> --in <feature-folder> [optional capability flags]
  srijika add part <Name> --in <slot-folder> [optional capability flags]
  srijika add shared-ui <Name> [--types]
  srijika add shared-widget <Name> [--hook] [--store] [--logic] [--api] [--types]
  srijika add shared-capability <Name> <--hook|--store|--logic|--api> [other capability flags]
  srijika add <hook|store|logic|api|types> --to <owner-folder>
  srijika add behavior-hook <Behavior> --in <owner-folder>
  srijika add store-slice <Concern> --in <owner-folder>
  srijika check [project] [--watch] [--json]
  srijika migrate react --source <existing-react> --target <new-srijika> [--dry-run] [--json]
  srijika migrate status --target <new-srijika> [--json]
  srijika migrate verify --target <new-srijika> [--routes-verified] [--visual-verified] [--json]
  srijika dev [project] [--runtime node|bun] [--port 5173]
  srijika install|build|preview|validate [project]
  srijika doctor [project] [--runtime node|bun] [--json]
  srijika studio [project]

Node is the compatibility default. Bun is an optional Vite turbo runtime.
\`create\` is the complete CLI-first onboarding flow; Desktop Studio is optional.
`;

interface CreatedProject {
  target: string;
  projectName: string;
  displayName: string;
  files: readonly string[];
  migration?: ReactMigrationSession;
}

type ProjectDirectoryPrompt = () => Promise<string>;

async function promptForProjectDirectory(): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      'A project name is required in non-interactive mode. Example: npm create srijika@latest my-app',
    );
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const directory = (await prompt.question('Project name: ')).trim();
      if (directory) return directory;
      console.log('! Enter a project name to continue.');
    }
  } finally {
    prompt.close();
  }
}

export async function resolveCreationDirectory(
  parsed: ParsedArguments,
  prompt: ProjectDirectoryPrompt = promptForProjectDirectory,
): Promise<string> {
  if (parsed.positionals.length > 1) {
    throw new Error('Only one new project directory can be provided.');
  }
  const provided = parsed.positionals[0]?.trim();
  if (provided) return provided;
  if (booleanOption(parsed, 'json')) {
    throw new Error(
      'A project name is required with --json. Example: npm create srijika@latest my-app -- --json',
    );
  }
  return prompt();
}

async function createProjectFiles(parsed: ParsedArguments): Promise<CreatedProject> {
  const directory = await resolveCreationDirectory(parsed);
  const target = resolve(directory);
  const projectName = stringOption(parsed, 'name') ?? kebabName(basename(target));
  const displayName = stringOption(parsed, 'display-name') ?? basename(target);
  const migrationSource = stringOption(parsed, 'from');
  if (migrationSource) {
    if (booleanOption(parsed, 'react-query')) {
      throw new Error(
        '--react-query is not supported with --from; migrate providers as a reviewed slice.',
      );
    }
    const migration = await startReactMigration({
      source: resolve(migrationSource),
      target,
      projectName,
      displayName,
    });
    return {
      target,
      projectName,
      displayName,
      files: [`.srijika/migrations/react/session.json`],
      migration,
    };
  }
  const result = await writeSrijikaProject(target, {
    projectName,
    displayName,
    reactQuery: booleanOption(parsed, 'react-query'),
  });
  return { target, projectName, displayName, files: result.files };
}

function runtimeOption(parsed: ParsedArguments): SrijikaRuntimePreference {
  const value = stringOption(parsed, 'runtime') ?? 'auto';
  if (value !== 'auto' && value !== 'node' && value !== 'bun') {
    throw new Error('--runtime must be auto, node, or bun.');
  }
  return value;
}

function numberOption(parsed: ParsedArguments, name: string): number | undefined {
  const value = stringOption(parsed, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 65_535) {
    throw new Error(`--${name} must be an integer between 1 and 65535.`);
  }
  return number;
}

function kebabName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,213}$/.test(normalized)) {
    throw new Error('The project name must normalize to a valid unscoped npm package name.');
  }
  return normalized;
}

async function runInit(parsed: ParsedArguments): Promise<number> {
  assertKnownOptions(parsed, ['name', 'display-name', 'install', 'json', 'react-query']);
  const result = await createProjectFiles(parsed);
  const { target, projectName } = result;
  const install = booleanOption(parsed, 'install');
  if (booleanOption(parsed, 'json')) {
    console.log(JSON.stringify({ ...result, projectName, installed: install }, null, 2));
  } else {
    console.log(`✓ Created ${projectName} with ${result.files.length} pinned files at ${target}`);
  }
  if (install) {
    const project = await inspectSrijikaProject(target);
    const plan = planSrijikaProjectCommand(project, 'install');
    console.log(`→ ${formatSrijikaCommand(plan)}`);
    return runSrijikaCommand(plan);
  }
  return 0;
}

async function runCreate(parsed: ParsedArguments): Promise<number> {
  assertKnownOptions(parsed, [
    'name',
    'display-name',
    'json',
    'no-install',
    'no-open',
    'no-vscode',
    'no-studio',
    'no-extension',
    'extension',
    'react-query',
    'from',
  ]);
  const result = await createProjectFiles(parsed);
  const json = booleanOption(parsed, 'json');
  const statuses: Record<string, string> = {
    scaffold: result.migration
      ? `migration ${result.migration.id}, ${result.migration.inventory.files.length} inventoried source files`
      : `${result.files.length} pinned files`,
  };
  if (!json) {
    console.log(
      `✓ Created ${result.projectName} with ${result.files.length} pinned files at ${result.target}`,
    );
  }

  if (!booleanOption(parsed, 'no-install')) {
    const project = await inspectSrijikaProject(result.target);
    const plan = planSrijikaProjectCommand(project, 'install');
    if (!json) console.log(`→ ${formatSrijikaCommand(plan)}`);
    const installCode = await runSrijikaCommand(plan, json ? { stdio: 'ignore' } : {});
    if (installCode !== 0) return installCode;
    statuses['dependencies'] = 'installed';
  } else statuses['dependencies'] = 'skipped';

  const architecture = await checkSrijikaArchitecture(result.target);
  if (architecture.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    if (!json) {
      for (const diagnostic of architecture.diagnostics) {
        console.error(`✗ ${diagnostic.ruleId ?? diagnostic.code} ${diagnostic.message}`);
      }
    }
    return 1;
  }
  statuses['architecture'] = `${architecture.checkedFiles} files, 0 errors`;
  if (!json) console.log(`✓ Architecture valid across ${architecture.checkedFiles} source files.`);
  const uiDiagnostics = await checkSrijikaUiDiagnostics(result.target);
  if (uiDiagnostics.diagnostics.length > 0) {
    if (!json) {
      for (const diagnostic of uiDiagnostics.diagnostics) {
        console.error(`✗ ${formatSrijikaUiDiagnostic(diagnostic)}`);
      }
    }
    return 1;
  }
  statuses['srijikaDiagnostics'] = `${uiDiagnostics.checkedFiles} UI files, zero diagnostics`;
  if (!json)
    console.log(`✓ Zero Srijika diagnostics across ${uiDiagnostics.checkedFiles} UI files.`);

  const open = !booleanOption(parsed, 'no-open');
  const vscodeEnabled = open && !booleanOption(parsed, 'no-vscode');
  if (vscodeEnabled) {
    const launch = await resolveVSCodeLaunch();
    if (!launch) statuses['vscode'] = 'not installed; skipped';
    else {
      if (!booleanOption(parsed, 'no-extension')) {
        const extension = stringOption(parsed, 'extension') ?? SRIJIKA_VSCODE_EXTENSION_ID;
        try {
          statuses['vscodeExtension'] = (await installSrijikaVSCodeExtension(launch, extension))
            ? `installed: ${extension}`
            : `installation unavailable; workspace recommendation retained: ${extension}`;
        } catch {
          statuses['vscodeExtension'] =
            `installation unavailable; workspace recommendation retained: ${extension}`;
        }
      } else statuses['vscodeExtension'] = 'skipped';
      try {
        statuses['vscode'] = (await openProjectInVSCode(launch, result.target))
          ? 'opened exact project folder'
          : 'launch failed';
      } catch {
        statuses['vscode'] = 'launch failed';
      }
    }
  } else statuses['vscode'] = 'skipped';

  const studioEnabled = open && !booleanOption(parsed, 'no-studio');
  if (studioEnabled) {
    const executable = await findSrijikaStudioExecutable();
    if (!executable) statuses['studio'] = 'not installed; skipped';
    else {
      try {
        await openSrijikaStudio(result.target);
        statuses['studio'] = 'opened exact project folder';
      } catch {
        statuses['studio'] = 'launch failed; project remains usable from CLI and VS Code';
      }
    }
  } else statuses['studio'] = 'skipped';

  if (json) console.log(JSON.stringify({ ...result, statuses }, null, 2));
  else
    for (const [surface, status] of Object.entries(statuses))
      console.log(`· ${surface}: ${status}`);
  return 0;
}

async function runAdd(parsed: ParsedArguments): Promise<number> {
  const result = await addSrijikaStructure(parsed);
  const json = booleanOption(parsed, 'json');
  const payload = {
    root: result.root,
    owner: result.plan.ownerName,
    dryRun: result.dryRun,
    created: result.plan.files.map((file) => file.relativePath),
    updated: result.plan.updates.map((file) => file.relativePath),
    moved: (result.plan.moves ?? []).map((move) => ({
      from: move.fromRelativePath,
      to: move.toRelativePath,
    })),
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    const prefix = result.dryRun ? 'Would create' : 'Created';
    for (const path of payload.created) console.log(`✓ ${prefix}: ${path}`);
    for (const move of payload.moved) console.log(`↪ Safe move: ${move.from} → ${move.to}`);
    for (const path of payload.updated) console.log(`↻ Safe rewire: ${path}`);
  }
  return 0;
}

export function resolveSrijikaWatchRoots(
  projectRoot: string,
  architecture: Partial<SrijikaArchitectureConfig> = {},
): readonly string[] {
  const resolvedArchitecture = resolveSrijikaArchitectureConfig(architecture);
  return Object.freeze(
    [...new Set([resolvedArchitecture.featuresRoot, resolvedArchitecture.sharedRoot])].map(
      (relativeRoot) => resolve(projectRoot, ...relativeRoot.split('/')),
    ),
  );
}

const SRIJIKA_WATCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.srijika',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

export function isSrijikaArchitectureWatchPath(
  relativePath: string | undefined,
  architecture: Partial<SrijikaArchitectureConfig> | undefined,
  entry: string,
): boolean {
  if (!relativePath) return true;
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  const normalizedKey = normalized.toLowerCase();
  if (normalizedKey === 'srijika.config.json' || normalizedKey === 'tsconfig.json') return true;
  if (normalizedKey === entry.toLowerCase()) return true;
  const resolved = resolveSrijikaArchitectureConfig(architecture ?? {});
  return [resolved.featuresRoot, resolved.sharedRoot].some((root) => {
    const rootKey = root.toLowerCase();
    if (normalizedKey === rootKey || rootKey.startsWith(`${normalizedKey}/`)) return true;
    if (!normalizedKey.startsWith(`${rootKey}/`)) return false;
    return !normalizedKey
      .slice(rootKey.length + 1)
      .split('/')
      .some((segment) => SRIJIKA_WATCH_IGNORED_DIRECTORIES.has(segment));
  });
}

async function runCheck(parsed: ParsedArguments): Promise<number> {
  assertKnownOptions(parsed, ['project', 'json', 'watch']);
  const projectArgument = parsed.positionals[0] ?? stringOption(parsed, 'project') ?? process.cwd();
  if (parsed.positionals.length > 1) throw new Error('check accepts at most one project path.');
  const json = booleanOption(parsed, 'json');
  type ProjectCheck = {
    architecture: Awaited<ReturnType<typeof checkSrijikaArchitecture>>;
    ui: Awaited<ReturnType<typeof checkSrijikaUiDiagnostics>>;
  };
  const checkProject = async (index?: SrijikaArchitectureIndex): Promise<ProjectCheck> => {
    const [architecture, ui] = await Promise.all([
      index ? index.check(projectArgument) : checkSrijikaArchitecture(projectArgument),
      checkSrijikaUiDiagnostics(projectArgument),
    ]);
    return { architecture, ui };
  };
  const printResult = (result: ProjectCheck): void => {
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    for (const diagnostic of result.ui.diagnostics) {
      console.log(`✗ ${formatSrijikaUiDiagnostic(diagnostic)}`);
    }
    for (const diagnostic of result.architecture.diagnostics) {
      console.log(
        `${diagnostic.severity === 'error' ? '✗' : '!'} ${diagnostic.fileName}:${diagnostic.span.line}:${diagnostic.span.column} ${diagnostic.ruleId ?? diagnostic.code} ${diagnostic.message}`,
      );
    }
    console.log(
      `✓ Zero Srijika diagnostics across ${result.ui.checkedFiles} UI files; checked ${result.architecture.checkedFiles} architecture files in ${result.architecture.durationMillis} ms (${result.architecture.recommendations.length} recommendations).`,
    );
  };
  if (!booleanOption(parsed, 'watch')) {
    const result = await checkProject();
    printResult(result);
    return result.ui.diagnostics.length > 0 ||
      result.architecture.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ? 1
      : 0;
  }
  let project = await inspectSrijikaProject(projectArgument);
  const index = new SrijikaArchitectureIndex();
  printResult({
    architecture: await index.check(project.root),
    ui: await checkSrijikaUiDiagnostics(project.root),
  });
  let watchAllUntilProjectIsValid = false;
  console.log(
    `→ Watching ${project.root} for project config, aliases, entry, Feature, and Shared changes; unchanged source text is reused.`,
  );
  await new Promise<void>((done, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(project.root, { recursive: true }, (_eventType, fileName) => {
      const relativePath = fileName?.toString();
      if (
        !watchAllUntilProjectIsValid &&
        !isSrijikaArchitectureWatchPath(relativePath, project.architecture, project.entry)
      ) {
        return;
      }
      if (
        watchAllUntilProjectIsValid &&
        relativePath
          ?.replaceAll('\\', '/')
          .toLowerCase()
          .split('/')
          .some((segment) => SRIJIKA_WATCH_IGNORED_DIRECTORIES.has(segment))
      ) {
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void inspectSrijikaProject(project.root)
          .then((nextProject) => {
            project = nextProject;
            watchAllUntilProjectIsValid = false;
            return Promise.all([
              index.check(project.root),
              checkSrijikaUiDiagnostics(project.root),
            ]).then(([architecture, ui]) => ({ architecture, ui }));
          })
          .then(printResult)
          .catch((error) => {
            watchAllUntilProjectIsValid = true;
            console.error(
              `✗ Srijika watch failed closed: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
      }, 80);
    });
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      watcher.close();
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const stop = (): void => {
      cleanup();
      done();
    };
    watcher.once('error', fail);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

async function runDoctor(parsed: ParsedArguments): Promise<number> {
  assertKnownOptions(parsed, ['project', 'runtime', 'json']);
  const start = parsed.positionals[0] ?? stringOption(parsed, 'project') ?? process.cwd();
  if (parsed.positionals.length > 1) throw new Error('doctor accepts at most one project path.');
  const report = await createSrijikaDoctorReport(start, runtimeOption(parsed));
  if (booleanOption(parsed, 'json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Srijika Doctor: ${report.healthy ? 'healthy' : 'attention required'}`);
    console.log(`Runtime: ${report.selectedRuntime} — ${report.runtimeReason}`);
    for (const tool of report.tools) {
      console.log(
        `${tool.available ? '✓' : '·'} ${tool.name}${tool.version ? ` ${tool.version}` : ''}`,
      );
    }
    for (const issue of report.issues) console.log(`! ${issue}`);
  }
  return report.healthy ? 0 : 1;
}

async function runProjectCommand(
  command: SrijikaProjectCommandKind,
  parsed: ParsedArguments,
): Promise<number> {
  assertKnownOptions(parsed, ['project', 'runtime', 'host', 'port']);
  if (command !== 'dev' && parsed.options.has('runtime')) {
    throw new Error('--runtime is supported only by srijika dev.');
  }
  if (
    command !== 'dev' &&
    command !== 'preview' &&
    (parsed.options.has('host') || parsed.options.has('port'))
  ) {
    throw new Error(`--host and --port are not supported by srijika ${command}.`);
  }
  const start = parsed.positionals[0] ?? stringOption(parsed, 'project') ?? process.cwd();
  if (parsed.positionals.length > 1)
    throw new Error(`${command} accepts at most one project path.`);
  const project = await inspectSrijikaProject(start);
  const host = stringOption(parsed, 'host');
  const port = numberOption(parsed, 'port');
  const plan = planSrijikaProjectCommand(project, command, {
    runtime: runtimeOption(parsed),
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
  });
  if (plan.fallbackReason) console.log(`! ${plan.fallbackReason}`);
  console.log(`→ ${formatSrijikaCommand(plan)}`);
  return runSrijikaCommand(plan);
}

function printMigrationSession(session: ReactMigrationSession, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }
  console.log(`✓ React migration ${session.id}: ${session.phase}`);
  console.log(`  Source (read-only): ${session.sourceRoot}`);
  console.log(`  Target: ${session.targetRoot}`);
  console.log(
    `  Traceability: ${session.mappings.length + session.ignoredSources.length}/${session.inventory.files.length} source files accounted for`,
  );
  if (session.verification && !session.verification.passed) {
    for (const error of session.verification.errors) console.log(`! ${error}`);
  }
}

function packageManagerExecutable(manager: string): string {
  return process.platform === 'win32' ? `${manager}.cmd` : manager;
}

async function runMigrationScript(
  project: Awaited<ReturnType<typeof inspectSrijikaProject>>,
  name: 'typecheck' | 'build' | 'test',
  json: boolean,
): Promise<ReactMigrationCommandStatus> {
  const scriptName =
    name === 'test' && !project.scripts['test'] && project.scripts['validate:srijika']
      ? 'validate:srijika'
      : name;
  if (!project.scripts[scriptName]) {
    return {
      name,
      status: 'failed',
      details: `package.json does not define a ${name} verification script.`,
    };
  }
  const executable = packageManagerExecutable(project.packageManager);
  const code = await new Promise<number>((resolveCode, reject) => {
    const child = spawn(executable, ['run', scriptName], {
      cwd: project.root,
      env: process.env,
      stdio: json ? 'ignore' : 'inherit',
      shell: false,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (exitCode) => resolveCode(exitCode ?? 1));
  });
  return {
    name,
    status: code === 0 ? 'passed' : 'failed',
    details:
      code === 0
        ? scriptName === name
          ? `${name} passed.`
          : `${name} passed through the ${scriptName} migration fallback.`
        : `${scriptName} exited with code ${code}.`,
  };
}

async function runMigrate(parsed: ParsedArguments): Promise<number> {
  const [operation, ...extra] = parsed.positionals;
  if (!operation || extra.length > 0) {
    throw new Error('Use `srijika migrate react|status|verify` with named source/target options.');
  }
  if (operation === 'react') {
    assertKnownOptions(parsed, [
      'source',
      'target',
      'name',
      'display-name',
      'dry-run',
      'json',
      'no-install',
    ]);
    const source = stringOption(parsed, 'source');
    const target = stringOption(parsed, 'target');
    if (!source || !target) {
      throw new Error('migrate react requires --source and --target.');
    }
    const json = booleanOption(parsed, 'json');
    const dryRun = booleanOption(parsed, 'dry-run');
    const projectName = stringOption(parsed, 'name');
    const displayName = stringOption(parsed, 'display-name');
    const session = await startReactMigration({
      source: resolve(source),
      target: resolve(target),
      ...(projectName ? { projectName } : {}),
      ...(displayName ? { displayName } : {}),
      dryRun,
    });
    if (!dryRun && !booleanOption(parsed, 'no-install')) {
      const project = await inspectSrijikaProject(session.targetRoot);
      const install = planSrijikaProjectCommand(project, 'install');
      if (!json) console.log(`→ ${formatSrijikaCommand(install)}`);
      const code = await runSrijikaCommand(install, json ? { stdio: 'ignore' } : {});
      if (code !== 0) return code;
    }
    printMigrationSession(session, json);
    return 0;
  }
  if (operation === 'status') {
    assertKnownOptions(parsed, ['target', 'json']);
    const target = stringOption(parsed, 'target');
    if (!target) throw new Error('migrate status requires --target.');
    printMigrationSession(
      await getReactMigrationStatus(resolve(target)),
      booleanOption(parsed, 'json'),
    );
    return 0;
  }
  if (operation === 'verify') {
    assertKnownOptions(parsed, ['target', 'json', 'routes-verified', 'visual-verified']);
    const target = stringOption(parsed, 'target');
    if (!target) throw new Error('migrate verify requires --target.');
    const json = booleanOption(parsed, 'json');
    const project = await inspectSrijikaProject(resolve(target));
    const commands: ReactMigrationCommandStatus[] = [];
    commands.push(await runMigrationScript(project, 'typecheck', json));
    commands.push(await runMigrationScript(project, 'build', json));
    commands.push(await runMigrationScript(project, 'test', json));
    if (booleanOption(parsed, 'routes-verified')) {
      commands.push({
        name: 'routes',
        status: 'passed',
        details: 'User confirmed the reviewed source and target route matrix matches.',
      });
    }
    if (booleanOption(parsed, 'visual-verified')) {
      commands.push({
        name: 'visual',
        status: 'passed',
        details: 'User confirmed representative mobile, tablet, and desktop viewport parity.',
      });
    }
    const verified = await verifyReactMigration({ target: project.root, commands });
    if (!verified.verification?.passed) {
      printMigrationSession(verified, json);
      return 1;
    }
    const completed = await finalizeReactMigration({ target: project.root, commands });
    printMigrationSession(completed, json);
    return 0;
  }
  throw new Error(`Unknown migrate operation: ${operation}. Use react, status, or verify.`);
}

async function runStudio(parsed: ParsedArguments): Promise<number> {
  assertKnownOptions(parsed, ['project']);
  const start = parsed.positionals[0] ?? stringOption(parsed, 'project') ?? process.cwd();
  if (parsed.positionals.length > 1) throw new Error('studio accepts at most one project path.');
  const root = await findSrijikaProjectRoot(start);
  await openSrijikaStudio(root);
  console.log(`✓ Opened Srijika Studio for ${root}`);
  return 0;
}

export async function runSrijikaCli(args = process.argv.slice(2)): Promise<number> {
  const [command = 'help', ...remaining] = args;
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return 0;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(SRIJIKA_CLI_VERSION);
    return 0;
  }
  const parsed = parseSrijikaArguments(remaining);
  if (booleanOption(parsed, 'help')) {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case 'create':
      return runCreate(parsed);
    case 'init':
      return runInit(parsed);
    case 'add':
      return runAdd(parsed);
    case 'check':
      return runCheck(parsed);
    case 'doctor':
      return runDoctor(parsed);
    case 'migrate':
      return runMigrate(parsed);
    case 'dev':
    case 'install':
    case 'build':
    case 'preview':
    case 'validate':
      return runProjectCommand(command, parsed);
    case 'studio':
      return runStudio(parsed);
    default:
      throw new Error(`Unknown command: ${command}. Run srijika help.`);
  }
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  runSrijikaCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(`Srijika: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
