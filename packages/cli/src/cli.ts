import { watch } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkSrijikaArchitecture,
  createSrijikaDoctorReport,
  findSrijikaProjectRoot,
  formatSrijikaCommand,
  inspectSrijikaProject,
  planSrijikaProjectCommand,
  runSrijikaCommand,
  SrijikaArchitectureIndex,
  type SrijikaProjectCommandKind,
  type SrijikaRuntimePreference,
} from '@srijika/developer-engine';
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

export const SRIJIKA_CLI_VERSION = '0.1.0';

const HELP = `Srijika CLI ${SRIJIKA_CLI_VERSION}

Usage:
  srijika create <directory> [--name package-name] [--display-name "App Name"]
                 [--no-install] [--no-vscode] [--no-extension] [--no-studio]
  srijika init <directory> [--name package-name] [--display-name "App Name"] [--install]
  srijika add feature <Name> [--hook] [--store] [--logic] [--api] [--types]
  srijika add slot <Name> --in <feature-folder> [optional capability flags]
  srijika add part <Name> --in <slot-folder> [optional capability flags]
  srijika add <hook|store|logic|api|types> --to <owner-folder>
  srijika check [project] [--watch] [--json]
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
}

async function createProjectFiles(parsed: ParsedArguments): Promise<CreatedProject> {
  const [directory] = parsed.positionals;
  if (!directory || parsed.positionals.length !== 1) {
    throw new Error('A single new project directory is required.');
  }
  const target = resolve(directory);
  const projectName = stringOption(parsed, 'name') ?? kebabName(basename(target));
  const displayName = stringOption(parsed, 'display-name') ?? basename(target);
  const result = await writeSrijikaProject(target, { projectName, displayName });
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
  assertKnownOptions(parsed, ['name', 'display-name', 'install', 'json']);
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
  ]);
  const result = await createProjectFiles(parsed);
  const json = booleanOption(parsed, 'json');
  const statuses: Record<string, string> = {
    scaffold: `${result.files.length} pinned files`,
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
  };
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    const prefix = result.dryRun ? 'Would create' : 'Created';
    for (const path of payload.created) console.log(`✓ ${prefix}: ${path}`);
    for (const path of payload.updated) console.log(`↻ Safe rewire: ${path}`);
  }
  return 0;
}

async function runCheck(parsed: ParsedArguments): Promise<number> {
  assertKnownOptions(parsed, ['project', 'json', 'watch']);
  const projectArgument = parsed.positionals[0] ?? stringOption(parsed, 'project') ?? process.cwd();
  if (parsed.positionals.length > 1) throw new Error('check accepts at most one project path.');
  const json = booleanOption(parsed, 'json');
  const printResult = (result: Awaited<ReturnType<typeof checkSrijikaArchitecture>>): void => {
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    for (const diagnostic of result.diagnostics) {
      console.log(
        `${diagnostic.severity === 'error' ? '✗' : '!'} ${diagnostic.fileName}:${diagnostic.span.line}:${diagnostic.span.column} ${diagnostic.ruleId ?? diagnostic.code} ${diagnostic.message}`,
      );
    }
    console.log(
      `✓ Checked ${result.checkedFiles} architecture files in ${result.durationMillis} ms (${result.recommendations.length} recommendations).`,
    );
  };
  if (!booleanOption(parsed, 'watch')) {
    const result = await checkSrijikaArchitecture(projectArgument);
    printResult(result);
    return result.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 1 : 0;
  }
  const project = await inspectSrijikaProject(projectArgument);
  const index = new SrijikaArchitectureIndex();
  printResult(await index.check(project.root));
  const sourceRoot = resolve(project.root, project.architecture?.featuresRoot ?? 'src/features');
  console.log(`→ Watching ${sourceRoot}; unchanged source text is reused.`);
  await new Promise<void>((done, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const watcher = watch(sourceRoot, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void index.check(project.root).then(printResult).catch(reject);
      }, 80);
    });
    watcher.once('error', reject);
    const stop = (): void => {
      if (timer) clearTimeout(timer);
      watcher.close();
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      done();
    };
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
