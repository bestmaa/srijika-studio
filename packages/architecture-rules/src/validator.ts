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

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

const runtimeCapabilityRank: Readonly<
  Record<Exclude<SrijikaArchitectureCapability, 'types' | 'ui'>, number>
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

function scriptKindForFile(fileName: string): ts.ScriptKind {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (normalized.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (normalized.endsWith('.js') || normalized.endsWith('.mjs') || normalized.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
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
  const lowerValue = value.toLowerCase();
  for (const extension of sourceExtensions) {
    if (lowerValue.endsWith(extension)) return value.slice(0, -extension.length);
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

function canonicalOwnerFolderName(value: string): string {
  const canonical = pascalName(value);
  const characters = [...canonical];
  let output = '';
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? '';
    const previous = characters[index - 1];
    const next = characters[index + 1];
    if (
      /[A-Z]/.test(character) &&
      index > 0 &&
      ((previous !== undefined && /[a-z0-9]/.test(previous)) ||
        (previous !== undefined &&
          /[A-Z]/.test(previous) &&
          next !== undefined &&
          /[a-z]/.test(next)))
    ) {
      output += '-';
    }
    output += character.toLowerCase();
  }
  return output;
}

function ownershipName(ownership: SrijikaArchitectureOwnership): string | null {
  if (ownership.kind === 'feature') return ownership.feature ?? null;
  if (ownership.kind === 'slot') return ownership.slot ?? null;
  if (ownership.kind === 'part') return ownership.part ?? null;
  if (
    ownership.kind === 'shared-ui' ||
    ownership.kind === 'shared-widget' ||
    ownership.kind === 'shared-capability'
  )
    return ownership.shared ?? null;
  return null;
}

function noncanonicalOwnerFolders(
  ownership: SrijikaArchitectureOwnership,
): readonly { role: string; actual: string; expected: string }[] {
  const candidates: Array<{ role: string; actual: string }> = [];
  if (ownership.feature) candidates.push({ role: 'Feature', actual: ownership.feature });
  if (ownership.slot) candidates.push({ role: 'Slot', actual: ownership.slot });
  if (ownership.part && ownership.relativeToPart !== '') {
    candidates.push({ role: 'Part', actual: ownership.part });
  }
  if (ownership.shared) candidates.push({ role: 'Shared owner', actual: ownership.shared });
  return candidates.flatMap(({ role, actual }) => {
    const expected = canonicalOwnerFolderName(actual);
    return actual === expected ? [] : [{ role, actual, expected }];
  });
}

function ownerRelativePath(ownership: SrijikaArchitectureOwnership): string | null {
  if (ownership.kind === 'feature') return ownership.relativeToFeature ?? null;
  if (ownership.kind === 'slot') return ownership.relativeToSlot ?? null;
  if (ownership.kind === 'part') return ownership.relativeToPart ?? null;
  if (
    ownership.kind === 'shared-ui' ||
    ownership.kind === 'shared-widget' ||
    ownership.kind === 'shared-capability'
  )
    return ownership.relativeToShared ?? null;
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
  const relativeSegments = relative.split('/');

  if (ownership.kind === 'shared-ui') {
    const expectedUi = `${pascalName(owner)}${architecture.uiSuffix}`;
    const expectedTypes = `${camelName(owner)}${architecture.typesSuffix}`;
    const allowed =
      relativeSegments.length === 1 && (fileName === expectedUi || fileName === expectedTypes);
    if (!allowed) {
      output.push(
        diagnostic(
          'SRIJIKA4110',
          file.fileName,
          anchor,
          `${fileName} is outside the strict ${owner} shared UI primitive contract.`,
          `A shared UI primitive contains only ${expectedUi} and optional ${expectedTypes}. It receives all authored values and events through props and cannot own Connector, Hook, Store, Logic, or API runtime code.`,
        ),
      );
    }
    return output;
  }

  if (
    ownership.kind === 'shared-capability' &&
    (fileName.endsWith(architecture.uiSuffix) || fileName.endsWith(architecture.connectorSuffix))
  ) {
    output.push(
      diagnostic(
        'SRIJIKA4110',
        file.fileName,
        anchor,
        `${fileName} is a visual boundary inside the headless ${owner} shared capability.`,
        `Headless capabilities contain only Hook, Store, Logic, API, and Types. Move reusable visual code to ${architecture.sharedRoot}/ui or ${architecture.sharedRoot}/widgets.`,
      ),
    );
  }

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
    const helperStem = fileName.slice(0, -architecture.storeSuffix.length);
    const ownerPrefix = camelName(owner);
    const helperSuffix = helperStem.slice(ownerPrefix.length);
    const privateSlice =
      relativeSegments.length === 2 &&
      relativeSegments[0] === architecture.storesDirectory &&
      helperStem.startsWith(ownerPrefix) &&
      /^[A-Z0-9][A-Za-z0-9]*$/.test(helperSuffix);
    const expandedGateway =
      relativeSegments.length === 2 &&
      relativeSegments[0] === architecture.storesDirectory &&
      fileName === expected;
    const flatGateway = !relative.includes('/') && fileName === expected;
    if (!flatGateway && !expandedGateway && !privateSlice) {
      output.push(
        diagnostic(
          'SRIJIKA4105',
          file.fileName,
          anchor,
          `The ${owner} Store must be its canonical ${expected} gateway or an owner-prefixed concern directly inside ${architecture.storesDirectory}/.`,
          `Use ${expected} in flat mode, or ${architecture.storesDirectory}/${expected} plus ${architecture.storesDirectory}/${ownerPrefix}<Concern>${architecture.storeSuffix} in expanded mode.`,
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

  const insideHooksDirectory = relativeSegments[0] === architecture.hooksDirectory;
  const expectedHook = `use${pascalName(owner)}.ts`;
  const flatGatewayHook = !relative.includes('/') && fileName === expectedHook;
  const expandedGatewayHook =
    relativeSegments.length === 2 &&
    relativeSegments[0] === architecture.hooksDirectory &&
    fileName === expectedHook;
  const canonicalGatewayHook = flatGatewayHook || expandedGatewayHook;
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
          `The ${owner} Hook must be the canonical ${expectedPrefix}.ts gateway or an owner-prefixed behavior directly inside ${architecture.hooksDirectory}/.`,
          `Use ${expectedPrefix}.ts in flat mode, or ${architecture.hooksDirectory}/${expectedPrefix}.ts plus ${architecture.hooksDirectory}/${expectedPrefix}<Behavior>.ts in expanded mode.`,
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
  if (architectureFile && !relative.includes('/') && ownership.kind !== 'shared-capability') {
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
          : ownership.kind === 'shared-widget'
            ? `${architecture.sharedRoot}/widgets/<another-widget>/`
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

  const canonicalRootFiles = new Set([
    ...(ownership.kind === 'shared-capability'
      ? []
      : [
          `${pascalName(owner)}${architecture.uiSuffix}`,
          `${pascalName(owner)}${architecture.connectorSuffix}`,
        ]),
    `use${pascalName(owner)}.ts`,
    `${camelName(owner)}${architecture.storeSuffix}`,
    `${camelName(owner)}${architecture.logicSuffix}`,
    `${camelName(owner)}${architecture.apiSuffix}`,
    `${camelName(owner)}${architecture.typesSuffix}`,
  ]);
  const allowedRoot = relativeSegments.length === 1 && canonicalRootFiles.has(fileName);
  const allowedHookFile =
    relativeSegments.length === 2 &&
    relativeSegments[0] === architecture.hooksDirectory &&
    fileName.endsWith('.ts') &&
    (fileName === `use${pascalName(owner)}.ts` ||
      new RegExp(`^use${pascalName(owner)}[A-Z0-9][A-Za-z0-9]*\\.ts$`).test(fileName));
  const ownerStorePrefix = camelName(owner);
  const allowedStoreFile =
    relativeSegments.length === 2 &&
    relativeSegments[0] === architecture.storesDirectory &&
    (fileName === `${ownerStorePrefix}${architecture.storeSuffix}` ||
      new RegExp(`^${ownerStorePrefix}[A-Z0-9][A-Za-z0-9]*\\.store\\.ts$`).test(fileName));
  const recognizedButMisnamed =
    architectureFile || isHook || fileName.endsWith('.store.ts') || fileName.endsWith('.store.tsx');
  const forbiddenHeadlessVisual =
    ownership.kind === 'shared-capability' &&
    (fileName.endsWith(architecture.uiSuffix) || fileName.endsWith(architecture.connectorSuffix));
  if (
    !allowedRoot &&
    !allowedHookFile &&
    !allowedStoreFile &&
    !recognizedButMisnamed &&
    !forbiddenHeadlessVisual
  ) {
    output.push(
      diagnostic(
        'SRIJIKA4110',
        file.fileName,
        anchor,
        `${fileName} is outside the strict ${owner} owner file contract.`,
        `Only canonical UI, Connector, Hook, Store, Logic, API, and Types files are allowed. Child owners belong only in ${architecture.slotsDirectory}/ or ${architecture.partsDirectory}/; expanded capability files belong only one level deep in ${architecture.hooksDirectory}/ or ${architecture.storesDirectory}/.`,
      ),
    );
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

function isNoncanonicalSharedSourcePath(
  fileName: string,
  projectRoot: string,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const normalizedFile = normalizePath(fileName);
  const normalizedRoot = normalizePath(projectRoot).replace(/\/$/, '');
  const relative = normalizedFile.startsWith(`${normalizedRoot}/`)
    ? normalizedFile.slice(normalizedRoot.length + 1)
    : normalizedFile;
  const segments = pathSegments(relative);
  const sharedSegments = pathSegments(architecture.sharedRoot);
  let sharedIndex = -1;
  for (let index = 0; index <= segments.length - sharedSegments.length; index += 1) {
    if (sharedSegments.every((segment, offset) => segments[index + offset] === segment)) {
      sharedIndex = index;
    }
  }
  if (sharedIndex < 0) return false;
  const category = segments[sharedIndex + sharedSegments.length];
  return category !== 'ui' && category !== 'widgets' && category !== 'capabilities';
}

export function classifySrijikaArchitecturePath(
  fileName: string,
  options: ValidateSrijikaArchitectureOptions = {},
): SrijikaArchitectureOwnership {
  const architecture = resolveSrijikaArchitectureConfig(options.architecture);
  const normalized = normalizePath(fileName);
  const segments = pathSegments(normalized);
  const sharedRootSegments = pathSegments(architecture.sharedRoot);
  let sharedRootIndex = -1;
  for (let index = 0; index <= segments.length - sharedRootSegments.length; index += 1) {
    if (sharedRootSegments.every((segment, offset) => segments[index + offset] === segment)) {
      sharedRootIndex = index;
    }
  }
  if (sharedRootIndex >= 0) {
    const categoryIndex = sharedRootIndex + sharedRootSegments.length;
    const category = segments[categoryIndex];
    const shared = segments[categoryIndex + 1];
    const kind =
      category === 'ui'
        ? 'shared-ui'
        : category === 'widgets'
          ? 'shared-widget'
          : category === 'capabilities'
            ? 'shared-capability'
            : null;
    if (!kind || !shared) return { kind: 'outside', fileName: normalized };
    return {
      kind,
      fileName: normalized,
      shared,
      relativeToShared: segments.slice(categoryIndex + 2).join('/'),
    };
  }
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
  const part = sourceExtensions.some((extension) => partCandidate.toLowerCase().endsWith(extension))
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
  typeOnly: boolean;
}

function isPresentationalAssetSpecifier(specifier: string): boolean {
  return /\.(?:css|scss|sass|less|styl|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp3|wav|ogg|mp4|webm)(?:[?#][^?#]*)?$/i.test(
    specifier,
  );
}

type ExternalRuntimeConcern = 'react' | 'query' | 'state' | 'router' | 'request';

function externalRuntimeConcern(specifier: string): ExternalRuntimeConcern | null {
  const normalized = specifier.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  if (/^(?:react(?:\/|$)|react-dom(?:\/|$))/.test(normalized)) return 'react';
  if (
    /^(?:@tanstack\/react-query(?:\/|$)|react-query(?:\/|$)|swr(?:\/|$)|@apollo\/client(?:\/|$)|urql(?:\/|$))/.test(
      normalized,
    )
  ) {
    return 'query';
  }
  if (
    /^(?:zustand(?:\/|$)|redux(?:\/|$)|react-redux(?:\/|$)|@reduxjs\/toolkit(?:\/|$)|jotai(?:\/|$)|recoil(?:\/|$)|mobx(?:\/|$)|mobx-react(?:-lite)?(?:\/|$)|xstate(?:\/|$)|@xstate\/react(?:\/|$)|valtio(?:\/|$)|effector(?:\/|$)|react-hook-form(?:\/|$))/.test(
      normalized,
    )
  ) {
    return 'state';
  }
  if (
    /^(?:react-router(?:-dom)?(?:\/|$)|@tanstack\/react-router(?:\/|$)|next\/(?:router|navigation|link)(?:\/|$))/.test(
      normalized,
    )
  ) {
    return 'router';
  }
  if (
    /^(?:axios(?:\/|$)|ky(?:\/|$)|superagent(?:\/|$)|got(?:\/|$)|graphql-request(?:\/|$)|node:(?:http|https)(?:\/|$)|https?(?:\/|$)|undici(?:\/|$)|cross-fetch(?:\/|$)|node-fetch(?:\/|$)|ofetch(?:\/|$))/.test(
      normalized,
    )
  ) {
    return 'request';
  }
  return null;
}

function isForbiddenLogicExternalConcern(concern: ExternalRuntimeConcern | null): boolean {
  return (
    concern === 'react' ||
    concern === 'query' ||
    concern === 'state' ||
    concern === 'router' ||
    concern === 'request'
  );
}

function isJsxTagReference(node: ts.Identifier): boolean {
  let current: ts.Node = node;
  while (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) {
    current = current.parent;
  }
  const parent = current.parent;
  return (
    (ts.isJsxOpeningElement(parent) ||
      ts.isJsxClosingElement(parent) ||
      ts.isJsxSelfClosingElement(parent)) &&
    parent.tagName === current
  );
}

/**
 * External modules have no source graph to inspect. Treat only style/assets and
 * bindings used exclusively as JSX tags as renderer-only imports.
 */
function isPresentationalExternalImport(
  sourceFile: ts.SourceFile,
  reference: ImportReference,
): boolean {
  if (isPresentationalAssetSpecifier(reference.specifier)) return true;
  const declaration = reference.node.parent;
  if (!ts.isImportDeclaration(declaration) || !declaration.importClause) return false;
  const clause = declaration.importClause;
  const bindings: ts.Identifier[] = [];
  if (clause.name) bindings.push(clause.name);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) bindings.push(clause.namedBindings.name);
    else {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) bindings.push(element.name);
      }
    }
  }
  if (bindings.length === 0) return false;
  for (const binding of bindings) {
    let references = 0;
    let rendererOnly = true;
    const visit = (node: ts.Node): void => {
      if (!rendererOnly || node === declaration) return;
      if (ts.isIdentifier(node) && node.text === binding.text) {
        references += 1;
        if (!isJsxTagReference(node)) rendererOnly = false;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!rendererOnly || references === 0) return false;
  }
  return true;
}

function isSafeReactUiSupportImport(
  sourceFile: ts.SourceFile,
  reference: ImportReference,
): boolean {
  if (
    reference.specifier === 'react/jsx-runtime' ||
    reference.specifier === 'react/jsx-dev-runtime'
  ) {
    return true;
  }
  if (reference.specifier !== 'react') return false;
  const declaration = reference.node.parent;
  if (!ts.isImportDeclaration(declaration)) return false;
  const clause = declaration.importClause;
  if (!clause) return true;
  const bindings: ts.Identifier[] = [];
  if (clause.name) bindings.push(clause.name);
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) bindings.push(clause.namedBindings.name);
    else {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) bindings.push(element.name);
      }
    }
  }

  for (const binding of bindings) {
    let safe = true;
    const visit = (node: ts.Node): void => {
      if (!safe || node === declaration) return;
      if (ts.isIdentifier(node) && node.text === binding.text) {
        if (isJsxTagReference(node)) return;
        let access: ts.Expression = node;
        while (
          ts.isPropertyAccessExpression(access.parent) &&
          access.parent.expression === access
        ) {
          access = access.parent;
        }
        if (ts.isCallExpression(access.parent) && access.parent.expression === access) {
          const name = propertyAccessPath(access)?.at(-1);
          if (
            name &&
            (name === 'use' ||
              /^use[A-Z0-9]/.test(name) ||
              name === 'createElement' ||
              name === 'cloneElement')
          ) {
            return;
          }
        }
        safe = false;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (!safe) return false;
  }
  return true;
}

function isTypeOnlyModuleReference(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    return (
      !clause.name &&
      !!clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every((element) => element.isTypeOnly)
    );
  }
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return true;
    return (
      !!node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 &&
      node.exportClause.elements.every((element) => element.isTypeOnly)
    );
  }
  if (ts.isImportEqualsDeclaration(node)) return node.isTypeOnly;
  return false;
}

function isPassiveTypesStatement(statement: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return true;
  if (ts.isImportDeclaration(statement)) return isTypeOnlyModuleReference(statement);
  if (ts.isExportDeclaration(statement)) {
    if (
      !statement.moduleSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.length === 0 || isTypeOnlyModuleReference(statement);
    }
    return isTypeOnlyModuleReference(statement);
  }
  return ts.isEmptyStatement(statement);
}

function passiveTypesReferenceViolations(statement: ts.Statement): readonly ts.Node[] {
  const violations: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeQueryNode(node)) {
      violations.push(node.exprName);
      return;
    }
    if (ts.isComputedPropertyName(node)) {
      violations.push(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return violations;
}

function collectImportReferences(sourceFile: ts.SourceFile): readonly ImportReference[] {
  const imports: ImportReference[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        node: node.moduleSpecifier,
        typeOnly: isTypeOnlyModuleReference(node),
      });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      imports.push({
        specifier: node.moduleReference.expression.text,
        node: node.moduleReference.expression,
        typeOnly: isTypeOnlyModuleReference(node),
      });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      imports.push({
        specifier: node.argument.literal.text,
        node: node.argument.literal,
        typeOnly: true,
      });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        imports.push({ specifier: argument.text, node: argument, typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function collectUnprovenDynamicModuleReferences(
  sourceFile: ts.SourceFile,
): readonly ts.CallExpression[] {
  const references: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument)) references.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function inferProjectRoot(
  files: readonly SrijikaArchitectureSourceFile[],
  architecture: ResolvedSrijikaArchitectureConfig,
  explicitRoot?: string,
): string {
  if (explicitRoot) return normalizePath(explicitRoot).replace(/\/$/, '');
  for (const root of [architecture.featuresRoot, architecture.sharedRoot]) {
    const marker = `/${root}/`;
    for (const file of files) {
      const normalized = normalizePath(file.fileName);
      const markerIndex = normalized.lastIndexOf(marker);
      if (markerIndex >= 0) return normalized.slice(0, markerIndex);
    }
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
      .find(([prefix]) =>
        prefix.endsWith('/') ? specifier.startsWith(prefix) : specifier === prefix,
      );
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

function matchingProjectAlias(
  specifier: string,
  aliases: Readonly<Record<string, string>>,
): readonly [string, string] | undefined {
  return Object.entries(aliases)
    .sort(([left], [right]) => right.length - left.length)
    .find(([prefix]) =>
      prefix.endsWith('/') ? specifier.startsWith(prefix) : specifier === prefix,
    );
}

function isReservedProjectAlias(specifier: string): boolean {
  return (
    specifier.startsWith('~/') ||
    specifier.startsWith('#') ||
    /^@(?:app|src)(?:\/|$)/.test(specifier)
  );
}

function isWithinConfiguredOwnershipRoot(
  fileName: string,
  projectRoot: string,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const normalized = normalizePath(fileName);
  return [architecture.featuresRoot, architecture.sharedRoot].some((root) => {
    const absoluteRoot = normalizedJoin(projectRoot, root).replace(/\/$/, '');
    return normalized === absoluteRoot || normalized.startsWith(`${absoluteRoot}/`);
  });
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
        : ownership.kind === 'part'
          ? ownership.part
          : ownership.shared;
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
  if (file.endsWith(architecture.storeSuffix) || /\.store(?:\.(?:ts|tsx))?$/.test(file)) {
    return 'store';
  }
  if (
    normalized.includes(`/${architecture.hooksDirectory}/`) ||
    /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(file)
  ) {
    return 'hook';
  }
  if (file.endsWith(architecture.connectorSuffix) || /\.connector(?:\.(?:ts|tsx))?$/.test(file)) {
    return 'connector';
  }
  if (file.endsWith(architecture.logicSuffix) || /\.logic(?:\.(?:ts|tsx))?$/.test(file)) {
    return 'logic';
  }
  if (file.endsWith(architecture.apiSuffix) || /\.api(?:\.(?:ts|tsx))?$/.test(file)) {
    return 'api';
  }
  return null;
}

type RuntimeCapability = Exclude<SrijikaArchitectureCapability, 'types' | 'ui'>;

function isRuntimeCapability(
  capability: SrijikaArchitectureCapability | undefined,
): capability is RuntimeCapability {
  return (
    capability === 'connector' ||
    capability === 'hook' ||
    capability === 'store' ||
    capability === 'logic' ||
    capability === 'api'
  );
}

function ownerKey(ownership: SrijikaArchitectureOwnership): string | null {
  if (ownership.kind === 'feature' && ownership.feature) return `feature:${ownership.feature}`;
  if (ownership.kind === 'slot' && ownership.feature && ownership.slot) {
    return `slot:${ownership.feature}/${ownership.slot}`;
  }
  if (ownership.kind === 'part' && ownership.feature && ownership.slot && ownership.part) {
    return `part:${ownership.feature}/${ownership.slot}/${ownership.part}`;
  }
  if (
    (ownership.kind === 'shared-ui' ||
      ownership.kind === 'shared-widget' ||
      ownership.kind === 'shared-capability') &&
    ownership.shared
  ) {
    return `${ownership.kind}:${ownership.shared}`;
  }
  return null;
}

function capabilityForOwnerFile(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): SrijikaArchitectureCapability | null {
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null) return null;
  const file = baseName(ownership.fileName);
  const segments = relative.split('/');
  const atRoot = segments.length === 1;
  const inHooks = segments.length === 2 && segments[0] === architecture.hooksDirectory;
  const inStores = segments.length === 2 && segments[0] === architecture.storesDirectory;
  if (atRoot && file === `${pascalName(owner)}${architecture.connectorSuffix}`) return 'connector';
  if ((atRoot || inHooks) && file === `use${pascalName(owner)}.ts`) return 'hook';
  if ((atRoot || inStores) && file === `${camelName(owner)}${architecture.storeSuffix}`)
    return 'store';
  if (atRoot && file === `${camelName(owner)}${architecture.logicSuffix}`) return 'logic';
  if (atRoot && file === `${camelName(owner)}${architecture.apiSuffix}`) return 'api';
  if (atRoot && file === `${camelName(owner)}${architecture.typesSuffix}`) return 'types';
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
    segments.length === 2 &&
    segments[0] === architecture.hooksDirectory &&
    new RegExp(`^use${pascalName(owner)}[A-Z0-9][A-Za-z0-9]*\\.ts$`).test(
      baseName(ownership.fileName),
    )
  );
}

function isOwnerHelperStore(
  ownership: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): boolean {
  const owner = ownershipName(ownership);
  const relative = ownerRelativePath(ownership);
  if (!owner || relative === null) return false;
  const segments = relative.split('/');
  const file = baseName(ownership.fileName);
  if (segments.length !== 2 || segments[0] !== architecture.storesDirectory) return false;
  if (!file.endsWith(architecture.storeSuffix)) return false;
  const prefix = camelName(owner);
  const stem = file.slice(0, -architecture.storeSuffix.length);
  return stem.startsWith(prefix) && /^[A-Z0-9][A-Za-z0-9]*$/.test(stem.slice(prefix.length));
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

const UI_FUNCTION_MEANINGFUL_LINE_LIMIT = 200;
const UI_FILE_MEANINGFUL_LINE_LIMIT = 300;
const UI_CONTRACT_MEMBER_LIMIT = 16;

function isCommentLikeNode(node: ts.Node): boolean {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
}

/** Mirrors the compiler-owned meaningful-line policy without adding a compiler dependency. */
function countMeaningfulLines(sourceFile: ts.SourceFile, root: ts.Node): number {
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (isCommentLikeNode(node)) return;
    const children = node.getChildren(sourceFile);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    if (end <= start) return;
    const startLine = sourceFile.getLineAndCharacterOfPosition(start).line;
    const endLine = sourceFile.getLineAndCharacterOfPosition(Math.max(start, end - 1)).line;
    for (let line = startLine; line <= endLine; line += 1) {
      const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
      const nextLineStart =
        line + 1 < sourceFile.getLineStarts().length
          ? sourceFile.getPositionOfLineAndCharacter(line + 1, 0)
          : sourceFile.text.length;
      const sliceStart = Math.max(start, lineStart);
      const sliceEnd = Math.min(end, nextLineStart);
      if (/\S/u.test(sourceFile.text.slice(sliceStart, sliceEnd))) lines.add(line);
    }
  };
  visit(root);
  return lines.size;
}

function exportedOwnerUiFunction(
  sourceFile: ts.SourceFile,
  owner: string,
): ts.FunctionDeclaration | null {
  const expectedName = `${pascalName(owner)}UI`;
  return (
    sourceFile.statements.find(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === expectedName &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
          true,
    ) ?? null
  );
}

type PromotableCapability = Extract<
  SrijikaArchitectureCapability,
  'hook' | 'store' | 'logic' | 'api'
>;

interface PromotionDestination {
  label: string;
  ownerName: string;
  ownerPath: string;
}

function kebabName(value: string): string {
  return canonicalOwnerFolderName(value);
}

function promotionDestination(
  origin: SrijikaArchitectureOwnership,
  target: SrijikaArchitectureOwnership,
  architecture: ResolvedSrijikaArchitectureConfig,
): PromotionDestination | null {
  if (!origin.feature || !target.feature) return null;
  if (origin.feature !== target.feature) {
    const sharedName = ownershipName(target);
    if (!sharedName) return null;
    const sharedFolder = kebabName(sharedName);
    return {
      label: `${architecture.sharedRoot}/capabilities/${sharedFolder}`,
      ownerName: sharedName,
      ownerPath: `${architecture.sharedRoot}/capabilities/${sharedFolder}`,
    };
  }
  if (target.slot && origin.slot !== target.slot) {
    return {
      label: `${target.feature} Feature root`,
      ownerName: target.feature,
      ownerPath: `${architecture.featuresRoot}/${target.feature}`,
    };
  }
  if (target.slot && target.part && origin.slot === target.slot && origin.part !== target.part) {
    return {
      label: `${target.slot} Slot root`,
      ownerName: target.slot,
      ownerPath: `${architecture.featuresRoot}/${target.feature}/${architecture.slotsDirectory}/${target.slot}`,
    };
  }
  return null;
}

function promotedCapabilityFile(
  destination: PromotionDestination,
  capability: PromotableCapability,
  architecture: ResolvedSrijikaArchitectureConfig,
): string {
  const fileName =
    capability === 'hook'
      ? `use${pascalName(destination.ownerName)}.ts`
      : capability === 'store'
        ? `${camelName(destination.ownerName)}${architecture.storeSuffix}`
        : capability === 'logic'
          ? `${camelName(destination.ownerName)}${architecture.logicSuffix}`
          : `${camelName(destination.ownerName)}${architecture.apiSuffix}`;
  return `${destination.ownerPath}/${fileName}`;
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
    SRIJIKA4110: 'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
    SRIJIKA4111: 'SRIJIKA-ARCH-MIXED-CAPABILITY-LAYOUT',
    SRIJIKA4112: 'SRIJIKA-ARCH-MISSING-CAPABILITY-GATEWAY',
    SRIJIKA4113: 'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY',
    SRIJIKA4114: 'SRIJIKA-ARCH-SHARED-PRIVATE-IMPORT',
    SRIJIKA4115: 'SRIJIKA-ARCH-SHARED-MISSING-RUNTIME-GATEWAY',
    SRIJIKA4116: 'SRIJIKA-ARCH-DIRECT-CHILD-UI',
    SRIJIKA4117: 'SRIJIKA-ARCH-PASSIVE-TYPES',
    SRIJIKA4118: 'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN',
    SRIJIKA4119: 'SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT',
    SRIJIKA4120: 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS',
    SRIJIKA4121: 'SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT',
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

function propertyAccessPath(expression: ts.Expression): readonly string[] | null {
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const parent = propertyAccessPath(expression.expression);
    return parent ? [...parent, expression.name.text] : null;
  }
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteralLike(expression.argumentExpression) ||
      ts.isNumericLiteral(expression.argumentExpression))
  ) {
    const parent = propertyAccessPath(expression.expression);
    return parent ? [...parent, expression.argumentExpression.text] : null;
  }
  return null;
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isStatement(current)) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

function isStandaloneRuntimeIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (isTypePosition(node)) return false;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isClassExpression(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isTypeParameterDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isImportEqualsDeclaration(parent) && parent.name === node) ||
    (ts.isModuleDeclaration(parent) && parent.name === node) ||
    (ts.isEnumMember(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    isJsxTagReference(node)
  ) {
    return false;
  }
  return true;
}

function outermostPropertyAccess(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    (ts.isPropertyAccessExpression(current.parent) ||
      ts.isElementAccessExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

function isCoveredByRuntimePropertyAccess(
  identifier: ts.Identifier,
  runtimeNames: ReadonlySet<string>,
): boolean {
  let current: ts.Expression = identifier;
  while (
    (ts.isPropertyAccessExpression(current.parent) ||
      ts.isElementAccessExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
    const terminalName = propertyAccessPath(current)?.at(-1);
    if (terminalName !== undefined && runtimeNames.has(terminalName)) return true;
  }
  return false;
}

function isCoveredByStaticPropertyAccess(identifier: ts.Identifier): boolean {
  const outermost = outermostPropertyAccess(identifier);
  return outermost !== identifier && propertyAccessPath(outermost) !== null;
}

function isDirectInvocationTarget(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  return (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === identifier
  );
}

function validateUiRuntimeUsage(
  file: SrijikaArchitectureSourceFile,
  sourceFile: ts.SourceFile,
  importedHookNames: ReadonlySet<string>,
): readonly SrijikaArchitectureDiagnostic[] {
  const diagnostics: SrijikaArchitectureDiagnostic[] = [];
  const browserRuntimeNames = new Set([
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Worker',
    'SharedWorker',
    'BroadcastChannel',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'caches',
    'document',
    'navigator',
    'location',
    'history',
    'Notification',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'MutationObserver',
    'ResizeObserver',
    'IntersectionObserver',
    'PerformanceObserver',
    'Image',
    'Audio',
    'FileReader',
    'DOMParser',
    'performance',
    'screen',
    'process',
    'Deno',
    'Bun',
  ]);
  const browserGlobals = new Set(['window', 'globalThis', 'self']);
  const reportedRuntimeReferences = new Set<string>();

  const reportRuntimeReference = (node: ts.Node, name: string): void => {
    const span = spanForNode(sourceFile, node);
    const key = `${span.start}:${span.end}:${name}`;
    if (reportedRuntimeReferences.has(key)) return;
    reportedRuntimeReferences.add(key);
    diagnostics.push(
      diagnostic(
        'SRIJIKA4101',
        file.fileName,
        span,
        `Pure UI files cannot access the ${name} browser/runtime API.`,
        'Move requests, sockets, and browser state access to the matching Connector or its Hook → Store → Logic → API chain, then pass values and event callbacks through typed props.',
      ),
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const path = propertyAccessPath(node.expression);
      const name = path?.at(-1);
      const importedIdentifier =
        ts.isIdentifier(node.expression) && importedHookNames.has(node.expression.text);
      if (name && (name === 'use' || /^use[A-Z0-9]/.test(name)) && !importedIdentifier) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4101',
            file.fileName,
            spanForNode(sourceFile, node.expression),
            `Pure UI files cannot call the ${path?.join('.') ?? name} hook.`,
            'Move lifecycle, state, store access, and data wiring to the matching Connector, then pass authored values and events through typed props.',
          ),
        );
      }
    }

    if (ts.isIdentifier(node) && browserRuntimeNames.has(node.text)) {
      if (isStandaloneRuntimeIdentifier(node)) reportRuntimeReference(node, node.text);
    } else if (ts.isIdentifier(node) && browserGlobals.has(node.text)) {
      if (
        isStandaloneRuntimeIdentifier(node) &&
        !isCoveredByRuntimePropertyAccess(node, browserRuntimeNames)
      ) {
        reportRuntimeReference(node, node.text);
      }
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const path = propertyAccessPath(node);
      const name = path?.at(-1);
      if (
        !isTypePosition(node) &&
        path &&
        name &&
        browserRuntimeNames.has(name) &&
        browserGlobals.has(path[0] ?? '')
      ) {
        reportRuntimeReference(node, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return diagnostics;
}

function validateLogicRuntimeUsage(
  file: SrijikaArchitectureSourceFile,
  sourceFile: ts.SourceFile,
): readonly SrijikaArchitectureDiagnostic[] {
  const diagnostics: SrijikaArchitectureDiagnostic[] = [];
  const queryLifecycleNames = new Set([
    'invalidateQueries',
    'refetchQueries',
    'resetQueries',
    'cancelQueries',
    'removeQueries',
    'setQueryData',
    'setQueriesData',
    'getQueryData',
    'getQueriesData',
    'fetchQuery',
    'prefetchQuery',
    'ensureQueryData',
  ]);
  const queryRuntimeConstructors = new Set(['QueryClient', 'QueryCache', 'MutationCache']);
  const logicTransportNames = new Set([
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'Request',
  ]);
  const browserGlobals = new Set(['window', 'globalThis', 'self']);
  const reported = new Set<string>();

  const reportConcern = (node: ts.Node, name: string): void => {
    const span = spanForNode(sourceFile, node);
    const key = `${span.start}:${span.end}:${name}`;
    if (reported.has(key)) return;
    reported.add(key);
    diagnostics.push(
      diagnostic(
        'SRIJIKA4118',
        file.fileName,
        span,
        `Business Logic cannot use the ${name} React, state, router, or query lifecycle concern.`,
        'Keep Logic framework-free and deterministic. Put React and query lifecycle behavior in the owner Hook, shared client state in Store, routing in Connector, and request transport in API.',
      ),
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const path = propertyAccessPath(node.expression);
      const name = path?.at(-1);
      if (
        name &&
        (name === 'use' ||
          /^use[A-Z0-9]/.test(name) ||
          queryLifecycleNames.has(name) ||
          logicTransportNames.has(name))
      ) {
        reportConcern(node.expression, path?.join('.') ?? name);
      }
    } else if (ts.isNewExpression(node)) {
      const path = propertyAccessPath(node.expression);
      const name = path?.at(-1);
      if (name && (queryRuntimeConstructors.has(name) || logicTransportNames.has(name))) {
        reportConcern(node.expression, path?.join('.') ?? name);
      }
    }
    if (ts.isIdentifier(node) && logicTransportNames.has(node.text)) {
      if (isStandaloneRuntimeIdentifier(node) && !isDirectInvocationTarget(node)) {
        reportConcern(node, node.text);
      }
    } else if (ts.isIdentifier(node) && browserGlobals.has(node.text)) {
      if (isStandaloneRuntimeIdentifier(node) && !isCoveredByStaticPropertyAccess(node)) {
        reportConcern(node, node.text);
      }
    } else if (
      !isTypePosition(node) &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
    ) {
      const path = propertyAccessPath(node);
      if (path && browserGlobals.has(path[0] ?? '')) {
        reportConcern(node, path.join('.'));
      }
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
    '@shared/': architecture.sharedRoot,
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
  const sharedDependencyEdges: Array<{
    originKey: string;
    targetKey: string;
    originName: string;
    targetName: string;
    fileName: string;
    targetFileName: string;
    span: SrijikaArchitectureSourceSpan;
  }> = [];
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

  const promotionRecommendationForImport = (
    origin: SrijikaArchitectureOwnership,
    target: SrijikaArchitectureOwnership,
    targetCapability: SrijikaArchitectureCapability | undefined,
  ): SrijikaArchitectureRecommendation | undefined => {
    if (
      targetCapability !== 'hook' &&
      targetCapability !== 'store' &&
      targetCapability !== 'logic' &&
      targetCapability !== 'api'
    ) {
      return undefined;
    }
    const destination = promotionDestination(origin, target, architecture);
    const originKey = ownerKey(origin);
    const targetKey = ownerKey(target);
    const targetName = ownershipName(target);
    if (!destination || !originKey || !targetKey || !targetName || originKey === targetKey) {
      return undefined;
    }
    const key = `${originKey}:${targetKey}:${targetCapability}:promote:${destination.ownerPath}`;
    if (recommendationKeys.has(key)) return undefined;
    recommendationKeys.add(key);
    const recommendation: SrijikaArchitectureRecommendation = {
      id: 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER',
      kind: 'maintainability',
      owner: targetName,
      ownerKind: target.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>,
      from: targetCapability,
      currentTarget: targetCapability,
      recommendedTarget: targetCapability,
      message: `The private ${targetName} ${targetCapability} is consumed across owner boundaries; promote it to the nearest common owner, ${destination.label}.`,
      suggestedFileName: promotedCapabilityFile(destination, targetCapability, architecture),
      evidence: { metric: 'owner-consumers', value: 2, threshold: 2 },
    };
    recommendations.push(recommendation);
    return recommendation;
  };

  for (const file of files) {
    const normalizedFileName = normalizePath(file.fileName);
    const ownership = classifySrijikaArchitecturePath(normalizedFileName, {
      ...options,
      architecture,
    });
    const key = ownerKey(ownership);
    const capability = capabilityForOwnerFile(ownership, architecture);
    const privateCapability = isOwnerHelperHook(ownership, architecture)
      ? 'hook'
      : isOwnerHelperStore(ownership, architecture)
        ? 'store'
        : null;
    if (key && (capability || privateCapability)) {
      fileCapabilities.set(normalizedFileName, capability ?? privateCapability!);
    }
    if (!key || !capability) continue;
    const current = ownerCapabilities.get(key) ?? new Set<SrijikaArchitectureCapability>();
    current.add(capability);
    ownerCapabilities.set(key, current);
    const capabilityFiles =
      ownerCapabilityFiles.get(key) ?? new Map<SrijikaArchitectureCapability, string>();
    capabilityFiles.set(capability, normalizedFileName);
    ownerCapabilityFiles.set(key, capabilityFiles);
  }

  const layouts = new Map<
    string,
    {
      owner: string;
      kind: Exclude<SrijikaArchitectureScopeKind, 'outside'>;
      flatHook?: SrijikaArchitectureSourceFile;
      expandedHook?: SrijikaArchitectureSourceFile;
      helperHooks: SrijikaArchitectureSourceFile[];
      flatStore?: SrijikaArchitectureSourceFile;
      expandedStore?: SrijikaArchitectureSourceFile;
      helperStores: SrijikaArchitectureSourceFile[];
    }
  >();
  for (const file of files) {
    const normalizedFileName = normalizePath(file.fileName);
    const ownership = classifySrijikaArchitecturePath(normalizedFileName, {
      ...options,
      architecture,
    });
    const key = ownerKey(ownership);
    const owner = ownershipName(ownership);
    const relative = ownerRelativePath(ownership);
    if (!key || !owner || relative === null || ownership.kind === 'outside') continue;
    const layout = layouts.get(key) ?? {
      owner,
      kind: ownership.kind,
      helperHooks: [],
      helperStores: [],
    };
    if (relative === `use${pascalName(owner)}.ts`) layout.flatHook = file;
    if (relative === `${architecture.hooksDirectory}/use${pascalName(owner)}.ts`)
      layout.expandedHook = file;
    if (isOwnerHelperHook(ownership, architecture)) layout.helperHooks.push(file);
    if (relative === `${camelName(owner)}${architecture.storeSuffix}`) layout.flatStore = file;
    if (
      relative === `${architecture.storesDirectory}/${camelName(owner)}${architecture.storeSuffix}`
    )
      layout.expandedStore = file;
    if (isOwnerHelperStore(ownership, architecture)) layout.helperStores.push(file);
    layouts.set(key, layout);
  }

  const layoutAnchor = (file: SrijikaArchitectureSourceFile): SrijikaArchitectureSourceSpan =>
    fileAnchor(
      ts.createSourceFile(
        file.fileName,
        file.source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindForFile(file.fileName),
      ),
    );
  for (const layout of layouts.values()) {
    const validateLayout = (
      capability: 'Hook' | 'Store',
      flat: SrijikaArchitectureSourceFile | undefined,
      expanded: SrijikaArchitectureSourceFile | undefined,
      helpers: readonly SrijikaArchitectureSourceFile[],
      gatewayName: string,
      directory: string,
    ): void => {
      if (flat && expanded) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4111',
            expanded.fileName,
            layoutAnchor(expanded),
            `${layout.owner} has both flat and expanded ${capability} gateways.`,
            `Keep exactly one gateway. When ${directory}/ exists, move ${gatewayName} into ${directory}/, update imports, and remove the root copy.`,
          ),
        );
      }
      if (helpers.length > 0 && flat && !expanded) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4111',
            helpers[0]!.fileName,
            layoutAnchor(helpers[0]!),
            `${layout.owner} mixes a flat ${capability} gateway with expanded ${directory}/ helpers.`,
            `Move ${gatewayName} into ${directory}/ and update all imports. Flat and expanded modes cannot be mixed.`,
          ),
        );
      }
      if (helpers.length > 0 && !flat && !expanded) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4112',
            helpers[0]!.fileName,
            layoutAnchor(helpers[0]!),
            `${layout.owner} ${directory}/ helpers have no canonical expanded ${gatewayName} gateway.`,
            `Create ${directory}/${gatewayName}. All ${capability} access must pass through that owner-named gateway.`,
          ),
        );
      }
    };
    validateLayout(
      'Hook',
      layout.flatHook,
      layout.expandedHook,
      layout.helperHooks,
      `use${pascalName(layout.owner)}.ts`,
      architecture.hooksDirectory,
    );
    validateLayout(
      'Store',
      layout.flatStore,
      layout.expandedStore,
      layout.helperStores,
      `${camelName(layout.owner)}${architecture.storeSuffix}`,
      architecture.storesDirectory,
    );
  }

  for (const file of files) {
    const normalizedFileName = normalizePath(file.fileName);
    const sourceFile = ts.createSourceFile(
      normalizedFileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForFile(normalizedFileName),
    );
    const origin = classifySrijikaArchitecturePath(normalizedFileName, {
      ...options,
      architecture,
    });
    const isUi = normalizedFileName.endsWith(architecture.uiSuffix);
    const isLogic = normalizedFileName.endsWith(architecture.logicSuffix);
    const governedOrigin = isWithinConfiguredOwnershipRoot(
      normalizedFileName,
      projectRoot,
      architecture,
    );
    const importedHookNames = new Set<string>();
    const anchorSpan = fileAnchor(sourceFile);
    if (isNoncanonicalSharedSourcePath(normalizedFileName, projectRoot, architecture)) {
      diagnostics.push(
        diagnostic(
          'SRIJIKA4110',
          file.fileName,
          anchorSpan,
          `${baseName(file.fileName)} is inside ${architecture.sharedRoot} but outside its strict owner categories.`,
          `Shared source belongs only under ${architecture.sharedRoot}/ui/<owner>, ${architecture.sharedRoot}/widgets/<owner>, or ${architecture.sharedRoot}/capabilities/<owner>. Freehand root files, utils, common, and alternate categories are forbidden.`,
        ),
      );
    }
    const invalidOwnerFolders = noncanonicalOwnerFolders(origin);
    if (invalidOwnerFolders.length > 0) {
      diagnostics.push(
        diagnostic(
          'SRIJIKA4110',
          file.fileName,
          anchorSpan,
          `This source uses noncanonical owner folder naming: ${invalidOwnerFolders
            .map(({ role, actual }) => `${role} "${actual}"`)
            .join(', ')}.`,
          `Rename each owner folder to its exact kebab-case path: ${invalidOwnerFolders
            .map(({ role, expected }) => `${role} → ${expected}`)
            .join(
              ', ',
            )}. UI, Connector, and capability filenames remain derived from the same PascalCase owner name.`,
        ),
      );
    }
    diagnostics.push(...structureDiagnosticsForFile(file, sourceFile, origin, architecture));
    if (governedOrigin || isUi) {
      for (const reference of collectUnprovenDynamicModuleReferences(sourceFile)) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4119',
            file.fileName,
            spanForNode(sourceFile, reference),
            'This dynamic module reference cannot be proven against Srijika ownership boundaries.',
            'Use a static string literal or no-substitution template literal in import()/require(). Computed module targets are forbidden inside Feature, Slot, Part, and Shared ownership roots.',
          ),
        );
      }
    }
    if (normalizedFileName.endsWith(architecture.typesSuffix)) {
      for (const statement of sourceFile.statements) {
        if (!isPassiveTypesStatement(statement)) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4117',
              file.fileName,
              spanForNode(sourceFile, statement),
              `${baseName(file.fileName)} contains a runtime declaration or value import/export.`,
              'Types files are passive contracts. Keep only interfaces, type aliases, import type/export type declarations, and an optional empty export {}; move runtime values to Hook, Store, Logic, or API.',
            ),
          );
          continue;
        }
        for (const reference of passiveTypesReferenceViolations(statement)) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4117',
              file.fileName,
              spanForNode(sourceFile, reference),
              `${baseName(file.fileName)} references a runtime value from its passive Types contract.`,
              'Replace typeof/computed runtime references with an explicit passive interface or type alias imported through import type/export type.',
            ),
          );
        }
      }
    }

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
    if (
      (origin.kind === 'shared-ui' ||
        origin.kind === 'shared-widget' ||
        origin.kind === 'shared-capability') &&
      origin.shared
    ) {
      registerOwner(
        `${origin.kind}:${origin.shared}`,
        origin,
        file,
        anchorSpan,
        origin.kind !== 'shared-capability' && isOwnerUiEntry(origin, architecture),
        origin.kind === 'shared-widget' && isOwnerConnectorEntry(origin, architecture),
        origin.kind !== 'shared-capability',
      );
    }

    if (isUi && isOwnerUiEntry(origin, architecture)) {
      const key = ownerKey(origin);
      const name = ownershipName(origin);
      const component = name ? exportedOwnerUiFunction(sourceFile, name) : null;
      if (key && name && component) {
        const fileLines = countMeaningfulLines(sourceFile, sourceFile);
        const functionLines = countMeaningfulLines(sourceFile, component);
        const parameterType = component.parameters[0]?.type;
        const contractName =
          parameterType &&
          ts.isTypeReferenceNode(parameterType) &&
          ts.isIdentifier(parameterType.typeName)
            ? parameterType.typeName.text
            : null;
        const contract = contractName
          ? sourceFile.statements.find(
              (statement): statement is ts.InterfaceDeclaration =>
                ts.isInterfaceDeclaration(statement) && statement.name.text === contractName,
            )
          : undefined;
        const contractMembers = contract?.members ?? [];
        const breaches: Array<{
          metric: 'ui-function-lines' | 'ui-file-lines' | 'ui-contract-members';
          value: number;
          threshold: number;
          span: SrijikaArchitectureSourceSpan;
          description: string;
        }> = [];
        if (functionLines > UI_FUNCTION_MEANINGFUL_LINE_LIMIT) {
          breaches.push({
            metric: 'ui-function-lines',
            value: functionLines,
            threshold: UI_FUNCTION_MEANINGFUL_LINE_LIMIT,
            span: spanForNode(sourceFile, component.name ?? component),
            description: `${functionLines} meaningful exported-function lines`,
          });
        }
        if (fileLines > UI_FILE_MEANINGFUL_LINE_LIMIT) {
          breaches.push({
            metric: 'ui-file-lines',
            value: fileLines,
            threshold: UI_FILE_MEANINGFUL_LINE_LIMIT,
            span: anchorSpan,
            description: `${fileLines} meaningful file lines`,
          });
        }
        if (contractMembers.length > UI_CONTRACT_MEMBER_LIMIT) {
          const overflowMember = contractMembers[UI_CONTRACT_MEMBER_LIMIT];
          breaches.push({
            metric: 'ui-contract-members',
            value: contractMembers.length,
            threshold: UI_CONTRACT_MEMBER_LIMIT,
            span: overflowMember ? spanForNode(sourceFile, overflowMember) : anchorSpan,
            description: `${contractMembers.length} top-level contract members`,
          });
        }
        const firstBreach = breaches[0];
        const recommendationKey = `${key}:SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER`;
        if (firstBreach && !recommendationKeys.has(recommendationKey)) {
          recommendationKeys.add(recommendationKey);
          const recommendation: SrijikaArchitectureRecommendation = {
            id: 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
            kind: 'maintainability',
            owner: name,
            ownerKind: origin.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>,
            from: 'ui',
            currentTarget: 'ui',
            recommendedTarget: 'ui',
            message: `The ${name} UI exceeds its owner guardrail (${breaches.map(({ description }) => description).join(', ')}); split it into a focused child owner.`,
            evidence: {
              metric: firstBreach.metric,
              value: firstBreach.value,
              threshold: firstBreach.threshold,
            },
          };
          recommendations.push(recommendation);
          diagnostics.push(
            diagnostic(
              'SRIJIKA4202',
              file.fileName,
              firstBreach.span,
              recommendation.message,
              `This deterministic recommendation is non-blocking. The limits are strictly greater than 200 meaningful UI-function lines, 300 meaningful UI-file lines, or 16 top-level contract members. Extract a focused Part, Slot, or separate Shared owner without flattening ownership.`,
              undefined,
              recommendation,
              'warning',
            ),
          );
        }
      }
    }

    if (isUi) {
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
        const clause = statement.importClause;
        const modulePath = ts.isStringLiteralLike(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : '';
        const architectureHookTarget =
          forbiddenUiModule(modulePath, architecture) !== null &&
          resolveImportTarget(normalizedFileName, modulePath, fileLookup, projectRoot, aliases) !==
            null;
        if (clause.name && (clause.name.text === 'use' || /^use[A-Z0-9]/.test(clause.name.text))) {
          importedHookNames.add(clause.name.text);
          if (!architectureHookTarget) {
            diagnostics.push(
              diagnostic(
                'SRIJIKA4101',
                file.fileName,
                spanForNode(sourceFile, clause.name),
                `Pure UI files cannot import the ${clause.name.text} hook.`,
                'Call this hook in the matching Connector and pass its values or event callbacks into the UI through typed props.',
              ),
            );
          }
        }
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (importedName === 'use' || /^use[A-Z0-9]/.test(importedName)) {
              importedHookNames.add(element.name.text);
              if (!architectureHookTarget) {
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
      const span = moduleSpecifierSpan(sourceFile, reference.node);
      const uiRuntimeImport = isUi && !reference.typeOnly;
      const sharedUiRuntimeImport = origin.kind === 'shared-ui' && !reference.typeOnly;
      if (isPresentationalAssetSpecifier(reference.specifier)) continue;
      const targetFileName = resolveImportTarget(
        normalizedFileName,
        reference.specifier,
        fileLookup,
        projectRoot,
        aliases,
      );
      const declaredAlias = matchingProjectAlias(reference.specifier, aliases);
      if (
        (declaredAlias !== undefined || isReservedProjectAlias(reference.specifier)) &&
        (!declaredAlias ||
          !targetFileName ||
          !sourceByFile.has(normalizePath(targetFileName)) ||
          !isWithinConfiguredOwnershipRoot(targetFileName, projectRoot, architecture))
      ) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4120',
            file.fileName,
            span,
            `The project-local alias ${reference.specifier} does not resolve to a scanned governed source file.`,
            'Declare the alias in tsconfig.json compilerOptions.paths and point it to a source inside the configured Feature or Shared ownership roots. Unresolved project aliases fail closed; use ordinary package specifiers only for external npm dependencies.',
            targetFileName ?? undefined,
          ),
        );
        continue;
      }
      const projectLocalImport =
        reference.specifier.startsWith('.') || reference.specifier.startsWith('src/');
      if (
        (governedOrigin || isUi) &&
        projectLocalImport &&
        (!targetFileName ||
          !sourceByFile.has(normalizePath(targetFileName)) ||
          !isWithinConfiguredOwnershipRoot(targetFileName, projectRoot, architecture))
      ) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4121',
            file.fileName,
            span,
            `The project-local module ${reference.specifier} does not resolve to a scanned governed source file.`,
            `Keep source imports inside ${architecture.featuresRoot} or ${architecture.sharedRoot}, and make sure the target exists in the bounded architecture scan. Styles and static assets remain allowed; external packages must use bare npm specifiers.`,
            targetFileName ?? undefined,
          ),
        );
        continue;
      }
      if (!targetFileName) {
        const concern = externalRuntimeConcern(reference.specifier);
        if (isLogic && isForbiddenLogicExternalConcern(concern)) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4118',
              file.fileName,
              span,
              `Business Logic cannot import the ${concern} runtime module ${reference.specifier}.`,
              'Keep Logic framework-free and deterministic. Put React and query lifecycle behavior in the owner Hook, shared client state in Store, routing in Connector, and request transport in API.',
            ),
          );
        }
        const safeReactSupport =
          concern === 'react' && isSafeReactUiSupportImport(sourceFile, reference);
        if (
          uiRuntimeImport &&
          !safeReactSupport &&
          (concern !== null || !isPresentationalExternalImport(sourceFile, reference))
        ) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4101',
              file.fileName,
              span,
              origin.kind === 'shared-ui'
                ? `Shared UI primitives cannot import the non-presentational runtime module ${reference.specifier}.`
                : `Pure UI files cannot import the non-presentational runtime module ${reference.specifier}.`,
              origin.kind === 'shared-ui'
                ? 'Keep this primitive renderer-only. External imports are limited to styles/assets, safe React JSX support, or bindings used exclusively as JSX tags; move hooks, state, routing, data access, and callable utilities into a Shared Widget Connector.'
                : 'Keep this UI renderer-only. External imports are limited to styles/assets, safe React JSX support, or bindings used exclusively as JSX tags; move hooks, state, routing, data access, and callable utilities into the matching Connector chain.',
            ),
          );
        }
        continue;
      }
      const target = classifySrijikaArchitecturePath(targetFileName, {
        ...options,
        architecture,
      });
      const sharedUiPublicPrimitiveImport =
        sharedUiRuntimeImport &&
        target.kind === 'shared-ui' &&
        isOwnerUiEntry(target, architecture);
      if (sharedUiRuntimeImport && !sharedUiPublicPrimitiveImport) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4101',
            file.fileName,
            span,
            `Shared UI primitives cannot import the runtime module ${reference.specifier}.`,
            `Keep this primitive renderer-only. It may compose another canonical ${architecture.sharedRoot}/ui public UI boundary, styles/assets, and external bindings used exclusively as JSX tags; all behavior belongs in a Shared Widget Connector.`,
            targetFileName,
          ),
        );
      }

      const originKey = ownerKey(origin);
      const targetKey = ownerKey(target);
      const originCapability = fileCapabilities.get(normalizedFileName);
      const targetCapability = fileCapabilities.get(normalizePath(targetFileName));
      if (normalizePath(targetFileName).endsWith(architecture.typesSuffix) && !reference.typeOnly) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4117',
            file.fileName,
            span,
            `${reference.specifier} is a passive Types contract but is imported or exported as a runtime value.`,
            'Use import type/export type for canonical Types modules. Move every runtime value to the matching Hook, Store, Logic, or API owner capability.',
            targetFileName,
          ),
        );
        continue;
      }
      const targetIsOwnerUi = isOwnerUiEntry(target, architecture);
      const matchingConnectorOwnUi =
        originKey !== null && originKey === targetKey && originCapability === 'connector';
      const pureUiSharedPrimitive =
        isUi && originKey !== targetKey && target.kind === 'shared-ui' && targetIsOwnerUi;
      if (targetIsOwnerUi && !matchingConnectorOwnUi && !pureUiSharedPrimitive) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4116',
            file.fileName,
            span,
            `${ownershipName(origin) ?? baseName(file.fileName)} cannot import the ${ownershipName(target) ?? 'target'} UI directly.`,
            `A UI is rendered only by its matching Connector. Compose ${ownershipName(target) ?? 'the child'} through ${pascalName(ownershipName(target) ?? 'Owner')}${architecture.connectorSuffix}; the only cross-owner UI exception is pure UI composition of a canonical Shared UI Primitive.`,
            targetFileName,
          ),
        );
        continue;
      }
      const privateStoreBypass =
        isOwnerHelperStore(target, architecture) &&
        origin.kind !== 'outside' &&
        (target.feature !== undefined
          ? origin.feature === target.feature
          : originKey !== null && originKey === targetKey) &&
        !(originKey === targetKey && capabilityForOwnerFile(origin, architecture) === 'store');
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
          message: `Connector must use the canonical ${architecture.hooksDirectory}/use${pascalName(name)}.ts gateway instead of a private helper Hook.`,
          suggestedFileName: `${architecture.hooksDirectory}/use${pascalName(name)}.ts`,
        };
        recommendations.push(recommendation);
        diagnostics.push(
          diagnostic(
            'SRIJIKA4201',
            file.fileName,
            span,
            `The ${name} Connector bypasses its canonical Hook gateway to import the private helper ${reference.specifier}.`,
            `Import ${architecture.hooksDirectory}/use${pascalName(name)}.ts from the Connector. The gateway may compose owner-prefixed helpers internally.`,
            targetFileName,
            recommendation,
          ),
        );
      }
      if (privateStoreBypass) {
        const name = ownershipName(target) ?? 'owner';
        const recommendation: SrijikaArchitectureRecommendation = {
          id: 'SRIJIKA-ARCH-RECOMMEND-STORE',
          kind: 'required-fix',
          owner: name,
          ownerKind: target.kind as Exclude<SrijikaArchitectureScopeKind, 'outside'>,
          from: originCapability ?? 'connector',
          currentTarget: 'store',
          recommendedTarget: 'store',
          message: `${name} runtime code must enter private Store concerns through the canonical ${architecture.storesDirectory}/${camelName(name)}${architecture.storeSuffix} gateway.`,
          suggestedFileName: `${architecture.storesDirectory}/${camelName(name)}${architecture.storeSuffix}`,
        };
        recommendations.push(recommendation);
        diagnostics.push(
          diagnostic(
            'SRIJIKA4201',
            file.fileName,
            span,
            `The ${ownershipName(origin) ?? 'module'} ${originCapability ?? 'module'} bypasses the ${name} canonical Store gateway to import the private slice ${reference.specifier}.`,
            `Import ${architecture.storesDirectory}/${camelName(name)}${architecture.storeSuffix}. Only that public Store gateway may expose owner-private Store concerns.`,
            targetFileName,
            recommendation,
          ),
        );
      }
      if (
        originKey &&
        originKey === targetKey &&
        isRuntimeCapability(originCapability) &&
        isRuntimeCapability(targetCapability) &&
        !privateStoreBypass &&
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
        isRuntimeCapability(originCapability) &&
        isRuntimeCapability(targetCapability) &&
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
        isRuntimeCapability(targetCapability) &&
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

      if (isUi && !sharedUiRuntimeImport) {
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

      const originIsShared =
        origin.kind === 'shared-ui' ||
        origin.kind === 'shared-widget' ||
        origin.kind === 'shared-capability';
      const targetIsShared =
        target.kind === 'shared-ui' ||
        target.kind === 'shared-widget' ||
        target.kind === 'shared-capability';
      if (originIsShared && !targetIsShared && target.kind !== 'outside') {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4113',
            file.fileName,
            span,
            `Shared code cannot import the Feature-owned module ${reference.specifier}.`,
            `Shared dependencies are one-way: Features may consume public Shared boundaries, but Shared owners never depend on src/features. Move genuinely cross-feature behavior into ${architecture.sharedRoot}.`,
            targetFileName,
          ),
        );
        continue;
      }

      if (targetIsShared) {
        if (originKey === targetKey) continue;
        const publicTargetCapability = capabilityForOwnerFile(target, architecture);
        const targetCapabilities = targetKey
          ? (ownerCapabilities.get(targetKey) ?? new Set<SrijikaArchitectureCapability>())
          : new Set<SrijikaArchitectureCapability>();
        const highestCapability = (['hook', 'store', 'logic', 'api'] as const).find((role) =>
          targetCapabilities.has(role),
        );
        const publicSharedBoundary =
          publicTargetCapability === 'types' ||
          (target.kind === 'shared-ui' && isOwnerUiEntry(target, architecture)) ||
          (target.kind === 'shared-widget' && publicTargetCapability === 'connector') ||
          (target.kind === 'shared-capability' &&
            highestCapability !== undefined &&
            (publicTargetCapability === highestCapability || publicTargetCapability === 'api'));
        if (!publicSharedBoundary) {
          diagnostics.push(
            diagnostic(
              'SRIJIKA4114',
              file.fileName,
              span,
              `The ${target.shared ?? 'target'} ${target.kind} keeps ${reference.specifier} behind its public Shared boundary.`,
              target.kind === 'shared-ui'
                ? `Import only its canonical pure UI entry${targetCapabilities.has('types') ? ' or passive Types contract' : ''}.`
                : target.kind === 'shared-widget'
                  ? `Import only its canonical Connector entry or passive Types contract.`
                  : `Import the highest available capability gateway (${highestCapability ?? 'Hook, Store, Logic, or API'}), an explicit API boundary, or its passive Types contract. Private helpers and lower runtime layers remain owner-private.`,
              targetFileName,
            ),
          );
        } else if (
          originIsShared &&
          originKey &&
          targetKey &&
          !reference.typeOnly &&
          (!sharedUiRuntimeImport || sharedUiPublicPrimitiveImport)
        ) {
          sharedDependencyEdges.push({
            originKey,
            targetKey,
            originName: ownershipName(origin) ?? originKey,
            targetName: ownershipName(target) ?? targetKey,
            fileName: file.fileName,
            targetFileName,
            span,
          });
        }
        continue;
      }

      if (target.kind === 'outside') continue;
      const sameFeature = origin.feature !== undefined && origin.feature === target.feature;
      const publicFeatureEntry = target.kind === 'feature' && isMainEntry(target, architecture);
      if (!sameFeature && !publicFeatureEntry) {
        const promotion = promotionRecommendationForImport(origin, target, targetCapability);
        diagnostics.push(
          diagnostic(
            'SRIJIKA4102',
            file.fileName,
            span,
            `The ${target.feature ?? 'target'} feature keeps ${reference.specifier} private.`,
            promotion
              ? `${promotion.message} Use ${promotion.suggestedFileName} as the canonical promoted gateway in the shared domain.`
              : `Import the feature's public UI/Connector entry instead. If both features own this behavior or state, promote it to the nearest shared domain rather than crossing a private feature boundary.`,
            targetFileName,
            promotion,
          ),
        );
        continue;
      }

      if (sameFeature && isSlotPrivateModule(target, architecture)) {
        const sameSlot = origin.slot !== undefined && origin.slot === target.slot;
        if (!sameSlot) {
          const promotion = promotionRecommendationForImport(origin, target, targetCapability);
          diagnostics.push(
            diagnostic(
              'SRIJIKA4103',
              file.fileName,
              span,
              `The ${target.slot ?? 'target'} slot keeps ${reference.specifier} inside its own subtree.`,
              promotion
                ? `${promotion.message} Use ${promotion.suggestedFileName} as the canonical promoted gateway.`
                : `Do not import slot stores, hooks, parts, or private modules from a parent or sibling slot. If multiple areas need it, promote it to the ${target.feature ?? 'feature'} feature scope.`,
              targetFileName,
              promotion,
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
        const promotion = promotionRecommendationForImport(origin, target, targetCapability);
        diagnostics.push(
          diagnostic(
            'SRIJIKA4104',
            file.fileName,
            span,
            targetIsPublicEntry && importingSibling
              ? `The ${origin.part ?? 'current'} sibling part cannot import the ${target.part ?? 'target'} part public entry ${reference.specifier}.`
              : `The ${target.part ?? 'target'} part keeps ${reference.specifier} private to its own subtree.`,
            promotion
              ? `${promotion.message} Use ${promotion.suggestedFileName} as the canonical promoted gateway at the slot scope.`
              : targetIsPublicEntry && importingSibling
                ? `Compose the ${target.part ?? 'target'} public UI/Connector from the owning ${target.slot ?? 'slot'} slot. Promote shared sibling behavior to that slot scope.`
                : `The owning ${target.slot ?? 'slot'} slot may compose only this part's public UI/Connector. Keep part stores, hooks, and private files inside ${target.part ?? 'the part'}; promote genuinely shared behavior to the slot scope.`,
            targetFileName,
            promotion,
          ),
        );
      }
    }

    if (isUi) diagnostics.push(...validateUiRuntimeUsage(file, sourceFile, importedHookNames));
    if (isLogic) diagnostics.push(...validateLogicRuntimeUsage(file, sourceFile));
  }

  const sharedAdjacency = new Map<string, Set<string>>();
  for (const edge of sharedDependencyEdges) {
    const targets = sharedAdjacency.get(edge.originKey) ?? new Set<string>();
    targets.add(edge.targetKey);
    sharedAdjacency.set(edge.originKey, targets);
  }
  const canReachSharedOwner = (start: string, goal: string): boolean => {
    const pending = [start];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      if (current === goal) return true;
      visited.add(current);
      const targets = [...(sharedAdjacency.get(current) ?? [])].sort().reverse();
      pending.push(...targets);
    }
    return false;
  };
  const reportedCycleEdges = new Set<string>();
  for (const edge of [...sharedDependencyEdges].sort(
    (left, right) =>
      normalizePath(left.fileName).localeCompare(normalizePath(right.fileName)) ||
      left.span.start - right.span.start ||
      left.targetKey.localeCompare(right.targetKey),
  )) {
    const edgeKey = `${edge.originKey}->${edge.targetKey}`;
    if (reportedCycleEdges.has(edgeKey) || !canReachSharedOwner(edge.targetKey, edge.originKey)) {
      continue;
    }
    reportedCycleEdges.add(edgeKey);
    diagnostics.push(
      diagnostic(
        'SRIJIKA4113',
        edge.fileName,
        edge.span,
        `The ${edge.originName} Shared owner import of ${edge.targetName} participates in a Shared dependency cycle.`,
        `Shared owners may consume another Shared owner's public runtime boundary, but the owner graph must remain acyclic. Move the common behavior to a narrower independent Shared owner and remove one direction of this cycle.`,
        edge.targetFileName,
      ),
    );
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
        scriptKindForFile(fileName),
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
    const name = ownershipName(owner.ownership);
    if (!name) continue;
    if (owner.ownership.kind === 'shared-capability') {
      const key = ownerKey(owner.ownership);
      const capabilities = key ? ownerCapabilities.get(key) : undefined;
      if (
        !capabilities ||
        !(['hook', 'store', 'logic', 'api', 'types'] as const).some((role) =>
          capabilities.has(role),
        )
      ) {
        diagnostics.push(
          diagnostic(
            'SRIJIKA4115',
            owner.anchorFile.fileName,
            owner.anchorSpan,
            `The ${name} shared headless capability has no public runtime gateway.`,
            `Add at least one canonical Hook, Store, Logic, API, or passive Types contract. Types-only capabilities expose no runtime behavior and consumers must import them with import type.`,
          ),
        );
      }
      continue;
    }
    if (!owner.requiresUi) continue;
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
    if (owner.ownership.kind !== 'shared-ui' && !owner.hasConnector) {
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
