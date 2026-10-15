import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileSrijikaNativeTsx } from './compiler.js';
import { nativeProjectRoot, readNativeFile } from './filesystem.js';
import { printNativeCheck } from './project.js';
import { startNativePreview } from './runtime.js';
import { writeNativeProject } from './scaffold.js';

export const SRIJIKA_NATIVE_VERSION = '0.7.1';

const HELP = `Srijika Native ${SRIJIKA_NATIVE_VERSION}

Usage:
  srijika-native create <directory> [--name package-name] [--display-name "App Name"]
  srijika-native check [project] [--json]
  srijika-native compile <file.ui.tsx> [--json]
  srijika-native dev [project] [--tunnel] [--port 8081]

This independent CLI targets React Native + Expo Go on a physical phone.
After create: pnpm install --frozen-lockfile, pnpm verify, then pnpm start.
For WSL or blocked LAN access, use dev --tunnel or pnpm start:tunnel.
`;

export async function runNativeCli(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;
  if (command === '--version') {
    console.log(SRIJIKA_NATIVE_VERSION);
    return 0;
  }
  if (!command || command === '--help' || command === 'help') {
    console.log(HELP);
    return 0;
  }
  const allowed: Readonly<Record<string, readonly string[]>> = {
    create: ['name', 'display-name'],
    check: ['json'],
    compile: ['json'],
    dev: ['tunnel', 'port'],
  };
  const known = allowed[command];
  if (!known) throw new Error(`Unknown Native command ${command}. Run srijika-native --help.`);
  const options = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index]!;
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!known.includes(name) || options.has(name))
      throw new Error(`Unknown or repeated Native option ${argument}.`);
    if (name === 'json' || name === 'tunnel') {
      options.set(name, true);
      continue;
    }
    const next = rest[++index];
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires a value.`);
    options.set(name, next);
  }
  if (positionals.length > 1) throw new Error('Provide only one Native project or file path.');
  const path = positionals[0];
  if (command === 'create') {
    if (!path) throw new Error('Provide a new Native project directory.');
    const name = options.get('name');
    const displayName = options.get('display-name');
    const projectName =
      typeof name === 'string'
        ? name
        : basename(resolve(path))
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    const result = await writeNativeProject(resolve(path), {
      projectName,
      ...(typeof displayName === 'string' ? { displayName } : {}),
    });
    console.log(
      `Created Native project: ${result.root}\nRun pnpm install --frozen-lockfile, pnpm verify, then pnpm start in that directory.`,
    );
    return 0;
  }
  if (command === 'check') return printNativeCheck(path ?? process.cwd(), options.has('json'));
  if (command === 'compile') {
    if (!path || !path.endsWith('.tsx')) throw new Error('Provide a Native UI TSX file.');
    const absolute = resolve(path);
    const root = await nativeProjectRoot(dirname(absolute));
    const result = compileSrijikaNativeTsx(
      await readNativeFile(root, basename(absolute)),
      absolute,
    );
    if (options.has('json')) console.log(JSON.stringify(result, null, 2));
    else {
      for (const diagnostic of result.diagnostics)
        console.error(
          `${diagnostic.fileName}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`,
        );
      console.log(`Native compile: ${result.document ? 'passed' : 'failed'}.`);
    }
    return result.document ? 0 : 1;
  }
  const port = options.get('port');
  if (typeof port === 'string' && !/^\d+$/.test(port))
    throw new Error('--port requires an integer.');
  return startNativePreview(path ?? process.cwd(), {
    tunnel: options.has('tunnel'),
    ...(typeof port === 'string' ? { port: Number(port) } : {}),
  });
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  try {
    process.exitCode = await runNativeCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
