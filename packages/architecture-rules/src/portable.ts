import type fs from 'node:fs/promises';
import type path from 'node:path';

import type ts from 'typescript';

import { resolveSrijikaArchitectureConfig } from './config';
import type { SrijikaArchitectureConfig } from './types';

interface PortableRuntime {
  fs: typeof fs;
  path: typeof path;
  ts: typeof ts;
}

interface PortableFile {
  fileName: string;
  source: string;
}

interface PortableOwner {
  kind: 'outside' | 'feature' | 'slot' | 'part';
  fileName: string;
  feature?: string;
  slot?: string;
  part?: string;
  rest?: readonly string[];
  slotRest?: readonly string[];
  partRest?: readonly string[];
}

interface PortableSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}

type PortableMain = (
  runtime: PortableRuntime,
  projectRoot: string,
  rawConfig: ReturnType<typeof resolveSrijikaArchitectureConfig>,
) => Promise<void>;

/**
 * Deliberately self-contained: `Function#toString()` is embedded in generated
 * projects, so this function must not close over package-local declarations.
 */
const portableMain: PortableMain = async function portableMain(runtime, projectRoot, rawConfig) {
  const { fs, path, ts } = runtime;
  const config = rawConfig;
  const normalizedProjectRoot = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const sourceRoot = path.resolve(projectRoot, 'src');
  const ignored = new Set(['node_modules', 'dist', 'build', '.git', '.srijika']);
  const files: PortableFile[] = [];

  async function collect(directory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(absolute);
      else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push({
          fileName: absolute.replaceAll('\\', '/'),
          source: await fs.readFile(absolute, 'utf8'),
        });
      }
    }
  }
  await collect(sourceRoot);

  const fileMap = new Map<string, string>();
  function stripExtension(value: string): string {
    return value.replace(/\.(?:tsx|ts|mts|cts)$/, '');
  }
  for (const file of files) {
    fileMap.set(file.fileName, file.fileName);
    fileMap.set(stripExtension(file.fileName), file.fileName);
    if (/\/index\.(?:tsx|ts|mts|cts)$/.test(file.fileName)) {
      fileMap.set(stripExtension(file.fileName).replace(/\/index$/, ''), file.fileName);
    }
  }

  function clean(value: string): string {
    return value.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
  }
  function classify(fileName: string): PortableOwner {
    const normalized = clean(fileName);
    const relative = normalized.startsWith(`${normalizedProjectRoot}/`)
      ? normalized.slice(normalizedProjectRoot.length + 1)
      : normalized;
    const segments = relative.split('/').filter(Boolean);
    const rootSegments = config.featuresRoot.split('/').filter(Boolean);
    let rootIndex = -1;
    for (let index = 0; index <= segments.length - rootSegments.length; index += 1) {
      if (rootSegments.every((segment, offset) => segments[index + offset] === segment))
        rootIndex = index;
    }
    if (rootIndex < 0) return { kind: 'outside', fileName: normalized };
    const featureIndex = rootIndex + rootSegments.length;
    const feature = segments[featureIndex];
    if (!feature) return { kind: 'outside', fileName: normalized };
    const rest = segments.slice(featureIndex + 1);
    const slotIndex = rest.indexOf(config.slotsDirectory);
    if (slotIndex < 0 || !rest[slotIndex + 1]) {
      return { kind: 'feature', fileName: normalized, feature, rest };
    }
    const slot = rest[slotIndex + 1]!;
    const slotRest = rest.slice(slotIndex + 2);
    const partIndex = slotRest.indexOf(config.partsDirectory);
    if (partIndex < 0 || !slotRest[partIndex + 1]) {
      return { kind: 'slot', fileName: normalized, feature, slot, rest, slotRest };
    }
    const partSegment = slotRest[partIndex + 1]!;
    const part = /\.(?:tsx|ts|mts|cts)$/.test(partSegment)
      ? stripExtension(partSegment).split('.')[0]!
      : partSegment;
    return {
      kind: 'part',
      fileName: normalized,
      feature,
      slot,
      part,
      rest,
      slotRest,
      partRest: slotRest.slice(partIndex + 2),
    };
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
  function ownerName(owner: PortableOwner): string | null {
    return owner.kind === 'feature'
      ? (owner.feature ?? null)
      : owner.kind === 'slot'
        ? (owner.slot ?? null)
        : owner.kind === 'part'
          ? (owner.part ?? null)
          : null;
  }
  function ownerRelative(owner: PortableOwner): readonly string[] {
    if (owner.kind === 'feature') return owner.rest ?? [];
    if (owner.kind === 'slot') return owner.slotRest ?? [];
    if (owner.kind === 'part') return owner.partRest ?? [];
    return [];
  }
  function isEntry(owner: PortableOwner): boolean {
    const file = owner.fileName.split('/').at(-1) ?? '';
    const relative = ownerRelative(owner);
    const name =
      owner.kind === 'feature' ? owner.feature : owner.kind === 'slot' ? owner.slot : owner.part;
    if (!name) return false;
    if (file === 'index.ts' || file === 'index.tsx') {
      return relative.length === 1 && relative[0] === file;
    }
    const suffix = file.endsWith(config.uiSuffix)
      ? config.uiSuffix
      : file.endsWith(config.connectorSuffix)
        ? config.connectorSuffix
        : null;
    return (
      suffix !== null && normalizedName(file.slice(0, -suffix.length)) === normalizedName(name)
    );
  }
  function isOwnerUi(owner: PortableOwner): boolean {
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    if (!name || (owner.kind === 'part' ? relative.length > 1 : relative.length !== 1))
      return false;
    return (owner.fileName.split('/').at(-1) ?? '') === `${pascalName(name)}${config.uiSuffix}`;
  }
  function isOwnerConnector(owner: PortableOwner): boolean {
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    if (!name || (owner.kind === 'part' ? relative.length > 1 : relative.length !== 1))
      return false;
    return (
      (owner.fileName.split('/').at(-1) ?? '') === `${pascalName(name)}${config.connectorSuffix}`
    );
  }
  type RuntimeCapability = 'connector' | 'hook' | 'store' | 'logic' | 'api';
  const capabilityRank: Readonly<Record<RuntimeCapability, number>> = {
    connector: 0,
    hook: 1,
    store: 2,
    logic: 3,
    api: 4,
  };
  function ownerKey(owner: PortableOwner): string | null {
    if (owner.kind === 'feature' && owner.feature) return `feature:${owner.feature}`;
    if (owner.kind === 'slot' && owner.feature && owner.slot)
      return `slot:${owner.feature}/${owner.slot}`;
    if (owner.kind === 'part' && owner.feature && owner.slot && owner.part)
      return `part:${owner.feature}/${owner.slot}/${owner.part}`;
    return null;
  }
  function ownerCapability(owner: PortableOwner): RuntimeCapability | 'types' | null {
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    if (!name || relative.length !== 1) return null;
    const file = owner.fileName.split('/').at(-1) ?? '';
    if (file === `${pascalName(name)}${config.connectorSuffix}`) return 'connector';
    if (file === `use${pascalName(name)}.ts`) return 'hook';
    if (file === `${camelName(name)}${config.storeSuffix}`) return 'store';
    if (file === `${camelName(name)}${config.logicSuffix}`) return 'logic';
    if (file === `${camelName(name)}${config.apiSuffix}`) return 'api';
    if (file === `${camelName(name)}${config.typesSuffix}`) return 'types';
    return null;
  }
  function isOwnerHelperHook(owner: PortableOwner): boolean {
    const relative = ownerRelative(owner);
    const file = owner.fileName.split('/').at(-1) ?? '';
    return relative[0] === config.hooksDirectory && /^use[A-Z0-9].*\.ts$/.test(file);
  }
  function matchCount(source: string, expression: RegExp): number {
    return [...source.matchAll(expression)].length;
  }
  function recommendationSignals(source: string) {
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
  function resolve(origin: string, specifier: string): string | null {
    let candidate: string | null = null;
    if (specifier.startsWith('.')) candidate = clean(path.resolve(path.dirname(origin), specifier));
    else if (specifier.startsWith('@/'))
      candidate = clean(path.resolve(projectRoot, 'src', specifier.slice(2)));
    else if (specifier.startsWith('@features/')) {
      candidate = clean(
        path.resolve(projectRoot, config.featuresRoot, specifier.slice('@features/'.length)),
      );
    } else if (specifier.startsWith('src/'))
      candidate = clean(path.resolve(projectRoot, specifier));
    if (!candidate) return null;
    return fileMap.get(candidate) ?? fileMap.get(stripExtension(candidate)) ?? candidate;
  }
  function location(sourceFile: ts.SourceFile, node: ts.StringLiteralLike): PortableSpan {
    const start = node.getStart(sourceFile) + 1;
    const end = Math.max(start, node.getEnd() - 1);
    const point = sourceFile.getLineAndCharacterOfPosition(start);
    return { start, end, line: point.line + 1, column: point.character + 1 };
  }
  function report(
    code: string,
    fileName: string,
    span: PortableSpan,
    message: string,
    guidance: string,
    severity: 'error' | 'warning' = 'error',
    stableId?: string,
  ): void {
    const relative = clean(path.relative(projectRoot, fileName));
    process.stderr.write(
      `${relative}:${span.line}:${span.column} - ${severity} ${code}${stableId ? ` [${stableId}]` : ''}: ${message}\n  ${guidance}\n`,
    );
    if (severity === 'error') process.exitCode = 1;
  }

  const owners = new Map<
    string,
    {
      owner: PortableOwner;
      hasUi: boolean;
      hasConnector: boolean;
      requiresUi: boolean;
      fileName: string;
      span: PortableSpan;
    }
  >();
  const ownerCapabilities = new Map<string, Set<RuntimeCapability | 'types'>>();
  const ownerCapabilityFiles = new Map<string, Map<RuntimeCapability | 'types', string>>();
  const fileCapabilities = new Map<string, RuntimeCapability | 'types'>();
  const reportedRecommendations = new Set<string>();
  for (const file of files) {
    const owner = classify(file.fileName);
    const key = ownerKey(owner);
    const capability = ownerCapability(owner);
    if (!key || !capability) continue;
    const current = ownerCapabilities.get(key) ?? new Set<RuntimeCapability | 'types'>();
    current.add(capability);
    ownerCapabilities.set(key, current);
    const capabilityFiles =
      ownerCapabilityFiles.get(key) ?? new Map<RuntimeCapability | 'types', string>();
    capabilityFiles.set(capability, file.fileName);
    ownerCapabilityFiles.set(key, capabilityFiles);
    fileCapabilities.set(file.fileName, capability);
  }
  function registerOwner(
    key: string,
    owner: PortableOwner,
    hasUi: boolean,
    hasConnector: boolean,
    requiresUi: boolean,
    fileName: string,
    span: PortableSpan,
  ): void {
    const current = owners.get(key);
    if (current) {
      current.hasUi ||= hasUi;
      current.hasConnector ||= hasConnector;
      if (!current.requiresUi && requiresUi) {
        current.fileName = fileName;
        current.span = span;
      }
      current.requiresUi ||= requiresUi;
    } else {
      owners.set(key, { owner, hasUi, hasConnector, requiresUi, fileName, span });
    }
  }

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.fileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      file.fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const origin = classify(file.fileName);
    const isUi = file.fileName.endsWith(config.uiSuffix);
    const first = sourceFile.statements[0];
    const anchorStart = first?.getStart(sourceFile) ?? 0;
    const anchorEnd = first?.getFirstToken(sourceFile)?.getEnd() ?? anchorStart;
    const anchorPoint = sourceFile.getLineAndCharacterOfPosition(anchorStart);
    const anchor = {
      start: anchorStart,
      end: anchorEnd,
      line: anchorPoint.line + 1,
      column: anchorPoint.character + 1,
    };
    const owner = ownerName(origin);
    const relative = ownerRelative(origin);
    const currentBase = file.fileName.split('/').at(-1) ?? '';
    const importedHookNames = new Set<string>();

    if (isUi) {
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
        const clause = statement.importClause;
        if (clause.name && (clause.name.text === 'use' || /^use[A-Z0-9]/.test(clause.name.text))) {
          importedHookNames.add(clause.name.text);
        }
        if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
        for (const element of clause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName !== 'use' && !/^use[A-Z0-9]/.test(importedName)) continue;
          importedHookNames.add(element.name.text);
          const modulePath = ts.isStringLiteralLike(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : '';
          const moduleIsArchitectureHook =
            modulePath.includes(`/${config.hooksDirectory}/`) ||
            /(?:^|\/)use[A-Z0-9]/.test(modulePath) ||
            /\.store(?:\.(?:ts|tsx))?$/.test(modulePath);
          if (!moduleIsArchitectureHook) {
            const start = element.name.getStart(sourceFile);
            const point = sourceFile.getLineAndCharacterOfPosition(start);
            report(
              'SRIJIKA4101',
              file.fileName,
              {
                start,
                end: element.name.getEnd(),
                line: point.line + 1,
                column: point.character + 1,
              },
              `Pure UI files cannot import the ${importedName} hook.`,
              'Call this hook in the matching Connector and pass its values or event callbacks into the UI through typed props.',
            );
          }
        }
      }
    }

    if (owner) {
      if (currentBase.endsWith('.store.tsx')) {
        report(
          'SRIJIKA4105',
          file.fileName,
          anchor,
          `Store files do not render JSX: ${currentBase} must use the .store.ts suffix.`,
          `Rename this file to ${camelName(owner)}${config.storeSuffix}.`,
        );
      } else if (currentBase.endsWith(config.storeSuffix)) {
        const expected = `${camelName(owner)}${config.storeSuffix}`;
        if (relative.length !== 1 || currentBase !== expected) {
          report(
            'SRIJIKA4105',
            file.fileName,
            anchor,
            `The ${owner} owner store must be located at its scope root and named ${expected}.`,
            `Move or rename this store to the ${origin.kind} root as ${expected}.`,
          );
        }
      }
      for (const [capability, suffix] of [
        ['logic', config.logicSuffix],
        ['api', config.apiSuffix],
        ['types', config.typesSuffix],
      ] as const) {
        if (!currentBase.endsWith(suffix)) continue;
        const expected = `${camelName(owner)}${suffix}`;
        if (relative.length !== 1 || currentBase !== expected) {
          report(
            'SRIJIKA4105',
            file.fileName,
            anchor,
            `The ${owner} owner ${capability} module must be located at its scope root and named ${expected}.`,
            `Move or rename this module to the ${origin.kind} root as ${expected}.`,
          );
        }
      }
      const insideHooksDirectory = relative[0] === config.hooksDirectory;
      const canonicalGatewayHook =
        relative.length === 1 && currentBase === `use${pascalName(owner)}.ts`;
      if (
        canonicalGatewayHook ||
        insideHooksDirectory ||
        /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(currentBase)
      ) {
        const expectedPrefix = `use${pascalName(owner)}`;
        if (
          !canonicalGatewayHook &&
          (!insideHooksDirectory ||
            !currentBase.startsWith(expectedPrefix) ||
            !currentBase.endsWith('.ts'))
        ) {
          report(
            'SRIJIKA4107',
            file.fileName,
            anchor,
            `The ${owner} hook must be the canonical ${expectedPrefix}.ts gateway at the owner root or a .ts helper in its ${config.hooksDirectory}/ directory starting with ${expectedPrefix}.`,
            `Use ${expectedPrefix}.ts for the public owner gateway, or move a private helper to ${config.hooksDirectory}/${expectedPrefix}<Behavior>.ts.`,
          );
        }
      }
      const architectureFile =
        currentBase.endsWith(config.uiSuffix) ||
        currentBase.endsWith(config.connectorSuffix) ||
        currentBase.endsWith(config.storeSuffix) ||
        currentBase.endsWith(config.logicSuffix) ||
        currentBase.endsWith(config.apiSuffix) ||
        currentBase.endsWith(config.typesSuffix);
      if (architectureFile && relative.length === 1) {
        const expectedUi = `${pascalName(owner)}${config.uiSuffix}`;
        const expectedConnector = `${pascalName(owner)}${config.connectorSuffix}`;
        const expectedStore = `${camelName(owner)}${config.storeSuffix}`;
        const expectedLogic = `${camelName(owner)}${config.logicSuffix}`;
        const expectedApi = `${camelName(owner)}${config.apiSuffix}`;
        const expectedTypes = `${camelName(owner)}${config.typesSuffix}`;
        if (
          ![
            expectedUi,
            expectedConnector,
            expectedStore,
            expectedLogic,
            expectedApi,
            expectedTypes,
          ].includes(currentBase)
        ) {
          const destination =
            origin.kind === 'feature'
              ? `${config.slotsDirectory}/<slot>/`
              : `${config.partsDirectory}/<part>/`;
          report(
            'SRIJIKA4108',
            file.fileName,
            anchor,
            `${currentBase} is an additional UI unit at the ${owner} ${origin.kind} root.`,
            `Keep only canonical owner files at this root. Move additional visual units into ${destination}.`,
          );
        }
      }
    }

    if (origin.feature) {
      registerOwner(
        `feature:${origin.feature}`,
        {
          kind: 'feature',
          fileName: file.fileName,
          feature: origin.feature,
          rest: origin.rest ?? [],
        },
        origin.kind === 'feature' && isOwnerUi(origin),
        origin.kind === 'feature' && isOwnerConnector(origin),
        true,
        file.fileName,
        anchor,
      );
    }
    if (origin.feature && origin.slot) {
      registerOwner(
        `slot:${origin.feature}/${origin.slot}`,
        {
          kind: 'slot',
          fileName: file.fileName,
          feature: origin.feature,
          slot: origin.slot,
          rest: origin.rest ?? [],
          slotRest: origin.slotRest ?? [],
        },
        origin.kind === 'slot' && isOwnerUi(origin),
        origin.kind === 'slot' && isOwnerConnector(origin),
        true,
        file.fileName,
        anchor,
      );
    }
    if (origin.feature && origin.slot && origin.part) {
      registerOwner(
        `part:${origin.feature}/${origin.slot}/${origin.part}`,
        origin,
        origin.kind === 'part' && isOwnerUi(origin),
        origin.kind === 'part' && isOwnerConnector(origin),
        true,
        file.fileName,
        anchor,
      );
    }

    function visit(node: ts.Node): void {
      let moduleNode: ts.StringLiteralLike | null = null;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        moduleNode = node.moduleSpecifier;
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        moduleNode = node.moduleReference.expression;
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0 &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        moduleNode = node.arguments[0];
      }
      if (moduleNode) {
        const targetName = resolve(file.fileName, moduleNode.text);
        if (targetName) {
          const target = classify(targetName);
          const span = location(sourceFile, moduleNode);
          const base = targetName.split('/').at(-1) ?? '';
          const forbidden =
            base.endsWith(config.storeSuffix) || base.endsWith('.store.tsx')
              ? 'store'
              : targetName.includes(`/${config.hooksDirectory}/`) ||
                  /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(base)
                ? 'hook'
                : base.endsWith(config.connectorSuffix)
                  ? 'connector'
                  : base.endsWith(config.logicSuffix)
                    ? 'logic'
                    : base.endsWith(config.apiSuffix)
                      ? 'api'
                      : null;
          if (isUi && forbidden) {
            report(
              'SRIJIKA4101',
              file.fileName,
              span,
              `Pure UI files cannot import a ${forbidden}: ${moduleNode.text}.`,
              `Move this ${forbidden} dependency to the matching Connector and pass the result through typed props.`,
            );
          }
          const originKey = ownerKey(origin);
          const targetKey = ownerKey(target);
          const originCapability = fileCapabilities.get(file.fileName);
          const targetCapability = fileCapabilities.get(targetName);
          if (
            originKey &&
            originKey === targetKey &&
            originCapability === 'connector' &&
            ownerCapabilities.get(originKey)?.has('hook') &&
            isOwnerHelperHook(target)
          ) {
            report(
              'SRIJIKA4201',
              file.fileName,
              span,
              `The ${ownerName(origin)} Connector bypasses its canonical Hook gateway to import the private helper ${moduleNode.text}.`,
              `Import use${pascalName(ownerName(origin) ?? '')}.ts from the Connector. The gateway may compose private helpers from ${config.hooksDirectory}/ internally.`,
            );
          }
          if (
            originKey &&
            originKey === targetKey &&
            originCapability &&
            originCapability !== 'types' &&
            targetCapability &&
            targetCapability !== 'types' &&
            capabilityRank[targetCapability] > capabilityRank[originCapability]
          ) {
            const available = ownerCapabilities.get(originKey) ?? new Set();
            const expected = (['hook', 'store', 'logic', 'api'] as const).find(
              (capability) =>
                capabilityRank[capability] > capabilityRank[originCapability] &&
                available.has(capability),
            );
            if (expected && expected !== targetCapability) {
              report(
                'SRIJIKA4201',
                file.fileName,
                span,
                `The ${ownerName(origin)} ${originCapability} jumps over the available ${expected} capability to import ${moduleNode.text}.`,
                `Route this behavior through ${expected}. The owner-local runtime chain is Connector → Hook → Store → Logic → API; only absent capabilities may be skipped. Types remain passive and may be imported directly.`,
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
            capabilityRank[targetCapability] < capabilityRank[originCapability]
          ) {
            report(
              'SRIJIKA4203',
              file.fileName,
              span,
              `The ${ownerName(origin)} ${originCapability} has a reverse dependency on its senior ${targetCapability} capability.`,
              `Dependencies move only downward through Connector → Hook → Store → Logic → API. Return values may flow upward at runtime, but junior source modules must not import senior source modules.`,
            );
          }
          if (
            originKey &&
            originKey === targetKey &&
            (originCapability === 'connector' ||
              originCapability === 'hook' ||
              originCapability === 'store') &&
            targetCapability &&
            targetCapability !== 'types'
          ) {
            const available = ownerCapabilities.get(originKey) ?? new Set();
            const expected = (['hook', 'store', 'logic', 'api'] as const).find(
              (capability) =>
                capabilityRank[capability] > capabilityRank[originCapability] &&
                available.has(capability),
            );
            const targetSource =
              files.find((candidate) => candidate.fileName === targetName)?.source ?? '';
            const originSignals = recommendationSignals(file.source);
            const storeSignals = recommendationSignals(`${file.source}\n${targetSource}`);
            if (
              expected === targetCapability &&
              targetCapability === 'api' &&
              !available.has('logic') &&
              (originSignals.endpointCalls >= 2 || originSignals.branchValidationTransform) &&
              !reportedRecommendations.has(`${originKey}:logic`)
            ) {
              reportedRecommendations.add(`${originKey}:logic`);
              report(
                'SRIJIKA4202',
                file.fileName,
                span,
                `The ${ownerName(origin)} ${originCapability} is coordinating multiple API calls or business branching/validation/transformation; add Logic before API.`,
                `This evidence-based recommendation is non-blocking. Add Logic at the canonical owner boundary; no source rewrite was applied.`,
                'warning',
                'SRIJIKA-ARCH-RECOMMEND-LOGIC',
              );
            }
            const aboveStore =
              targetCapability === 'store' &&
              (storeSignals.storeMembers >= 5 || storeSignals.storeAsyncCache);
            if (
              expected === targetCapability &&
              originCapability === 'connector' &&
              !available.has('hook') &&
              (originSignals.lifecycleCache ||
                originSignals.asyncHandlers >= 2 ||
                originSignals.reactHooks >= 3 ||
                aboveStore) &&
              !reportedRecommendations.has(`${originKey}:hook`)
            ) {
              reportedRecommendations.add(`${originKey}:hook`);
              report(
                'SRIJIKA4202',
                file.fileName,
                span,
                `The ${ownerName(origin)} Connector is coordinating lifecycle/cache/async React behavior${aboveStore ? ' or a complex Store surface' : ''}; add the canonical owner Hook as its single runtime gateway.`,
                `This evidence-based recommendation is non-blocking. Add Hook at the canonical owner boundary; no source rewrite was applied.`,
                'warning',
                aboveStore
                  ? 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE'
                  : 'SRIJIKA-ARCH-RECOMMEND-HOOK',
              );
            }
            if (
              expected === targetCapability &&
              (originCapability === 'connector' || originCapability === 'hook') &&
              !available.has('store') &&
              originSignals.localStateFields >= 4 &&
              !reportedRecommendations.has(`${originKey}:store`)
            ) {
              reportedRecommendations.add(`${originKey}:store`);
              report(
                'SRIJIKA4202',
                file.fileName,
                span,
                `The ${ownerName(origin)} ${originCapability} owns ${originSignals.localStateFields} local state fields; add Store to give shared client state an explicit owner boundary.`,
                `This evidence-based recommendation is non-blocking. Add Store at the canonical owner boundary; no source rewrite was applied.`,
                'warning',
                'SRIJIKA-ARCH-RECOMMEND-STORE',
              );
            }
          }
          if (target.kind !== 'outside') {
            const sameFeature = origin.feature && origin.feature === target.feature;
            const publicFeatureEntry = target.kind === 'feature' && isEntry(target);
            if (!sameFeature && !publicFeatureEntry) {
              report(
                'SRIJIKA4102',
                file.fileName,
                span,
                `The ${target.feature} feature keeps ${moduleNode.text} private.`,
                `Import the public feature entry, or promote genuinely shared code to the nearest shared domain.`,
              );
            } else if (
              sameFeature &&
              (target.kind === 'part' || (target.kind === 'slot' && !isEntry(target))) &&
              origin.slot !== target.slot
            ) {
              report(
                'SRIJIKA4103',
                file.fileName,
                span,
                `The ${target.slot} slot keeps ${moduleNode.text} inside its own subtree.`,
                `Promote it to the ${target.feature} feature scope if multiple slots need it.`,
              );
            } else if (
              sameFeature &&
              target.kind === 'slot' &&
              isEntry(target) &&
              origin.slot &&
              origin.slot !== target.slot
            ) {
              report(
                'SRIJIKA4103',
                file.fileName,
                span,
                `The ${target.slot} slot public entry cannot be composed by the ${origin.slot} sibling slot.`,
                `Compose ${target.slot} from the owning ${target.feature} Connector. Sibling slots may share only modules promoted to their feature owner.`,
              );
            } else if (
              sameFeature &&
              origin.slot === target.slot &&
              target.kind === 'part' &&
              origin.part !== target.part
            ) {
              const targetIsPublicEntry = isEntry(target);
              const originIsOwningSlot = origin.kind === 'slot';
              if (!(originIsOwningSlot && targetIsPublicEntry)) {
                const importingSibling = origin.kind === 'part';
                report(
                  'SRIJIKA4104',
                  file.fileName,
                  span,
                  targetIsPublicEntry && importingSibling
                    ? `The ${origin.part ?? 'current'} sibling part cannot import the ${target.part ?? 'target'} part public entry ${moduleNode.text}.`
                    : `The ${target.part ?? 'target'} part keeps ${moduleNode.text} private to its own subtree.`,
                  targetIsPublicEntry && importingSibling
                    ? `Compose the ${target.part ?? 'target'} public UI/Connector from the owning ${target.slot ?? 'slot'} slot. Promote shared sibling behavior to that slot scope.`
                    : `The owning ${target.slot ?? 'slot'} slot may compose only this part's public UI/Connector. Keep part stores, hooks, and private files inside ${target.part ?? 'the part'}; promote genuinely shared behavior to the slot scope.`,
                );
              }
            }
          }
        }
      }
      if (
        isUi &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        !importedHookNames.has(node.expression.text) &&
        (node.expression.text === 'use' || /^use[A-Z0-9]/.test(node.expression.text))
      ) {
        const start = node.expression.getStart(sourceFile);
        const point = sourceFile.getLineAndCharacterOfPosition(start);
        report(
          'SRIJIKA4101',
          file.fileName,
          {
            start,
            end: node.expression.getEnd(),
            line: point.line + 1,
            column: point.character + 1,
          },
          `Pure UI files cannot call the ${node.expression.text} hook.`,
          'Move this behavior to the matching Connector and pass values and events through typed props.',
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  for (const [key, capabilityFiles] of ownerCapabilityFiles) {
    const record = owners.get(key);
    if (!record) continue;
    const name = ownerName(record.owner);
    if (!name) continue;
    const connectorFileName = capabilityFiles.get('connector');
    const hookFileName = capabilityFiles.get('hook');
    const storeFileName = capabilityFiles.get('store');
    const apiFileName = capabilityFiles.get('api');
    const gatewayFileName = hookFileName ?? connectorFileName;
    const gatewayCapability: RuntimeCapability = hookFileName ? 'hook' : 'connector';
    const sourceFor = (fileName: string | undefined): string =>
      files.find((candidate) => candidate.fileName === fileName)?.source ?? '';
    const gatewaySignals = recommendationSignals(sourceFor(gatewayFileName));
    const connectorSignals = recommendationSignals(sourceFor(connectorFileName));
    const storeSignals = recommendationSignals(sourceFor(storeFileName));
    const warningSpanFor = (fileName: string): PortableSpan => {
      const sourceFile = ts.createSourceFile(
        fileName,
        sourceFor(fileName),
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const first = sourceFile.statements[0];
      const start = first?.getStart(sourceFile) ?? 0;
      const end = first?.getFirstToken(sourceFile)?.getEnd() ?? start;
      const point = sourceFile.getLineAndCharacterOfPosition(start);
      return { start, end, line: point.line + 1, column: point.character + 1 };
    };

    if (
      gatewayFileName &&
      !capabilityFiles.has('logic') &&
      (gatewaySignals.endpointCalls >= 2 ||
        (apiFileName !== undefined && gatewaySignals.branchValidationTransform)) &&
      !reportedRecommendations.has(`${key}:logic`)
    ) {
      reportedRecommendations.add(`${key}:logic`);
      report(
        'SRIJIKA4202',
        gatewayFileName,
        warningSpanFor(gatewayFileName),
        `The ${name} ${gatewayCapability} is coordinating multiple API calls or business branching/validation/transformation; add Logic before API.`,
        `This evidence-based recommendation is non-blocking. Add Logic at the canonical owner boundary; no source rewrite was applied.`,
        'warning',
        'SRIJIKA-ARCH-RECOMMEND-LOGIC',
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
        storeNeedsHook) &&
      !reportedRecommendations.has(`${key}:hook`)
    ) {
      reportedRecommendations.add(`${key}:hook`);
      report(
        'SRIJIKA4202',
        connectorFileName,
        warningSpanFor(connectorFileName),
        `The ${name} Connector is coordinating lifecycle/cache/async React behavior${storeNeedsHook ? ' or a complex Store surface' : ''}; add the canonical owner Hook as its single runtime gateway.`,
        `This evidence-based recommendation is non-blocking. Add Hook at the canonical owner boundary; no source rewrite was applied.`,
        'warning',
        storeNeedsHook ? 'SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE' : 'SRIJIKA-ARCH-RECOMMEND-HOOK',
      );
    }

    if (
      gatewayFileName &&
      !storeFileName &&
      gatewaySignals.localStateFields >= 4 &&
      !reportedRecommendations.has(`${key}:store`)
    ) {
      reportedRecommendations.add(`${key}:store`);
      report(
        'SRIJIKA4202',
        gatewayFileName,
        warningSpanFor(gatewayFileName),
        `The ${name} ${gatewayCapability} owns ${gatewaySignals.localStateFields} local state fields; add Store to give shared client state an explicit owner boundary.`,
        `This evidence-based recommendation is non-blocking. Add Store at the canonical owner boundary; no source rewrite was applied.`,
        'warning',
        'SRIJIKA-ARCH-RECOMMEND-STORE',
      );
    }
  }

  for (const record of owners.values()) {
    if (!record.requiresUi) continue;
    const name = ownerName(record.owner);
    if (!name) continue;
    if (!record.hasUi) {
      const expected = `${pascalName(name)}${config.uiSuffix}`;
      report(
        'SRIJIKA4106',
        record.fileName,
        record.span,
        `The ${name} ${record.owner.kind} has private companions but no mandatory ${expected}.`,
        `Create ${expected} at the ${record.owner.kind} root. UI and its matching Connector are required owner entries; Store, Hook, Logic, API, Types, Slots, and Parts are optional capabilities.`,
      );
    }
    if (!record.hasConnector) {
      const expected = `${pascalName(name)}${config.connectorSuffix}`;
      report(
        'SRIJIKA4109',
        record.fileName,
        record.span,
        `The ${name} ${record.owner.kind} has no mandatory matching ${expected}.`,
        `Create ${expected} at the ${record.owner.kind} root. The Connector is the UI's required and only runtime gateway into Hook → Store → Logic → API.`,
        'error',
        'SRIJIKA-ARCH-MISSING-CONNECTOR',
      );
    }
  }

  if (!process.exitCode)
    process.stdout.write(`Srijika architecture check passed (${files.length} source files).\n`);
};

/** Creates the deterministic validator emitted into standalone Srijika projects. */
export function createSrijikaArchitectureValidatorScript(
  architecture: Partial<SrijikaArchitectureConfig> = {},
): string {
  const config = resolveSrijikaArchitectureConfig(architecture);
  return [
    '#!/usr/bin/env node',
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import ts from 'typescript';",
    '',
    `const validate = ${portableMain.toString()};`,
    `await validate({ fs, path, ts }, process.cwd(), ${JSON.stringify(config, null, 2)});`,
    '',
  ].join('\n');
}
