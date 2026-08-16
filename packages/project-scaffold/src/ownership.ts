import {
  canonicalSrijikaOwnerName,
  resolveSrijikaArchitectureConfig,
  srijikaFolderName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_NAME_PATTERN,
  type ResolvedSrijikaArchitectureConfig,
  type SrijikaArchitectureConfig,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';
import ts from 'typescript';

export type SrijikaOptionalOwnerCapability = 'hook' | 'store' | 'logic' | 'api' | 'types';
export type SrijikaOwnerFileRole = 'ui' | 'connector' | SrijikaOptionalOwnerCapability;

export interface SrijikaOwnershipCreationInput {
  owner: SrijikaStructureOwnerContext;
  action: SrijikaStructureCreationAction;
  name?: string;
  optionalCapabilities?: readonly SrijikaOptionalOwnerCapability[];
  existingRelativePaths?: readonly string[];
  existingSources?: Readonly<Record<string, string>>;
  aliases?: Readonly<Record<string, string>>;
  allowCustomConnectorHookInsertion?: boolean;
  architecture?: Partial<SrijikaArchitectureConfig>;
}

export interface SrijikaOwnershipCapabilityBatchInput {
  owner: Exclude<SrijikaStructureOwnerContext, { level: 'featuresRoot' } | { level: 'sharedRoot' }>;
  actions: readonly SrijikaStructureCreationAction[];
  existingRelativePaths: readonly string[];
  existingSources: Readonly<Record<string, string>>;
  aliases?: Readonly<Record<string, string>>;
  architecture?: Partial<SrijikaArchitectureConfig>;
}

export interface SrijikaOwnershipCreationFile {
  relativePath: string;
  source: string;
}

export interface SrijikaOwnershipCreationMove {
  fromRelativePath: string;
  toRelativePath: string;
  source: string;
}

export interface SrijikaOwnershipCreationPlan {
  ownerName: string;
  ownerFolder: string;
  files: readonly SrijikaOwnershipCreationFile[];
  updates: readonly SrijikaOwnershipCreationFile[];
  moves?: readonly SrijikaOwnershipCreationMove[];
}

export interface SrijikaOwnershipFileStatus {
  role: SrijikaOwnerFileRole;
  action?: SrijikaStructureCreationAction;
  relativePath: string;
  exists: boolean;
  required: boolean;
}

export function availableSrijikaOwnershipCreationActions(
  owner: SrijikaStructureOwnerContext,
  existingRelativePaths: readonly string[],
  existingSources: Readonly<Record<string, string>> = {},
  architecture: Partial<SrijikaArchitectureConfig> = {},
): readonly SrijikaStructureCreationAction[] {
  void existingSources;
  const resolvedArchitecture = resolveSrijikaArchitectureConfig(architecture);
  const existing = new Set(
    existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLowerCase()),
  );
  return srijikaStructureCreationActionsForOwner(owner).filter((action) => {
    if (
      action === 'feature' ||
      action === 'slot' ||
      action === 'part' ||
      action === 'sharedUi' ||
      action === 'sharedWidget' ||
      action === 'sharedCapability'
    )
      return true;
    if (owner.level === 'featuresRoot' || owner.level === 'sharedRoot') return false;
    const target = targetForOwner(owner);
    if (isBehaviorHookAction(action)) {
      return ownerGatewayPath(existing, target, 'hook', resolvedArchitecture) !== null;
    }
    if (isStoreSliceAction(action)) {
      return ownerGatewayPath(existing, target, 'store', resolvedArchitecture) !== null;
    }
    const role = ACTION_ROLE[action];
    if (!role) return false;
    const roleExists = (candidate: FileRole): boolean =>
      ownerGatewayPath(existing, target, candidate, resolvedArchitecture) !== null;
    if (roleExists(role)) return false;
    if (target.mode === 'headless') {
      if (role !== 'types') return true;
      return (['hook', 'store', 'logic', 'api'] as const).some(roleExists);
    }
    if (!roleExists('ui')) return false;
    if (target.mode === 'primitive') return role === 'types';
    return role === 'connector' || roleExists('connector');
  });
}

type OwnerLevel = 'feature' | 'slot' | 'part' | 'sharedUi' | 'sharedWidget' | 'sharedCapability';
type FileRole = SrijikaOwnerFileRole;

interface TargetOwner {
  level: OwnerLevel;
  name: string;
  folder: string;
  mode: 'visual' | 'primitive' | 'headless';
}

function targetForOwner(
  owner: Exclude<SrijikaStructureOwnerContext, { level: 'featuresRoot' } | { level: 'sharedRoot' }>,
): TargetOwner {
  return {
    level: owner.level,
    name:
      owner.level === 'feature'
        ? owner.featureName
        : owner.level === 'slot'
          ? owner.slotName
          : owner.level === 'part'
            ? owner.partName
            : owner.sharedName,
    folder: owner.folder,
    mode:
      owner.level === 'sharedUi'
        ? 'primitive'
        : owner.level === 'sharedCapability'
          ? 'headless'
          : 'visual',
  };
}

const ACTION_ROLE: Partial<Record<SrijikaStructureCreationAction, FileRole>> = {
  featureConnector: 'connector',
  featureHook: 'hook',
  featureStore: 'store',
  featureLogic: 'logic',
  featureApi: 'api',
  featureTypes: 'types',
  slotConnector: 'connector',
  slotHook: 'hook',
  slotStore: 'store',
  slotLogic: 'logic',
  slotApi: 'api',
  slotTypes: 'types',
  partConnector: 'connector',
  partHook: 'hook',
  partStore: 'store',
  partLogic: 'logic',
  partApi: 'api',
  partTypes: 'types',
  sharedUiTypes: 'types',
  sharedWidgetConnector: 'connector',
  sharedWidgetHook: 'hook',
  sharedWidgetStore: 'store',
  sharedWidgetLogic: 'logic',
  sharedWidgetApi: 'api',
  sharedWidgetTypes: 'types',
  sharedCapabilityHook: 'hook',
  sharedCapabilityStore: 'store',
  sharedCapabilityLogic: 'logic',
  sharedCapabilityApi: 'api',
  sharedCapabilityTypes: 'types',
};

function isBehaviorHookAction(action: SrijikaStructureCreationAction): boolean {
  return (
    action === 'featureBehaviorHook' ||
    action === 'slotBehaviorHook' ||
    action === 'partBehaviorHook' ||
    action === 'sharedWidgetBehaviorHook' ||
    action === 'sharedCapabilityBehaviorHook'
  );
}

function isStoreSliceAction(action: SrijikaStructureCreationAction): boolean {
  return (
    action === 'featureStoreSlice' ||
    action === 'slotStoreSlice' ||
    action === 'partStoreSlice' ||
    action === 'sharedWidgetStoreSlice' ||
    action === 'sharedCapabilityStoreSlice'
  );
}

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLocaleLowerCase('en-US')}${value.slice(1)}`;
}

function fileNameFor(
  ownerName: string,
  role: FileRole,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  switch (role) {
    case 'ui':
      return `${ownerName}${architecture.uiSuffix}`;
    case 'connector':
      return `${ownerName}${architecture.connectorSuffix}`;
    case 'hook':
      return `use${ownerName}.ts`;
    case 'store':
      return `${lowerFirst(ownerName)}${architecture.storeSuffix}`;
    case 'logic':
      return `${lowerFirst(ownerName)}${architecture.logicSuffix}`;
    case 'api':
      return `${lowerFirst(ownerName)}${architecture.apiSuffix}`;
    case 'types':
      return `${lowerFirst(ownerName)}${architecture.typesSuffix}`;
  }
}

function filePathFor(
  owner: TargetOwner,
  role: FileRole,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  return `${owner.folder}/${fileNameFor(owner.name, role, architecture)}`;
}

function expandedFilePathFor(
  owner: TargetOwner,
  role: 'hook' | 'store',
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  const directory = role === 'hook' ? architecture.hooksDirectory : architecture.storesDirectory;
  return `${owner.folder}/${directory}/${fileNameFor(owner.name, role, architecture)}`;
}

function ownerGatewayPath(
  existing: ReadonlySet<string>,
  owner: TargetOwner,
  role: FileRole,
  architecture: ResolvedSrijikaArchitectureConfig,
): string | null {
  const flat = filePathFor(owner, role, architecture);
  if (existing.has(flat.toLowerCase())) return flat;
  if (role === 'hook' || role === 'store') {
    const expanded = expandedFilePathFor(owner, role, architecture);
    if (existing.has(expanded.toLowerCase())) return expanded;
  }
  return null;
}

function targetForAction(
  owner: SrijikaStructureOwnerContext,
  action: SrijikaStructureCreationAction,
  rawName: string | undefined,
  architecture: ResolvedSrijikaArchitectureConfig,
): TargetOwner {
  if (action === 'feature' || action === 'slot' || action === 'part') {
    const name = rawName?.trim() ?? '';
    if (!SRIJIKA_OWNER_NAME_PATTERN.test(name) || canonicalSrijikaOwnerName(name) !== name) {
      throw new Error('Use normalized PascalCase for the owner name, for example Dashboard.');
    }
    if (action === 'feature' && owner.level === 'featuresRoot') {
      return {
        level: 'feature',
        name,
        folder: `${owner.folder}/${srijikaFolderName(name)}`,
        mode: 'visual',
      };
    }
    if (action === 'slot' && owner.level === 'feature') {
      return {
        level: 'slot',
        name,
        folder: `${owner.folder}/${architecture.slotsDirectory}/${srijikaFolderName(name)}`,
        mode: 'visual',
      };
    }
    if (action === 'part' && owner.level === 'slot') {
      return {
        level: 'part',
        name,
        folder: `${owner.folder}/${architecture.partsDirectory}/${srijikaFolderName(name)}`,
        mode: 'visual',
      };
    }
    throw new Error(`${action} cannot be created inside ${owner.level}.`);
  }

  if (action === 'sharedUi' || action === 'sharedWidget' || action === 'sharedCapability') {
    const name = rawName?.trim() ?? '';
    if (!SRIJIKA_OWNER_NAME_PATTERN.test(name) || canonicalSrijikaOwnerName(name) !== name) {
      throw new Error('Use normalized PascalCase for the shared owner name, for example UserMenu.');
    }
    if (owner.level !== 'sharedRoot') {
      throw new Error(`${action} can be created only inside ${owner.folder}.`);
    }
    const category =
      action === 'sharedUi' ? 'ui' : action === 'sharedWidget' ? 'widgets' : 'capabilities';
    return {
      level: action,
      name,
      folder: `${owner.folder}/${category}/${srijikaFolderName(name)}`,
      mode: action === 'sharedUi' ? 'primitive' : action === 'sharedWidget' ? 'visual' : 'headless',
    };
  }

  if (owner.level === 'featuresRoot' || owner.level === 'sharedRoot') {
    throw new Error(`Choose one of the canonical owner kinds allowed inside ${owner.folder}.`);
  }
  return targetForOwner(owner);
}

export function srijikaOwnershipFileStatuses(
  owner: Exclude<SrijikaStructureOwnerContext, { level: 'featuresRoot' } | { level: 'sharedRoot' }>,
  existingRelativePaths: readonly string[],
  architecture: Partial<SrijikaArchitectureConfig> = {},
): readonly SrijikaOwnershipFileStatus[] {
  const resolvedArchitecture = resolveSrijikaArchitectureConfig(architecture);
  const target = targetForOwner(owner);
  const existing = new Set(
    existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLowerCase()),
  );
  const status = (
    role: FileRole,
    action?: SrijikaStructureCreationAction,
  ): SrijikaOwnershipFileStatus => {
    const existingPath = ownerGatewayPath(existing, target, role, resolvedArchitecture);
    const relativePath = existingPath ?? filePathFor(target, role, resolvedArchitecture);
    return {
      role,
      ...(action ? { action } : {}),
      relativePath,
      exists: existingPath !== null,
      required:
        target.mode === 'visual'
          ? role === 'ui' || role === 'connector'
          : target.mode === 'primitive'
            ? role === 'ui'
            : false,
    };
  };
  const actions = srijikaStructureCreationActionsForOwner(owner).filter(
    (action) =>
      action !== 'slot' &&
      action !== 'part' &&
      !isBehaviorHookAction(action) &&
      !isStoreSliceAction(action) &&
      !(
        target.mode === 'headless' &&
        ACTION_ROLE[action] === 'types' &&
        !(['hook', 'store', 'logic', 'api'] as const).some(
          (role) => ownerGatewayPath(existing, target, role, resolvedArchitecture) !== null,
        )
      ),
  );
  return [
    ...(target.mode === 'headless' ? [] : [status('ui')]),
    ...(target.mode === 'visual' && !actions.some((action) => ACTION_ROLE[action] === 'connector')
      ? [status('connector')]
      : []),
    ...actions.flatMap((action) => {
      const role = ACTION_ROLE[action];
      return role ? [status(role, action)] : [];
    }),
  ];
}

function importPath(
  ownerName: string,
  role: FileRole,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  return `./${fileNameFor(ownerName, role, architecture).replace(/\.(?:ts|tsx)$/, '')}`;
}

function highestJunior(roles: ReadonlySet<FileRole>, from: FileRole): FileRole | null {
  const order: readonly FileRole[] = ['connector', 'hook', 'store', 'logic', 'api'];
  const index = order.indexOf(from);
  return order.slice(index + 1).find((role) => roles.has(role)) ?? null;
}

function sourceFor(
  owner: TargetOwner,
  role: FileRole,
  roles: ReadonlySet<FileRole>,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  const lowerName = lowerFirst(owner.name);
  const junior = highestJunior(roles, role);
  if (role === 'ui') {
    const propsImport =
      owner.mode === 'primitive' && roles.has('types')
        ? `import type { ${owner.name}UIProps } from '${importPath(owner.name, 'types', architecture)}';\n\nexport type { ${owner.name}UIProps } from '${importPath(owner.name, 'types', architecture)}';\n\n`
        : `export interface ${owner.name}UIProps {\n  className?: string;\n}\n\n`;
    return `${propsImport}export function ${owner.name}UI({ className }: ${owner.name}UIProps) {\n  return (\n    <section className={className} data-srijika-owner="${owner.name}">\n      <h2>${owner.name}</h2>\n    </section>\n  );\n}\n`;
  }
  if (role === 'types') {
    if (owner.mode === 'primitive') {
      return `export interface ${owner.name}UIProps {\n  className?: string;\n}\n`;
    }
    return `export interface ${owner.name}Result {\n  ok: boolean;\n}\n`;
  }
  if (role === 'api') {
    const typeImport = roles.has('types')
      ? `import type { ${owner.name}Result } from '${importPath(owner.name, 'types', architecture)}';\n\n`
      : '';
    const resultType = roles.has('types') ? owner.name + 'Result' : '{ ok: boolean }';
    return `${typeImport}export const ${lowerName}Api = {\n  async load(): Promise<${resultType}> {\n    throw new Error('Connect ${owner.name} API transport.');\n  },\n};\n`;
  }
  if (role === 'logic') {
    const juniorImport =
      junior === 'api'
        ? `import { ${lowerName}Api } from '${importPath(owner.name, 'api', architecture)}';\n\n`
        : '';
    const load = junior === 'api' ? `() => ${lowerName}Api.load()` : `async () => ({ ok: true })`;
    return `${juniorImport}export const ${lowerName}Logic = {\n  load: ${load},\n};\n`;
  }
  if (role === 'store') {
    const targetRole = junior === 'logic' ? 'logic' : junior === 'api' ? 'api' : null;
    const symbol = targetRole ? `${lowerName}${targetRole === 'logic' ? 'Logic' : 'Api'}` : null;
    const juniorImport =
      targetRole && symbol
        ? `import { ${symbol} } from '${importPath(owner.name, targetRole, architecture)}';\n`
        : '';
    const load = symbol
      ? `await ${symbol}.load();`
      : `// Add an owner action when state needs one.`;
    return `import { create } from 'zustand';\n${juniorImport}\ninterface ${owner.name}State {\n  ready: boolean;\n  load: () => Promise<void>;\n}\n\nexport const use${owner.name}Store = create<${owner.name}State>((set) => ({\n  ready: false,\n  load: async () => {\n    ${load}\n    set({ ready: true });\n  },\n}));\n`;
  }
  if (role === 'hook') {
    const targetRole =
      junior === 'store' ? 'store' : junior === 'logic' ? 'logic' : junior === 'api' ? 'api' : null;
    if (targetRole === 'store') {
      return `import { use${owner.name}Store } from '${importPath(owner.name, 'store', architecture)}';\n\nexport function use${owner.name}() {\n  return use${owner.name}Store();\n}\n`;
    }
    if (targetRole) {
      const symbol = `${lowerName}${targetRole === 'logic' ? 'Logic' : 'Api'}`;
      return `import { ${symbol} } from '${importPath(owner.name, targetRole, architecture)}';\n\nexport function use${owner.name}() {\n  return { load: ${symbol}.load };\n}\n`;
    }
    return `export function use${owner.name}() {\n  return {};\n}\n`;
  }

  const uiImport = `import { ${owner.name}UI } from '${importPath(owner.name, 'ui', architecture)}';\n`;
  if (junior === 'hook') {
    return `${uiImport}import { use${owner.name} } from '${importPath(owner.name, 'hook', architecture)}';\n\nexport function ${owner.name}Connector() {\n  const model = use${owner.name}();\n  void model;\n  return <${owner.name}UI />;\n}\n`;
  }
  if (junior === 'store') {
    return `${uiImport}import { use${owner.name}Store } from '${importPath(owner.name, 'store', architecture)}';\n\nexport function ${owner.name}Connector() {\n  const model = use${owner.name}Store();\n  void model;\n  return <${owner.name}UI />;\n}\n`;
  }
  if (junior === 'logic' || junior === 'api') {
    const symbol = `${lowerName}${junior === 'logic' ? 'Logic' : 'Api'}`;
    return `${uiImport}import { ${symbol} } from '${importPath(owner.name, junior, architecture)}';\n\nexport function ${owner.name}Connector() {\n  void ${symbol};\n  return <${owner.name}UI />;\n}\n`;
  }
  return `${uiImport}\nexport function ${owner.name}Connector() {\n  return <${owner.name}UI />;\n}\n`;
}

function sourceForLayout(
  owner: TargetOwner,
  role: FileRole,
  roles: ReadonlySet<FileRole>,
  rolePaths: ReadonlyMap<FileRole, string>,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  let source = sourceFor(owner, role, roles, architecture);
  const fromPath = rolePaths.get(role) ?? filePathFor(owner, role, architecture);
  for (const targetRole of ['ui', 'hook', 'store', 'logic', 'api', 'types'] as const) {
    const targetPath = rolePaths.get(targetRole);
    if (!targetPath) continue;
    const oldSpecifier = importPath(owner.name, targetRole, architecture);
    const newSpecifier = relativeModuleSpecifier(fromPath, targetPath);
    source = source
      .replaceAll(`'${oldSpecifier}'`, `'${newSpecifier}'`)
      .replaceAll(`"${oldSpecifier}"`, `"${newSpecifier}"`);
  }
  return source;
}

function safelyPreserveGatewayExports(
  currentSource: string,
  previousCanonicalSource: string,
  nextCanonicalSource: string,
): string | null {
  if (currentSource === previousCanonicalSource) return nextCanonicalSource;
  const previousBody = previousCanonicalSource.trimEnd();
  if (!currentSource.startsWith(previousBody)) return null;
  const suffix = currentSource.slice(previousBody.length);
  if (
    !/^(?:\s*export \{ use[A-Z0-9][A-Za-z0-9]* \} from ['"]\.\/[A-Za-z0-9.]+['"];\s*)+$/.test(
      suffix,
    )
  ) {
    return null;
  }
  return `${nextCanonicalSource.trimEnd()}${suffix}`;
}

function safelyInsertHookIntoCustomConnector(
  owner: TargetOwner,
  currentSource: string,
  architecture: ResolvedSrijikaArchitectureConfig,
): string | null {
  const hookSymbol = `use${owner.name}`;
  const importSource = importPath(owner.name, 'hook', architecture);
  const modelName = `srijika${owner.name}Model`;
  if (currentSource.includes(modelName)) return null;

  let updated = currentSource;
  const hookImportPattern = new RegExp(`from\\s+['"]${importSource.replaceAll('.', '\\.')}['"]`);
  if (!hookImportPattern.test(updated)) {
    const importLine = `import { ${hookSymbol} } from '${importSource}';\n`;
    const directive = updated.match(/^(?:'use client'|"use client");\s*\n/);
    const insertionOffset = directive?.[0].length ?? 0;
    updated = `${updated.slice(0, insertionOffset)}${importLine}${updated.slice(insertionOffset)}`;
  }

  const connectorPattern = new RegExp(
    `(export\\s+function\\s+${owner.name}Connector\\s*\\([^)]*\\)\\s*(?::\\s*[^\\{]+)?\\s*\\{)`,
  );
  if (!connectorPattern.test(updated)) return null;
  return updated.replace(
    connectorPattern,
    `$1\n  const ${modelName} = ${hookSymbol}();\n  void ${modelName};`,
  );
}

function relativeModuleSpecifier(
  fromRelativePath: string,
  toRelativePath: string,
  preserveExtension = false,
): string {
  const from = fromRelativePath.split('/');
  const to = toRelativePath.split('/');
  from.pop();
  to.pop();
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  const up = Array.from({ length: from.length - shared }, () => '..');
  const targetFileName = toRelativePath.split('/').at(-1) ?? '';
  const targetFile = preserveExtension
    ? targetFileName
    : targetFileName.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i, '');
  const down = [...to.slice(shared), targetFile];
  const output = [...up, ...down].join('/');
  return output.startsWith('.') ? output : `./${output}`;
}

function rewriteStaticModuleSpecifiers(
  source: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0) return source;
  const sourceFile = ts.createSourceFile(
    'srijika-migration.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const record = (node: ts.StringLiteralLike): void => {
    const replacement = replacements.get(node.text);
    if (replacement === undefined || replacement === node.text) return;
    edits.push({
      start: node.getStart(sourceFile) + 1,
      end: node.getEnd() - 1,
      replacement,
    });
  };
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      record(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) record(argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (output, edit) =>
        `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`,
      source,
    );
}

function rewriteImportTarget(
  source: string,
  oldSourcePath: string,
  newSourcePath: string,
  oldTargetPath: string,
  newTargetPath: string,
  architecture: ResolvedSrijikaArchitectureConfig,
  aliases: Readonly<Record<string, string>>,
): string {
  const oldSpecifier = relativeModuleSpecifier(oldSourcePath, oldTargetPath);
  const newSpecifier = relativeModuleSpecifier(newSourcePath, newTargetPath);
  const withoutSourceExtension = (value: string): string =>
    value.replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i, '');
  const aliasSpecifiers = (value: string): Readonly<Record<string, string>> => {
    const normalized = withoutSourceExtension(value.replaceAll('\\', '/'));
    return {
      direct: normalized,
      ...(normalized.startsWith('src/') ? { source: `@/${normalized.slice('src/'.length)}` } : {}),
      ...(normalized.startsWith(`${architecture.featuresRoot}/`)
        ? { features: `@features/${normalized.slice(architecture.featuresRoot.length + 1)}` }
        : {}),
      ...(normalized.startsWith(`${architecture.sharedRoot}/`)
        ? { shared: `@shared/${normalized.slice(architecture.sharedRoot.length + 1)}` }
        : {}),
    };
  };
  const oldSpecifiers = { relative: oldSpecifier, ...aliasSpecifiers(oldTargetPath) };
  const newSpecifiers = { relative: newSpecifier, ...aliasSpecifiers(newTargetPath) };
  const replacements = new Map<string, string>();
  for (const [kind, previous] of Object.entries(oldSpecifiers)) {
    const next = newSpecifiers[kind as keyof typeof newSpecifiers];
    if (previous && next) replacements.set(previous, next);
  }
  replacements.set(
    relativeModuleSpecifier(oldSourcePath, oldTargetPath, true),
    relativeModuleSpecifier(newSourcePath, newTargetPath, true),
  );

  const normalizedOld = oldTargetPath.replaceAll('\\', '/');
  const normalizedNew = newTargetPath.replaceAll('\\', '/');
  const oldWithoutExtension = withoutSourceExtension(normalizedOld);
  const newWithoutExtension = withoutSourceExtension(normalizedNew);
  const explicitExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
  for (const extension of explicitExtensions) {
    const oldVariant = `${oldWithoutExtension}${extension}`;
    const newVariant = `${newWithoutExtension}${extension}`;
    replacements.set(oldVariant, newVariant);
    replacements.set(
      relativeModuleSpecifier(oldSourcePath, oldVariant, true),
      relativeModuleSpecifier(newSourcePath, newVariant, true),
    );
    if (oldVariant.startsWith('src/') && newVariant.startsWith('src/')) {
      replacements.set(`@/${oldVariant.slice(4)}`, `@/${newVariant.slice(4)}`);
    }
    if (
      oldVariant.startsWith(`${architecture.featuresRoot}/`) &&
      newVariant.startsWith(`${architecture.featuresRoot}/`)
    ) {
      replacements.set(
        `@features/${oldVariant.slice(architecture.featuresRoot.length + 1)}`,
        `@features/${newVariant.slice(architecture.featuresRoot.length + 1)}`,
      );
    }
    if (
      oldVariant.startsWith(`${architecture.sharedRoot}/`) &&
      newVariant.startsWith(`${architecture.sharedRoot}/`)
    ) {
      replacements.set(
        `@shared/${oldVariant.slice(architecture.sharedRoot.length + 1)}`,
        `@shared/${newVariant.slice(architecture.sharedRoot.length + 1)}`,
      );
    }
  }
  for (const [prefix, rawTarget] of Object.entries(aliases)) {
    const target = rawTarget.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
    const targetWithoutExtension = withoutSourceExtension(target);
    if (prefix.endsWith('/')) {
      const aliasVariants: Array<readonly [string, string, string, boolean]> = [
        [oldWithoutExtension, newWithoutExtension, targetWithoutExtension, false],
        ...explicitExtensions.map(
          (extension) =>
            [
              `${oldWithoutExtension}${extension}`,
              `${newWithoutExtension}${extension}`,
              targetWithoutExtension,
              true,
            ] as const,
        ),
      ];
      for (const [previousPath, nextPath, targetPath, preserveExtension] of aliasVariants) {
        const previousRest = targetPath
          ? previousPath.startsWith(`${targetPath}/`)
            ? previousPath.slice(targetPath.length + 1)
            : null
          : previousPath;
        if (previousRest === null) continue;
        const nextRest = targetPath
          ? nextPath.startsWith(`${targetPath}/`)
            ? nextPath.slice(targetPath.length + 1)
            : null
          : nextPath;
        const previous = `${prefix}${previousRest}`;
        const next =
          nextRest === null
            ? relativeModuleSpecifier(oldSourcePath, nextPath, preserveExtension)
            : `${prefix}${nextRest}`;
        replacements.set(previous, next);
      }
    } else if (oldWithoutExtension === targetWithoutExtension || normalizedOld === target) {
      replacements.set(prefix, newSpecifier);
    }
  }

  return rewriteStaticModuleSpecifiers(source, replacements);
}

function relocateOwnerGatewayImports(
  source: string,
  owner: TargetOwner,
  oldGatewayPath: string,
  newGatewayPath: string,
  existing: ReadonlySet<string>,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  let output = source;
  for (const role of ['store', 'logic', 'api', 'types'] as const) {
    const target = ownerGatewayPath(existing, owner, role, architecture);
    if (!target) continue;
    output = rewriteImportTarget(
      output,
      oldGatewayPath,
      newGatewayPath,
      target,
      target,
      architecture,
      {},
    );
  }
  return output;
}

function canonicalBehaviorName(rawName: string | undefined): string {
  const name = rawName?.trim() ?? '';
  if (!SRIJIKA_OWNER_NAME_PATTERN.test(name) || canonicalSrijikaOwnerName(name) !== name) {
    throw new Error('Use normalized PascalCase for the behavior name, for example Search.');
  }
  return name;
}

function helperHookSource(ownerName: string, behaviorName: string): string {
  return `export function use${ownerName}${behaviorName}() {\n  // Keep ${ownerName} ${behaviorName} React behavior here.\n  return {};\n}\n`;
}

function helperStoreSource(ownerName: string, concernName: string): string {
  return `import { create } from 'zustand';\n\ninterface ${ownerName}${concernName}State {\n  ready: boolean;\n  setReady: (ready: boolean) => void;\n}\n\nexport const use${ownerName}${concernName}Store = create<${ownerName}${concernName}State>((set) => ({\n  ready: false,\n  setReady: (ready) => set({ ready }),\n}));\n`;
}

function appendGatewayExport(source: string, symbol: string, specifier: string): string {
  const exportLine = `export { ${symbol} } from '${specifier}';`;
  if (source.includes(exportLine)) return source;
  return `${source.replace(/\s*$/, '')}\n\n${exportLine}\n`;
}

function buildExpandedOwnerCapabilityPlan(
  input: SrijikaOwnershipCreationInput,
  target: TargetOwner,
  existing: ReadonlySet<string>,
  existingSources: ReadonlyMap<string, string>,
  architecture: ResolvedSrijikaArchitectureConfig,
): SrijikaOwnershipCreationPlan {
  const behaviorName = canonicalBehaviorName(input.name);
  const role: 'hook' | 'store' = isBehaviorHookAction(input.action) ? 'hook' : 'store';
  const flatGateway = filePathFor(target, role, architecture);
  const expandedGateway = expandedFilePathFor(target, role, architecture);
  const hasFlatGateway = existing.has(flatGateway.toLowerCase());
  const hasExpandedGateway = existing.has(expandedGateway.toLowerCase());
  if (hasFlatGateway && hasExpandedGateway) {
    throw new Error(
      `${target.name} mixes flat and folder ${role} gateways. Keep exactly one canonical gateway.`,
    );
  }
  if (!hasFlatGateway && !hasExpandedGateway) {
    throw new Error(
      `Create the canonical ${fileNameFor(target.name, role, architecture)} gateway before adding a private ${role}.`,
    );
  }
  if (hasFlatGateway) {
    const withoutSourceExtension = (value: string): string =>
      value
        .replaceAll('\\', '/')
        .replace(/^\.\//, '')
        .replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i, '');
    const flatTarget = withoutSourceExtension(flatGateway);
    const exactAlias = Object.entries(input.aliases ?? {}).find(
      ([prefix, target]) => !prefix.endsWith('/') && withoutSourceExtension(target) === flatTarget,
    );
    if (exactAlias) {
      throw new Error(
        `Cannot expand ${flatGateway} while exact tsconfig alias ${exactAlias[0]} points to it. Change that alias to a terminal-wildcard owner alias before moving the gateway.`,
      );
    }
  }
  const helperFileName =
    role === 'hook'
      ? `use${target.name}${behaviorName}.ts`
      : `${lowerFirst(target.name)}${behaviorName}${architecture.storeSuffix}`;
  const helperDirectory =
    role === 'hook' ? architecture.hooksDirectory : architecture.storesDirectory;
  const helperPath = `${target.folder}/${helperDirectory}/${helperFileName}`;
  if (existing.has(helperPath.toLowerCase())) throw new Error(`${helperPath} already exists.`);

  const oldGatewayPath = hasFlatGateway ? flatGateway : expandedGateway;
  const currentGatewaySource = existingSources.get(oldGatewayPath.toLowerCase());
  if (currentGatewaySource === undefined) {
    throw new Error(`Read ${oldGatewayPath} before expanding its ${role} boundary.`);
  }
  const helperSymbol =
    role === 'hook' ? `use${target.name}${behaviorName}` : `use${target.name}${behaviorName}Store`;
  const relocatedGateway = hasFlatGateway
    ? relocateOwnerGatewayImports(
        currentGatewaySource,
        target,
        oldGatewayPath,
        expandedGateway,
        existing,
        architecture,
      )
    : currentGatewaySource;
  const nextGatewaySource = appendGatewayExport(
    relocatedGateway,
    helperSymbol,
    `./${helperFileName.replace(/\.ts$/, '')}`,
  );

  const files: SrijikaOwnershipCreationFile[] = [
    {
      relativePath: helperPath,
      source:
        role === 'hook'
          ? helperHookSource(target.name, behaviorName)
          : helperStoreSource(target.name, behaviorName),
    },
  ];
  const moves: SrijikaOwnershipCreationMove[] = hasFlatGateway
    ? [
        {
          fromRelativePath: flatGateway,
          toRelativePath: expandedGateway,
          source: nextGatewaySource,
        },
      ]
    : [];
  const updates: SrijikaOwnershipCreationFile[] = hasExpandedGateway
    ? [{ relativePath: expandedGateway, source: nextGatewaySource }]
    : [];

  if (hasFlatGateway) {
    for (const [relativePathKey, source] of existingSources) {
      const relativePath = [...(input.existingRelativePaths ?? [])].find(
        (candidate) => candidate.toLowerCase() === relativePathKey,
      );
      if (!relativePath || relativePath.toLowerCase() === flatGateway.toLowerCase()) continue;
      const nextSource = rewriteImportTarget(
        source,
        relativePath,
        relativePath,
        flatGateway,
        expandedGateway,
        architecture,
        input.aliases ?? {},
      );
      if (nextSource !== source) updates.push({ relativePath, source: nextSource });
    }
  }

  return {
    ownerName: target.name,
    ownerFolder: target.folder,
    files,
    updates,
    moves,
  };
}

export function buildSrijikaOwnershipCreationPlan(
  input: SrijikaOwnershipCreationInput,
): SrijikaOwnershipCreationPlan {
  const architecture = resolveSrijikaArchitectureConfig(input.architecture);
  const allowed = srijikaStructureCreationActionsForOwner(input.owner);
  if (!allowed.includes(input.action)) {
    throw new Error(`${input.action} is not allowed inside ${input.owner.folder}.`);
  }

  const target = targetForAction(input.owner, input.action, input.name, architecture);
  const existing = new Set(
    (input.existingRelativePaths ?? []).map((path) => path.replaceAll('\\', '/').toLowerCase()),
  );
  const existingSources = new Map(
    Object.entries(input.existingSources ?? {}).map(([path, source]) => [
      path.replaceAll('\\', '/').toLowerCase(),
      source.replaceAll('\r\n', '\n'),
    ]),
  );
  if (isBehaviorHookAction(input.action) || isStoreSliceAction(input.action)) {
    return buildExpandedOwnerCapabilityPlan(input, target, existing, existingSources, architecture);
  }
  const composite =
    input.action === 'feature' ||
    input.action === 'slot' ||
    input.action === 'part' ||
    input.action === 'sharedUi' ||
    input.action === 'sharedWidget' ||
    input.action === 'sharedCapability';
  const plannedRoles = new Set<FileRole>();
  if (composite) {
    if (target.mode !== 'headless') plannedRoles.add('ui');
    if (target.mode === 'visual') plannedRoles.add('connector');
    for (const role of input.optionalCapabilities ?? []) plannedRoles.add(role);
    if (
      target.mode === 'primitive' &&
      [...plannedRoles].some((role) => role !== 'ui' && role !== 'types')
    ) {
      throw new Error('A shared UI primitive accepts only the optional Types contract.');
    }
    if (
      target.mode === 'headless' &&
      !(['hook', 'store', 'logic', 'api'] as const).some((role) => plannedRoles.has(role))
    ) {
      throw new Error(
        'A shared headless capability requires at least one runtime layer: hook, store, logic, or api.',
      );
    }
  } else {
    const role = ACTION_ROLE[input.action];
    if (!role) throw new Error(`Unsupported creation action: ${input.action}`);
    plannedRoles.add(role);
  }

  const roleExists = (role: FileRole): boolean =>
    ownerGatewayPath(existing, target, role, architecture) !== null;
  if (!composite) {
    if (target.mode !== 'headless' && !roleExists('ui')) {
      throw new Error(
        `Required ${filePathFor(target, 'ui', architecture)} is missing. Create the owner first.`,
      );
    }
    if (target.mode === 'visual' && !plannedRoles.has('connector') && !roleExists('connector')) {
      throw new Error(
        `Required ${filePathFor(target, 'connector', architecture)} is missing. Add the Connector before optional capabilities.`,
      );
    }
    if (
      target.mode === 'headless' &&
      plannedRoles.has('types') &&
      !(['hook', 'store', 'logic', 'api'] as const).some((role) => roleExists(role))
    ) {
      throw new Error(
        'Create at least one runtime Hook, Store, Logic, or API before adding Types to a shared headless capability.',
      );
    }
  }

  const availableRoles = new Set<FileRole>(plannedRoles);
  for (const role of ['ui', 'connector', 'hook', 'store', 'logic', 'api', 'types'] as const) {
    if (roleExists(role)) availableRoles.add(role);
  }
  const rolePaths = new Map<FileRole, string>();
  for (const role of availableRoles) {
    rolePaths.set(
      role,
      ownerGatewayPath(existing, target, role, architecture) ??
        filePathFor(target, role, architecture),
    );
  }

  const orderedRoles = (
    ['ui', 'types', 'api', 'logic', 'store', 'hook', 'connector'] as const
  ).filter((role) => plannedRoles.has(role));
  if (!composite) {
    const requestedRole = ACTION_ROLE[input.action];
    if (requestedRole && roleExists(requestedRole)) {
      throw new Error(
        `${ownerGatewayPath(existing, target, requestedRole, architecture) ?? filePathFor(target, requestedRole, architecture)} already exists.`,
      );
    }
  }
  const duplicate = orderedRoles
    .map((role) => filePathFor(target, role, architecture))
    .find((path) => existing.has(path.toLowerCase()));
  if (duplicate) throw new Error(`${duplicate} already exists.`);

  const updates: SrijikaOwnershipCreationFile[] = [];
  if (!composite) {
    const newRole = ACTION_ROLE[input.action];
    const runtimeOrder: readonly FileRole[] = ['connector', 'hook', 'store', 'logic', 'api'];
    let seniorRole: FileRole | undefined;
    if (newRole === 'types') {
      if (target.mode === 'primitive' && roleExists('ui')) seniorRole = 'ui';
      else if (roleExists('api')) seniorRole = 'api';
    } else if (newRole) {
      const newRoleIndex = runtimeOrder.indexOf(newRole);
      if (newRoleIndex > 0) {
        seniorRole = [...runtimeOrder.slice(0, newRoleIndex)]
          .reverse()
          .find((role) => roleExists(role));
      }
    }

    if (seniorRole) {
      const previousRoles = new Set(availableRoles);
      if (newRole) previousRoles.delete(newRole);
      const previousCanonicalSource = sourceForLayout(
        target,
        seniorRole,
        previousRoles,
        rolePaths,
        architecture,
      ).replaceAll('\r\n', '\n');
      const nextCanonicalSource = sourceForLayout(
        target,
        seniorRole,
        availableRoles,
        rolePaths,
        architecture,
      );
      if (previousCanonicalSource !== nextCanonicalSource) {
        const seniorPath = ownerGatewayPath(existing, target, seniorRole, architecture);
        if (!seniorPath) throw new Error(`Missing ${seniorRole} boundary for ${target.name}.`);
        const currentSource = existingSources.get(seniorPath.toLowerCase());
        if (currentSource === undefined) {
          throw new Error(
            `Read ${seniorPath} before adding this capability so Srijika can preserve the strict runtime chain.`,
          );
        }
        const preservedGatewaySource = safelyPreserveGatewayExports(
          currentSource,
          previousCanonicalSource,
          nextCanonicalSource,
        );
        let keepCustomSeniorSource = false;
        if (
          currentSource !== previousCanonicalSource &&
          currentSource !== nextCanonicalSource &&
          preservedGatewaySource === null
        ) {
          const customConnectorUpdate =
            input.allowCustomConnectorHookInsertion &&
            seniorRole === 'connector' &&
            newRole === 'hook'
              ? safelyInsertHookIntoCustomConnector(target, currentSource, architecture)
              : null;
          if (customConnectorUpdate) {
            updates.push({ relativePath: seniorPath, source: customConnectorUpdate });
            return {
              ownerName: target.name,
              ownerFolder: target.folder,
              files: orderedRoles.map((role) => ({
                relativePath: filePathFor(target, role, architecture),
                source: sourceFor(target, role, availableRoles, architecture),
              })),
              updates,
              moves: [],
            };
          }
          if (seniorRole === 'connector') {
            throw new Error(
              `${seniorPath} contains custom code. Srijika could not safely insert the new boundary; connect it in one reviewed edit.`,
            );
          }
          if (seniorRole === 'ui' && target.mode === 'primitive') {
            throw new Error(
              `${seniorPath} contains custom code. Srijika could not safely move its inline props contract into Types; connect the Types contract in one reviewed edit.`,
            );
          }
          // A custom Hook, Store, Logic, or API may legitimately have no need to call a newly
          // created lower boundary yet. Preserve its behavior byte-for-byte. If it later calls a
          // lower capability, the architecture validator still enforces the no-jump chain.
          keepCustomSeniorSource = true;
        }
        if (!keepCustomSeniorSource && currentSource !== nextCanonicalSource) {
          updates.push({
            relativePath: seniorPath,
            source: preservedGatewaySource ?? nextCanonicalSource,
          });
        }
      }
    }
  }

  return {
    ownerName: target.name,
    ownerFolder: target.folder,
    files: orderedRoles.map((role) => ({
      relativePath: filePathFor(target, role, architecture),
      source: sourceForLayout(target, role, availableRoles, rolePaths, architecture),
    })),
    updates,
    moves: [],
  };
}

export function buildSrijikaOwnershipCapabilityBatchPlan(
  input: SrijikaOwnershipCapabilityBatchInput,
): SrijikaOwnershipCreationPlan {
  const actionOrder: readonly FileRole[] = ['connector', 'hook', 'store', 'logic', 'api', 'types'];
  const allowed = new Set(srijikaStructureCreationActionsForOwner(input.owner));
  const actions = [...new Set(input.actions)].sort((left, right) => {
    const leftRole = ACTION_ROLE[left];
    const rightRole = ACTION_ROLE[right];
    return actionOrder.indexOf(leftRole ?? 'ui') - actionOrder.indexOf(rightRole ?? 'ui');
  });
  if (actions.length === 0) throw new Error('Select at least one missing owner file to create.');
  for (const action of actions) {
    if (!allowed.has(action) || !ACTION_ROLE[action]) {
      throw new Error(`${action} is not an owner-file action for ${input.owner.folder}.`);
    }
  }

  const paths = [...input.existingRelativePaths];
  const sources: Record<string, string> = { ...input.existingSources };
  const created = new Map<string, SrijikaOwnershipCreationFile>();
  const updates = new Map<string, SrijikaOwnershipCreationFile>();
  const moves = new Map<string, SrijikaOwnershipCreationMove>();

  for (const action of actions) {
    const step = buildSrijikaOwnershipCreationPlan({
      owner: input.owner,
      action,
      existingRelativePaths: paths,
      existingSources: sources,
      allowCustomConnectorHookInsertion: true,
      ...(input.aliases ? { aliases: input.aliases } : {}),
      ...(input.architecture ? { architecture: input.architecture } : {}),
    });
    for (const file of step.files) {
      const key = file.relativePath.toLowerCase();
      paths.push(file.relativePath);
      sources[file.relativePath] = file.source;
      created.set(key, file);
    }
    for (const update of step.updates) {
      const key = update.relativePath.toLowerCase();
      sources[update.relativePath] = update.source;
      const createdFile = created.get(key);
      if (createdFile) {
        created.set(key, { ...createdFile, source: update.source });
      } else {
        updates.set(key, update);
      }
    }
    for (const move of step.moves ?? []) {
      const pathIndex = paths.findIndex(
        (path) => path.toLowerCase() === move.fromRelativePath.toLowerCase(),
      );
      if (pathIndex >= 0) paths.splice(pathIndex, 1, move.toRelativePath);
      delete sources[move.fromRelativePath];
      sources[move.toRelativePath] = move.source;
      moves.set(move.fromRelativePath.toLowerCase(), move);
    }
  }

  const target = targetForOwner(input.owner);
  return {
    ownerName: target.name,
    ownerFolder: target.folder,
    files: [...created.values()],
    updates: [...updates.values()],
    moves: [...moves.values()],
  };
}
