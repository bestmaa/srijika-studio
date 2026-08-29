import { createHash } from 'node:crypto';
import { posix, relative } from 'node:path';

import { resolveSrijikaArchitectureConfig } from '@srijika/architecture-rules';
import {
  compileSrijikaTsx,
  srijikaTypeOnlyModuleSpecifiers,
  type SrijikaDiagnostic,
  type SrijikaResolvedTypeModule,
} from '@srijika/tsx-compiler';

import { inspectSrijikaProject } from './project.js';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';

const MAX_UI_FILES = 4_096;
const MAX_SCAN_ENTRIES = 32_768;
const MAX_SCAN_DIRECTORIES = 4_096;
const MAX_SCAN_DEPTH = 32;
const MAX_UI_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_UI_BYTES = 24 * 1024 * 1024;

export interface SrijikaUiDiagnosticCheckResult {
  root: string;
  checkedFiles: number;
  diagnostics: readonly SrijikaDiagnostic[];
}

export interface SrijikaProspectiveUiWrite {
  relativePath: string;
  content: string;
}

function isUiPath(fileName: string, uiSuffix: string): boolean {
  return fileName.toLowerCase().endsWith(uiSuffix.toLowerCase());
}

function belongsToOwner(fileName: string, owner: string): boolean {
  const fileKey = fileName.toLowerCase();
  const ownerKey = owner.toLowerCase();
  return fileKey === ownerKey || fileKey.startsWith(`${ownerKey}/`);
}

function diagnosticSummary(diagnostic: SrijikaDiagnostic): string {
  return `${diagnostic.fileName}:${diagnostic.span.line}:${diagnostic.span.column} ${diagnostic.code} ${diagnostic.message}`;
}

function sourceHash(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function canonicalTypesPath(uiPath: string, uiSuffix: string, typesSuffix: string): string {
  const uiBase = uiPath.slice(0, -uiSuffix.length);
  const directory = posix.dirname(uiBase);
  const ownerName = posix.basename(uiBase);
  const typesName = `${ownerName.charAt(0).toLowerCase()}${ownerName.slice(1)}${typesSuffix}`;
  return directory === '.' ? typesName : posix.join(directory, typesName);
}

async function resolvedTypeModules(
  uiPath: string,
  source: string,
  uiSuffix: string,
  typesSuffix: string,
  readSource: (relativePath: string) => Promise<string | undefined>,
): Promise<readonly SrijikaResolvedTypeModule[]> {
  const expectedPath = canonicalTypesPath(uiPath, uiSuffix, typesSuffix);
  const modules: SrijikaResolvedTypeModule[] = [];
  for (const specifier of srijikaTypeOnlyModuleSpecifiers(source)) {
    const resolved = posix.normalize(posix.join(posix.dirname(uiPath), specifier));
    const candidate = /\.(?:ts|tsx)$/i.test(resolved) ? resolved : `${resolved}.ts`;
    if (candidate !== expectedPath || posix.dirname(candidate) !== posix.dirname(uiPath)) continue;
    const moduleSource = await readSource(candidate);
    if (moduleSource === undefined) continue;
    modules.push({
      specifier,
      fileName: candidate,
      source: moduleSource,
      hash: sourceHash(moduleSource),
    });
  }
  return Object.freeze(modules);
}

async function compileUi(
  fileName: string,
  source: string,
  uiSuffix: string,
  typesSuffix: string,
  readSource: (relativePath: string) => Promise<string | undefined>,
): Promise<readonly SrijikaDiagnostic[]> {
  return compileSrijikaTsx(fileName, source, {
    documentKind: 'component',
    resolvedTypeModules: await resolvedTypeModules(
      fileName,
      source,
      uiSuffix,
      typesSuffix,
      readSource,
    ),
  }).diagnostics;
}

export async function assertSrijikaUiWritesValid(
  projectRoot: string,
  writes: readonly SrijikaProspectiveUiWrite[],
): Promise<void> {
  const project = await inspectSrijikaProject(projectRoot);
  const architecture = resolveSrijikaArchitectureConfig(project.architecture);
  const fileSystem = await SrijikaProjectFileSystem.open(project.root);
  const prospective = new Map(writes.map((write) => [write.relativePath, write.content]));
  const readSource = async (relativePath: string): Promise<string | undefined> => {
    const pending = prospective.get(relativePath);
    if (pending !== undefined) return pending;
    if (!(await fileSystem.isRegularFile(relativePath))) return undefined;
    return (await fileSystem.readText(relativePath, MAX_UI_BYTES)).source;
  };
  const diagnostics = (
    await Promise.all(
      writes
        .filter((write) => isUiPath(write.relativePath, architecture.uiSuffix))
        .map((write) =>
          compileUi(
            write.relativePath,
            write.content,
            architecture.uiSuffix,
            architecture.typesSuffix,
            readSource,
          ),
        ),
    )
  ).flat();
  if (diagnostics.length > 0) {
    throw new Error(
      `Migration UI writes require zero Srijika diagnostics before apply: ${diagnostics
        .slice(0, 8)
        .map(diagnosticSummary)
        .join(' | ')}${diagnostics.length > 8 ? ` | ${diagnostics.length - 8} more` : ''}`,
    );
  }
}

export async function checkSrijikaUiDiagnostics(
  projectRoot: string,
): Promise<SrijikaUiDiagnosticCheckResult> {
  const project = await inspectSrijikaProject(projectRoot);
  const architecture = resolveSrijikaArchitectureConfig(project.architecture);
  const fileSystem = await SrijikaProjectFileSystem.open(project.root);
  const discovered = await fileSystem.walkFiles(
    project.adoption
      ? project.adoption.managedRoots
      : [architecture.featuresRoot, architecture.sharedRoot],
    {
      maximumFiles: MAX_UI_FILES,
      maximumEntries: MAX_SCAN_ENTRIES,
      maximumDirectories: MAX_SCAN_DIRECTORIES,
      maximumDepth: MAX_SCAN_DEPTH,
      ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
      allowIgnoredDirectorySymlinks: false,
      acceptFile: (fileName) => isUiPath(fileName, architecture.uiSuffix),
    },
  );
  const paths = [
    ...new Set(
      discovered
        .map((file) => file.relativePath)
        .filter(
          (path) =>
            !project.adoption ||
            project.adoption.adoptedOwners.some((owner) => belongsToOwner(path, owner)),
        ),
    ),
  ];
  if (isUiPath(project.entry, architecture.uiSuffix) && !paths.includes(project.entry)) {
    paths.push(project.entry);
  }
  if (paths.length > MAX_UI_FILES) {
    throw new Error(`Srijika UI diagnostics exceed the ${MAX_UI_FILES}-file safety limit.`);
  }
  paths.sort((left, right) => left.localeCompare(right));
  let totalBytes = 0;
  const sourceCache = new Map<string, string>();
  const chargeSource = (path: string, source: string, size: number): string => {
    const cached = sourceCache.get(path);
    if (cached !== undefined) return cached;
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_UI_BYTES) {
      throw new Error('Srijika UI diagnostics exceed the 24 MiB aggregate source limit.');
    }
    sourceCache.set(path, source);
    return source;
  };
  const readSource = async (path: string): Promise<string | undefined> => {
    const cached = sourceCache.get(path);
    if (cached !== undefined) return cached;
    if (!(await fileSystem.isRegularFile(path))) return undefined;
    const read = await fileSystem.readText(path, MAX_UI_BYTES);
    return chargeSource(path, read.source, read.size);
  };
  const diagnostics: SrijikaDiagnostic[] = [];
  for (const path of paths) {
    const read = await fileSystem.readText(path, MAX_UI_BYTES);
    const source = chargeSource(path, read.source, read.size);
    const displayPath = relative(project.root, fileSystem.resolve(path)).replaceAll('\\', '/');
    diagnostics.push(
      ...(await compileUi(
        displayPath,
        source,
        architecture.uiSuffix,
        architecture.typesSuffix,
        readSource,
      )),
    );
  }
  return Object.freeze({
    root: project.root,
    checkedFiles: paths.length,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function formatSrijikaUiDiagnostic(diagnostic: SrijikaDiagnostic): string {
  return diagnosticSummary(diagnostic);
}
