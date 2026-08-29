import ts from 'typescript';

import {
  SRIJIKA_ARCHITECTURE_PROFILE,
  type ResolvedSrijikaArchitectureConfig,
  type SrijikaArchitectureConfig,
  type SrijikaProjectConfig,
} from './types';

export const DEFAULT_SRIJIKA_ARCHITECTURE: ResolvedSrijikaArchitectureConfig = Object.freeze({
  profile: SRIJIKA_ARCHITECTURE_PROFILE,
  featuresRoot: 'src/features',
  sharedRoot: 'src/shared',
  slotsDirectory: 'slots',
  partsDirectory: 'parts',
  hooksDirectory: 'hooks',
  storesDirectory: 'stores',
  uiSuffix: '.ui.tsx',
  connectorSuffix: '.connector.tsx',
  storeSuffix: '.store.ts',
  logicSuffix: '.logic.ts',
  apiSuffix: '.api.ts',
  typesSuffix: '.types.ts',
});

const MAX_ARCHITECTURE_ROOT_SEGMENTS = 10;

const PROJECT_ARCHITECTURE_STRING_FIELDS = [
  'featuresRoot',
  'sharedRoot',
  'slotsDirectory',
  'partsDirectory',
  'hooksDirectory',
  'storesDirectory',
  'uiSuffix',
  'connectorSuffix',
  'storeSuffix',
  'logicSuffix',
  'apiSuffix',
  'typesSuffix',
] as const;

function validatedRelativePath(value: string, field: string, maximumSegments: number): string {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`${field} must be a normalized project-relative path.`);
  }
  const segments = value.split('/');
  if (
    segments.length > maximumSegments ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`${field} must be a bounded project-relative path without traversal.`);
  }
  return value;
}

function rootsOverlap(left: string, right: string): boolean {
  const canonicalLeft = left.toLowerCase();
  const canonicalRight = right.toLowerCase();
  return (
    canonicalLeft === canonicalRight ||
    canonicalLeft.startsWith(`${canonicalRight}/`) ||
    canonicalRight.startsWith(`${canonicalLeft}/`)
  );
}

function validatedSuffix(value: string, field: string, extension: '.ts' | '.tsx'): string {
  if (
    !value ||
    value.includes('\0') ||
    value.includes('/') ||
    value.includes('\\') ||
    !value.startsWith('.') ||
    value.endsWith('.d.ts') ||
    value.endsWith('.d.tsx') ||
    !value.endsWith(extension)
  ) {
    throw new Error(`${field} must be a basename-only ${extension} suffix.`);
  }
  return value;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    throw new Error(`${label} must use distinct values.`);
  }
}

function assertNonoverlappingSuffixes(values: readonly string[], label: string): void {
  const canonical = values.map((value) => value.toLowerCase());
  for (let leftIndex = 0; leftIndex < canonical.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < canonical.length; rightIndex += 1) {
      const left = canonical[leftIndex] ?? '';
      const right = canonical[rightIndex] ?? '';
      if (left.endsWith(right) || right.endsWith(left)) {
        throw new Error(`${label} must not overlap by suffix.`);
      }
    }
  }
}

export function resolveSrijikaArchitectureConfig(
  input: Partial<SrijikaArchitectureConfig> = {},
): ResolvedSrijikaArchitectureConfig {
  if (input.profile !== undefined && input.profile !== SRIJIKA_ARCHITECTURE_PROFILE) {
    throw new Error(`Unsupported Srijika architecture profile: ${String(input.profile)}`);
  }

  const featuresRoot = validatedRelativePath(
    input.featuresRoot ?? DEFAULT_SRIJIKA_ARCHITECTURE.featuresRoot,
    'featuresRoot',
    MAX_ARCHITECTURE_ROOT_SEGMENTS,
  );
  const sharedRoot = validatedRelativePath(
    input.sharedRoot ?? DEFAULT_SRIJIKA_ARCHITECTURE.sharedRoot,
    'sharedRoot',
    MAX_ARCHITECTURE_ROOT_SEGMENTS,
  );
  if (rootsOverlap(featuresRoot, sharedRoot)) {
    throw new Error('featuresRoot and sharedRoot must be separate non-overlapping directories.');
  }
  const slotsDirectory = validatedRelativePath(
    input.slotsDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.slotsDirectory,
    'slotsDirectory',
    1,
  );
  const partsDirectory = validatedRelativePath(
    input.partsDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.partsDirectory,
    'partsDirectory',
    1,
  );
  const hooksDirectory = validatedRelativePath(
    input.hooksDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.hooksDirectory,
    'hooksDirectory',
    1,
  );
  const storesDirectory = validatedRelativePath(
    input.storesDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.storesDirectory,
    'storesDirectory',
    1,
  );
  assertUnique(
    [slotsDirectory, partsDirectory, hooksDirectory, storesDirectory],
    'Architecture directory names',
  );
  const uiSuffix = validatedSuffix(
    input.uiSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.uiSuffix,
    'uiSuffix',
    '.tsx',
  );
  const connectorSuffix = validatedSuffix(
    input.connectorSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.connectorSuffix,
    'connectorSuffix',
    '.tsx',
  );
  const storeSuffix = validatedSuffix(
    input.storeSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.storeSuffix,
    'storeSuffix',
    '.ts',
  );
  const logicSuffix = validatedSuffix(
    input.logicSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.logicSuffix,
    'logicSuffix',
    '.ts',
  );
  const apiSuffix = validatedSuffix(
    input.apiSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.apiSuffix,
    'apiSuffix',
    '.ts',
  );
  const typesSuffix = validatedSuffix(
    input.typesSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.typesSuffix,
    'typesSuffix',
    '.ts',
  );
  assertUnique(
    [uiSuffix, connectorSuffix, storeSuffix, logicSuffix, apiSuffix, typesSuffix],
    'Architecture file suffixes',
  );
  assertNonoverlappingSuffixes(
    [uiSuffix, connectorSuffix, storeSuffix, logicSuffix, apiSuffix, typesSuffix],
    'Architecture file suffixes',
  );

  return {
    profile: SRIJIKA_ARCHITECTURE_PROFILE,
    featuresRoot,
    sharedRoot,
    slotsDirectory,
    partsDirectory,
    hooksDirectory,
    storesDirectory,
    uiSuffix,
    connectorSuffix,
    storeSuffix,
    logicSuffix,
    apiSuffix,
    typesSuffix,
  };
}

/**
 * Parses the optional architecture block from an authoritative
 * `srijika.config.json` file. Project JSON is deliberately stricter than the
 * programmatic resolver: once an architecture block exists it must opt into
 * the exact supported profile instead of silently inheriting or changing
 * semantics.
 */
export function parseSrijikaProjectArchitectureConfig(
  source: string,
): ResolvedSrijikaArchitectureConfig | undefined {
  const root = parseProjectConfigObject(source);
  return architectureFromProjectConfigObject(root);
}

function parseProjectConfigObject(source: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('srijika.config.json is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('srijika.config.json must contain a JSON object.');
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function architectureFromProjectConfigObject(
  root: Readonly<Record<string, unknown>>,
): ResolvedSrijikaArchitectureConfig | undefined {
  if (!Object.hasOwn(root, 'architecture')) return undefined;
  const candidate = root['architecture'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('srijika.config.json architecture must be an object.');
  }

  const architecture = candidate as Readonly<Record<string, unknown>>;
  if (!Object.hasOwn(architecture, 'profile')) {
    throw new Error(
      `srijika.config.json architecture.profile is required and must be "${SRIJIKA_ARCHITECTURE_PROFILE}".`,
    );
  }
  if (architecture['profile'] !== SRIJIKA_ARCHITECTURE_PROFILE) {
    throw new Error(
      `Unsupported Srijika architecture profile: ${String(architecture['profile'])}. Expected "${SRIJIKA_ARCHITECTURE_PROFILE}".`,
    );
  }

  const config: Partial<SrijikaArchitectureConfig> = {
    profile: SRIJIKA_ARCHITECTURE_PROFILE,
  };
  for (const field of PROJECT_ARCHITECTURE_STRING_FIELDS) {
    const value = architecture[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      throw new Error(`srijika.config.json architecture.${field} must be a string.`);
    }
    config[field] = value;
  }

  try {
    return resolveSrijikaArchitectureConfig(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid srijika.config.json architecture: ${message}`, { cause: error });
  }
}

/** Parses the complete TSX-first project contract used by every Srijika adapter. */
export function parseSrijikaProjectConfig(source: string): SrijikaProjectConfig {
  const root = parseProjectConfigObject(source);
  if (root['sourceOfTruth'] !== 'tsx') {
    throw new Error('srijika.config.json sourceOfTruth must be "tsx".');
  }
  const architecture =
    architectureFromProjectConfigObject(root) ?? resolveSrijikaArchitectureConfig();
  if (typeof root['entry'] !== 'string') {
    throw new Error('srijika.config.json entry must be a nonempty project-relative path.');
  }
  const entry = validatedRelativePath(root['entry'], 'entry', 32);
  if (!entry.endsWith(architecture.uiSuffix)) {
    throw new Error(
      `srijika.config.json entry must end with the configured UI suffix ${architecture.uiSuffix}.`,
    );
  }
  return Object.freeze({ sourceOfTruth: 'tsx', entry, architecture });
}

function normalizedTsconfigPath(value: string, field: string, allowEmpty = false): string {
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error(`${field} must remain inside the project root.`);
  }
  const output: string[] = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (output.length === 0) throw new Error(`${field} must not traverse outside the project.`);
      output.pop();
      continue;
    }
    output.push(segment);
  }
  const result = output.join('/');
  if (!allowEmpty && !result) throw new Error(`${field} must be nonempty.`);
  return result;
}

/**
 * Reads deterministic, project-root-relative TypeScript path aliases. Only
 * exact aliases and terminal-wildcard aliases are accepted; the first target
 * is authoritative and must stay inside the project.
 */
export function parseSrijikaTypeScriptPathAliases(
  source: string,
): Readonly<Record<string, string>> {
  const parsed = ts.parseConfigFileTextToJson('tsconfig.json', source);
  if (parsed.error) {
    throw new Error(
      `tsconfig.json is not valid JSONC: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
    );
  }
  const root = parsed.config as unknown;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error('tsconfig.json must contain a JSON object.');
  }
  const rootRecord = root as Readonly<Record<string, unknown>>;
  if (Object.hasOwn(rootRecord, 'extends')) {
    throw new Error(
      'tsconfig.json extends is not supported by the strict Srijika alias contract; declare bounded paths directly in the project tsconfig.json.',
    );
  }
  const references = rootRecord['references'];
  if (references !== undefined) {
    if (!Array.isArray(references)) {
      throw new Error('tsconfig.json references must be an array.');
    }
    if (references.length > 0) {
      throw new Error(
        'tsconfig.json project references are not supported by the strict Srijika alias contract; keep the governed source graph inside this project tsconfig.json.',
      );
    }
  }
  const compilerOptions = rootRecord['compilerOptions'];
  if (compilerOptions === undefined) return Object.freeze({});
  if (!compilerOptions || typeof compilerOptions !== 'object' || Array.isArray(compilerOptions)) {
    throw new Error('tsconfig.json compilerOptions must be an object.');
  }
  const options = compilerOptions as Readonly<Record<string, unknown>>;
  const baseUrlValue = options['baseUrl'];
  if (baseUrlValue !== undefined && typeof baseUrlValue !== 'string') {
    throw new Error('tsconfig.json compilerOptions.baseUrl must be a string.');
  }
  const baseUrl = normalizedTsconfigPath(
    typeof baseUrlValue === 'string' ? baseUrlValue : '',
    'tsconfig.json compilerOptions.baseUrl',
    true,
  );
  const paths = options['paths'];
  if (paths === undefined) return Object.freeze({});
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) {
    throw new Error('tsconfig.json compilerOptions.paths must be an object.');
  }
  const aliases: Array<readonly [string, string]> = [];
  for (const [pattern, rawTargets] of Object.entries(paths)) {
    if (
      !pattern ||
      pattern.includes('\0') ||
      pattern.includes('\\') ||
      (pattern.includes('*') && !pattern.endsWith('*')) ||
      (pattern.match(/\*/g)?.length ?? 0) > 1
    ) {
      throw new Error(`tsconfig.json path alias ${pattern || '<empty>'} is not deterministic.`);
    }
    if (
      !Array.isArray(rawTargets) ||
      rawTargets.length === 0 ||
      typeof rawTargets[0] !== 'string'
    ) {
      throw new Error(`tsconfig.json path alias ${pattern} must have at least one string target.`);
    }
    const wildcard = pattern.endsWith('*');
    const firstTarget = rawTargets[0];
    if ((wildcard && !pattern.endsWith('/*')) || (!wildcard && pattern.endsWith('/'))) {
      throw new Error(
        `tsconfig.json path alias ${pattern} must be an exact alias or a slash-delimited /* wildcard.`,
      );
    }
    if (
      firstTarget.includes('*') !== wildcard ||
      (firstTarget.includes('*') && !firstTarget.endsWith('*')) ||
      (firstTarget.match(/\*/g)?.length ?? 0) > 1 ||
      (wildcard && !firstTarget.endsWith('/*'))
    ) {
      throw new Error(`tsconfig.json path alias ${pattern} must use a matching terminal wildcard.`);
    }
    const alias = wildcard ? pattern.slice(0, -1) : pattern;
    const targetWithoutWildcard = wildcard ? firstTarget.slice(0, -1) : firstTarget;
    const target = normalizedTsconfigPath(
      [baseUrl, targetWithoutWildcard].filter(Boolean).join('/'),
      `tsconfig.json path alias ${pattern}`,
      true,
    );
    aliases.push([alias, target]);
  }
  return Object.freeze(Object.fromEntries(aliases));
}
