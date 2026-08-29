import { createHash } from 'node:crypto';
import { posix, relative } from 'node:path';
import ts from 'typescript';

import { resolveSrijikaArchitectureConfig } from '@srijika/architecture-rules';
import {
  analyzeSrijikaNextBoundary,
  compileSrijikaTsx,
  srijikaTypeOnlyModuleSpecifiers,
  type CompileSrijikaTsxResult,
  type CompileSrijikaTsxOptions,
  type SrijikaDiagnostic,
  type SrijikaResolvedTypeModule,
  type SrijikaResolvedUiComponent,
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
  projectComponents?: CompileSrijikaTsxOptions['projectComponents'],
): Promise<CompileSrijikaTsxResult> {
  return compileSrijikaTsx(fileName, source, {
    documentKind: 'component',
    resolvedTypeModules: await resolvedTypeModules(
      fileName,
      source,
      uiSuffix,
      typesSuffix,
      readSource,
    ),
    ...(projectComponents ? { projectComponents } : {}),
  });
}

function isNextBoundaryPath(fileName: string): boolean {
  return /(?:^|\/)(?:page|layout|route)\.[cm]?[jt]sx?$/i.test(fileName);
}

function pathContains(parent: string, child: string): boolean {
  const normalizedParent = parent.toLowerCase();
  const normalizedChild = child.toLowerCase();
  return normalizedParent === normalizedChild || normalizedChild.startsWith(`${normalizedParent}/`);
}

function compactRoots(roots: readonly string[]): readonly string[] {
  return [...new Set(roots)]
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .filter(
      (root, index, ordered) =>
        !ordered.slice(0, index).some((parent) => pathContains(parent, root)),
    );
}

function resolvedRouteUiComponents(
  routePath: string,
  source: string,
  compiledByPath: ReadonlyMap<string, CompileSrijikaTsxResult>,
  aliases: Readonly<Record<string, string>> = {},
): readonly SrijikaResolvedUiComponent[] {
  const sourceFile = ts.createSourceFile(
    routePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const output: SrijikaResolvedUiComponent[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause ||
      statement.importClause.isTypeOnly
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    let unresolved: string | undefined;
    if (/^\.\.?\//.test(specifier)) {
      unresolved = posix.normalize(posix.join(posix.dirname(routePath), specifier));
    } else {
      const alias = Object.entries(aliases)
        .sort(([left], [right]) => right.length - left.length || left.localeCompare(right))
        .find(([prefix]) =>
          prefix.endsWith('/') ? specifier.startsWith(prefix) : specifier === prefix,
        );
      if (alias) {
        const [prefix, target] = alias;
        unresolved = prefix.endsWith('/')
          ? posix.normalize(posix.join(target, specifier.slice(prefix.length)))
          : posix.normalize(target);
      }
    }
    if (!unresolved || unresolved === '..' || unresolved.startsWith('../')) continue;
    const candidates = /\.[cm]?[jt]sx?$/i.test(unresolved)
      ? [unresolved]
      : [`${unresolved}.tsx`, `${unresolved}.ts`, posix.join(unresolved, 'index.tsx')];
    const match = candidates.find((candidate) => compiledByPath.has(candidate));
    if (!match) continue;
    const compiled = compiledByPath.get(match)!;
    const componentName = compiled.document?.name;
    if (!componentName) continue;
    if (statement.importClause.name) {
      output.push({
        specifier,
        exportName: 'default',
        componentName,
        contract: compiled.componentContract,
      });
    }
    const bindings = statement.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        const exportName = element.propertyName?.text ?? element.name.text;
        if (exportName !== componentName) continue;
        output.push({ specifier, exportName, componentName, contract: compiled.componentContract });
      }
    }
  }
  return Object.freeze(output);
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
            project.framework?.components,
          ).then((result) => result.diagnostics),
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
  const configuredRoots = project.adoption
    ? project.adoption.managedRoots
    : [architecture.featuresRoot, architecture.sharedRoot];
  const scanRoots = compactRoots([
    ...configuredRoots,
    ...(project.nextProject ? ['app', 'src/app'] : []),
  ]);
  const discovered = await fileSystem.walkFiles(scanRoots, {
    maximumFiles: MAX_UI_FILES,
    maximumEntries: MAX_SCAN_ENTRIES,
    maximumDirectories: MAX_SCAN_DIRECTORIES,
    maximumDepth: MAX_SCAN_DEPTH,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: false,
    acceptFile: (fileName) =>
      isUiPath(fileName, architecture.uiSuffix) ||
      (project.nextProject && isNextBoundaryPath(fileName)),
  });
  const uiPaths = [
    ...new Set(
      discovered
        .map((file) => file.relativePath)
        .filter((path) => isUiPath(path, architecture.uiSuffix))
        .filter(
          (path) =>
            !project.adoption ||
            project.adoption.adoptedOwners.some((owner) => belongsToOwner(path, owner)),
        ),
    ),
  ];
  if (isUiPath(project.entry, architecture.uiSuffix) && !uiPaths.includes(project.entry)) {
    uiPaths.push(project.entry);
  }
  const boundaryPaths = project.nextProject
    ? discovered
        .map((file) => file.relativePath)
        .filter(isNextBoundaryPath)
        .filter(
          (path) =>
            !project.adoption ||
            project.adoption.adoptedOwners.some((owner) => belongsToOwner(path, owner)),
        )
    : [];
  const paths = [...new Set([...uiPaths, ...boundaryPaths])];
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
  const compiledByPath = new Map<string, CompileSrijikaTsxResult>();
  for (const path of uiPaths.sort((left, right) => left.localeCompare(right))) {
    const read = await fileSystem.readText(path, MAX_UI_BYTES);
    const source = chargeSource(path, read.source, read.size);
    const displayPath = relative(project.root, fileSystem.resolve(path)).replaceAll('\\', '/');
    const compiled = await compileUi(
      displayPath,
      source,
      architecture.uiSuffix,
      architecture.typesSuffix,
      readSource,
      project.framework?.components,
    );
    compiledByPath.set(displayPath, compiled);
    diagnostics.push(...compiled.diagnostics);
  }
  for (const path of boundaryPaths.sort((left, right) => left.localeCompare(right))) {
    const read = await fileSystem.readText(path, MAX_UI_BYTES);
    const source = chargeSource(path, read.source, read.size);
    diagnostics.push(
      ...analyzeSrijikaNextBoundary(path, source, {
        resolvedUiComponents: resolvedRouteUiComponents(
          path,
          source,
          compiledByPath,
          project.aliases,
        ),
      }).diagnostics,
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
