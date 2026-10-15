import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

export const MAX_NATIVE_SOURCE_BYTES = 4 * 1024 * 1024;
const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  '.expo',
  '.srijika',
  'dist',
  'build',
  'coverage',
  'android',
  'ios',
]);

export async function nativeProjectRoot(directory: string): Promise<string> {
  const lexical = resolve(directory);
  const metadata = await lstat(lexical);
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new Error('A Native project root must be a real directory.');
  const canonical = await realpath(lexical);
  if (process.platform !== 'win32' && canonical !== lexical)
    throw new Error('Native project paths must not pass through symbolic links.');
  return canonical;
}

export async function readNativeFile(
  root: string,
  fileName: string,
  maximumBytes = MAX_NATIVE_SOURCE_BYTES,
): Promise<string> {
  const path = resolve(root, fileName);
  const fromRoot = relative(root, path);
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot))
    throw new Error('Native source paths must remain inside the project.');
  let segmentPath = root;
  for (const segment of fromRoot.split(/[\\/]/)) {
    segmentPath = join(segmentPath, segment);
    if ((await lstat(segmentPath)).isSymbolicLink())
      throw new Error(`Symbolic links are unsupported: ${fileName}`);
  }
  const file = await open(
    path,
    constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > maximumBytes)
      throw new Error(`Native file exceeds its read limit or is not regular: ${fileName}`);
    const bytes = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length > maximumBytes) throw new Error(`Native file exceeds its read limit: ${fileName}`);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
  } finally {
    await file.close();
  }
}

export async function scanNativeSources(
  root: string,
): Promise<readonly { fileName: string; source: string }[]> {
  const paths: string[] = [];
  let entriesSeen = 0;
  let directoriesSeen = 0;
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 32 || ++directoriesSeen > 4096)
      throw new Error('Native source scan exceeds its directory budget.');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entriesSeen > 32_768) throw new Error('Native source scan exceeds its entry budget.');
      if (ignoredDirectories.has(entry.name)) continue;
      if (entry.isSymbolicLink())
        throw new Error(`Symbolic links are unsupported in Native source scans: ${entry.name}`);
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (
        entry.isFile() &&
        /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) &&
        !/\.d\.[cm]?tsx?$/.test(entry.name)
      ) {
        paths.push(path);
        if (paths.length > 4096) throw new Error('Native source scan exceeds its file budget.');
      }
    }
  }
  await visit(root, 0);
  let totalBytes = 0;
  const files: { fileName: string; source: string }[] = [];
  for (const fileName of paths) {
    const source = await readNativeFile(root, fileName);
    totalBytes += Buffer.byteLength(source);
    if (totalBytes > 24 * 1024 * 1024)
      throw new Error('Native source scan exceeds its 24 MiB budget.');
    files.push({ fileName, source });
  }
  return files;
}
