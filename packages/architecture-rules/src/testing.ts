import ts from 'typescript';

import { resolveSrijikaArchitectureConfig } from './config';
import { canonicalSrijikaOwnerName } from './creation';
import type {
  SrijikaArchitectureCapability,
  SrijikaArchitectureScopeKind,
  SrijikaArchitectureSourceFile,
  ValidateSrijikaArchitectureOptions,
} from './types';
import {
  classifySrijikaArchitectureCapability,
  classifySrijikaArchitecturePath,
} from './validator';

export const SRIJIKA_TEST_CONTRACT_VERSION = 'srijika-test-contract-v1' as const;

export type SrijikaTestOwnerKind = Exclude<SrijikaArchitectureScopeKind, 'outside'>;
export type SrijikaTestFileRole = SrijikaArchitectureCapability | 'support';
export type SrijikaTestLayer =
  'architecture' | 'typecheck' | 'unit' | 'component' | 'browser' | 'visual' | 'accessibility';
export type SrijikaTestRuntime = 'static' | 'node' | 'dom' | 'browser';

export interface SrijikaTestOwnerFile {
  fileName: string;
  role: SrijikaTestFileRole;
}

export interface SrijikaTestRequirement {
  id: string;
  layer: SrijikaTestLayer;
  runtime: SrijikaTestRuntime;
  adapter: 'core' | 'framework';
  subjectFiles: readonly string[];
  reason: string;
}

export interface SrijikaTestOwner {
  id: string;
  kind: SrijikaTestOwnerKind;
  name: string;
  ownerPath: string;
  files: readonly SrijikaTestOwnerFile[];
  capabilities: readonly SrijikaArchitectureCapability[];
  requirements: readonly SrijikaTestRequirement[];
}

export interface SrijikaTestFileDependency {
  fromFile: string;
  toFile: string;
  kind: 'runtime' | 'type';
  fromOwnerId?: string;
  toOwnerId?: string;
}

export interface SrijikaTestContract {
  version: typeof SRIJIKA_TEST_CONTRACT_VERSION;
  owners: readonly SrijikaTestOwner[];
  fileDependencies: readonly SrijikaTestFileDependency[];
}

export interface SrijikaAffectedTestPlan {
  changedFiles: readonly string[];
  affectedFiles: readonly string[];
  directOwnerIds: readonly string[];
  affectedOwnerIds: readonly string[];
  requirementIds: readonly string[];
}

interface OwnerIdentity {
  id: string;
  kind: SrijikaTestOwnerKind;
  name: string;
  ownerPath: string;
}

interface ImportReference {
  specifier: string;
  kind: 'runtime' | 'type';
}

const SOURCE_EXTENSION_PATTERN = /\.(?:[cm]?[jt]sx?)$/iu;

function normalizePath(value: string): string {
  const raw = value.trim().replaceAll('\\', '/');
  const absolute = raw.startsWith('/');
  const output: string[] = [];
  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (output.length > 0 && output.at(-1) !== '..') output.pop();
      else if (!absolute) output.push(segment);
      continue;
    }
    output.push(segment);
  }
  return `${absolute ? '/' : ''}${output.join('/')}`;
}

function joinPath(...values: readonly string[]): string {
  return normalizePath(values.filter(Boolean).join('/'));
}

function directoryName(value: string): string {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf('/');
  return index < 0 ? '' : normalized.slice(0, index);
}

function stripSourceExtension(value: string): string {
  return value.replace(SOURCE_EXTENSION_PATTERN, '');
}

function createFileLookup(
  files: readonly SrijikaArchitectureSourceFile[],
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const file of files) {
    const normalized = normalizePath(file.fileName);
    const extensionless = stripSourceExtension(normalized);
    lookup.set(normalized, normalized);
    lookup.set(extensionless, normalized);
    if (extensionless.endsWith('/index')) {
      lookup.set(extensionless.slice(0, -'/index'.length), normalized);
    }
  }
  return lookup;
}

function inferProjectRoot(
  files: readonly SrijikaArchitectureSourceFile[],
  roots: readonly string[],
  explicitRoot?: string,
): string {
  if (explicitRoot !== undefined) return normalizePath(explicitRoot);
  for (const root of roots) {
    const marker = `/${normalizePath(root)}/`;
    for (const file of files) {
      const normalized = normalizePath(file.fileName);
      if (normalized.startsWith(`${normalizePath(root)}/`)) return '';
      const index = normalized.lastIndexOf(marker);
      if (index >= 0) return normalized.slice(0, index);
    }
  }
  return '';
}

function resolveImportTarget(
  originFileName: string,
  specifier: string,
  fileLookup: ReadonlyMap<string, string>,
  projectRoot: string,
  aliases: Readonly<Record<string, string>>,
): string | null {
  let candidate: string | null = null;
  if (specifier.startsWith('.')) {
    candidate = joinPath(directoryName(originFileName), specifier);
  } else {
    const alias = Object.entries(aliases)
      .sort(([left], [right]) => right.length - left.length)
      .find(([prefix]) =>
        prefix.endsWith('/') ? specifier.startsWith(prefix) : specifier === prefix,
      );
    if (alias) {
      const [prefix, targetRoot] = alias;
      candidate = joinPath(projectRoot, targetRoot, specifier.slice(prefix.length));
    } else if (specifier.startsWith('src/')) {
      candidate = joinPath(projectRoot, specifier);
    }
  }
  if (!candidate) return null;
  return fileLookup.get(candidate) ?? fileLookup.get(stripSourceExtension(candidate)) ?? null;
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
    return false;
  return (
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function collectImportReferences(source: string, fileName: string): readonly ImportReference[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const references: ImportReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({
        specifier: node.moduleSpecifier.text,
        kind: importDeclarationIsTypeOnly(node) ? 'type' : 'runtime',
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        specifier: node.moduleSpecifier.text,
        kind: node.isTypeOnly ? 'type' : 'runtime',
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      references.push({ specifier: node.argument.literal.text, kind: 'type' });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        references.push({ specifier: argument.text, kind: 'runtime' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function ownerIdentity(
  fileName: string,
  options: ValidateSrijikaArchitectureOptions,
): OwnerIdentity | null {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const ownership = classifySrijikaArchitecturePath(fileName, options);
  if (ownership.kind === 'outside') return null;
  if (ownership.kind === 'feature' && ownership.feature) {
    return {
      id: `feature:${ownership.feature}`,
      kind: ownership.kind,
      name: canonicalSrijikaOwnerName(ownership.feature),
      ownerPath: `${architecture.featuresRoot}/${ownership.feature}`,
    };
  }
  if (ownership.kind === 'slot' && ownership.feature && ownership.slot) {
    return {
      id: `slot:${ownership.feature}/${ownership.slot}`,
      kind: ownership.kind,
      name: canonicalSrijikaOwnerName(ownership.slot),
      ownerPath: `${architecture.featuresRoot}/${ownership.feature}/${architecture.slotsDirectory}/${ownership.slot}`,
    };
  }
  if (ownership.kind === 'part' && ownership.feature && ownership.slot && ownership.part) {
    return {
      id: `part:${ownership.feature}/${ownership.slot}/${ownership.part}`,
      kind: ownership.kind,
      name: canonicalSrijikaOwnerName(ownership.part),
      ownerPath: `${architecture.featuresRoot}/${ownership.feature}/${architecture.slotsDirectory}/${ownership.slot}/${architecture.partsDirectory}/${ownership.part}`,
    };
  }
  if (ownership.shared) {
    const category =
      ownership.kind === 'shared-ui'
        ? 'ui'
        : ownership.kind === 'shared-widget'
          ? 'widgets'
          : 'capabilities';
    return {
      id: `${ownership.kind}:${ownership.shared}`,
      kind: ownership.kind,
      name: canonicalSrijikaOwnerName(ownership.shared),
      ownerPath: `${architecture.sharedRoot}/${category}/${ownership.shared}`,
    };
  }
  return null;
}

function requirement(
  ownerId: string,
  layer: SrijikaTestLayer,
  runtime: SrijikaTestRuntime,
  adapter: 'core' | 'framework',
  subjectFiles: readonly string[],
  reason: string,
): SrijikaTestRequirement {
  return { id: `${ownerId}:${layer}`, layer, runtime, adapter, subjectFiles, reason };
}

function requirementsForOwner(
  ownerId: string,
  files: readonly SrijikaTestOwnerFile[],
  capabilities: ReadonlySet<SrijikaArchitectureCapability>,
): readonly SrijikaTestRequirement[] {
  const allFiles = files.map(({ fileName }) => fileName);
  const requirements: SrijikaTestRequirement[] = [
    requirement(
      ownerId,
      'architecture',
      'static',
      'core',
      allFiles,
      'Every owner must satisfy its canonical shape, privacy, and capability boundaries.',
    ),
    requirement(
      ownerId,
      'typecheck',
      'static',
      'core',
      allFiles,
      'Every owner must preserve its public and internal TypeScript contracts.',
    ),
  ];
  const unitFiles = files
    .filter(({ role }) => role === 'store' || role === 'logic' || role === 'api')
    .map(({ fileName }) => fileName);
  if (unitFiles.length > 0) {
    requirements.push(
      requirement(
        ownerId,
        'unit',
        'node',
        'core',
        unitFiles,
        'Store, Logic, and API behavior needs deterministic node-level coverage.',
      ),
    );
  }
  const componentFiles = files
    .filter(({ role }) => role === 'ui' || role === 'connector' || role === 'hook')
    .map(({ fileName }) => fileName);
  if (componentFiles.length > 0) {
    requirements.push(
      requirement(
        ownerId,
        'component',
        'dom',
        'framework',
        componentFiles,
        'UI, Connector, and Hook composition needs a framework-aware DOM harness.',
      ),
    );
  }
  if (capabilities.has('ui')) {
    for (const [layer, reason] of [
      ['browser', 'Every visual owner needs an isolated real-browser behavior smoke test.'],
      ['visual', 'Every visual owner needs a reviewed fixed-viewport visual baseline.'],
      ['accessibility', 'Every visual owner needs automated accessibility evidence.'],
    ] as const) {
      requirements.push(
        requirement(ownerId, layer, 'browser', 'framework', componentFiles, reason),
      );
    }
  }
  return requirements;
}

export function buildSrijikaTestContract(
  inputFiles: readonly SrijikaArchitectureSourceFile[],
  options: ValidateSrijikaArchitectureOptions = {},
): SrijikaTestContract {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const files = inputFiles
    .map((file) => ({ fileName: normalizePath(file.fileName), source: file.source }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
  const projectRoot = inferProjectRoot(
    files,
    [architecture.featuresRoot, architecture.sharedRoot],
    options.projectRoot,
  );
  const normalizedOptions: ValidateSrijikaArchitectureOptions = {
    ...options,
    projectRoot,
    architecture,
  };
  const ownerByFile = new Map<string, OwnerIdentity>();
  const ownerFiles = new Map<string, { identity: OwnerIdentity; files: SrijikaTestOwnerFile[] }>();
  for (const file of files) {
    const identity = ownerIdentity(file.fileName, normalizedOptions);
    if (!identity) continue;
    ownerByFile.set(file.fileName, identity);
    const canonicalUiPath = `${identity.ownerPath}/${identity.name}${architecture.uiSuffix}`;
    const role =
      file.fileName === canonicalUiPath || file.fileName.endsWith(`/${canonicalUiPath}`)
        ? 'ui'
        : (classifySrijikaArchitectureCapability(file.fileName, normalizedOptions) ?? 'support');
    const existing = ownerFiles.get(identity.id) ?? { identity, files: [] };
    existing.files.push({ fileName: file.fileName, role });
    ownerFiles.set(identity.id, existing);
  }

  const owners = [...ownerFiles.values()]
    .sort((left, right) => left.identity.id.localeCompare(right.identity.id))
    .map(({ identity, files: ownedFiles }): SrijikaTestOwner => {
      const capabilities = [
        ...new Set(ownedFiles.flatMap(({ role }) => (role === 'support' ? [] : [role]))),
      ].sort();
      return {
        ...identity,
        files: ownedFiles.sort((left, right) => left.fileName.localeCompare(right.fileName)),
        capabilities,
        requirements: requirementsForOwner(identity.id, ownedFiles, new Set(capabilities)),
      };
    });

  const fileLookup = createFileLookup(files);
  const dependencies = new Map<string, SrijikaTestFileDependency>();
  for (const file of files) {
    for (const reference of collectImportReferences(file.source, file.fileName)) {
      const target = resolveImportTarget(
        file.fileName,
        reference.specifier,
        fileLookup,
        projectRoot,
        options.aliases ?? {},
      );
      if (!target || target === file.fileName) continue;
      const fromOwnerId = ownerByFile.get(file.fileName)?.id;
      const toOwnerId = ownerByFile.get(target)?.id;
      const dependency: SrijikaTestFileDependency = {
        fromFile: file.fileName,
        toFile: target,
        kind: reference.kind,
        ...(fromOwnerId ? { fromOwnerId } : {}),
        ...(toOwnerId ? { toOwnerId } : {}),
      };
      dependencies.set(
        `${dependency.fromFile}\0${dependency.toFile}\0${dependency.kind}`,
        dependency,
      );
    }
  }

  return {
    version: SRIJIKA_TEST_CONTRACT_VERSION,
    owners,
    fileDependencies: [...dependencies.values()].sort(
      (left, right) =>
        left.fromFile.localeCompare(right.fromFile) ||
        left.toFile.localeCompare(right.toFile) ||
        left.kind.localeCompare(right.kind),
    ),
  };
}

export function affectedSrijikaTestPlan(
  contract: SrijikaTestContract,
  changedFileNames: readonly string[],
): SrijikaAffectedTestPlan {
  const changedFiles = [...new Set(changedFileNames.map(normalizePath))].sort();
  const ownerByFile = new Map(
    contract.owners.flatMap((owner) =>
      owner.files.map((file) => [file.fileName, owner.id] as const),
    ),
  );
  const reverseDependencies = new Map<string, string[]>();
  for (const dependency of contract.fileDependencies) {
    const consumers = reverseDependencies.get(dependency.toFile) ?? [];
    consumers.push(dependency.fromFile);
    reverseDependencies.set(dependency.toFile, consumers);
  }
  const affectedFiles = new Set(changedFiles);
  const queue = [...changedFiles];
  for (let index = 0; index < queue.length; index += 1) {
    const target = queue[index]!;
    for (const consumer of reverseDependencies.get(target) ?? []) {
      if (affectedFiles.has(consumer)) continue;
      affectedFiles.add(consumer);
      queue.push(consumer);
    }
  }
  const directOwnerIds = [
    ...new Set(
      changedFiles.flatMap((file) => {
        const ownerId = ownerByFile.get(file);
        return ownerId ? [ownerId] : [];
      }),
    ),
  ].sort();
  const affectedOwnerIds = [
    ...new Set(
      [...affectedFiles].flatMap((file) => {
        const ownerId = ownerByFile.get(file);
        return ownerId ? [ownerId] : [];
      }),
    ),
  ].sort();
  const affectedOwners = new Set(affectedOwnerIds);
  const requirementIds = contract.owners
    .filter((owner) => affectedOwners.has(owner.id))
    .flatMap((owner) => owner.requirements.map(({ id }) => id))
    .sort();
  return {
    changedFiles,
    affectedFiles: [...affectedFiles].sort(),
    directOwnerIds,
    affectedOwnerIds,
    requirementIds,
  };
}
