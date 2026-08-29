import { dirname, join, parse, resolve } from 'node:path';

import {
  parseSrijikaProjectConfig,
  parseSrijikaTypeScriptPathAliases,
} from '@srijika/architecture-rules';

import type { SrijikaPackageManager, SrijikaProjectMetadata } from './types.js';
import { SrijikaProjectFileSystem } from './project-filesystem.js';

const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_ARCHITECTURE_CONFIG_BYTES = 64 * 1024;
const MAX_TSCONFIG_BYTES = 1024 * 1024;
const MAX_ENTRY_SOURCE_BYTES = 4 * 1024 * 1024;

interface PackageJsonShape {
  name?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  devDependencies?: unknown;
  dependencies?: unknown;
  srijika?: unknown;
}

const LOCKFILES = Object.freeze([
  { fileName: 'pnpm-lock.yaml', manager: 'pnpm' },
  { fileName: 'bun.lock', manager: 'bun' },
  { fileName: 'bun.lockb', manager: 'bun' },
  { fileName: 'yarn.lock', manager: 'yarn' },
  { fileName: 'package-lock.json', manager: 'npm' },
] as const);

function recordValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  const record = recordValue(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function packageManagerFromField(value: unknown): {
  manager: SrijikaPackageManager | null;
  version?: string;
} {
  if (typeof value !== 'string') return { manager: null };
  const match = /^(pnpm|npm|yarn|bun)(?:@(.+))?$/.exec(value.trim());
  if (!match?.[1]) return { manager: null };
  const manager = match[1] as SrijikaPackageManager;
  return match[2] ? { manager, version: match[2] } : { manager };
}

export async function findSrijikaProjectRoot(startDirectory = process.cwd()): Promise<string> {
  let candidate = resolve(startDirectory);
  for (;;) {
    let fileSystem: SrijikaProjectFileSystem | undefined;
    try {
      fileSystem = await SrijikaProjectFileSystem.open(candidate);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (fileSystem) {
      const hasConfig = await fileSystem.isRegularFile('srijika.config.json');
      const hasPackage = await fileSystem.isRegularFile('package.json');
      if (hasConfig && hasPackage) return fileSystem.root;
    }
    const parent = dirname(candidate);
    if (parent === candidate || candidate === parse(candidate).root) break;
    candidate = parent;
  }
  throw new Error(`No Srijika project was found from ${resolve(startDirectory)}.`);
}

export async function inspectSrijikaProject(projectRoot: string): Promise<SrijikaProjectMetadata> {
  const root = await findSrijikaProjectRoot(projectRoot);
  const fileSystem = await SrijikaProjectFileSystem.open(root);
  const packageJsonPath = join(root, 'package.json');
  const configPath = join(root, 'srijika.config.json');
  const packageJson = JSON.parse(
    (await fileSystem.readText(packageJsonPath, MAX_PACKAGE_JSON_BYTES)).source,
  ) as PackageJsonShape;
  const configSource = (await fileSystem.readText(configPath, MAX_ARCHITECTURE_CONFIG_BYTES))
    .source;
  const declared = packageManagerFromField(packageJson.packageManager);
  const detectedLockfiles = [] as Array<{ fileName: string; manager: SrijikaPackageManager }>;
  for (const candidate of LOCKFILES) {
    if (await fileSystem.isRegularFile(candidate.fileName)) detectedLockfiles.push(candidate);
  }
  const lockfileMatch = detectedLockfiles.find((entry) => entry.manager === declared.manager);
  const selectedLockfile = lockfileMatch ?? detectedLockfiles[0];
  const packageManager = declared.manager ?? selectedLockfile?.manager ?? 'npm';
  const warnings: string[] = [];
  if (!selectedLockfile)
    warnings.push('No supported lockfile was found; installs are not reproducible.');
  if (declared.manager && selectedLockfile && declared.manager !== selectedLockfile.manager) {
    warnings.push(
      `packageManager selects ${declared.manager}, but ${selectedLockfile.fileName} belongs to ${selectedLockfile.manager}.`,
    );
  }
  const scripts = stringMap(packageJson.scripts);
  const dependencies = {
    ...stringMap(packageJson.dependencies),
    ...stringMap(packageJson.devDependencies),
  };
  const srijika = recordValue(packageJson.srijika);
  if (srijika?.['sourceOfTruth'] !== 'tsx') {
    warnings.push('package.json does not declare srijika.sourceOfTruth as tsx.');
  }

  const projectConfig = parseSrijikaProjectConfig(configSource);
  // The authoritative entry may intentionally live outside the configured
  // ownership roots, but it is still part of the project contract. Validate it
  // through the same no-symlink, bounded, fatal-UTF-8 reader before any command
  // reports the project as healthy.
  await fileSystem.readText(projectConfig.entry, MAX_ENTRY_SOURCE_BYTES);
  const aliases = (await fileSystem.isRegularFile('tsconfig.json'))
    ? parseSrijikaTypeScriptPathAliases(
        (await fileSystem.readText('tsconfig.json', MAX_TSCONFIG_BYTES)).source,
      )
    : {};
  return Object.freeze({
    root,
    packageJsonPath,
    configPath,
    entry: projectConfig.entry,
    projectName:
      typeof packageJson.name === 'string' && packageJson.name.length > 0
        ? packageJson.name
        : (root.split(/[\\/]/).at(-1) ?? 'srijika-project'),
    packageManager,
    ...(declared.version ? { packageManagerVersion: declared.version } : {}),
    lockfile: selectedLockfile?.fileName ?? null,
    scripts: Object.freeze(scripts),
    architecture: projectConfig.architecture,
    ...(projectConfig.adoption ? { adoption: projectConfig.adoption } : {}),
    aliases,
    viteProject:
      typeof dependencies['vite'] === 'string' || /^vite(?:\s|$)/.test(scripts['dev'] ?? ''),
    nextProject:
      typeof dependencies['next'] === 'string' || /^next(?:\s|$)/.test(scripts['dev'] ?? ''),
    warnings: Object.freeze(warnings),
  });
}
