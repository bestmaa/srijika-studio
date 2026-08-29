import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  planSrijikaBrownfieldAdoption,
  resolveSrijikaArchitectureConfig,
  validateSrijikaArchitecture,
  type SrijikaArchitectureSourceFile,
} from '@srijika/architecture-rules';

import { inspectSrijikaProject } from './project.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';
import type { SrijikaArchitectureCheckResult } from './types.js';

const SOURCE_PATTERN = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_FILES = 4_096;
const MAX_SOURCE_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_SCAN_ENTRIES = 32_768;
const MAX_SCAN_DIRECTORIES = 4_096;
const MAX_SCAN_DEPTH = 32;

interface CachedSource {
  size: number;
  modified: number;
  changed: number;
  device: number;
  inode: number;
  source: string;
}

export class SrijikaArchitectureIndex {
  readonly #cache = new Map<string, CachedSource>();

  async check(projectRoot: string): Promise<SrijikaArchitectureCheckResult> {
    const startedAt = performance.now();
    const project = await inspectSrijikaProject(projectRoot);
    const fileSystem = await SrijikaProjectFileSystem.open(project.root);
    const architecture = resolveSrijikaArchitectureConfig(project.architecture);
    const scanRoots = project.adoption
      ? project.adoption.managedRoots
      : [architecture.featuresRoot, architecture.sharedRoot];
    const discoveredFiles = await fileSystem.walkFiles(scanRoots, {
      maximumFiles: MAX_SOURCE_FILES,
      maximumEntries: MAX_SCAN_ENTRIES,
      maximumDirectories: MAX_SCAN_DIRECTORIES,
      maximumDepth: MAX_SCAN_DEPTH,
      ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
      acceptFile: (fileName) =>
        SOURCE_PATTERN.test(fileName.toLowerCase()) &&
        !/\.d\.(?:ts|tsx|mts|cts)$/.test(fileName.toLowerCase()),
    });
    const absoluteFiles = [...new Set(discoveredFiles.map(({ absolutePath }) => absolutePath))];
    const entryPath = fileSystem.resolve(project.entry);
    if (!absoluteFiles.includes(entryPath)) absoluteFiles.push(entryPath);
    if (absoluteFiles.length > MAX_SOURCE_FILES) {
      throw new Error(
        `Architecture scan exceeds the ${MAX_SOURCE_FILES}-source-file safety limit after including the authoritative entry.`,
      );
    }
    absoluteFiles.sort((left, right) => left.localeCompare(right));

    const currentFiles = new Set(absoluteFiles);
    for (const cachedPath of this.#cache.keys()) {
      if (!currentFiles.has(cachedPath)) this.#cache.delete(cachedPath);
    }
    let reusedFiles = 0;
    let totalBytes = 0;
    const files: SrijikaArchitectureSourceFile[] = [];
    for (const path of absoluteFiles) {
      const metadata = await fileSystem.inspectRegularFile(path);
      if (metadata.size > MAX_SOURCE_BYTES) {
        throw new Error(`${relative(project.root, path)} exceeds the 4 MiB source limit.`);
      }
      totalBytes += metadata.size;
      if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
        throw new Error('Architecture scan exceeds the 24 MiB aggregate source safety limit.');
      }
      const cached = this.#cache.get(path);
      let source: string;
      if (
        cached &&
        cached.size === metadata.size &&
        cached.modified === metadata.mtimeMs &&
        cached.changed === metadata.ctimeMs &&
        (cached.device === 0 || metadata.dev === 0 || cached.device === metadata.dev) &&
        (cached.inode === 0 || metadata.ino === 0 || cached.inode === metadata.ino)
      ) {
        source = cached.source;
        reusedFiles += 1;
      } else {
        const read = await fileSystem.readText(path, MAX_SOURCE_BYTES);
        source = read.source;
        totalBytes += read.size - metadata.size;
        if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
          throw new Error('Architecture scan exceeds the 24 MiB aggregate source safety limit.');
        }
        const refreshed = await fileSystem.inspectRegularFile(path);
        this.#cache.set(path, {
          size: read.size,
          modified: read.modified,
          changed: refreshed.ctimeMs,
          device: refreshed.dev,
          inode: refreshed.ino,
          source,
        });
      }
      files.push({ fileName: path, source });
    }
    const adoption = project.adoption
      ? planSrijikaBrownfieldAdoption(files, project.adoption, {
          projectRoot: project.root,
          architecture,
          ...(project.aliases ? { aliases: project.aliases } : {}),
        })
      : undefined;
    const result = validateSrijikaArchitecture(files, {
      projectRoot: project.root,
      architecture,
      ...(project.aliases ? { aliases: project.aliases } : {}),
    });
    const strictPaths = adoption
      ? new Set([
          entryPath,
          ...adoption.strictFiles.map((fileName) => resolve(project.root, fileName)),
        ])
      : undefined;
    const diagnostics = strictPaths
      ? result.diagnostics.filter(({ fileName }) => strictPaths.has(resolve(fileName)))
      : result.diagnostics;
    const recommendations = strictPaths
      ? result.recommendations.filter((recommendation) =>
          diagnostics.some(({ recommendation: diagnosticRecommendation }) =>
            diagnosticRecommendation
              ? diagnosticRecommendation.id === recommendation.id &&
                diagnosticRecommendation.owner === recommendation.owner
              : false,
          ),
        )
      : result.recommendations;
    return Object.freeze({
      root: project.root,
      checkedFiles: files.length,
      reusedFiles,
      durationMillis: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
      diagnostics: Object.freeze(diagnostics),
      recommendations: Object.freeze(recommendations),
      ...(adoption ? { adoption } : {}),
    });
  }
}

export async function checkSrijikaArchitecture(
  projectRoot: string,
): Promise<SrijikaArchitectureCheckResult> {
  return new SrijikaArchitectureIndex().check(projectRoot);
}
