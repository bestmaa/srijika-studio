import ts from 'typescript';

import {
  canonicalSrijikaOwnerName,
  normalizeSrijikaRelativePath,
  srijikaFolderName,
} from './creation';
import { resolveSrijikaArchitectureConfig } from './config';
import { classifySrijikaArchitecturePath } from './validator';
import type {
  ResolvedSrijikaBrownfieldAdoptionConfig,
  SrijikaArchitectureConfig,
  SrijikaArchitectureSourceFile,
  SrijikaBrownfieldExclusionCategory,
} from './types';

export const SRIJIKA_BROWNFIELD_PLAN_VERSION = 'srijika-brownfield-plan-v1' as const;

export type SrijikaBrownfieldCoverageStatus = 'governed' | 'pending' | 'blocked' | 'excluded';

export type SrijikaBrownfieldFileCategory =
  'ui' | 'connector' | 'hook' | SrijikaBrownfieldExclusionCategory | 'source';

export interface SrijikaBrownfieldCoverageEntry {
  relativePath: string;
  status: SrijikaBrownfieldCoverageStatus;
  category: SrijikaBrownfieldFileCategory;
  managedRoot: string;
  adoptedOwner?: string;
  proposedTarget?: string;
  reason: string;
}

export interface SrijikaBrownfieldMove {
  fromRelativePath: string;
  toRelativePath: string;
  category: 'ui' | 'connector' | 'hook';
  status: 'ready' | 'blocked';
  reason: string;
}

export interface SrijikaBrownfieldRewire {
  relativePath: string;
  sourceAfterMove: string;
  importedSourcePath: string;
  importedTargetPath: string;
  fromSpecifier: string;
  toSpecifier: string;
}

export interface SrijikaBrownfieldCoverageSummary {
  files: number;
  governed: number;
  pending: number;
  blocked: number;
  excluded: number;
  adoptedOwners: number;
  fullProjectSuccess: boolean;
}

export interface SrijikaBrownfieldAdoptionPlan {
  version: typeof SRIJIKA_BROWNFIELD_PLAN_VERSION;
  status: 'complete' | 'partial' | 'blocked';
  config: ResolvedSrijikaBrownfieldAdoptionConfig;
  coverage: readonly SrijikaBrownfieldCoverageEntry[];
  summary: SrijikaBrownfieldCoverageSummary;
  moves: readonly SrijikaBrownfieldMove[];
  rewires: readonly SrijikaBrownfieldRewire[];
  strictFiles: readonly string[];
}

export interface PlanSrijikaBrownfieldAdoptionOptions {
  projectRoot?: string;
  architecture?: Partial<SrijikaArchitectureConfig>;
  aliases?: Readonly<Record<string, string>>;
}

function normalizedPath(value: string): string {
  return normalizeSrijikaRelativePath(value).replaceAll(/\/{2,}/gu, '/');
}

function containsPath(parent: string, child: string): boolean {
  const parentKey = parent.toLowerCase();
  const childKey = child.toLowerCase();
  return parentKey === childKey || childKey.startsWith(`${parentKey}/`);
}

function relativeFileName(fileName: string, projectRoot?: string): string {
  const normalized = normalizedPath(fileName);
  if (!projectRoot) return normalized;
  const root = normalizedPath(projectRoot);
  if (normalized.toLowerCase() === root.toLowerCase()) return '';
  return containsPath(root, normalized) ? normalized.slice(root.length + 1) : normalized;
}

function matchingPrefix(path: string, prefixes: readonly string[]): string | undefined {
  return [...prefixes]
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .find((prefix) => containsPath(prefix, path));
}

function fileBaseName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function withoutSourceExtension(fileName: string): string {
  return fileName.replace(/\.(?:[cm]?[jt]sx?)$/iu, '');
}

function ownerNameForFile(
  fileName: string,
  category: 'ui' | 'connector',
  uiSuffix: string,
  connectorSuffix: string,
): string {
  const suffix = category === 'ui' ? uiSuffix : connectorSuffix;
  let stem = fileName.endsWith(suffix)
    ? fileName.slice(0, -suffix.length)
    : withoutSourceExtension(fileName);
  stem = stem.replace(category === 'ui' ? /(?:UI|View|Component)$/u : /Connector$/u, '');
  return canonicalSrijikaOwnerName(stem || 'Owner');
}

function pathCategory(
  relativePath: string,
  config: ResolvedSrijikaBrownfieldAdoptionConfig,
  architecture: ReturnType<typeof resolveSrijikaArchitectureConfig>,
): SrijikaBrownfieldFileCategory {
  const segments = relativePath.split('/');
  const directorySegments = segments.slice(0, -1).map((segment) => segment.toLowerCase());
  const hasDirectory = (names: readonly string[]): boolean =>
    names.some((name) => directorySegments.includes(name.toLowerCase()));
  const fileName = fileBaseName(relativePath);
  if (fileName.endsWith(architecture.uiSuffix) || hasDirectory(config.directories.ui)) return 'ui';
  if (
    fileName.endsWith(architecture.connectorSuffix) ||
    hasDirectory(config.directories.connectors)
  ) {
    return 'connector';
  }
  if (hasDirectory(config.directories.hooks) || /^use[A-Z0-9].*\.[cm]?[jt]sx?$/u.test(fileName)) {
    return 'hook';
  }
  if (directorySegments.some((segment) => segment === 'server')) return 'server';
  if (directorySegments.some((segment) => segment === 'service' || segment === 'services')) {
    return 'service';
  }
  if (directorySegments.some((segment) => segment === 'domain')) return 'domain';
  if (
    directorySegments.some(
      (segment) => segment === 'test' || segment === 'tests' || segment === '__tests__',
    ) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(fileName)
  ) {
    return 'test';
  }
  return 'source';
}

function proposedTarget(
  relativePath: string,
  managedRoot: string,
  category: SrijikaBrownfieldFileCategory,
  config: ResolvedSrijikaBrownfieldAdoptionConfig,
  architecture: ReturnType<typeof resolveSrijikaArchitectureConfig>,
): string | undefined {
  if (category !== 'ui' && category !== 'connector' && category !== 'hook') return undefined;
  const remainder = relativePath.slice(managedRoot.length + 1).split('/');
  const sourceFeature = remainder[0];
  if (!sourceFeature) return undefined;
  const featureName = canonicalSrijikaOwnerName(sourceFeature);
  const featureFolder = srijikaFolderName(featureName);
  const featureRoot = `${architecture.featuresRoot}/${featureFolder}`;
  const fileName = fileBaseName(relativePath);
  const canonicalOwner = classifySrijikaArchitecturePath(relativePath, { architecture });
  let canonicalRoot: string | undefined;
  let canonicalName: string | undefined;
  if (canonicalOwner.kind === 'feature' && canonicalOwner.feature) {
    canonicalRoot = `${architecture.featuresRoot}/${canonicalOwner.feature}`;
    canonicalName = canonicalSrijikaOwnerName(canonicalOwner.feature);
  } else if (canonicalOwner.kind === 'slot' && canonicalOwner.feature && canonicalOwner.slot) {
    canonicalRoot = `${architecture.featuresRoot}/${canonicalOwner.feature}/${architecture.slotsDirectory}/${canonicalOwner.slot}`;
    canonicalName = canonicalSrijikaOwnerName(canonicalOwner.slot);
  } else if (
    canonicalOwner.kind === 'part' &&
    canonicalOwner.feature &&
    canonicalOwner.slot &&
    canonicalOwner.part
  ) {
    canonicalRoot = `${architecture.featuresRoot}/${canonicalOwner.feature}/${architecture.slotsDirectory}/${canonicalOwner.slot}/${architecture.partsDirectory}/${canonicalOwner.part}`;
    canonicalName = canonicalSrijikaOwnerName(canonicalOwner.part);
  } else if (
    (canonicalOwner.kind === 'shared-ui' ||
      canonicalOwner.kind === 'shared-widget' ||
      canonicalOwner.kind === 'shared-capability') &&
    canonicalOwner.shared
  ) {
    const category =
      canonicalOwner.kind === 'shared-ui'
        ? 'ui'
        : canonicalOwner.kind === 'shared-widget'
          ? 'widgets'
          : 'capabilities';
    canonicalRoot = `${architecture.sharedRoot}/${category}/${canonicalOwner.shared}`;
    canonicalName = canonicalSrijikaOwnerName(canonicalOwner.shared);
  }
  if (canonicalRoot && canonicalName) {
    const expected =
      category === 'ui'
        ? `${canonicalRoot}/${canonicalName}${architecture.uiSuffix}`
        : category === 'connector'
          ? `${canonicalRoot}/${canonicalName}${architecture.connectorSuffix}`
          : undefined;
    if (expected === relativePath) return expected;
    if (
      category === 'hook' &&
      (relativePath === `${canonicalRoot}/use${canonicalName}.ts` ||
        relativePath.startsWith(`${canonicalRoot}/${architecture.hooksDirectory}/`))
    ) {
      return relativePath;
    }
  }
  const directorySegments = remainder.slice(1, -1);
  const recognized =
    category === 'ui'
      ? config.directories.ui
      : category === 'connector'
        ? config.directories.connectors
        : config.directories.hooks;
  const recognizedIndex = directorySegments.findIndex((segment) =>
    recognized.some((name) => name.toLowerCase() === segment.toLowerCase()),
  );
  const scope = recognizedIndex < 0 ? [] : directorySegments.slice(0, recognizedIndex);
  const slotName = scope[0] ? canonicalSrijikaOwnerName(scope[0]) : undefined;
  const slotRoot = slotName
    ? `${featureRoot}/${architecture.slotsDirectory}/${srijikaFolderName(slotName)}`
    : undefined;
  if (category === 'hook') {
    if (!slotName || !slotRoot) {
      const featureHook = `${featureRoot}/use${featureName}.ts`;
      return fileName === `use${featureName}.ts`
        ? featureHook
        : `${featureRoot}/${architecture.hooksDirectory}/${fileName}`;
    }
    const partName = scope[1] ? canonicalSrijikaOwnerName(scope[1]) : undefined;
    const scopeRoot = partName
      ? `${slotRoot}/${architecture.partsDirectory}/${srijikaFolderName(partName)}`
      : slotRoot;
    const scopeName = partName ?? slotName;
    return fileName === `use${scopeName}.ts`
      ? `${scopeRoot}/${fileName}`
      : `${scopeRoot}/${architecture.hooksDirectory}/${fileName}`;
  }
  const ownerName = ownerNameForFile(
    fileName,
    category,
    architecture.uiSuffix,
    architecture.connectorSuffix,
  );
  let ownerRoot: string;
  if (!slotName || !slotRoot) {
    ownerRoot =
      ownerName.toLowerCase() === featureName.toLowerCase()
        ? featureRoot
        : `${featureRoot}/${architecture.slotsDirectory}/${srijikaFolderName(ownerName)}`;
  } else {
    ownerRoot =
      ownerName.toLowerCase() === slotName.toLowerCase()
        ? slotRoot
        : `${slotRoot}/${architecture.partsDirectory}/${srijikaFolderName(ownerName)}`;
  }
  return `${ownerRoot}/${ownerName}${
    category === 'ui' ? architecture.uiSuffix : architecture.connectorSuffix
  }`;
}

function posixDirectory(path: string): string {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}

function normalizeJoinedPath(base: string, value: string): string | null {
  const output = base ? base.split('/') : [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (output.length === 0) return null;
      output.pop();
    } else output.push(segment);
  }
  return output.join('/');
}

function stripKnownExtension(path: string): string {
  return path.replace(/\.(?:[cm]?[jt]sx?)$/iu, '');
}

function sourceLookup(paths: readonly string[]): ReadonlyMap<string, string> {
  const output = new Map<string, string>();
  for (const path of paths) {
    output.set(path, path);
    output.set(stripKnownExtension(path), path);
    const index = stripKnownExtension(path).replace(/\/index$/u, '');
    if (index !== stripKnownExtension(path)) output.set(index, path);
  }
  return output;
}

function resolveImport(
  origin: string,
  specifier: string,
  lookup: ReadonlyMap<string, string>,
  aliases: Readonly<Record<string, string>>,
): string | undefined {
  let unresolved: string | null = null;
  if (specifier.startsWith('.')) {
    unresolved = normalizeJoinedPath(posixDirectory(origin), specifier);
  } else {
    const alias = Object.entries(aliases)
      .sort(([left], [right]) => right.length - left.length)
      .find(([prefix]) =>
        prefix.endsWith('/') ? specifier.startsWith(prefix) : specifier === prefix,
      );
    if (alias) {
      unresolved = normalizeJoinedPath(alias[1], specifier.slice(alias[0].length));
    } else if (specifier.startsWith('src/')) unresolved = normalizeJoinedPath('', specifier);
  }
  if (!unresolved) return undefined;
  return lookup.get(unresolved) ?? lookup.get(stripKnownExtension(unresolved));
}

function importSpecifiers(relativePath: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.add(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze([...specifiers].sort());
}

function relativeImport(fromFile: string, toFile: string): string {
  const from = posixDirectory(fromFile).split('/').filter(Boolean);
  const to = stripKnownExtension(toFile).split('/').filter(Boolean);
  while (from[0] && to[0] && from[0].toLowerCase() === to[0].toLowerCase()) {
    from.shift();
    to.shift();
  }
  const prefix = from.length === 0 ? './' : '../'.repeat(from.length);
  return `${prefix}${to.join('/')}`;
}

export function planSrijikaBrownfieldAdoption(
  files: readonly SrijikaArchitectureSourceFile[],
  config: ResolvedSrijikaBrownfieldAdoptionConfig,
  options: PlanSrijikaBrownfieldAdoptionOptions = {},
): SrijikaBrownfieldAdoptionPlan {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const sources = files
    .map((file) => ({
      relativePath: relativeFileName(file.fileName, options.projectRoot),
      source: file.source,
    }))
    .filter(({ relativePath }) => Boolean(relativePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const knownPaths = new Set(sources.map(({ relativePath }) => relativePath));
  const knownPathKeys = new Set([...knownPaths].map((path) => path.toLowerCase()));
  const coverage: SrijikaBrownfieldCoverageEntry[] = [];
  for (const file of sources) {
    const managedRoot = matchingPrefix(file.relativePath, config.managedRoots);
    const includedRoot = matchingPrefix(file.relativePath, config.include);
    if (!managedRoot || !includedRoot) continue;
    const adoptedOwner = matchingPrefix(file.relativePath, config.adoptedOwners);
    const exclusion = config.exclude.find(({ path }) => containsPath(path, file.relativePath));
    const category = pathCategory(file.relativePath, config, architecture);
    const target = proposedTarget(file.relativePath, includedRoot, category, config, architecture);
    if (exclusion && !adoptedOwner) {
      coverage.push({
        relativePath: file.relativePath,
        status: 'excluded',
        category: exclusion.category,
        managedRoot,
        reason: `Explicit ${exclusion.category} exclusion remains normal project code.`,
      });
      continue;
    }
    const requiresMove = target !== undefined && target !== file.relativePath;
    coverage.push({
      relativePath: file.relativePath,
      status: adoptedOwner ? (requiresMove ? 'blocked' : 'governed') : 'pending',
      category,
      managedRoot,
      ...(adoptedOwner ? { adoptedOwner } : {}),
      ...(target ? { proposedTarget: target } : {}),
      reason: adoptedOwner
        ? requiresMove
          ? 'An adopted owner must complete its canonical move before strict verification can pass.'
          : 'The file belongs to an adopted owner and is strictly governed.'
        : target
          ? 'The file has a deterministic canonical target but its owner is not adopted yet.'
          : 'The file remains pending until its owner is adopted or explicitly categorized.',
    });
  }

  const byTarget = new Map<string, SrijikaBrownfieldCoverageEntry[]>();
  for (const entry of coverage) {
    if (!entry.proposedTarget || entry.proposedTarget === entry.relativePath) continue;
    const targetKey = entry.proposedTarget.toLowerCase();
    const existing = byTarget.get(targetKey) ?? [];
    existing.push(entry);
    byTarget.set(targetKey, existing);
  }
  const conflictedTargets = new Set<string>();
  for (const [targetKey, entries] of byTarget) {
    const target = entries[0]?.proposedTarget ?? targetKey;
    const collision =
      entries.length > 1 ||
      (knownPathKeys.has(targetKey) &&
        !entries.some(({ relativePath }) => relativePath.toLowerCase() === targetKey));
    if (!collision) continue;
    conflictedTargets.add(targetKey);
    for (const entry of entries) {
      entry.status = 'blocked';
      entry.reason = knownPathKeys.has(targetKey)
        ? `Canonical target ${target} already exists and will not be overwritten.`
        : `Multiple source files map to canonical target ${target}.`;
    }
  }

  const moves = coverage
    .filter(
      (entry): entry is SrijikaBrownfieldCoverageEntry & { proposedTarget: string } =>
        entry.proposedTarget !== undefined && entry.proposedTarget !== entry.relativePath,
    )
    .filter(
      (entry): entry is typeof entry & { category: 'ui' | 'connector' | 'hook' } =>
        entry.category === 'ui' || entry.category === 'connector' || entry.category === 'hook',
    )
    .map((entry): SrijikaBrownfieldMove => ({
      fromRelativePath: entry.relativePath,
      toRelativePath: entry.proposedTarget,
      category: entry.category,
      status: conflictedTargets.has(entry.proposedTarget.toLowerCase()) ? 'blocked' : 'ready',
      reason: entry.reason,
    }));
  const movedPaths = new Map(
    moves
      .filter(({ status }) => status === 'ready')
      .map(({ fromRelativePath, toRelativePath }) => [fromRelativePath, toRelativePath]),
  );
  const lookup = sourceLookup([...knownPaths]);
  const rewires: SrijikaBrownfieldRewire[] = [];
  for (const file of sources) {
    const sourceAfterMove = movedPaths.get(file.relativePath) ?? file.relativePath;
    for (const specifier of importSpecifiers(file.relativePath, file.source)) {
      const importedSourcePath = resolveImport(
        file.relativePath,
        specifier,
        lookup,
        options.aliases ?? {},
      );
      if (!importedSourcePath) continue;
      const importedTargetPath = movedPaths.get(importedSourcePath);
      if (!importedTargetPath) continue;
      const toSpecifier = relativeImport(sourceAfterMove, importedTargetPath);
      if (specifier === toSpecifier) continue;
      rewires.push({
        relativePath: file.relativePath,
        sourceAfterMove,
        importedSourcePath,
        importedTargetPath,
        fromSpecifier: specifier,
        toSpecifier,
      });
    }
  }

  coverage.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  moves.sort((left, right) => left.fromRelativePath.localeCompare(right.fromRelativePath));
  rewires.sort(
    (left, right) =>
      left.relativePath.localeCompare(right.relativePath) ||
      left.fromSpecifier.localeCompare(right.fromSpecifier),
  );
  const count = (status: SrijikaBrownfieldCoverageStatus): number =>
    coverage.filter((entry) => entry.status === status).length;
  const summary: SrijikaBrownfieldCoverageSummary = Object.freeze({
    files: coverage.length,
    governed: count('governed'),
    pending: count('pending'),
    blocked: count('blocked'),
    excluded: count('excluded'),
    adoptedOwners: config.adoptedOwners.length,
    fullProjectSuccess:
      coverage.length > 0 &&
      coverage.every(({ status }) => status === 'governed') &&
      config.adoptedOwners.length > 0,
  });
  return Object.freeze({
    version: SRIJIKA_BROWNFIELD_PLAN_VERSION,
    status: summary.blocked > 0 ? 'blocked' : summary.pending > 0 ? 'partial' : 'complete',
    config,
    coverage: Object.freeze(coverage),
    summary,
    moves: Object.freeze(moves),
    rewires: Object.freeze(rewires),
    strictFiles: Object.freeze(
      coverage
        .filter(({ adoptedOwner }) => adoptedOwner !== undefined)
        .map(({ relativePath }) => relativePath),
    ),
  });
}
