import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { applySrijikaOwnershipCreationPlan } from './ownership-writer.js';
import type { SrijikaNextTestAdapterPlan } from './next-testing.js';
import type { SrijikaViteTestAdapterPlan } from './testing.js';

const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

type SrijikaTestAdapterPackagePlan = Pick<
  SrijikaViteTestAdapterPlan | SrijikaNextTestAdapterPlan,
  'scripts' | 'devDependencies'
>;

export interface ApplySrijikaTestPackageResult {
  root: string;
  updated: boolean;
  addedScripts: readonly string[];
  preservedScripts: readonly string[];
  addedDevDependencies: readonly string[];
  preservedDevDependencies: readonly string[];
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`package.json ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function formattedPackageJson(source: string, value: unknown): string {
  const indentation = /\n([\t ]+)"/u.exec(source)?.[1] ?? '  ';
  const endOfLine = source.includes('\r\n') ? '\r\n' : '\n';
  return `${JSON.stringify(value, null, indentation).replaceAll('\n', endOfLine)}${endOfLine}`;
}

export async function applySrijikaTestPackagePlan(
  projectRoot: string,
  plan: SrijikaTestAdapterPackagePlan,
): Promise<ApplySrijikaTestPackageResult> {
  if (!isAbsolute(projectRoot)) {
    throw new TypeError('projectRoot must be an explicit absolute path.');
  }
  const root = resolve(projectRoot);
  const packagePath = resolve(root, 'package.json');
  const metadata = await lstat(packagePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('package.json must be a regular file, not a symbolic link.');
  }
  if (metadata.size > MAX_PACKAGE_JSON_BYTES) {
    throw new Error('package.json exceeds the 1 MiB safety limit.');
  }
  const source = await readFile(packagePath, 'utf8');
  if (Buffer.byteLength(source) > MAX_PACKAGE_JSON_BYTES) {
    throw new Error('package.json exceeds the 1 MiB safety limit.');
  }
  const packageJson = JSON.parse(source) as unknown;
  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('package.json must contain one JSON object.');
  }
  const packageRecord = packageJson as Record<string, unknown>;
  const scripts = record(packageRecord['scripts'], 'scripts');
  const dependencies = record(packageRecord['dependencies'], 'dependencies');
  const devDependencies = record(packageRecord['devDependencies'], 'devDependencies');
  const addedScripts: string[] = [];
  const preservedScripts: string[] = [];
  const addedDevDependencies: string[] = [];
  const preservedDevDependencies: string[] = [];

  for (const [name, command] of Object.entries(plan.scripts)) {
    if (scripts[name] === undefined) {
      scripts[name] = command;
      addedScripts.push(name);
    } else {
      if (typeof scripts[name] !== 'string') {
        throw new Error(`package.json script ${name} must be a string.`);
      }
      preservedScripts.push(name);
    }
  }
  for (const requirement of plan.devDependencies) {
    const existing = dependencies[requirement.name] ?? devDependencies[requirement.name];
    if (existing === undefined) {
      devDependencies[requirement.name] = requirement.version;
      addedDevDependencies.push(requirement.name);
    } else {
      if (typeof existing !== 'string') {
        throw new Error(`package.json dependency ${requirement.name} must be a string.`);
      }
      preservedDevDependencies.push(requirement.name);
    }
  }

  const updated = addedScripts.length > 0 || addedDevDependencies.length > 0;
  if (updated) {
    packageRecord['scripts'] = scripts;
    packageRecord['devDependencies'] = devDependencies;
    await applySrijikaOwnershipCreationPlan(
      root,
      {
        ownerName: 'SrijikaTestPackage',
        ownerFolder: '.',
        files: [],
        updates: [
          { relativePath: 'package.json', source: formattedPackageJson(source, packageJson) },
        ],
      },
      { expectedUpdateSources: { 'package.json': source } },
    );
  }

  return Object.freeze({
    root,
    updated,
    addedScripts: Object.freeze(addedScripts.sort()),
    preservedScripts: Object.freeze(preservedScripts.sort()),
    addedDevDependencies: Object.freeze(addedDevDependencies.sort()),
    preservedDevDependencies: Object.freeze(preservedDevDependencies.sort()),
  });
}
