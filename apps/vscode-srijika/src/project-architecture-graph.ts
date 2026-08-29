import ts from 'typescript';

import {
  classifySrijikaArchitectureCapability,
  classifySrijikaArchitecturePath,
  type ResolvedSrijikaArchitectureConfig,
  type SrijikaArchitectureCapability,
  type SrijikaArchitectureDiagnostic,
  type SrijikaArchitectureOwnership,
  type SrijikaArchitectureSourceFile,
  type SrijikaBrownfieldAdoptionPlan,
} from '@srijika/architecture-rules';

export type SrijikaProjectGraphNodeKind = 'app' | 'group' | 'owner' | 'file';
export type SrijikaProjectGraphEdgeKind =
  'hierarchy' | 'same-owner' | 'shared' | 'cross-owner' | 'forbidden';
export type SrijikaProjectFileCapability = SrijikaArchitectureCapability | 'entry' | 'unknown';

export interface SrijikaProjectGraphImport {
  specifier: string;
  kind: 'workspace' | 'package' | 'asset' | 'unresolved';
  resolvedPath?: string;
  packageName?: string;
}

export interface SrijikaProjectGraphNode {
  id: string;
  kind: SrijikaProjectGraphNodeKind;
  label: string;
  subtitle: string;
  parentId?: string;
  ownerId?: string;
  ownerKind?: string;
  relativePath?: string;
  capability?: SrijikaProjectFileCapability;
  imports: readonly SrijikaProjectGraphImport[];
  exports: readonly string[];
  violationIds: readonly string[];
}

export interface SrijikaProjectGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: SrijikaProjectGraphEdgeKind;
  label: string;
}

export interface SrijikaProjectGraphViolation {
  id: string;
  code: string;
  ruleId?: string;
  severity: 'error' | 'warning';
  message: string;
  guidance: string;
  nodeIds: readonly string[];
}

export interface SrijikaProjectArchitectureGraphModel {
  projectName: string;
  projectRoot: string;
  entry: string;
  nodes: readonly SrijikaProjectGraphNode[];
  edges: readonly SrijikaProjectGraphEdge[];
  violations: readonly SrijikaProjectGraphViolation[];
  adoption?: SrijikaBrownfieldAdoptionPlan;
  stats: {
    owners: number;
    files: number;
    imports: number;
    packages: number;
    unresolvedImports: number;
    violations: number;
  };
}

export interface SrijikaProjectArchitectureGraphInput {
  projectName: string;
  projectRoot: string;
  entry: string;
  architecture: ResolvedSrijikaArchitectureConfig;
  aliases?: Readonly<Record<string, string>>;
  files: readonly SrijikaArchitectureSourceFile[];
  diagnostics: readonly SrijikaArchitectureDiagnostic[];
  adoption?: SrijikaBrownfieldAdoptionPlan;
}

interface ParsedModule {
  imports: readonly string[];
  exports: readonly string[];
}

interface OwnerDescriptor {
  id: string;
  kind: Exclude<SrijikaArchitectureOwnership['kind'], 'outside'>;
  label: string;
  relativeFolder: string;
  parentId: string;
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;
const ASSET_EXTENSION =
  /\.(?:css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp3|wav|ogg|mp4|webm)(?:[?#].*)?$/iu;

function normalizedPath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/{2,}/gu, '/');
  return /^[A-Za-z]:\//u.test(normalized)
    ? normalized.slice(0, 1).toLowerCase() + normalized.slice(1)
    : normalized;
}

function relativeProjectPath(projectRoot: string, fileName: string): string {
  const root = normalizedPath(projectRoot).replace(/\/$/u, '');
  const file = normalizedPath(fileName);
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file.replace(/^\.\//u, '');
}

function posixDirectory(value: string): string {
  const index = value.lastIndexOf('/');
  return index < 0 ? '' : value.slice(0, index);
}

function posixJoin(...parts: readonly string[]): string {
  const output: string[] = [];
  for (const segment of parts.join('/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') output.pop();
    else output.push(segment);
  }
  return output.join('/');
}

function fileNodeId(relativePath: string): string {
  return `file:${relativePath}`;
}

function ownerDescriptor(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): OwnerDescriptor | undefined {
  if (ownership.kind === 'feature' && ownership.feature) {
    return {
      id: `owner:feature:${ownership.feature}`,
      kind: ownership.kind,
      label: ownership.feature,
      relativeFolder: `${architecture.featuresRoot}/${ownership.feature}`,
      parentId: 'group:features',
    };
  }
  if (ownership.kind === 'slot' && ownership.feature && ownership.slot) {
    return {
      id: `owner:slot:${ownership.feature}/${ownership.slot}`,
      kind: ownership.kind,
      label: ownership.slot,
      relativeFolder: `${architecture.featuresRoot}/${ownership.feature}/${architecture.slotsDirectory}/${ownership.slot}`,
      parentId: `owner:feature:${ownership.feature}`,
    };
  }
  if (ownership.kind === 'part' && ownership.feature && ownership.slot && ownership.part) {
    return {
      id: `owner:part:${ownership.feature}/${ownership.slot}/${ownership.part}`,
      kind: ownership.kind,
      label: ownership.part,
      relativeFolder: `${architecture.featuresRoot}/${ownership.feature}/${architecture.slotsDirectory}/${ownership.slot}/${architecture.partsDirectory}/${ownership.part}`,
      parentId: `owner:slot:${ownership.feature}/${ownership.slot}`,
    };
  }
  if (
    (ownership.kind === 'shared-ui' ||
      ownership.kind === 'shared-widget' ||
      ownership.kind === 'shared-capability') &&
    ownership.shared
  ) {
    const category =
      ownership.kind === 'shared-ui'
        ? 'ui'
        : ownership.kind === 'shared-widget'
          ? 'widgets'
          : 'capabilities';
    return {
      id: `owner:${ownership.kind}:${ownership.shared}`,
      kind: ownership.kind,
      label: ownership.shared,
      relativeFolder: `${architecture.sharedRoot}/${category}/${ownership.shared}`,
      parentId: 'group:shared',
    };
  }
  return undefined;
}

function ownerAncestors(owner: OwnerDescriptor): readonly OwnerDescriptor[] {
  if (owner.kind === 'slot') {
    const [feature = ''] = owner.id.slice('owner:slot:'.length).split('/');
    return [
      {
        id: `owner:feature:${feature}`,
        kind: 'feature',
        label: feature,
        relativeFolder: owner.relativeFolder.split('/slots/')[0] ?? '',
        parentId: 'group:features',
      },
    ];
  }
  if (owner.kind === 'part') {
    const [feature = '', slot = ''] = owner.id.slice('owner:part:'.length).split('/');
    const featureFolder = owner.relativeFolder.split('/slots/')[0] ?? '';
    return [
      {
        id: `owner:feature:${feature}`,
        kind: 'feature',
        label: feature,
        relativeFolder: featureFolder,
        parentId: 'group:features',
      },
      {
        id: `owner:slot:${feature}/${slot}`,
        kind: 'slot',
        label: slot,
        relativeFolder: owner.relativeFolder.split('/parts/')[0] ?? '',
        parentId: `owner:feature:${feature}`,
      },
    ];
  }
  return [];
}

function scriptKind(relativePath: string): ts.ScriptKind {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function declarationNames(node: ts.Node): readonly string[] {
  const output: string[] = [];
  const appendBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) output.push(name.text);
    else
      for (const element of name.elements)
        if (!ts.isOmittedExpression(element)) appendBinding(element.name);
  };
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    if (node.name && ts.isIdentifier(node.name)) output.push(node.name.text);
  } else if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) appendBinding(declaration.name);
  }
  return output;
}

function parseModule(relativePath: string, source: string): ParsedModule {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(relativePath),
  );
  const imports = new Set<string>();
  const exports = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.add(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      imports.add(node.arguments[0].text);
    }
    if (ts.isExportAssignment(node)) exports.add('default');
    if (ts.isExportDeclaration(node)) {
      if (!node.exportClause) exports.add('*');
      else if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) exports.add(element.name.text);
      }
    }
    if (ts.canHaveModifiers(node)) {
      const modifiers = ts.getModifiers(node) ?? [];
      if (modifiers.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
        const isDefault = modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword);
        if (isDefault) {
          exports.add('default');
        } else {
          for (const name of declarationNames(node)) exports.add(name);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    imports: [...imports].sort(),
    exports: [...exports].sort(),
  };
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}

function resolveWorkspaceImport(
  importer: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
  aliases: Readonly<Record<string, string>>,
): SrijikaProjectGraphImport {
  if (ASSET_EXTENSION.test(specifier)) return { specifier, kind: 'asset' };
  let requested: string | undefined;
  if (specifier.startsWith('.')) {
    requested = posixJoin(posixDirectory(importer), specifier);
  } else {
    const alias = Object.entries(aliases)
      .sort(([left], [right]) => right.length - left.length)
      .find(([pattern]) =>
        pattern.endsWith('/') ? specifier.startsWith(pattern) : specifier === pattern,
      );
    if (alias) requested = posixJoin(alias[1], specifier.slice(alias[0].length));
  }
  if (requested === undefined) {
    return { specifier, kind: 'package', packageName: packageName(specifier) };
  }
  const candidates = [
    requested,
    ...SOURCE_EXTENSIONS.map((extension) => requested + extension),
    ...SOURCE_EXTENSIONS.map((extension) => `${requested}/index${extension}`),
  ];
  const resolvedPath = candidates.find((candidate) => knownPaths.has(candidate));
  return resolvedPath
    ? { specifier, kind: 'workspace', resolvedPath }
    : { specifier, kind: 'unresolved' };
}

function inferredCapability(
  relativePath: string,
  entry: string,
  architecture: ResolvedSrijikaArchitectureConfig,
): SrijikaProjectFileCapability {
  if (relativePath === entry) return 'entry';
  const canonical = classifySrijikaArchitectureCapability(relativePath, { architecture });
  if (canonical) return canonical;
  const base = relativePath.split('/').at(-1) ?? relativePath;
  if (base.endsWith(architecture.uiSuffix)) return 'ui';
  if (base.endsWith(architecture.connectorSuffix)) return 'connector';
  if (base.endsWith(architecture.storeSuffix)) return 'store';
  if (base.endsWith(architecture.logicSuffix)) return 'logic';
  if (base.endsWith(architecture.apiSuffix)) return 'api';
  if (base.endsWith(architecture.typesSuffix)) return 'types';
  if (
    relativePath.split('/').includes(architecture.hooksDirectory) ||
    /^use[A-Z][A-Za-z0-9]*\.[cm]?[jt]sx?$/u.test(base)
  ) {
    return 'hook';
  }
  return 'unknown';
}

function importEdgeKind(
  sourceOwner: string | undefined,
  targetOwner: string | undefined,
  targetKind: string | undefined,
): Exclude<SrijikaProjectGraphEdgeKind, 'hierarchy' | 'forbidden'> {
  if (sourceOwner === targetOwner) return 'same-owner';
  if (targetKind?.startsWith('shared-')) return 'shared';
  return 'cross-owner';
}

export function buildSrijikaProjectArchitectureGraph(
  input: SrijikaProjectArchitectureGraphInput,
): SrijikaProjectArchitectureGraphModel {
  const files = input.files
    .map((file) => ({
      ...file,
      relativePath: relativeProjectPath(input.projectRoot, file.fileName),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const knownPaths = new Set(files.map(({ relativePath }) => relativePath));
  const owners = new Map<string, OwnerDescriptor>();
  const ownerByFile = new Map<string, OwnerDescriptor>();
  for (const file of files) {
    const ownership = classifySrijikaArchitecturePath(file.relativePath, {
      architecture: input.architecture,
    });
    const owner = ownerDescriptor(ownership, input.architecture);
    if (!owner) continue;
    ownerByFile.set(file.relativePath, owner);
    for (const item of [...ownerAncestors(owner), owner]) owners.set(item.id, item);
  }

  const nodes: SrijikaProjectGraphNode[] = [
    {
      id: 'app',
      kind: 'app',
      label: input.projectName,
      subtitle: `Srijika application · ${input.entry}`,
      imports: [],
      exports: [],
      violationIds: [],
    },
    {
      id: 'group:features',
      kind: 'group',
      label: 'Features',
      subtitle: input.architecture.featuresRoot,
      parentId: 'app',
      imports: [],
      exports: [],
      violationIds: [],
    },
    {
      id: 'group:shared',
      kind: 'group',
      label: 'Shared',
      subtitle: input.architecture.sharedRoot,
      parentId: 'app',
      imports: [],
      exports: [],
      violationIds: [],
    },
  ];
  const edges: SrijikaProjectGraphEdge[] = [
    {
      id: 'hierarchy:app:group:features',
      source: 'app',
      target: 'group:features',
      kind: 'hierarchy',
      label: '',
    },
    {
      id: 'hierarchy:app:group:shared',
      source: 'app',
      target: 'group:shared',
      kind: 'hierarchy',
      label: '',
    },
  ];
  for (const owner of [...owners.values()].sort((left, right) => left.id.localeCompare(right.id))) {
    nodes.push({
      id: owner.id,
      kind: 'owner',
      label: owner.label,
      subtitle: `${owner.kind} · ${owner.relativeFolder}`,
      parentId: owner.parentId,
      ownerId: owner.id,
      ownerKind: owner.kind,
      imports: [],
      exports: [],
      violationIds: [],
    });
    edges.push({
      id: `hierarchy:${owner.parentId}:${owner.id}`,
      source: owner.parentId,
      target: owner.id,
      kind: 'hierarchy',
      label: owner.kind,
    });
  }

  const parsedByPath = new Map<string, ParsedModule>();
  for (const file of files) {
    const parsed = parseModule(file.relativePath, file.source);
    parsedByPath.set(file.relativePath, parsed);
    const owner = ownerByFile.get(file.relativePath);
    const imports = parsed.imports.map((specifier) =>
      resolveWorkspaceImport(file.relativePath, specifier, knownPaths, input.aliases ?? {}),
    );
    nodes.push({
      id: fileNodeId(file.relativePath),
      kind: 'file',
      label: file.relativePath.split('/').at(-1) ?? file.relativePath,
      subtitle: `${inferredCapability(file.relativePath, input.entry, input.architecture)} · ${file.relativePath}`,
      parentId: owner?.id ?? 'app',
      ...(owner ? { ownerId: owner.id, ownerKind: owner.kind } : {}),
      relativePath: file.relativePath,
      capability: inferredCapability(file.relativePath, input.entry, input.architecture),
      imports,
      exports: parsed.exports,
      violationIds: [],
    });
    edges.push({
      id: `hierarchy:${owner?.id ?? 'app'}:${fileNodeId(file.relativePath)}`,
      source: owner?.id ?? 'app',
      target: fileNodeId(file.relativePath),
      kind: 'hierarchy',
      label: inferredCapability(file.relativePath, input.entry, input.architecture),
    });
  }

  const nodeByPath = new Map(
    nodes.flatMap((node) => (node.relativePath ? [[node.relativePath, node] as const] : [])),
  );
  const violationIdsByNode = new Map<string, string[]>();
  const violations: SrijikaProjectGraphViolation[] = input.diagnostics.map((diagnostic, index) => {
    const sourcePath = relativeProjectPath(input.projectRoot, diagnostic.fileName);
    const targetPath = diagnostic.targetFileName
      ? relativeProjectPath(input.projectRoot, diagnostic.targetFileName)
      : undefined;
    const sourceNode = nodeByPath.get(sourcePath);
    const targetNode = targetPath ? nodeByPath.get(targetPath) : undefined;
    const nodeIds = [
      ...(sourceNode ? [sourceNode.id, ...(sourceNode.ownerId ? [sourceNode.ownerId] : [])] : []),
      ...(targetNode ? [targetNode.id, ...(targetNode.ownerId ? [targetNode.ownerId] : [])] : []),
    ];
    const uniqueNodeIds = [...new Set(nodeIds.length > 0 ? nodeIds : ['app'])];
    const id = `diagnostic:${diagnostic.code}:${index}`;
    for (const nodeId of uniqueNodeIds) {
      violationIdsByNode.set(nodeId, [...(violationIdsByNode.get(nodeId) ?? []), id]);
    }
    return {
      id,
      code: diagnostic.code,
      ...(diagnostic.ruleId ? { ruleId: diagnostic.ruleId } : {}),
      severity: diagnostic.severity,
      message: diagnostic.message,
      guidance: diagnostic.guidance,
      nodeIds: uniqueNodeIds,
    };
  });

  const forbiddenPairs = new Set(
    input.diagnostics.flatMap((diagnostic) => {
      if (!diagnostic.targetFileName) return [];
      return [
        `${relativeProjectPath(input.projectRoot, diagnostic.fileName)}\0${relativeProjectPath(input.projectRoot, diagnostic.targetFileName)}`,
      ];
    }),
  );
  for (const sourceNode of nodes) {
    if (!sourceNode.relativePath) continue;
    for (const dependency of sourceNode.imports) {
      if (dependency.kind !== 'workspace' || !dependency.resolvedPath) continue;
      const targetNode = nodeByPath.get(dependency.resolvedPath);
      if (!targetNode) continue;
      const forbidden = forbiddenPairs.has(
        `${sourceNode.relativePath}\0${targetNode.relativePath}`,
      );
      edges.push({
        id: `import:${sourceNode.relativePath}:${dependency.resolvedPath}:${dependency.specifier}`,
        source: sourceNode.id,
        target: targetNode.id,
        kind: forbidden
          ? 'forbidden'
          : importEdgeKind(sourceNode.ownerId, targetNode.ownerId, targetNode.ownerKind),
        label: dependency.specifier,
      });
    }
  }

  const finalizedNodes = nodes.map((node) => ({
    ...node,
    violationIds: Object.freeze(violationIdsByNode.get(node.id) ?? []),
  }));
  const imports = finalizedNodes.flatMap((node) => node.imports);
  return {
    projectName: input.projectName,
    projectRoot: normalizedPath(input.projectRoot),
    entry: input.entry,
    nodes: Object.freeze(finalizedNodes),
    edges: Object.freeze(edges),
    violations: Object.freeze(violations),
    ...(input.adoption ? { adoption: input.adoption } : {}),
    stats: {
      owners: owners.size,
      files: files.length,
      imports: imports.length,
      packages: imports.filter(({ kind }) => kind === 'package').length,
      unresolvedImports: imports.filter(({ kind }) => kind === 'unresolved').length,
      violations: violations.length,
    },
  };
}
