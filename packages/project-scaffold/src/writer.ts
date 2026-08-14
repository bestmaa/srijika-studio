import { lstat, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';

import { createSrijikaProjectFileMap } from './templates.js';
import type { SrijikaProjectScaffoldOptions, WriteSrijikaProjectResult } from './types.js';

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const inspectTarget = async (absoluteTarget: string): Promise<'missing' | 'empty-directory'> => {
  try {
    const targetStat = await lstat(absoluteTarget);
    if (targetStat.isSymbolicLink()) {
      throw new Error('The target directory must not be a symbolic link.');
    }
    if (!targetStat.isDirectory()) {
      throw new Error('The target already exists and is not a directory.');
    }

    const entries = await readdir(absoluteTarget);
    if (entries.length > 0) {
      throw new Error(
        'The target directory must be empty; existing projects are never overwritten.',
      );
    }

    return 'empty-directory';
  } catch (error) {
    if (isMissingPathError(error)) {
      return 'missing';
    }
    throw error;
  }
};

const destinationFor = (absoluteTarget: string, projectPath: string): string => {
  const destination = resolve(absoluteTarget, ...projectPath.split('/'));
  const pathFromTarget = relative(absoluteTarget, destination);
  if (pathFromTarget.startsWith('..') || isAbsolute(pathFromTarget)) {
    throw new Error(`Unsafe scaffold path: ${projectPath}`);
  }

  return destination;
};

/**
 * Writes a newly generated project to an explicit absolute directory.
 * Existing non-empty directories, files, symlinks, and filesystem roots are rejected.
 */
export const writeSrijikaProject = async (
  targetDirectory: string,
  options: SrijikaProjectScaffoldOptions = {},
): Promise<WriteSrijikaProjectResult> => {
  if (targetDirectory.trim().length === 0 || !isAbsolute(targetDirectory)) {
    throw new TypeError('targetDirectory must be an explicit absolute path.');
  }

  const absoluteTarget = resolve(targetDirectory);
  if (absoluteTarget === parse(absoluteTarget).root) {
    throw new Error('A filesystem root cannot be used as a Srijika project target.');
  }

  const targetState = await inspectTarget(absoluteTarget);
  if (targetState === 'missing') {
    await mkdir(absoluteTarget, { recursive: true });
  }

  const fileMap = createSrijikaProjectFileMap(options);
  const files = Object.keys(fileMap);

  for (const projectPath of files) {
    const destination = destinationFor(absoluteTarget, projectPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, fileMap[projectPath] ?? '', {
      encoding: 'utf8',
      flag: 'wx',
    });
  }

  return Object.freeze({
    absoluteTarget,
    files: Object.freeze(files),
  });
};
