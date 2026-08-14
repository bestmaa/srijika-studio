import { access, readFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

import type { SrijikaArchitectureConfig } from '@srijika/architecture-rules';

import type { SrijikaPackageManager, SrijikaProjectMetadata } from './types.js';

const MAX_METADATA_BYTES = 1024 * 1024;

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readBoundedText(path: string): Promise<string> {
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source, 'utf8') > MAX_METADATA_BYTES) {
    throw new Error(`${path} exceeds the 1 MiB metadata limit.`);
  }
  return source;
}

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

function architectureFromConfig(source: string): Partial<SrijikaArchitectureConfig> | undefined {
  const parsed: unknown = JSON.parse(source);
  const root = recordValue(parsed);
  const architecture = recordValue(root?.['architecture']);
  if (!architecture || architecture['profile'] !== 'feature-slot-part-v1') return undefined;
  const result: Partial<SrijikaArchitectureConfig> = { profile: 'feature-slot-part-v1' };
  for (const key of [
    'featuresRoot',
    'slotsDirectory',
    'partsDirectory',
    'hooksDirectory',
    'uiSuffix',
    'connectorSuffix',
    'storeSuffix',
    'logicSuffix',
    'apiSuffix',
    'typesSuffix',
  ] as const) {
    const value = architecture[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }
  return result;
}

export async function findSrijikaProjectRoot(startDirectory = process.cwd()): Promise<string> {
  let candidate = resolve(startDirectory);
  for (;;) {
    if (
      (await pathExists(join(candidate, 'srijika.config.json'))) &&
      (await pathExists(join(candidate, 'package.json')))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate || candidate === parse(candidate).root) break;
    candidate = parent;
  }
  throw new Error(`No Srijika project was found from ${resolve(startDirectory)}.`);
}

export async function inspectSrijikaProject(projectRoot: string): Promise<SrijikaProjectMetadata> {
  const root = await findSrijikaProjectRoot(projectRoot);
  const packageJsonPath = join(root, 'package.json');
  const configPath = join(root, 'srijika.config.json');
  const packageJson = JSON.parse(await readBoundedText(packageJsonPath)) as PackageJsonShape;
  const configSource = await readBoundedText(configPath);
  const declared = packageManagerFromField(packageJson.packageManager);
  const detectedLockfiles = [] as Array<{ fileName: string; manager: SrijikaPackageManager }>;
  for (const candidate of LOCKFILES) {
    if (await pathExists(join(root, candidate.fileName))) detectedLockfiles.push(candidate);
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

  const architecture = architectureFromConfig(configSource);
  return Object.freeze({
    root,
    packageJsonPath,
    configPath,
    projectName:
      typeof packageJson.name === 'string' && packageJson.name.length > 0
        ? packageJson.name
        : (root.split(/[\\/]/).at(-1) ?? 'srijika-project'),
    packageManager,
    ...(declared.version ? { packageManagerVersion: declared.version } : {}),
    lockfile: selectedLockfile?.fileName ?? null,
    scripts: Object.freeze(scripts),
    ...(architecture ? { architecture } : {}),
    viteProject:
      typeof dependencies['vite'] === 'string' || /^vite(?:\s|$)/.test(scripts['dev'] ?? ''),
    warnings: Object.freeze(warnings),
  });
}
