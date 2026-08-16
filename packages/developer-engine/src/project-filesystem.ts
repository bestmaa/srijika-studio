import { constants } from 'node:fs';
import type { Dirent, Stats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export interface SrijikaSafeTextFile {
  source: string;
  size: number;
  modified: number;
}

export interface SrijikaSafeProjectFile {
  absolutePath: string;
  relativePath: string;
}

export interface SrijikaSafeProjectWalkOptions {
  maximumFiles: number;
  maximumEntries?: number;
  maximumDirectories?: number;
  maximumDepth?: number;
  ignoredDirectoryNames?: ReadonlySet<string>;
  allowIgnoredDirectorySymlinks?: boolean;
  stopAtNestedProjectRoots?: boolean;
  acceptFile?: (fileName: string) => boolean;
}

export const SRIJIKA_IGNORED_PROJECT_DIRECTORIES: ReadonlySet<string> = new Set([
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

const pathKey = (value: string): string =>
  process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

function sameFileIdentity(left: Stats, right: Stats): boolean {
  const stableHandleIdentity =
    left.dev !== 0 && left.ino !== 0 && right.dev !== 0 && right.ino !== 0;
  return (
    (!stableHandleIdentity || (left.dev === right.dev && left.ino === right.ino)) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function assertContained(root: string, target: string, label: string): void {
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`${label} must remain inside the canonical Srijika project root.`);
  }
}

function normalizedRelativePath(root: string, target: string, label: string): string {
  const fromRoot = relative(root, target).replaceAll('\\', '/');
  if (!fromRoot || fromRoot.startsWith('../') || isAbsolute(fromRoot)) {
    throw new Error(`${label} must be a non-root path inside the Srijika project.`);
  }
  return fromRoot;
}

/**
 * A fail-closed, local-filesystem reader for Srijika project metadata and source.
 * Every path component below the canonical project root is checked with lstat,
 * and every read is both byte-bounded and opened with O_NOFOLLOW when supported.
 */
export class SrijikaProjectFileSystem {
  readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(projectRoot: string): Promise<SrijikaProjectFileSystem> {
    const root = resolve(projectRoot);
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('The Srijika project root must be a real directory, not a symbolic link.');
    }
    const canonicalRoot = await realpath(root);
    if (pathKey(canonicalRoot) !== pathKey(root)) {
      throw new Error('The Srijika project root must not be reached through a symbolic link.');
    }
    return new SrijikaProjectFileSystem(canonicalRoot);
  }

  resolve(relativeOrAbsolutePath: string): string {
    const target = isAbsolute(relativeOrAbsolutePath)
      ? resolve(relativeOrAbsolutePath)
      : resolve(this.root, ...relativeOrAbsolutePath.replaceAll('\\', '/').split('/'));
    assertContained(this.root, target, relativeOrAbsolutePath);
    return target;
  }

  async isRegularFile(relativeOrAbsolutePath: string): Promise<boolean> {
    try {
      await this.inspectRegularFile(relativeOrAbsolutePath);
      return true;
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
  }

  async inspectRegularFile(relativeOrAbsolutePath: string): Promise<Stats> {
    return this.#inspectExistingPath(relativeOrAbsolutePath, 'file');
  }

  async inspectDirectory(relativeOrAbsolutePath: string): Promise<Stats> {
    return this.#inspectExistingPath(relativeOrAbsolutePath, 'directory');
  }

  async readDirectory(
    relativeOrAbsolutePath: string,
    options: {
      allowMissing?: boolean;
      ignoredSymlinkNames?: ReadonlySet<string>;
      maximumEntries?: number;
      entryLimitLabel?: number;
    } = {},
  ): Promise<Dirent[]> {
    const directory = this.resolve(relativeOrAbsolutePath);
    const maximumEntries = options.maximumEntries ?? 32_768;
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) {
      throw new TypeError('maximumEntries must be a nonnegative safe integer.');
    }
    let before: Stats;
    try {
      before = await this.inspectDirectory(directory);
    } catch (error) {
      if (options.allowMissing && isMissingPathError(error)) return [];
      throw error;
    }
    const entries: Dirent[] = [];
    const handle = await opendir(directory);
    for await (const entry of handle) {
      entries.push(entry);
      if (entries.length > maximumEntries) {
        throw new Error(
          `Project scan exceeds the ${options.entryLimitLabel ?? maximumEntries}-entry safety limit.`,
        );
      }
    }
    const after = await this.inspectDirectory(directory);
    if (!sameFileIdentity(before, after)) {
      throw new Error(
        `${normalizedRelativePath(this.root, directory, relativeOrAbsolutePath)} changed while Srijika was scanning it.`,
      );
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        if (options.ignoredSymlinkNames?.has(entry.name)) continue;
        throw new Error(
          `${normalizedRelativePath(this.root, resolve(directory, entry.name), entry.name)} must not be a symbolic link.`,
        );
      }
    }
    return entries;
  }

  async readText(
    relativeOrAbsolutePath: string,
    maximumBytes: number,
  ): Promise<SrijikaSafeTextFile> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new TypeError('maximumBytes must be a positive safe integer.');
    }
    const file = this.resolve(relativeOrAbsolutePath);
    const relativePath = normalizedRelativePath(this.root, file, relativeOrAbsolutePath);
    const before = await this.inspectRegularFile(file);
    if (before.size > maximumBytes) {
      throw new Error(`${relativePath} exceeds the ${maximumBytes}-byte read limit.`);
    }

    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
    const handle = await open(file, constants.O_RDONLY | noFollow);
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new Error(`${relativePath} must be a regular file.`);
      if (opened.size > maximumBytes) {
        throw new Error(`${relativePath} exceeds the ${maximumBytes}-byte read limit.`);
      }
      if (
        before.dev !== 0 &&
        before.ino !== 0 &&
        opened.dev !== 0 &&
        opened.ino !== 0 &&
        (before.dev !== opened.dev || before.ino !== opened.ino)
      ) {
        throw new Error(`${relativePath} changed while Srijika was opening it.`);
      }

      const buffer = Buffer.allocUnsafe(maximumBytes + 1);
      let offset = 0;
      while (offset <= maximumBytes) {
        const { bytesRead } = await handle.read(buffer, offset, maximumBytes + 1 - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > maximumBytes) {
        throw new Error(`${relativePath} exceeds the ${maximumBytes}-byte read limit.`);
      }
      const after = await this.inspectRegularFile(file);
      if (!sameFileIdentity(opened, after)) {
        throw new Error(`${relativePath} changed while Srijika was reading it.`);
      }
      let source: string;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
      } catch (error) {
        throw new Error(`${relativePath} must contain valid UTF-8 text.`, { cause: error });
      }
      return {
        source,
        size: offset,
        modified: opened.mtimeMs,
      };
    } finally {
      await handle.close();
    }
  }

  async walkFiles(
    relativeRoots: readonly string[],
    options: SrijikaSafeProjectWalkOptions,
  ): Promise<SrijikaSafeProjectFile[]> {
    if (!Number.isSafeInteger(options.maximumFiles) || options.maximumFiles < 1) {
      throw new TypeError('maximumFiles must be a positive safe integer.');
    }
    const maximumEntries = options.maximumEntries ?? options.maximumFiles * 8;
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < options.maximumFiles) {
      throw new TypeError(
        'maximumEntries must be a safe integer at least as large as maximumFiles.',
      );
    }
    const maximumDirectories = options.maximumDirectories ?? options.maximumFiles;
    const maximumDepth = options.maximumDepth ?? 32;
    if (!Number.isSafeInteger(maximumDirectories) || maximumDirectories < 1) {
      throw new TypeError('maximumDirectories must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(maximumDepth) || maximumDepth < 1) {
      throw new TypeError('maximumDepth must be a positive safe integer.');
    }
    const results: SrijikaSafeProjectFile[] = [];
    const seen = new Set<string>();
    let visitedEntries = 0;
    let visitedDirectories = 0;
    const visit = async (relativeDirectory: string, depth: number): Promise<void> => {
      if (depth > maximumDepth) {
        throw new Error(`Project scan exceeds the ${maximumDepth}-directory depth safety limit.`);
      }
      visitedDirectories += 1;
      if (visitedDirectories > maximumDirectories) {
        throw new Error(`Project scan exceeds the ${maximumDirectories}-directory safety limit.`);
      }
      const entries = await this.readDirectory(relativeDirectory, {
        allowMissing: true,
        maximumEntries: maximumEntries - visitedEntries,
        entryLimitLabel: maximumEntries,
        ...(options.allowIgnoredDirectorySymlinks
          ? { ignoredSymlinkNames: options.ignoredDirectoryNames }
          : {}),
      });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        visitedEntries += 1;
        if (visitedEntries > maximumEntries) {
          throw new Error(`Project scan exceeds the ${maximumEntries}-entry safety limit.`);
        }
        const child = `${relativeDirectory}/${entry.name}`.replace(/^\/+/, '');
        if (entry.isSymbolicLink()) {
          if (
            options.allowIgnoredDirectorySymlinks &&
            options.ignoredDirectoryNames?.has(entry.name)
          ) {
            continue;
          }
          throw new Error(`${child} must not be a symbolic link.`);
        }
        if (entry.isDirectory()) {
          if (options.ignoredDirectoryNames?.has(entry.name)) continue;
          if (
            options.stopAtNestedProjectRoots &&
            (await this.isRegularFile(`${child}/srijika.config.json`))
          ) {
            continue;
          }
          await visit(child, depth + 1);
          continue;
        }
        if (!entry.isFile()) {
          throw new Error(`${child} must be a regular file or directory.`);
        }
        if (options.acceptFile && !options.acceptFile(entry.name)) continue;
        await this.inspectRegularFile(child);
        if (seen.has(child)) continue;
        seen.add(child);
        results.push({ absolutePath: this.resolve(child), relativePath: child });
        if (results.length > options.maximumFiles) {
          throw new Error(`Project scan exceeds the ${options.maximumFiles}-file safety limit.`);
        }
      }
    };
    for (const relativeRoot of new Set(relativeRoots)) await visit(relativeRoot, 1);
    return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  async #inspectExistingPath(
    relativeOrAbsolutePath: string,
    expected: 'file' | 'directory',
  ): Promise<Stats> {
    const target = this.resolve(relativeOrAbsolutePath);
    const relativePath = relative(this.root, target);
    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    let current = this.root;
    let metadata = await lstat(current);
    for (const [index, segment] of segments.entries()) {
      current = resolve(current, segment);
      metadata = await lstat(current);
      const label = segments.slice(0, index + 1).join('/');
      if (metadata.isSymbolicLink()) {
        throw new Error(`${label} must not be a symbolic link.`);
      }
      if (index < segments.length - 1 && !metadata.isDirectory()) {
        throw new Error(`${label} must be a directory.`);
      }
    }
    if (expected === 'file' && !metadata.isFile()) {
      throw new Error(`${relativePath.replaceAll('\\', '/')} must be a regular file.`);
    }
    if (expected === 'directory' && !metadata.isDirectory()) {
      throw new Error(`${relativePath.replaceAll('\\', '/')} must be a directory.`);
    }
    const canonical = await realpath(target);
    assertContained(this.root, canonical, relativeOrAbsolutePath);
    if (pathKey(canonical) !== pathKey(target)) {
      throw new Error(
        `${relativePath.replaceAll('\\', '/') || 'project root'} must not be reached through a symbolic link.`,
      );
    }
    return metadata;
  }
}
