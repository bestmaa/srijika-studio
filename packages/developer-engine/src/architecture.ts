import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  resolveSrijikaArchitectureConfig,
  validateSrijikaArchitecture,
  type SrijikaArchitectureSourceFile,
} from '@srijika/architecture-rules';

import { inspectSrijikaProject } from './project.js';
import type { SrijikaArchitectureCheckResult } from './types.js';

const SOURCE_PATTERN = /\.(?:ts|tsx|mts|cts)$/;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_FILES = 4_096;

interface CachedSource {
  size: number;
  modified: number;
  source: string;
}

export class SrijikaArchitectureIndex {
  readonly #cache = new Map<string, CachedSource>();

  async check(projectRoot: string): Promise<SrijikaArchitectureCheckResult> {
    const startedAt = performance.now();
    const project = await inspectSrijikaProject(projectRoot);
    const architecture = resolveSrijikaArchitectureConfig(project.architecture);
    const sourceRoot = resolve(project.root, architecture.featuresRoot);
    const absoluteFiles: string[] = [];
    const visit = async (folder: string): Promise<void> => {
      const entries = await readdir(folder, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && SOURCE_PATTERN.test(entry.name)) absoluteFiles.push(path);
        if (absoluteFiles.length > MAX_SOURCE_FILES) {
          throw new Error(`Architecture scan exceeds the ${MAX_SOURCE_FILES}-file safety limit.`);
        }
      }
    };
    await visit(sourceRoot);

    const currentFiles = new Set(absoluteFiles);
    for (const cachedPath of this.#cache.keys()) {
      if (!currentFiles.has(cachedPath)) this.#cache.delete(cachedPath);
    }
    let reusedFiles = 0;
    const files: SrijikaArchitectureSourceFile[] = [];
    for (const path of absoluteFiles) {
      const metadata = await stat(path);
      if (metadata.size > MAX_SOURCE_BYTES) {
        throw new Error(`${relative(project.root, path)} exceeds the 4 MiB source limit.`);
      }
      const cached = this.#cache.get(path);
      let source: string;
      if (cached && cached.size === metadata.size && cached.modified === metadata.mtimeMs) {
        source = cached.source;
        reusedFiles += 1;
      } else {
        source = await readFile(path, 'utf8');
        this.#cache.set(path, { size: metadata.size, modified: metadata.mtimeMs, source });
      }
      files.push({ fileName: path, source });
    }
    const result = validateSrijikaArchitecture(files, {
      projectRoot: project.root,
      ...(project.architecture ? { architecture: project.architecture } : {}),
    });
    return Object.freeze({
      root: project.root,
      checkedFiles: files.length,
      reusedFiles,
      durationMillis: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
      diagnostics: result.diagnostics,
      recommendations: result.recommendations,
    });
  }
}

export async function checkSrijikaArchitecture(
  projectRoot: string,
): Promise<SrijikaArchitectureCheckResult> {
  return new SrijikaArchitectureIndex().check(projectRoot);
}
