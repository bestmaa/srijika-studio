import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { SrijikaOwnershipCreationFile, SrijikaOwnershipCreationPlan } from './ownership.js';

export interface ApplySrijikaOwnershipPlanOptions {
  expectedUpdateSources?: Readonly<Record<string, string>>;
}

export interface ApplySrijikaOwnershipPlanResult {
  root: string;
  created: readonly string[];
  updated: readonly string[];
}

function destinationFor(root: string, relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    isAbsolute(normalized) ||
    normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe ownership path: ${relativePath}`);
  }
  const destination = resolve(root, ...normalized.split('/'));
  const fromRoot = relative(root, destination);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe ownership path: ${relativePath}`);
  }
  return destination;
}

async function assertMissing(path: string, relativePath: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(`${relativePath} already exists.`);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
}

async function assertRegularFile(path: string, relativePath: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${relativePath} must be a regular file before Srijika can update it.`);
  }
}

async function temporaryFileFor(
  destination: string,
  file: SrijikaOwnershipCreationFile,
): Promise<string> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomBytes(8).toString('hex')}.srijika.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(file.source, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporary;
}

export async function applySrijikaOwnershipCreationPlan(
  projectRoot: string,
  plan: SrijikaOwnershipCreationPlan,
  options: ApplySrijikaOwnershipPlanOptions = {},
): Promise<ApplySrijikaOwnershipPlanResult> {
  if (!isAbsolute(projectRoot))
    throw new TypeError('projectRoot must be an explicit absolute path.');
  const root = resolve(projectRoot);
  const created = plan.files.map((file) => ({
    file,
    destination: destinationFor(root, file.relativePath),
  }));
  const updated = plan.updates.map((file) => ({
    file,
    destination: destinationFor(root, file.relativePath),
  }));
  const allPaths = [...created, ...updated].map(({ destination }) => destination.toLowerCase());
  if (new Set(allPaths).size !== allPaths.length) {
    throw new Error('The ownership plan contains duplicate target paths.');
  }

  for (const entry of created) await assertMissing(entry.destination, entry.file.relativePath);
  for (const entry of updated) {
    await assertRegularFile(entry.destination, entry.file.relativePath);
    const expected = options.expectedUpdateSources?.[entry.file.relativePath];
    if (expected !== undefined && (await readFile(entry.destination, 'utf8')) !== expected) {
      throw new Error(`${entry.file.relativePath} changed after planning; regenerate the plan.`);
    }
  }

  const staged: Array<{
    file: SrijikaOwnershipCreationFile;
    destination: string;
    temporary: string;
    mode: 'create' | 'update';
  }> = [];
  const committedCreates: string[] = [];
  try {
    for (const entry of created) {
      staged.push({
        ...entry,
        temporary: await temporaryFileFor(entry.destination, entry.file),
        mode: 'create',
      });
    }
    for (const entry of updated) {
      staged.push({
        ...entry,
        temporary: await temporaryFileFor(entry.destination, entry.file),
        mode: 'update',
      });
    }
    for (const entry of staged) {
      if (entry.mode === 'create') {
        await link(entry.temporary, entry.destination);
        committedCreates.push(entry.destination);
        await unlink(entry.temporary);
      } else {
        await rename(entry.temporary, entry.destination);
      }
    }
  } catch (error) {
    await Promise.all([
      ...staged.map(({ temporary }) => rm(temporary, { force: true })),
      ...committedCreates.map((destination) => rm(destination, { force: true })),
    ]);
    throw error;
  }

  return Object.freeze({
    root,
    created: Object.freeze(created.map(({ file }) => file.relativePath)),
    updated: Object.freeze(updated.map(({ file }) => file.relativePath)),
  });
}
