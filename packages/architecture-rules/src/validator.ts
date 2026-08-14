import ts from 'typescript';

import { resolveSrijikaArchitectureConfig } from './config';
import type {
  ResolvedSrijikaArchitectureConfig,
  SrijikaArchitectureCapability,
  SrijikaArchitectureDiagnostic,
  SrijikaArchitectureDiagnosticCode,
  SrijikaArchitectureOwnership,
  SrijikaArchitectureRecommendation,
  SrijikaArchitectureRuleId,
  SrijikaArchitectureScopeKind,
  SrijikaArchitectureSourceFile,
  SrijikaArchitectureSourceSpan,
  SrijikaArchitectureValidationResult,
  ValidateSrijikaArchitectureOptions,
} from './types';

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'] as const;

const runtimeCapabilityRank: Readonly<
  Record<Exclude<SrijikaArchitectureCapability, 'types'>, number>
> = {
  connector: 0,
  hook: 1,
  store: 2,
  logic: 3,
  api: 4,
};

function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `${normalized.slice(0, 1).toLowerCase()}${normalized.slice(1)}`;
  }
  return normalized;
}

function posixSegments(value: string): readonly string[] {
  return normalizePath(value).split('/');
}

function posixJoin(...values: readonly string[]): string {
  const joined = values.filter(Boolean).join('/');
  const absolute = joined.startsWith('/');
  const drive = /^[A-Za-z]:\//.exec(joined)?.[0]?.slice(0, 2);
  const output: string[] = [];
  for (const segment of posixSegments(joined)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (output.length > 0 && output.at(-1) !== '..' && output.at(-1) !== drive) output.pop();
      else if (!absolute) output.push(segment);
      continue;
    }
    output.push(segment);
  }
  const body = output.join('/');
  return normalizePath(`${absolute ? '/' : ''}${body}`);
}

function posixDirname(value: string): string {
  const normalized = normalizePath(value).replace(/\/$/, '');
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return '.';
  if (slash === 0) return '/';
  return normalized.slice(0, slash);
}

function posixBasename(value: string): string {
  const normalized = normalizePath(value).replace(/\/$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function normalizedJoin(...segments: readonly string[]): string {
  return posixJoin(...segments);
}

function stripSourceExtension(value: string): string {
  for (const extension of sourceExtensions) {
    if (value.endsWith(extension)) return value.slice(0, -extension.length);
  }
  return value;
}

function normalizedName(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function words(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function pascalName(value: string): string {
  return words(value)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join('');
}

function camelName(value: string): string {
  const pascal = pascalName(value);
  return `${pascal.slice(0, 1).toLowerCase()}${pascal.slice(1)}`;
}

function ownershipName(ownership: SrijikaArchitectureOwnership): string | null {
  if (ownership.kind === 'feature') return ownership.feature ?? null;
  if (ownership.kind === 'slot') return ownership.slot ?? null;
  if (ownership.kind === 'part') return ownership.part ?? null;
  return null;
}

function ownerRelativePath(ownership: SrijikaArchitectureOwnership): string | null {
  if (ownership.kind === 'feature') return ownership.relativeToFeature ?? null;
  if (ownership.kind === 'slot') return ownership.relativeToSlot ?? null;
  if (ownership.kind === 'part') return ownership.relativeToPart ?? null;
  return null;
}

function fileAnchor(sourceFile: ts.SourceFile): SrijikaArchitectureSourceSpan {
  const first = sourceFile.statements[0];
  if (!first) return { start: 0, end: 0, line: 1, column: 1 };
  const start = first.getStart(sourceFile);
  const end = first.getFirstToken(sourceFile)?.getEnd() ?? start;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return { start, end, line: line + 1, column: character + 1 };
}

function isOwnerUiEntry(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null || relative.includes('/')) return false;
  if (ownership.kind !== 'part' && relative.length === 0) return false;
  const expected = `${pascalName(owner)}${architecture.uiSuffix}`;
  return baseName(ownership.fileName) === expected;
}

function isOwnerConnectorEntry(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null || relative.includes('/')) return false;
  if (ownership.kind !== 'part' && relative.length === 0) return false;
  return baseName(ownership.fileName) === `${pascalName(owner)}${architecture.connectorSuffix}`;
}

function structureDiagnosticsForFile(
  file: SrijikaArchitectureSourceFile,
  sourceFile: ts.SourceFile,
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): readonly SrijikaArchitectureDiagnostic[] {
  if (ownership.kind === 'outside') return [];
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null) return [];
  const fileName = baseName(file.fileName);
  const anchor = fileAnchor(sourceFile);
  const output: SrijikaArchitectureDiagnostic[] = [];

  if (fileName.endsWith('.store.tsx')) {
    output.push(
      diagnostic(
        'SRIJIKA4105',
        file.fileName,
        anchor,
        `Store files do not render JSX: ${fileName} must use the .store.ts suffix.`,
        `Rename this file to ${camelName(owner)}${architecture.storeSuffix}.`,
      ),
    );
  } else if (fileName.endsWith(architecture.storeSuffix)) {
    const expected = `${camelName(owner)}${architecture.storeSuffix}`;
    if (relative.includes('/') || fileName !== expected) {
      output.push(
        diagnostic(
          'SRIJIKA4105',
          file.fileName,
          anchor,
          `The ${owner} owner store must be located at its scope root and named ${expected}.`,
          `Move or rename this store to the ${ownership.kind} root as ${expected}.`,
        ),
      );
    }
  }

  for (const [capability, suffix] of [
    ['logic', architecture.logicSuffix],
    ['api', architecture.apiSuffix],
    ['types', architecture.typesSuffix],
  ] as const) {
    if (!fileName.endsWith(suffix)) continue;
    const expected = `${camelName(owner)}${suffix}`;
    if (relative.includes('/') || fileName !== expected) {
      output.push(
        diagnostic(
          'SRIJIKA4105',
          file.fileName,
          anchor,
          `The ${owner} owner ${capability} module must be located at its scope root and named ${expected}.`,
          `Move or rename this module to the ${ownership.kind} root as ${expected}.`,
        ),
      );
    }
  }

  const relativeSegments = relative.split('/');
  const insideHooksDirectory = relativeSegments[0] === architecture.hooksDirectory;
  const canonicalGatewayHook = !relative.includes('/') && fileName === `use${pascalName(owner)}.ts`;
  const isHook =
    canonicalGatewayHook || insideHooksDirectory || /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(fileName);
  if (isHook) {
    const expectedPrefix = `use${pascalName(owner)}`;
    if (
      !canonicalGatewayHook &&
      (!insideHooksDirectory || !fileName.startsWith(expectedPrefix) || !fileName.endsWith('.ts'))
    ) {
      output.push(
        diagnostic(
          'SRIJIKA4107',
          file.fileName,
          anchor,
          `The ${owner} hook must be the canonical ${expectedPrefix}.ts gateway at the owner root or a .ts helper in its ${architecture.hooksDirectory}/ directory starting with ${expectedPrefix}.`,
          `Use ${expectedPrefix}.ts for the public owner gateway, or move and rename a private helper to ${architecture.hooksDirectory}/${expectedPrefix}<Behavior>.ts.`,
        ),
      );
    }
  }

  const architectureFile =
    fileName.endsWith(architecture.uiSuffix) ||
    fileName.endsWith(architecture.connectorSuffix) ||
    fileName.endsWith(architecture.storeSuffix) ||
    fileName.endsWith(architecture.logicSuffix) ||
    fileName.endsWith(architecture.apiSuffix) ||
    fileName.endsWith(architecture.typesSuffix);
  if (architectureFile && !relative.includes('/')) {
    const expectedUi = `${pascalName(owner)}${architecture.uiSuffix}`;
    const expectedConnector = `${pascalName(owner)}${architecture.connectorSuffix}`;
    const expectedStore = `${camelName(owner)}${architecture.storeSuffix}`;
    const expectedLogic = `${camelName(owner)}${architecture.logicSuffix}`;
    const expectedApi = `${camelName(owner)}${architecture.apiSuffix}`;
    const expectedTypes = `${camelName(owner)}${architecture.typesSuffix}`;
    if (
      ![
        expectedUi,
        expectedConnector,
        expectedStore,
        expectedLogic,
        expectedApi,
        expectedTypes,
      ].includes(fileName)
    ) {
      const destination =
        ownership.kind === 'feature'
          ? `${architecture.slotsDirectory}/<slot>/`
          : `${architecture.partsDirectory}/<part>/`;
      output.push(
        diagnostic(
          'SRIJIKA4108',
          file.fileName,
          anchor,
          `${fileName} is an additional UI unit at the ${owner} ${ownership.kind} root.`,
          `Keep only canonical owner files (${expectedUi}, ${expectedConnector}, ${expectedStore}, ${expectedLogic}, ${expectedApi}, and ${expectedTypes}) at this root. Move additional visual units into ${destination}.`,
        ),
      );
    }
  }

  return output;
}

function spanForNode(sourceFile: ts.SourceFile, node: ts.Node): SrijikaArchitectureSourceSpan {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return { start, end, line: line + 1, column: character + 1 };
}

function moduleSpecifierSpan(
  sourceFile: ts.SourceFile,
  node: ts.StringLiteralLike,
): SrijikaArchitectureSourceSpan {
  const start = node.getStart(sourceFile) + 1;
  const end = Math.max(start, node.getEnd() - 1);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return { start, end, line: line + 1, column: character + 1 };
}

function pathSegments(value: string): readonly string[] {
  return normalizePath(value).split('/').filter(Boolean);
}

export function classifySrijikaArchitecturePath(
  fileName: string,
  options: ValidateSrijikaArchitectureOptions = {},
): SrijikaArchitectureOwnership {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const normalized = normalizePath(fileName);
  const segments = pathSegments(normalized);
  const rootSegments = pathSegments(architecture.featuresRoot);
  let rootIndex = -1;
  for (let index = 0; index <= segments.length - rootSegments.length; index += 1) {
    if (rootSegments.every((segment, offset) => segments[index + offset] === segment)) {
      rootIndex = index;
    }
  }
  if (rootIndex < 0) return { kind: 'outside', fileName: normalized };

  const featureIndex = rootIndex + rootSegments.length;
  const feature = segments[featureIndex];
  if (!feature) return { kind: 'outside', fileName: normalized };
  const relativeSegments = segments.slice(featureIndex + 1);
  const relativeToFeature = relativeSegments.join('/');
  const slotsIndex = relativeSegments.indexOf(architecture.slotsDirectory);
  if (slotsIndex < 0 || !relativeSegments[slotsIndex + 1]) {
    return { kind: 'feature', fileName: normalized, feature, relativeToFeature };
  }

  const slot = relativeSegments[slotsIndex + 1]!;
  const withinSlot = relativeSegments.slice(slotsIndex + 2);
  const relativeToSlot = withinSlot.join('/');
  const partsIndex = withinSlot.indexOf(architecture.partsDirectory);
  if (partsIndex < 0 || !withinSlot[partsIndex + 1]) {
    return {
      kind: 'slot',
      fileName: normalized,
      feature,
      slot,
      relativeToFeature,
      relativeToSlot,
    };
  }

  const partCandidate = withinSlot[partsIndex + 1]!;
  const part = sourceExtensions.some((extension) => partCandidate.endsWith(extension))
    ? stripSourceExtension(partCandidate).split('.')[0]!
    : partCandidate;
  return {
    kind: 'part',
    fileName: normalized,
    feature,
    slot,
    part,
    relativeToFeature,
    relativeToSlot,
    relativeToPart: withinSlot.slice(partsIndex + 2).join('/'),
  };
}

interface ImportReference {
  specifier: string;
  node: ts.StringLiteralLike;
}

function collectImportReferences(sourceFile: ts.SourceFile): readonly ImportReference[] {
  const imports: ImportReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push({ specifier: node.moduleSpecifier.text, node: node.moduleSpecifier });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.push({
        specifier: node.moduleReference.expression.text,
        node: node.moduleReference.expression,
      });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        imports.push({ specifier: argument.text, node: argument });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function inferProjectRoot(
  files: readonly SrijikaArchitectureSourceFile[],
  architecture: ResolvedSrijikaArchitectureConfig,
  explicitRoot?: string,
): string {
  if (explicitRoot) return normalizePath(explicitRoot).replace(/\/$/, '');
  const marker = `/${architecture.featuresRoot}/`;
  for (const file of files) {
    const normalized = normalizePath(file.fileName);
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex >= 0) return normalized.slice(0, markerIndex);
  }
  return '.';
}

function createFileLookup(
  files: readonly SrijikaArchitectureSourceFile[],
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const file of files) {
    const normalized = normalizePath(file.fileName);
    lookup.set(normalized, normalized);
    lookup.set(stripSourceExtension(normalized), normalized);
    const indexWithoutExtension = stripSourceExtension(normalized).replace(/\/index$/, '');
    if (indexWithoutExtension !== stripSourceExtension(normalized)) {
      lookup.set(indexWithoutExtension, normalized);
    }
  }
  return lookup;
}

function resolveImportTarget(
  originFileName: string,
  specifier: string,
  fileLookup: ReadonlyMap<string, string>,
  projectRoot: string,
  aliases: Readonly<Record<string, string>>,
): string | null {
  let unresolved: string | null = null;
  if (specifier.startsWith('.')) {
    unresolved = normalizedJoin(posixDirname(normalizePath(originFileName)), specifier);
  } else {
    const alias = Object.entries(aliases)
      .sort(([left], [right]) => right.length - left.length)
      .find(([prefix]) => specifier.startsWith(prefix));
    if (alias) {
      const [prefix, targetRoot] = alias;
      unresolved = normalizedJoin(projectRoot, targetRoot, specifier.slice(prefix.length));
    } else if (specifier.startsWith('src/')) {
      unresolved = normalizedJoin(projectRoot, specifier);
    }
  }
  if (!unresolved) return null;
  return (
    fileLookup.get(unresolved) ?? fileLookup.get(stripSourceExtension(unresolved)) ?? unresolved
  );
}

function baseName(fileName: string): string {
  return posixBasename(fileName);
}

function isMainEntry(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const file = baseName(ownership.fileName);
  const relative = ownerRelativePath(ownership);
  const owner =
    ownership.kind === 'feature'
      ? ownership.feature
      : ownership.kind === 'slot'
        ? ownership.slot
        : ownership.part;
  if (!owner) return false;
  if (file === 'index.ts' || file === 'index.tsx') return relative === file;
  const base = file.endsWith(architecture.uiSuffix)
    ? file.slice(0, -architecture.uiSuffix.length)
    : file.endsWith(architecture.connectorSuffix)
      ? file.slice(0, -architecture.connectorSuffix.length)
      : null;
  return base !== null && normalizedName(base) === normalizedName(owner);
}

function isSlotPrivateModule(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  return (
    ownership.kind === 'part' ||
    (ownership.kind === 'slot' && !isMainEntry(ownership, architecture))
  );
}

function forbiddenUiModule(
  targetFileName: string,
  architecture: ResolvedSrijikaArchitectureConfig,
): 'store' | 'hook' | 'connector' | 'logic' | 'api' | null {
  const normalized = normalizePath(targetFileName);
  const file = baseName(normalized);
  if (/\.store(?:\.(?:ts|tsx))?$/.test(file)) return 'store';
  if (
    normalized.includes(`/${architecture.hooksDirectory}/`) ||
    /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(file)
  ) {
    return 'hook';
  }
  if (/\.connector(?:\.tsx)?$/.test(file)) return 'connector';
  if (file.endsWith(architecture.logicSuffix)) return 'logic';
  if (file.endsWith(architecture.apiSuffix)) return 'api';
  return null;
}

type RuntimeCapability = Exclude<SrijikaArchitectureCapability, 'types'>;

function ownerKey(ownership: SrijikaArchitectureOwnership): string | null {
  if (ownership.kind === 'feature' && ownership.feature) return `feature:${ownership.feature}`;
  if (ownership.kind === 'slot' && ownership.feature && ownership.slot) {
    return `slot:${ownership.feature}/${ownership.slot}`;
  }
  if (ownership.kind === 'part' && ownership.feature && ownership.slot && ownership.part) {
    return `part:${ownership.feature}/${ownership.slot}/${ownership.part}`;
  }
  return null;
}

function capabilityForOwnerFile(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): SrijikaArchitectureCapability | null {
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null || relative.includes('/')) return null;
  const file = baseName(ownership.fileName);
  if (file === `${pascalName(owner)}${architecture.connectorSuffix}`) return 'connector';
  if (file === `use${pascalName(owner)}.ts`) return 'hook';
  if (file === `${camelName(owner)}${architecture.storeSuffix}`) return 'store';
  if (file === `${camelName(owner)}${architecture.logicSuffix}`) return 'logic';
  if (file === `${camelName(owner)}${architecture.apiSuffix}`) return 'api';
  if (file === `${camelName(owner)}${architecture.typesSuffix}`) return 'types';
  return null;
}

function isOwnerHelperHook(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null) return false;
  const segments = relative.split('/');
  return (
    segments[0] === architecture.hooksDirectory &&
    /^use[A-Z0-9].*\.ts$/.test(baseName(ownership.fileName))
  );
}

/** Classifies a canonical owner-local runtime file without promoting private helper hooks. */
export function classifySrijikaArchitectureCapability(
  fileName: string,
  options: ValidateSrijikaArchitectureOptions = {},
): SrijikaArchitectureCapability | null {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const ownership = classifySrijikaArchitecturePath(fileName, {
    ...options,
    architecture,
  });
  return capabilityForOwnerFile(ownership, architecture);
}

interface RecommendationSignals {
  endpointCalls: number;
  branchValidationTransform: boolean;
  lifecycleCache: boolean;
  asyncHandlers: number;
  reactHooks: number;
  localStateFields: number;
  storeMembers: number;
  storeAsyncCache: boolean;
}

function matchCount(source: string, expression: RegExp): number {
  return [...source.matchAll(expression)].length;
}

function recommendationSignals(source: string): RecommendationSignals {
  const endpointCalls = matchCount(
    source,
    /\b(?:fetch\s*\(|\w*Api\.\w+\s*\(|(?:api|client|http|axios)\w*(?:\.\w+)*\.(?:get|post|put|patch|delete|request|query|mutate)\s*\()/gi,
  );
  const storeMembers = new Set<string>();
  for (const match of source.matchAll(/\b(?:state|store)\.([A-Za-z_$][\w$]*)/g)) {
    if (match[1]) storeMembers.add(match[1]);
  }
  for (const match of source.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)) {
    if (match[1]) storeMembers.add(match[1]);
  }
  const asyncHandlers = matchCount(source, /\basync\b/g);
  const cacheBehavior =
    /\b(?:useQuery|useMutation|queryClient|invalidateQueries|cache|retry|setInterval|subscribe|subscription|poll(?:ing)?|pagination|pageInfo|mutation)\b/i.test(
      source,
    );
  return {
    endpointCalls,
    branchValidationTransform:
      /\b(?:if|switch|throw|validate|validation|transform|normalize)\b|\.(?:map|filter|reduce|flatMap)\s*\(/i.test(
        source,
      ),
    lifecycleCache:
      /\b(?:useEffect|useLayoutEffect|useSyncExternalStore)\s*\(/.test(source) || cacheBehavior,
    asyncHandlers,
    reactHooks: matchCount(source, /\buse[A-Z][\w$]*\s*(?:<[^;{}()]*>)?\s*\(/g),
    localStateFields: matchCount(source, /\buseState\s*(?:<[^;{}()]*>)?\s*\(/g),
    storeMembers: storeMembers.size,
    storeAsyncCache: asyncHandlers > 0 || cacheBehavior,
  };
}

function highestAvailableJunior(
  from: RuntimeCapability,
  available: ReadonlySet<SrijikaArchitectureCapability>,
): RuntimeCapability | null {
  return (
    (['hook', 'store', 'logic', 'api'] as const).find(
      (capability) =>
        runtimeCapabilityRank[capability] > runtimeCapabilityRank[from] &&
        available.has(capability),
    ) ?? null
  );
}

function diagnostic(
  code: SrijikaArchitectureDiagnosticCode,
  fileName: string,
  span: SrijikaArchitectureSourceSpan,
  message: string,
  guidance: string,
  targetFileName?: string,
  recommendation?: SrijikaArchitectureRecommendation,
  severity: 'error' | 'warning' = 'error',
): SrijikaArchitectureDiagnostic {
  const ruleIdByCode: Partial<
    Record<SrijikaArchitectureDiagnosticCode, SrijikaArchitectureRuleId>
  > = {
    SRIJIKA4101: 'SRIJIKA-ARCH-UI-RUNTIME-IMPORT',
    SRIJIKA4102: 'SRIJIKA-ARCH-PRIVATE-IMPORT',
    SRIJIKA4103: 'SRIJIKA-ARCH-PRIVATE-IMPORT',
    SRIJIKA4104: 'SRIJIKA-ARCH-PRIVATE-IMPORT',
    SRIJIKA4106: 'SRIJIKA-ARCH-MISSING-UI',
    SRIJIKA4109: 'SRIJIKA-ARCH-MISSING-CONNECTOR',
    SRIJIKA4201: 'SRIJIKA-ARCH-LAYER-JUMP',
    SRIJIKA4202: 'SRIJIKA-ARCH-MAINTAINABILITY',
    SRIJIKA4203: 'SRIJIKA-ARCH-REVERSE-DEPENDENCY',
  };
  const ruleId = ruleIdByCode[code];
  return {
    code,
    ...(ruleId ? { ruleId } : {}),
    severity,
    fileName,
    span,
    message,
    guidance,
    ...(targetFileName ? { targetFileName } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

function validateUiHookCalls(
  file: SrijikaArchitectureSourceFile,
  sourceFile: ts.SourceFile,
  importedHookNames: ReadonlySet<string>,
): readonly SrijikaArchitectureDiagnostic[] {
  const diagnostics: SrijikaArchitectureDiagnostic[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'use' || /^use[A-Z0-9]/.test(node.expression.text)) &&
      !importedHookNames.has(node.expression.text)
    ) {
      diagnostics.push(
        diagnostic(
          'SRIJIKA4101',
          file.fileName,
          spanForNode(sourceFile, node.expression),
          `Pure UI files cannot call the ${node.expression.text} hook.`,
          'Move lifecycle, state, store access, and data wiring to the matching Connector, then pass authored values and events through typed props.',
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return diagnostics;
}

export function validateSrijikaArchitecture(
  files: readonly SrijikaArchitectureSourceFile[],
  options: ValidateSrijikaArchitectureOptions = {},
): SrijikaArchitectureValidationResult {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const projectRoot = inferProjectRoot(files, architecture, options.projectRoot);
  const aliases: Readonly<Record<string, string>> = {
    '@/': 'src/',
    '@features/': architecture.featuresRoot,
    ...(options.aliases ?? {}),
  };
  const fileLookup = createFileLookup(files);
  const sourceByFile = new Map(
    files.map((file) => [normalizePath(file.fileName), file.source] as const),
  );
  const diagnostics: SrijikaArchitectureDiagnostic[] = [];
  const recommendations: SrijikaArchitectureRecommendation[] = [];
  const recommendationKeys = new Set<string>();
  const ownerCapabilities = new Map<string, Set<SrijikaArchitectureCapability>>();
  const ownerCapabilityFiles = new Map<string, Map<SrijikaArchitectureCapability, string>>();
  const fileCapabilities = new Map<string, SrijikaArchitectureCapability>();
  const owners = new Map<
    string,
    {
      ownership: SrijikaArchitectureOwnership;
      hasUi: boolean;
      hasConnector: boolean;
      requiresUi: boolean;
      anchorFile: SrijikaArchitectureSourceFile;
      anchorSpan: SrijikaArchitectureSourceSpan;
    }
  >();

  const registerOwner = (
    key: string,
    ownership: SrijikaArchitectureOwnership,
    file: SrijikaArchitectureSourceFile,
    anchorSpan: SrijikaArchitectureSourceSpan,
    hasUi: boolean,
    hasConnector: boolean,
    requiresUi: boolean,
  ): void => {
    const current = owners.get(key);
    if (current) {
      current.hasUi ||= hasUi;
      current.hasConnector ||= hasConnector;
      if (!current.requiresUi && requiresUi) {
        current.anchorFile = file;
        current.anchorSpan = anchorSpan;
      }
      current.requiresUi ||= requiresUi;
      return;
    }
    owners.set(key, {
      ownership,
      hasUi,
      hasConnector,
      requiresUi,
      anchorFile: file,
      anchorSpan,
    });
  };

  for (const file of files) {
    const normalizedFileName = normalizePath(file.fileName);
    const ownership = classifySrijikaArchitecturePath(normalizedFileName, {
      ...options,
      architecture,
    });
    const key = ownerKey(ownership);
    const capability = capabilityForOwnerFile(ownership, architecture);
    if (!key || !capability) continue;
    const current = ownerCapabilities.get(key) ?? new Set<SrijikaArchitectureCapability>();
    current.add(capability);
    ownerCapabilities.set(key, current);
    const capabilityFiles =
      ownerCapabilityFiles.get(key) ?? new Map<SrijikaArchitectureCapability, string>();
    capabilityFiles.set(capability, normalizedFileName);
    ownerCapabilityFiles.set(key, capabilityFiles);
    fileCapabilities.set(normalizedFileName, capability);
  }

  for (const file of files) {
    const normalizedFileName = normalizePath(file.fileName);
    const sourceFile = ts.createSourceFile(
      normalizedFileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      normalizedFileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const origin = classifySrijikaArchitecturePath(normalizedFileName, {
      ...options,
      architecture,
    });
    const isUi = normalizedFileName.endsWith(architecture.uiSuffix);
    const importedHookNames = new Set<string>();
    const anchorSpan = fileAnchor(sourceFile);
    diagnostics.push(...structureDiagnosticsForFile(file, sourceFile, origin, architecture));

    if (origin.feature) {
      const featureOwnership: SrijikaArchitectureOwnership = {
        kind: 'feature',
        fileName: normalizedFileName,
        feature: origin.feature,
        relativeToFeature: origin.relativeToFeature ?? '',
      };
      registerOwner(
        `feature:${origin.feature}`,
        featureOwnership,
        file,
        anchorSpan,
        origin.kind === 'feature' && isOwnerUiEntry(origin, architecture),
        origin.kind === 'feature' && isOwnerConnectorEntry(origin, architecture),
        true,
      );
    }
    if (origin.feature && origin.slot) {
      const slotOwnership: SrijikaArchitectureOwnership = {
        kind: 'slot',
        fileName: normalizedFileName,
        feature: origin.feature,
        slot: origin.slot,
        relativeToFeature: origin.relativeToFeature ?? '',
        relativeToSlot: origin.relativeToSlot ?? '',
      };
      registerOwner(
        `slot:${origin.feature}/${origin.slot}`,
        slotOwnership,
        file,
        anchorSpan,
        origin.kind === 'slot' && isOwnerUiEntry(origin, architecture),
        origin.kind === 'slot' && isOwnerConnectorEntry(origin, architecture),
        true,
      );
    }
    if (origin.feature && origin.slot && origin.part) {
      registerOwner(
        `part:${origin.feature}/${origin.slot}/${origin.part}`,
        origin,
        file,
        anchorSpan,
        origin.kind === 'part' && isOwnerUiEntry(origin, architecture),
        origin.kind === 'part' && isOwnerConnectorEntry(origin, architecture),
        true,
      );
    }

    if (isUi) {
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
        const clause = statement.importClause;
        if (clause.name && (clause.name.text === 'use' || /^use[A-Z0-9]/.test(clause.name.text))) {
          importedHookNames.add(clause.name.text);
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'use' || /^use[A-Z0-9]/.test(importedName)) {
              importedHookNames.add(element.name.text);
              const modulePath = ts.isStringLiteralLike(statement.moduleSpecifier)
                ? statement.moduleSpecifier.text
                : '';
              if (!forbiddenUiModule(modulePath, architecture)) {
                diagnostics.push(
                  diagnostic(
                    'SRIJIKA4101',
                    file.fileName,
                    spanForNode(sourceFile, element.name),
                    `Pure UI files cannot import the ${importedName} hook.`,
                    'Call this hook in the matching Connector and pass its values or event callbacks into the UI through typed props.',
                  ),
                );
              }
            }
          }
        }
      }
    }

    for (const reference of collectImportReferences(sourceFile)) {
      const targetFileName = resolveImportTarget(
        normalizedFileName,
        reference.specifier,
        fileLookup,
        projectRoot,
        aliases,
      );
      if (!targetFileName) continue;
      const target = classifySrijikaArchitecturePath(targetFileName, {
        ...options,
        architecture,
      });
      const span = moduleSpecifierSpan(sourceFile, reference.node);

      const originKey = ownerKey(origin);
      const targetKey = ownerKey(target);
      const originCapability = fileCapabilities.get(normalizedFileName);
      const targetCapability = fileCapabilities.get(normalizePath(targetFileName));
      let expectedTarget: RuntimeCapability | null = null;
      if (
        originKey &&
        originKey === targetKey &&
        originCapability === 'connector' &&
        ownerCapabilities.get(originKey)?.has('hook') &&
        isOwnerHelperHook(target, architecture)
      ) {
        const name = ownershipName(origin) ?? 'owner';
        const recommendation: SrijikaArchitectureRecommendation = {
          id: 'SRIJIKA-ARCH-RECOMMEND-HOOK',
          kind: 'required-fix',
          owner: name,
          ownerKind: origin.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>,
          from: 'connector',
          currentTarget: 'hook',
          recommendedTarget: 'hook',
          message: `Connector must use the canonical use${pascalName(name)}.ts gateway instead of a private helper Hook.`,
          suggestedFileName: `use${pascalName(name)}.ts`,
        };
        recommendations.push(recommendation);
        diagnostics.push(
          diagnostic(
            'SRIJIKA4201',
            file.fileName,
            span,
            `The ${name} Connector bypasses its canonical Hook gateway to import the private helper ${reference.specifier}.`,
            `Import use${pascalName(name)}.ts from the Connector. The gateway may compose private helpers from ${architecture.hooksDirectory}/ internally.`,
            targetFileName,
            recommendation,
          ),
        );
      }
      if (
        originKey &&
        originKey === targetKey &&
        originCapability &&
        originCapability !== 'types' &&
        targetCapability &&
        targetCapability !== 'types' &&
        runtimeCapabilityRank[targetCapability] > runtimeCapabilityRank[originCapability]
      ) {
        const expected = highestAvailableJunior(
          originCapability,
          ownerCapabilities.get(originKey) ?? new Set(),
        );
        expectedTarget = expected;
        if (expected && targetCapability !== expected) {
          const name = ownershipName(origin) ?? 'owner';
          const recommendation: SrijikaArchitectureRecommendation = {
            id:
              expected === 'hook' && targetCapability === 'store'
                ? 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE'
                : expected === 'hook'
                  ? 'SRIJIKA-ARCH-RECOMMEND-HOOK'
                  : expected === 'store'
                    ? 'SRIJIKA-ARCH-RECOMMEND-STORE'
                    : 'SRIJIKA-ARCH-RECOMMEND-LOGIC',
            kind: 'required-fix',
            owner: name,
            ownerKind: origin.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>,
            from: originCapability,
            currentTarget: targetCapability,
            recommendedTarget: expected,
            message: `${originCapability} must call the highest available junior capability, ${expected}, instead of jumping to ${targetCapability}.`,
          };
          recommendations.push(recommendation);
          diagnostics.push(
            diagnostic(
              'SRIJIKA4201',
              file.fileName,
              span,
              `The ${name} ${originCapability} jumps over the available ${expected} capability to import ${reference.specifier}.`,
              `Route this behavior through ${expected}. The owner-local runtime chain is Connector → Hook → Store → Logic → API; only absent capabilities may be skipped. Types remain passive and may be imported directly.`,
              targetFileName,
              recommendation,
            ),
          );
        }
      }
      if (
        originKey &&
        originKey === targetKey &&
        originCapability &&
        originCapability !== 'types' &&
        targetCapability &&
        targetCapability !== 'types' &&
        runtimeCapabilityRank[targetCapability] < runtimeCapabilityRank[originCapability]
      ) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4203',
            file.fileName,
            span,
            `The ${ownershipName(origin) ?? 'owner'} ${originCapability} has a reverse dependency on its senior ${targetCapability} capability.`,
            `Dependencies move only downward through Connector → Hook → Store → Logic → API. Return values may flow upward at runtime, but junior source modules must not import senior source modules.`,
            targetFileName,
          ),
        );
      }

      if (
        originKey &&
        originKey === targetKey &&
        (originCapability === 'connector' ||
          originCapability === 'hook' ||
          originCapability === 'store') &&
        targetCapability &&
        targetCapability !== 'types' &&
        expectedTarget === targetCapability
      ) {
        const name = ownershipName(origin) ?? 'owner';
        const ownerKind = origin.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>;
        const originSource = sourceByFile.get(normalizedFileName) ?? '';
        const targetSource = sourceByFile.get(normalizePath(targetFileName)) ?? '';
        const originSignals = recommendationSignals(originSource);
        const storeSignals = recommendationSignals(`${originSource}\n${targetSource}`);
        const capabilities = ownerCapabilities.get(originKey) ?? new Set();
        const candidateRecommendations: SrijikaArchitectureRecommendation[] = [];
        if (
          targetCapability === 'api' &&
          !capabilities.has('logic') &&
          (originSignals.endpointCalls >= 2 || originSignals.branchValidationTransform)
        ) {
          const endpointSignal = originSignals.endpointCalls >= 2;
          candidateRecommendations.push({
            id: 'SRIJIKA-ARCH-RECOMMEND-LOGIC',
            kind: 'maintainability',
            owner: name,
            ownerKind,
            from: originCapability,
            currentTarget: 'api',
            recommendedTarget: 'logic',
            message: `The ${name} ${originCapability} is coordinating multiple API calls or business branching/validation/transformation; add Logic before API.`,
            suggestedFileName: `${camelName(name)}${architecture.logicSuffix}`,
            evidence: {
              metric: endpointSignal ? 'endpoint-calls' : 'branch-validation-transform',
              value: endpointSignal ? originSignals.endpointCalls : 1,
              threshold: endpointSignal ? 2 : 1,
            },
          });
        }
        if (
          originCapability === 'connector' &&
          !capabilities.has('hook') &&
          (originSignals.lifecycleCache ||
            originSignals.asyncHandlers >= 2 ||
            originSignals.reactHooks >= 3 ||
            (targetCapability === 'store' &&
              (storeSignals.storeMembers >= 5 || storeSignals.storeAsyncCache)))
        ) {
          const aboveStore =
            targetCapability === 'store' &&
            (storeSignals.storeMembers >= 5 || storeSignals.storeAsyncCache);
          const evidence = aboveStore
            ? storeSignals.storeMembers >= 5
              ? { metric: 'store-members' as const, value: storeSignals.storeMembers, threshold: 5 }
              : { metric: 'store-async-cache' as const, value: 1, threshold: 1 }
            : originSignals.lifecycleCache
              ? { metric: 'lifecycle-cache' as const, value: 1, threshold: 1 }
              : originSignals.asyncHandlers >= 2
                ? {
                    metric: 'async-handlers' as const,
                    value: originSignals.asyncHandlers,
                    threshold: 2,
                  }
                : {
                    metric: 'react-hooks' as const,
                    value: originSignals.reactHooks,
                    threshold: 3,
                  };
          candidateRecommendations.push({
            id: aboveStore
              ? 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE'
              : 'SRIJIKA-ARCH-RECOMMEND-HOOK',
            kind: 'maintainability',
            owner: name,
            ownerKind,
            from: 'connector',
            currentTarget: targetCapability,
            recommendedTarget: 'hook',
            message: `The ${name} Connector is coordinating lifecycle/cache/async React behavior${aboveStore ? ' or a complex Store surface' : ''}; add the canonical owner Hook as its single runtime gateway.`,
            suggestedFileName: `use${pascalName(name)}.ts`,
            evidence,
          });
        }
        if (
          (originCapability === 'connector' || originCapability === 'hook') &&
          !capabilities.has('store') &&
          originSignals.localStateFields >= 4
        ) {
          candidateRecommendations.push({
            id: 'SRIJIKA-ARCH-RECOMMEND-STORE',
            kind: 'maintainability',
            owner: name,
            ownerKind,
            from: originCapability,
            currentTarget: targetCapability,
            recommendedTarget: 'store',
            message: `The ${name} ${originCapability} owns ${originSignals.localStateFields} local state fields; add Store to give shared client state an explicit owner boundary.`,
            suggestedFileName: `${camelName(name)}${architecture.storeSuffix}`,
            evidence: {
              metric: 'local-state-fields',
              value: originSignals.localStateFields,
              threshold: 4,
            },
          });
        }
        for (const recommendation of candidateRecommendations) {
          const recommendationKey = `${originKey}:${recommendation.id}`;
          if (recommendationKeys.has(recommendationKey)) continue;
          recommendationKeys.add(recommendationKey);
          recommendations.push(recommendation);
          diagnostics.push(
            diagnostic(
              'SRIJIKA4202',
              file.fileName,
              span,
              recommendation.message,
              `Recommendation is evidence-based and non-blocking. Add ${recommendation.recommendedTarget} at the canonical ${name} owner boundary, then follow Connector → Hook → Store → Logic → API while skipping only absent capabilities. No source rewrite was applied.`,
              targetFileName,
              recommendation,
              'warning',
            ),
          );
        }
      }

      if (isUi) {
        const forbidden = forbiddenUiModule(targetFileName, architecture);
        if (forbidden) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4101',
              file.fileName,
              span,
              `Pure UI files cannot import a ${forbidden}: ${reference.specifier}.`,
              `Move this ${forbidden} dependency to the matching Connector and pass the result into the UI through typed props.`,
              targetFileName,
            ),
          );
        }
      }

      if (target.kind === 'outside') continue;
      const sameFeature = origin.feature !== undefined && origin.feature === target.feature;
      const publicFeatureEntry = target.kind === 'feature' && isMainEntry(target, architecture);
      if (!sameFeature && !publicFeatureEntry) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4102',
            file.fileName,
            span,
            `The ${target.feature ?? 'target'} feature keeps ${reference.specifier} private.`,
            `Import the feature's public UI/Connector entry instead. If both features own this behavior or state, promote it to the nearest shared domain rather than crossing a private feature boundary.`,
            targetFileName,
          ),
        );
        continue;
      }

      if (sameFeature && isSlotPrivateModule(target, architecture)) {
        const sameSlot = origin.slot !== undefined && origin.slot === target.slot;
        if (!sameSlot) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4103',
              file.fileName,
              span,
              `The ${target.slot ?? 'target'} slot keeps ${reference.specifier} inside its own subtree.`,
              `Do not import slot stores, hooks, parts, or private modules from a parent or sibling slot. If multiple Home areas need it, promote it to the ${target.feature ?? 'feature'} feature scope.`,
              targetFileName,
            ),
          );
          continue;
        }
      }

      if (
        sameFeature &&
        target.kind === 'slot' &&
        isMainEntry(target, architecture) &&
        origin.slot !== undefined &&
        origin.slot !== target.slot
      ) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4103',
            file.fileName,
            span,
            `The ${target.slot ?? 'target'} slot public entry cannot be composed by the ${origin.slot} sibling slot.`,
            `Compose ${target.slot ?? 'this slot'} from the owning ${target.feature ?? 'feature'} Connector. Sibling slots may share only modules promoted to their feature owner.`,
            targetFileName,
          ),
        );
        continue;
      }

      if (
        sameFeature &&
        origin.slot === target.slot &&
        target.kind === 'part' &&
        origin.part !== target.part
      ) {
        const targetIsPublicEntry = isMainEntry(target, architecture);
        const originIsOwningSlot = origin.kind === 'slot';
        if (originIsOwningSlot && targetIsPublicEntry) continue;
        const importingSibling = origin.kind === 'part';
        diagnostics.push(
          diagnostic(
            'SRIJIKA4104',
            file.fileName,
            span,
            targetIsPublicEntry && importingSibling
              ? `The ${origin.part ?? 'current'} sibling part cannot import the ${target.part ?? 'target'} part public entry ${reference.specifier}.`
              : `The ${target.part ?? 'target'} part keeps ${reference.specifier} private to its own subtree.`,
            targetIsPublicEntry && importingSibling
              ? `Compose the ${target.part ?? 'target'} public UI/Connector from the owning ${target.slot ?? 'slot'} slot. Promote shared sibling behavior to that slot scope.`
              : `The owning ${target.slot ?? 'slot'} slot may compose only this part's public UI/Connector. Keep part stores, hooks, and private files inside ${target.part ?? 'the part'}; promote genuinely shared behavior to the slot scope.`,
            targetFileName,
          ),
        );
      }
    }

    if (isUi) diagnostics.push(...validateUiHookCalls(file, sourceFile, importedHookNames));
  }

  for (const [key, capabilityFiles] of ownerCapabilityFiles) {
    const owner = owners.get(key);
    if (!owner) continue;
    const name = ownershipName(owner.ownership);
    if (!name) continue;
    const ownerKind = owner.ownership.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>;
    const connectorFileName = capabilityFiles.get('connector');
    const hookFileName = capabilityFiles.get('hook');
    const storeFileName = capabilityFiles.get('store');
    const apiFileName = capabilityFiles.get('api');
    const gatewayFileName = hookFileName ?? connectorFileName;
    const gatewayCapability: RuntimeCapability = hookFileName ? 'hook' : 'connector';
    const gatewaySource = gatewayFileName ? (sourceByFile.get(gatewayFileName) ?? '') : '';
    const connectorSource = connectorFileName ? (sourceByFile.get(connectorFileName) ?? '') : '';
    const storeSource = storeFileName ? (sourceByFile.get(storeFileName) ?? '') : '';
    const gatewaySignals = recommendationSignals(gatewaySource);
    const connectorSignals = recommendationSignals(connectorSource);
    const storeSignals = recommendationSignals(storeSource);

    const emitRecommendation = (
      recommendation: SrijikaArchitectureRecommendation,
      fileName: string,
    ): void => {
      const recommendationKey = `${key}:${recommendation.id}`;
      if (recommendationKeys.has(recommendationKey)) return;
      recommendationKeys.add(recommendationKey);
      recommendations.push(recommendation);
      const sourceFile = ts.createSourceFile(
        fileName,
        sourceByFile.get(fileName) ?? '',
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      diagnostics.push(
        diagnostic(
          'SRIJIKA4202',
          fileName,
          fileAnchor(sourceFile),
          recommendation.message,
          `Recommendation is evidence-based and non-blocking. Add ${recommendation.recommendedTarget} at the canonical ${name} owner boundary, then follow Connector → Hook → Store → Logic → API while skipping only absent capabilities. No source rewrite was applied.`,
          undefined,
          recommendation,
          'warning',
        ),
      );
    };

    if (
      gatewayFileName &&
      !capabilityFiles.has('logic') &&
      (gatewaySignals.endpointCalls >= 2 ||
        (apiFileName !== undefined && gatewaySignals.branchValidationTransform))
    ) {
      const endpointSignal = gatewaySignals.endpointCalls >= 2;
      emitRecommendation(
        {
          id: 'SRIJIKA-ARCH-RECOMMEND-LOGIC',
          kind: 'maintainability',
          owner: name,
          ownerKind,
          from: gatewayCapability,
          currentTarget: apiFileName ? 'api' : gatewayCapability,
          recommendedTarget: 'logic',
          message: `The ${name} ${gatewayCapability} is coordinating multiple API calls or business branching/validation/transformation; add Logic before API.`,
          suggestedFileName: `${camelName(name)}${architecture.logicSuffix}`,
          evidence: {
            metric: endpointSignal ? 'endpoint-calls' : 'branch-validation-transform',
            value: endpointSignal ? gatewaySignals.endpointCalls : 1,
            threshold: endpointSignal ? 2 : 1,
          },
        },
        gatewayFileName,
      );
    }

    const storeNeedsHook =
      storeFileName !== undefined &&
      (storeSignals.storeMembers >= 5 || storeSignals.storeAsyncCache);
    if (
      connectorFileName &&
      !hookFileName &&
      (connectorSignals.lifecycleCache ||
        connectorSignals.asyncHandlers >= 2 ||
        connectorSignals.reactHooks >= 3 ||
        storeNeedsHook)
    ) {
      const evidence = storeNeedsHook
        ? storeSignals.storeMembers >= 5
          ? { metric: 'store-members' as const, value: storeSignals.storeMembers, threshold: 5 }
          : { metric: 'store-async-cache' as const, value: 1, threshold: 1 }
        : connectorSignals.lifecycleCache
          ? { metric: 'lifecycle-cache' as const, value: 1, threshold: 1 }
          : connectorSignals.asyncHandlers >= 2
            ? {
                metric: 'async-handlers' as const,
                value: connectorSignals.asyncHandlers,
                threshold: 2,
              }
            : {
                metric: 'react-hooks' as const,
                value: connectorSignals.reactHooks,
                threshold: 3,
              };
      emitRecommendation(
        {
          id: storeNeedsHook
            ? 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE'
            : 'SRIJIKA-ARCH-RECOMMEND-HOOK',
          kind: 'maintainability',
          owner: name,
          ownerKind,
          from: 'connector',
          currentTarget: storeFileName ? 'store' : 'connector',
          recommendedTarget: 'hook',
          message: `The ${name} Connector is coordinating lifecycle/cache/async React behavior${storeNeedsHook ? ' or a complex Store surface' : ''}; add the canonical owner Hook as its single runtime gateway.`,
          suggestedFileName: `use${pascalName(name)}.ts`,
          evidence,
        },
        connectorFileName,
      );
    }

    if (gatewayFileName && !storeFileName && gatewaySignals.localStateFields >= 4) {
      emitRecommendation(
        {
          id: 'SRIJIKA-ARCH-RECOMMEND-STORE',
          kind: 'maintainability',
          owner: name,
          ownerKind,
          from: gatewayCapability,
          currentTarget: apiFileName ? 'api' : gatewayCapability,
          recommendedTarget: 'store',
          message: `The ${name} ${gatewayCapability} owns ${gatewaySignals.localStateFields} local state fields; add Store to give shared client state an explicit owner boundary.`,
          suggestedFileName: `${camelName(name)}${architecture.storeSuffix}`,
          evidence: {
            metric: 'local-state-fields',
            value: gatewaySignals.localStateFields,
            threshold: 4,
          },
        },
        gatewayFileName,
      );
    }
  }

  for (const owner of owners.values()) {
    if (!owner.requiresUi) continue;
    const name = ownershipName(owner.ownership);
    if (!name) continue;
    if (!owner.hasUi) {
      const expected = `${pascalName(name)}${architecture.uiSuffix}`;
      diagnostics.push(
        diagnostic(
          'SRIJIKA4106',
          owner.anchorFile.fileName,
          owner.anchorSpan,
          `The ${name} ${owner.ownership.kind} has private companions but no mandatory ${expected}.`,
          `Create ${expected} at the ${owner.ownership.kind} root. UI and its matching Connector are required owner entries; Store, Hook, Logic, API, Types, Slots, and Parts are optional capabilities.`,
        ),
      );
    }
    if (!owner.hasConnector) {
      const expected = `${pascalName(name)}${architecture.connectorSuffix}`;
      diagnostics.push(
        diagnostic(
          'SRIJIKA4109',
          owner.anchorFile.fileName,
          owner.anchorSpan,
          `The ${name} ${owner.ownership.kind} has no mandatory matching ${expected}.`,
          `Create ${expected} at the ${owner.ownership.kind} root. The Connector is the UI's required and only runtime gateway into Hook → Store → Logic → API.`,
        ),
      );
    }
  }

  diagnostics.sort(
    (left, right) =>
      normalizePath(left.fileName).localeCompare(normalizePath(right.fileName)) ||
      left.span.start - right.span.start ||
      left.code.localeCompare(right.code),
  );
  return { diagnostics, recommendations };
}
