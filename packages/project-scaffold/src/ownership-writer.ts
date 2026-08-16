import { randomBytes } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { SrijikaOwnershipCreationFile, SrijikaOwnershipCreationPlan } from './ownership.js';

export interface ApplySrijikaOwnershipPlanOptions {
  expectedUpdateSources?: Readonly<Record<string, string>>;
}

export interface ApplySrijikaOwnershipPlanResult {
  root: string;
  created: readonly string[];
  updated: readonly string[];
  moved: readonly { from: string; to: string }[];
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

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function assertInsideRoot(root: string, path: string, relativePath: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe ownership path: ${relativePath}`);
  }
}

async function assertSafeProjectRoot(root: string): Promise<string> {
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('projectRoot must be a real directory, not a symbolic link.');
  }
  return realpath(root);
}

/**
 * Rejects every existing symbolic-link ancestor below the project root. A
 * lexical `resolve()` containment check alone is insufficient because an
 * attacker (or an accidental workspace link) can redirect a valid-looking
 * owner path outside the project.
 */
async function assertSafeAncestors(
  root: string,
  realRoot: string,
  destination: string,
  relativePath: string,
): Promise<void> {
  assertInsideRoot(root, destination, relativePath);
  const parent = dirname(destination);
  const segments = relative(root, parent)
    .split(/[\\/]+/)
    .filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) {
        throw new Error(`${relativePath} crosses a symbolic-link directory.`);
      }
      if (!metadata.isDirectory()) {
        throw new Error(`${relativePath} crosses a non-directory path.`);
      }
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }
  }

  const realParent = await realpath(parent);
  assertInsideRoot(realRoot, realParent, relativePath);
}

async function ensureSafeParentDirectories(
  root: string,
  realRoot: string,
  destination: string,
  relativePath: string,
): Promise<void> {
  const parent = dirname(destination);
  const segments = relative(root, parent)
    .split(/[\\/]+/)
    .filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      await mkdir(current).catch((mkdirError: unknown) => {
        if (!(
          mkdirError instanceof Error &&
          'code' in mkdirError &&
          mkdirError.code === 'EEXIST'
        )) {
          throw mkdirError;
        }
      });
      metadata = await lstat(current);
    }
    if (metadata.isSymbolicLink()) {
      throw new Error(`${relativePath} crosses a symbolic-link directory.`);
    }
    if (!metadata.isDirectory()) {
      throw new Error(`${relativePath} crosses a non-directory path.`);
    }
  }
  const realParent = await realpath(parent);
  assertInsideRoot(realRoot, realParent, relativePath);
}

async function assertMissing(path: string, relativePath: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(`${relativePath} already exists.`);
  } catch (error) {
    if (isMissingFileError(error)) return;
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
  root: string,
  realRoot: string,
  destination: string,
  file: SrijikaOwnershipCreationFile,
): Promise<string> {
  await ensureSafeParentDirectories(root, realRoot, destination, file.relativePath);
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
  const realRoot = await assertSafeProjectRoot(root);
  const created = plan.files.map((file) => ({
    file,
    destination: destinationFor(root, file.relativePath),
  }));
  const updated = plan.updates.map((file) => ({
    file,
    destination: destinationFor(root, file.relativePath),
  }));
  const moved = (plan.moves ?? []).map((move) => ({
    move,
    source: destinationFor(root, move.fromRelativePath),
    destination: destinationFor(root, move.toRelativePath),
  }));
  const allPaths = [...created, ...updated, ...moved].map(({ destination }) =>
    destination.toLowerCase(),
  );
  if (new Set(allPaths).size !== allPaths.length) {
    throw new Error('The ownership plan contains duplicate target paths.');
  }

  for (const entry of created) {
    await assertSafeAncestors(root, realRoot, entry.destination, entry.file.relativePath);
  }
  for (const entry of updated) {
    await assertSafeAncestors(root, realRoot, entry.destination, entry.file.relativePath);
  }
  for (const entry of moved) {
    await assertSafeAncestors(root, realRoot, entry.source, entry.move.fromRelativePath);
    await assertSafeAncestors(root, realRoot, entry.destination, entry.move.toRelativePath);
  }

  for (const entry of created) await assertMissing(entry.destination, entry.file.relativePath);
  for (const entry of moved) {
    await assertRegularFile(entry.source, entry.move.fromRelativePath);
    await assertMissing(entry.destination, entry.move.toRelativePath);
    const expected = options.expectedUpdateSources?.[entry.move.fromRelativePath];
    if (expected !== undefined && (await readFile(entry.source, 'utf8')) !== expected) {
      throw new Error(
        `${entry.move.fromRelativePath} changed after planning; regenerate the plan.`,
      );
    }
  }
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
  const moveBackups: Array<{ source: string; backup: string }> = [];
  const updateBackups: Array<{ destination: string; backup: string }> = [];
  try {
    for (const entry of created) {
      staged.push({
        ...entry,
        temporary: await temporaryFileFor(root, realRoot, entry.destination, entry.file),
        mode: 'create',
      });
    }
    for (const entry of updated) {
      staged.push({
        ...entry,
        temporary: await temporaryFileFor(root, realRoot, entry.destination, entry.file),
        mode: 'update',
      });
    }
    for (const entry of moved) {
      staged.push({
        file: { relativePath: entry.move.toRelativePath, source: entry.move.source },
        destination: entry.destination,
        temporary: await temporaryFileFor(root, realRoot, entry.destination, {
          relativePath: entry.move.toRelativePath,
          source: entry.move.source,
        }),
        mode: 'create',
      });
    }
    for (const entry of staged) {
      await assertSafeAncestors(root, realRoot, entry.destination, entry.file.relativePath);
      if (entry.mode === 'create') {
        await link(entry.temporary, entry.destination);
        committedCreates.push(entry.destination);
        await unlink(entry.temporary);
      } else {
        const backup = `${entry.destination}.${randomBytes(8).toString('hex')}.srijika.update`;
        await rename(entry.destination, backup);
        updateBackups.push({ destination: entry.destination, backup });
        await rename(entry.temporary, entry.destination);
      }
    }
    for (const entry of moved) {
      await assertSafeAncestors(root, realRoot, entry.source, entry.move.fromRelativePath);
      const backup = `${entry.source}.${randomBytes(8).toString('hex')}.srijika.move`;
      await rename(entry.source, backup);
      moveBackups.push({ source: entry.source, backup });
    }
    await Promise.all(
      [...moveBackups, ...updateBackups].map(({ backup }) =>
        rm(backup, { force: true }).catch(() => undefined),
      ),
    );
  } catch (error) {
    await Promise.all([
      ...staged.map(({ temporary }) => rm(temporary, { force: true })),
      ...committedCreates.map((destination) => rm(destination, { force: true })),
    ]);
    for (const { source, backup } of moveBackups.reverse()) {
      await rename(backup, source).catch(() => undefined);
    }
    for (const { destination, backup } of updateBackups.reverse()) {
      await rm(destination, { force: true });
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }

  return Object.freeze({
    root,
    created: Object.freeze(created.map(({ file }) => file.relativePath)),
    updated: Object.freeze(updated.map(({ file }) => file.relativePath)),
    moved: Object.freeze(
      moved.map(({ move }) => ({ from: move.fromRelativePath, to: move.toRelativePath })),
    ),
  });
}
