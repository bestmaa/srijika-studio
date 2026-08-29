import type fs from 'node:fs/promises';
import type { constants as nodeFsConstants } from 'node:fs';
import type path from 'node:path';

import type ts from 'typescript';

import { resolveSrijikaArchitectureConfig } from './config';
import type { SrijikaArchitectureConfig } from './types';

interface PortableRuntime {
  fs: typeof fs;
  fsConstants: typeof nodeFsConstants;
  path: typeof path;
  ts: typeof ts;
}

interface PortableFile {
  fileName: string;
  source: string;
}

interface PortableOwner {
  kind:
    'outside' | 'feature' | 'slot' | 'part' | 'shared-ui' | 'shared-widget' | 'shared-capability';
  fileName: string;
  feature?: string;
  slot?: string;
  part?: string;
  shared?: string;
  rest?: readonly string[];
  slotRest?: readonly string[];
  partRest?: readonly string[];
  sharedRest?: readonly string[];
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
  const { fs, fsConstants, path, ts } = runtime;
  const MAX_CONFIG_BYTES = 64 * 1024;
  const MAX_TSCONFIG_BYTES = 1024 * 1024;
  const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
  const MAX_TOTAL_SOURCE_BYTES = 24 * 1024 * 1024;
  const MAX_SOURCE_FILES = 4096;
  const MAX_SCAN_ENTRIES = 32768;
  const MAX_SCAN_DIRECTORIES = 4096;
  const MAX_SCAN_DEPTH = 32;
  const lexicalProjectRoot = path.resolve(projectRoot);
  const rootMetadata = await fs.lstat(lexicalProjectRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('The Srijika project root must be a real directory, not a symbolic link.');
  }
  const canonicalProjectRoot = await fs.realpath(lexicalProjectRoot);
  const comparable = (value: string): string =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  // Windows realpath may expand an equivalent runner/volume alias. lstat still
  // rejects a linked root, and every governed descendant is checked below.
  if (
    process.platform !== 'win32' &&
    comparable(canonicalProjectRoot) !== comparable(lexicalProjectRoot)
  ) {
    throw new Error('The Srijika project root must not be reached through a symbolic link.');
  }
  projectRoot = canonicalProjectRoot;
  function missingPath(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    );
  }
  function assertContained(target: string, label: string): void {
    const fromRoot = path.relative(projectRoot, target);
    if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
      throw new Error(`${label} must remain inside the canonical Srijika project root.`);
    }
  }
  async function inspectSafePath(
    targetValue: string,
    expected: 'file' | 'directory',
  ): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
    const target = path.resolve(targetValue);
    assertContained(target, targetValue);
    const segments = path
      .relative(projectRoot, target)
      .split(/[\\/]+/)
      .filter(Boolean);
    let current = projectRoot;
    let metadata = await fs.lstat(current);
    for (const [index, segment] of segments.entries()) {
      current = path.resolve(current, segment);
      metadata = await fs.lstat(current);
      const label = segments.slice(0, index + 1).join('/');
      if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
      if (index < segments.length - 1 && !metadata.isDirectory()) {
        throw new Error(`${label} must be a directory.`);
      }
    }
    if (expected === 'file' && !metadata.isFile()) {
      throw new Error(`${path.relative(projectRoot, target)} must be a regular file.`);
    }
    if (expected === 'directory' && !metadata.isDirectory()) {
      throw new Error(`${path.relative(projectRoot, target)} must be a directory.`);
    }
    const canonical = await fs.realpath(target);
    assertContained(canonical, targetValue);
    if (comparable(canonical) !== comparable(target)) {
      throw new Error(`${path.relative(projectRoot, target)} must not cross a symbolic link.`);
    }
    return metadata;
  }
  async function readBoundedText(targetValue: string, maximumBytes: number): Promise<string> {
    const target = path.resolve(targetValue);
    const before = await inspectSafePath(target, 'file');
    const label = path.relative(projectRoot, target).replaceAll('\\', '/');
    if (before.size > maximumBytes) {
      throw new Error(`${label} exceeds the ${maximumBytes}-byte read limit.`);
    }
    const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
    const handle = await fs.open(target, fsConstants.O_RDONLY | noFollow);
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new Error(`${label} must be a regular file.`);
      if (opened.size > maximumBytes) {
        throw new Error(`${label} exceeds the ${maximumBytes}-byte read limit.`);
      }
      if (
        before.dev !== 0 &&
        before.ino !== 0 &&
        opened.dev !== 0 &&
        opened.ino !== 0 &&
        (before.dev !== opened.dev || before.ino !== opened.ino)
      ) {
        throw new Error(`${label} changed while Srijika was opening it.`);
      }
      const buffer = Buffer.allocUnsafe(maximumBytes + 1);
      let offset = 0;
      while (offset <= maximumBytes) {
        const result = await handle.read(buffer, offset, maximumBytes + 1 - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      if (offset > maximumBytes) {
        throw new Error(`${label} exceeds the ${maximumBytes}-byte read limit.`);
      }
      const after = await inspectSafePath(target, 'file');
      const stableHandleIdentity =
        opened.dev !== 0 && opened.ino !== 0 && after.dev !== 0 && after.ino !== 0;
      if (
        (stableHandleIdentity && (opened.dev !== after.dev || opened.ino !== after.ino)) ||
        opened.size !== after.size ||
        opened.mtimeMs !== after.mtimeMs ||
        opened.ctimeMs !== after.ctimeMs
      ) {
        throw new Error(`${label} changed while Srijika was reading it.`);
      }
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset));
      } catch (error) {
        throw new Error(`${label} must contain valid UTF-8 text.`, { cause: error });
      }
    } finally {
      await handle.close();
    }
  }
  const supportedProfile = rawConfig.profile;
  const defaultConfig: typeof rawConfig = {
    profile: supportedProfile,
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
  };
  function record(value: unknown): Readonly<Record<string, unknown>> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : null;
  }
  function validatedRelativePath(value: unknown, field: string, maximumSegments: number): string {
    if (
      typeof value !== 'string' ||
      !value ||
      value.includes('\0') ||
      value.includes('\\') ||
      value.startsWith('/') ||
      value.endsWith('/') ||
      /^[A-Za-z]:/.test(value)
    ) {
      throw new Error(`architecture.${field} must be a normalized project-relative path.`);
    }
    const segments = value.split('/');
    if (
      segments.length > maximumSegments ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error(
        `architecture.${field} must be a bounded project-relative path without traversal.`,
      );
    }
    return value;
  }
  function validatedSuffix(value: unknown, field: string, extension: '.ts' | '.tsx'): string {
    if (
      typeof value !== 'string' ||
      !value ||
      value.includes('\0') ||
      value.includes('/') ||
      value.includes('\\') ||
      !value.startsWith('.') ||
      value.endsWith('.d.ts') ||
      value.endsWith('.d.tsx') ||
      !value.endsWith(extension)
    ) {
      throw new Error(`architecture.${field} must be a basename-only ${extension} suffix.`);
    }
    return value;
  }
  function assertDistinct(values: readonly string[], label: string): void {
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
  function resolveRuntimeConfig(value: unknown): typeof rawConfig {
    const architecture = record(value);
    if (!architecture || architecture['profile'] !== supportedProfile) {
      throw new Error(`architecture.profile must be the supported ${supportedProfile} profile.`);
    }
    const featuresRoot = validatedRelativePath(
      architecture['featuresRoot'] ?? defaultConfig.featuresRoot,
      'featuresRoot',
      10,
    );
    const sharedRoot = validatedRelativePath(
      architecture['sharedRoot'] ?? defaultConfig.sharedRoot,
      'sharedRoot',
      10,
    );
    const canonicalFeaturesRoot = featuresRoot.toLowerCase();
    const canonicalSharedRoot = sharedRoot.toLowerCase();
    if (
      canonicalFeaturesRoot === canonicalSharedRoot ||
      canonicalFeaturesRoot.startsWith(`${canonicalSharedRoot}/`) ||
      canonicalSharedRoot.startsWith(`${canonicalFeaturesRoot}/`)
    ) {
      throw new Error(
        'architecture.featuresRoot and architecture.sharedRoot must be separate non-overlapping directories.',
      );
    }
    const slotsDirectory = validatedRelativePath(
      architecture['slotsDirectory'] ?? defaultConfig.slotsDirectory,
      'slotsDirectory',
      1,
    );
    const partsDirectory = validatedRelativePath(
      architecture['partsDirectory'] ?? defaultConfig.partsDirectory,
      'partsDirectory',
      1,
    );
    const hooksDirectory = validatedRelativePath(
      architecture['hooksDirectory'] ?? defaultConfig.hooksDirectory,
      'hooksDirectory',
      1,
    );
    const storesDirectory = validatedRelativePath(
      architecture['storesDirectory'] ?? defaultConfig.storesDirectory,
      'storesDirectory',
      1,
    );
    assertDistinct(
      [slotsDirectory, partsDirectory, hooksDirectory, storesDirectory],
      'Architecture directory names',
    );
    const uiSuffix = validatedSuffix(
      architecture['uiSuffix'] ?? defaultConfig.uiSuffix,
      'uiSuffix',
      '.tsx',
    );
    const connectorSuffix = validatedSuffix(
      architecture['connectorSuffix'] ?? defaultConfig.connectorSuffix,
      'connectorSuffix',
      '.tsx',
    );
    const storeSuffix = validatedSuffix(
      architecture['storeSuffix'] ?? defaultConfig.storeSuffix,
      'storeSuffix',
      '.ts',
    );
    const logicSuffix = validatedSuffix(
      architecture['logicSuffix'] ?? defaultConfig.logicSuffix,
      'logicSuffix',
      '.ts',
    );
    const apiSuffix = validatedSuffix(
      architecture['apiSuffix'] ?? defaultConfig.apiSuffix,
      'apiSuffix',
      '.ts',
    );
    const typesSuffix = validatedSuffix(
      architecture['typesSuffix'] ?? defaultConfig.typesSuffix,
      'typesSuffix',
      '.ts',
    );
    assertDistinct(
      [uiSuffix, connectorSuffix, storeSuffix, logicSuffix, apiSuffix, typesSuffix],
      'Architecture file suffixes',
    );
    assertNonoverlappingSuffixes(
      [uiSuffix, connectorSuffix, storeSuffix, logicSuffix, apiSuffix, typesSuffix],
      'Architecture file suffixes',
    );
    return {
      profile: supportedProfile,
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
  let config: typeof rawConfig = rawConfig;
  let entrySource: string | undefined;
  try {
    const source = await readBoundedText(
      path.join(projectRoot, 'srijika.config.json'),
      MAX_CONFIG_BYTES,
    );
    const projectConfig = record(JSON.parse(source));
    if (!projectConfig) throw new Error('srijika.config.json must contain a JSON object.');
    config = Object.prototype.hasOwnProperty.call(projectConfig, 'architecture')
      ? resolveRuntimeConfig(projectConfig['architecture'])
      : defaultConfig;
    if (projectConfig['sourceOfTruth'] !== 'tsx') {
      throw new Error('srijika.config.json sourceOfTruth must be "tsx".');
    }
    entrySource = validatedRelativePath(projectConfig['entry'], 'entry', 32);
    if (!entrySource.endsWith(config.uiSuffix)) {
      throw new Error(
        `srijika.config.json entry must end with the configured UI suffix ${config.uiSuffix}.`,
      );
    }
  } catch (error) {
    if (missingPath(error)) {
      throw new Error(
        'srijika.config.json is required for portable Srijika architecture validation.',
        { cause: error },
      );
    }
    throw error;
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
      } else output.push(segment);
    }
    const result = output.join('/');
    if (!allowEmpty && !result) throw new Error(`${field} must be nonempty.`);
    return result;
  }
  function parseTypeScriptAliases(source: string): Readonly<Record<string, string>> {
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json', source);
    if (parsed.error) {
      throw new Error(
        `tsconfig.json is not valid JSONC: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
      );
    }
    const root = record(parsed.config);
    if (!root) throw new Error('tsconfig.json must contain a JSON object.');
    if (Object.prototype.hasOwnProperty.call(root, 'extends')) {
      throw new Error(
        'tsconfig.json extends is not supported by the strict Srijika alias contract; declare bounded paths directly in the project tsconfig.json.',
      );
    }
    const references = root['references'];
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
    const compilerOptionsValue = root['compilerOptions'];
    if (compilerOptionsValue === undefined) return {};
    const compilerOptions = record(compilerOptionsValue);
    if (!compilerOptions) throw new Error('tsconfig.json compilerOptions must be an object.');
    const baseUrlValue = compilerOptions['baseUrl'];
    if (baseUrlValue !== undefined && typeof baseUrlValue !== 'string') {
      throw new Error('tsconfig.json compilerOptions.baseUrl must be a string.');
    }
    const baseUrl = normalizedTsconfigPath(
      typeof baseUrlValue === 'string' ? baseUrlValue : '',
      'tsconfig.json compilerOptions.baseUrl',
      true,
    );
    const pathsValue = compilerOptions['paths'];
    if (pathsValue === undefined) return {};
    const paths = record(pathsValue);
    if (!paths) throw new Error('tsconfig.json compilerOptions.paths must be an object.');
    const output: Array<readonly [string, string]> = [];
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
        throw new Error(`tsconfig.json path alias ${pattern} must have a string target.`);
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
        throw new Error(
          `tsconfig.json path alias ${pattern} must use a matching terminal wildcard.`,
        );
      }
      const alias = wildcard ? pattern.slice(0, -1) : pattern;
      const target = wildcard ? firstTarget.slice(0, -1) : firstTarget;
      output.push([
        alias,
        normalizedTsconfigPath(
          [baseUrl, target].filter(Boolean).join('/'),
          `tsconfig.json path alias ${pattern}`,
          true,
        ),
      ]);
    }
    return Object.fromEntries(output);
  }
  let aliases: Readonly<Record<string, string>> = {
    '@/': 'src/',
    '@features/': config.featuresRoot,
    '@shared/': config.sharedRoot,
  };
  try {
    aliases = {
      ...aliases,
      ...parseTypeScriptAliases(
        await readBoundedText(path.join(projectRoot, 'tsconfig.json'), MAX_TSCONFIG_BYTES),
      ),
    };
  } catch (error) {
    if (!missingPath(error)) throw error;
  }
  const normalizedProjectRoot = projectRoot.replaceAll('\\', '/').replace(/\/$/, '');
  const sourceRoots = [...new Set([config.featuresRoot, config.sharedRoot])].map((root) =>
    path.resolve(projectRoot, ...root.split('/')),
  );
  const ignored = new Set([
    '.git',
    '.next',
    '.srijika',
    '.turbo',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'target',
  ]);
  const files: PortableFile[] = [];
  const collectedFiles = new Set<string>();
  let visitedEntries = 0;
  let visitedDirectories = 0;
  let totalSourceBytes = 0;

  async function collect(directory: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) {
      throw new Error(`Architecture scan exceeds the ${MAX_SCAN_DEPTH}-directory depth limit.`);
    }
    visitedDirectories += 1;
    if (visitedDirectories > MAX_SCAN_DIRECTORIES) {
      throw new Error(
        `Architecture scan exceeds the ${MAX_SCAN_DIRECTORIES}-directory safety limit.`,
      );
    }
    const entries: Array<{
      name: string;
      isSymbolicLink(): boolean;
      isDirectory(): boolean;
      isFile(): boolean;
    }> = [];
    try {
      const before = await inspectSafePath(directory, 'directory');
      const handle = await fs.opendir(directory);
      for await (const entry of handle) {
        visitedEntries += 1;
        if (visitedEntries > MAX_SCAN_ENTRIES) {
          throw new Error(`Architecture scan exceeds the ${MAX_SCAN_ENTRIES}-entry safety limit.`);
        }
        entries.push(entry);
      }
      const after = await inspectSafePath(directory, 'directory');
      const stableIdentity =
        before.dev !== 0 && before.ino !== 0 && after.dev !== 0 && after.ino !== 0;
      if (
        (stableIdentity && (before.dev !== after.dev || before.ino !== after.ino)) ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs
      ) {
        throw new Error(
          `${path.relative(projectRoot, directory).replaceAll('\\', '/')} changed while Srijika was scanning it.`,
        );
      }
    } catch (error) {
      if (missingPath(error)) return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `${path.relative(projectRoot, absolute).replaceAll('\\', '/')} must not be a symbolic link.`,
        );
      }
      if (ignored.has(entry.name)) continue;
      if (entry.isDirectory()) await collect(absolute, depth + 1);
      else if (!entry.isFile()) {
        throw new Error(
          `${path.relative(projectRoot, absolute).replaceAll('\\', '/')} must be a regular file or directory.`,
        );
      } else if (
        /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name.toLowerCase()) &&
        !/\.d\.(?:ts|tsx|mts|cts)$/.test(entry.name.toLowerCase())
      ) {
        const normalized = absolute.replaceAll('\\', '/');
        if (collectedFiles.has(normalized)) continue;
        collectedFiles.add(normalized);
        if (collectedFiles.size > MAX_SOURCE_FILES) {
          throw new Error(`Architecture scan exceeds the ${MAX_SOURCE_FILES}-file safety limit.`);
        }
        const source = await readBoundedText(absolute, MAX_SOURCE_BYTES);
        totalSourceBytes += Buffer.byteLength(source, 'utf8');
        if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
          throw new Error('Architecture scan exceeds the 24 MiB aggregate source safety limit.');
        }
        files.push({
          fileName: normalized,
          source,
        });
      }
    }
  }
  for (const sourceRoot of sourceRoots) await collect(sourceRoot, 1);
  if (entrySource) {
    const absoluteEntry = path.resolve(projectRoot, ...entrySource.split('/'));
    const normalizedEntry = absoluteEntry.replaceAll('\\', '/');
    if (!collectedFiles.has(normalizedEntry)) {
      collectedFiles.add(normalizedEntry);
      if (collectedFiles.size > MAX_SOURCE_FILES) {
        throw new Error(`Architecture scan exceeds the ${MAX_SOURCE_FILES}-file safety limit.`);
      }
      const source = await readBoundedText(absoluteEntry, MAX_SOURCE_BYTES);
      totalSourceBytes += Buffer.byteLength(source, 'utf8');
      if (totalSourceBytes > MAX_TOTAL_SOURCE_BYTES) {
        throw new Error('Architecture scan exceeds the 24 MiB aggregate source safety limit.');
      }
      files.push({ fileName: normalizedEntry, source });
    }
  }
  files.sort((left, right) => left.fileName.localeCompare(right.fileName));

  const fileMap = new Map<string, string>();
  function stripExtension(value: string): string {
    return value.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/i, '');
  }
  for (const file of files) {
    fileMap.set(file.fileName, file.fileName);
    fileMap.set(stripExtension(file.fileName), file.fileName);
    if (/\/index\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file.fileName)) {
      fileMap.set(stripExtension(file.fileName).replace(/\/index$/, ''), file.fileName);
    }
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

  function clean(value: string): string {
    return value.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
  }
  function classify(fileName: string): PortableOwner {
    const normalized = clean(fileName);
    const relative = normalized.startsWith(`${normalizedProjectRoot}/`)
      ? normalized.slice(normalizedProjectRoot.length + 1)
      : normalized;
    const segments = relative.split('/').filter(Boolean);
    const sharedRootSegments = config.sharedRoot.split('/').filter(Boolean);
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
        sharedRest: segments.slice(categoryIndex + 2),
      };
    }
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
    const part = /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(partSegment)
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
  function isNoncanonicalSharedSourcePath(fileName: string): boolean {
    const normalized = clean(fileName);
    const relative = normalized.startsWith(`${normalizedProjectRoot}/`)
      ? normalized.slice(normalizedProjectRoot.length + 1)
      : normalized;
    const segments = relative.split('/').filter(Boolean);
    const sharedSegments = config.sharedRoot.split('/').filter(Boolean);
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
  function ownerName(owner: PortableOwner): string | null {
    return owner.kind === 'feature'
      ? (owner.feature ?? null)
      : owner.kind === 'slot'
        ? (owner.slot ?? null)
        : owner.kind === 'part'
          ? (owner.part ?? null)
          : owner.kind === 'shared-ui' ||
              owner.kind === 'shared-widget' ||
              owner.kind === 'shared-capability'
            ? (owner.shared ?? null)
            : null;
  }
  function noncanonicalOwnerFolders(
    owner: PortableOwner,
  ): readonly { role: string; actual: string; expected: string }[] {
    const candidates: Array<{ role: string; actual: string }> = [];
    if (owner.feature) candidates.push({ role: 'Feature', actual: owner.feature });
    if (owner.slot) candidates.push({ role: 'Slot', actual: owner.slot });
    if (owner.part && (owner.partRest?.length ?? 0) > 0) {
      candidates.push({ role: 'Part', actual: owner.part });
    }
    if (owner.shared) candidates.push({ role: 'Shared owner', actual: owner.shared });
    return candidates.flatMap(({ role, actual }) => {
      const expected = canonicalOwnerFolderName(actual);
      return actual === expected ? [] : [{ role, actual, expected }];
    });
  }
  function ownerRelative(owner: PortableOwner): readonly string[] {
    if (owner.kind === 'feature') return owner.rest ?? [];
    if (owner.kind === 'slot') return owner.slotRest ?? [];
    if (owner.kind === 'part') return owner.partRest ?? [];
    if (
      owner.kind === 'shared-ui' ||
      owner.kind === 'shared-widget' ||
      owner.kind === 'shared-capability'
    )
      return owner.sharedRest ?? [];
    return [];
  }
  function isEntry(owner: PortableOwner): boolean {
    const file = owner.fileName.split('/').at(-1) ?? '';
    const relative = ownerRelative(owner);
    const name =
      owner.kind === 'feature'
        ? owner.feature
        : owner.kind === 'slot'
          ? owner.slot
          : owner.kind === 'part'
            ? owner.part
            : owner.shared;
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
    if (
      (owner.kind === 'shared-ui' ||
        owner.kind === 'shared-widget' ||
        owner.kind === 'shared-capability') &&
      owner.shared
    )
      return `${owner.kind}:${owner.shared}`;
    return null;
  }
  function ownerCapability(owner: PortableOwner): RuntimeCapability | 'types' | null {
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    if (!name) return null;
    const file = owner.fileName.split('/').at(-1) ?? '';
    const atRoot = relative.length === 1;
    const inHooks = relative.length === 2 && relative[0] === config.hooksDirectory;
    const inStores = relative.length === 2 && relative[0] === config.storesDirectory;
    if (atRoot && file === `${pascalName(name)}${config.connectorSuffix}`) return 'connector';
    if ((atRoot || inHooks) && file === `use${pascalName(name)}.ts`) return 'hook';
    if ((atRoot || inStores) && file === `${camelName(name)}${config.storeSuffix}`) return 'store';
    if (atRoot && file === `${camelName(name)}${config.logicSuffix}`) return 'logic';
    if (atRoot && file === `${camelName(name)}${config.apiSuffix}`) return 'api';
    if (atRoot && file === `${camelName(name)}${config.typesSuffix}`) return 'types';
    return null;
  }
  function kebabName(value: string): string {
    return canonicalOwnerFolderName(value);
  }
  function promotionForImport(
    origin: PortableOwner,
    target: PortableOwner,
    capability: RuntimeCapability | 'types' | undefined,
  ): { label: string; suggestedFileName: string } | null {
    if (
      capability !== 'hook' &&
      capability !== 'store' &&
      capability !== 'logic' &&
      capability !== 'api'
    ) {
      return null;
    }
    if (!origin.feature || !target.feature) return null;
    let label: string;
    let destinationName: string;
    let destinationPath: string;
    if (origin.feature !== target.feature) {
      const sharedName = ownerName(target);
      if (!sharedName) return null;
      destinationName = sharedName;
      destinationPath = `${config.sharedRoot}/capabilities/${kebabName(sharedName)}`;
      label = destinationPath;
    } else if (target.slot && origin.slot !== target.slot) {
      destinationName = target.feature;
      destinationPath = `${config.featuresRoot}/${target.feature}`;
      label = `${target.feature} Feature root`;
    } else if (
      target.slot &&
      target.part &&
      origin.slot === target.slot &&
      origin.part !== target.part
    ) {
      destinationName = target.slot;
      destinationPath = `${config.featuresRoot}/${target.feature}/${config.slotsDirectory}/${target.slot}`;
      label = `${target.slot} Slot root`;
    } else {
      return null;
    }
    const fileName =
      capability === 'hook'
        ? `use${pascalName(destinationName)}.ts`
        : capability === 'store'
          ? `${camelName(destinationName)}${config.storeSuffix}`
          : capability === 'logic'
            ? `${camelName(destinationName)}${config.logicSuffix}`
            : `${camelName(destinationName)}${config.apiSuffix}`;
    return { label, suggestedFileName: `${destinationPath}/${fileName}` };
  }
  function isOwnerHelperHook(owner: PortableOwner): boolean {
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    const file = owner.fileName.split('/').at(-1) ?? '';
    return (
      !!name &&
      relative.length === 2 &&
      relative[0] === config.hooksDirectory &&
      new RegExp(`^use${pascalName(name)}[A-Z0-9][A-Za-z0-9]*\\.ts$`).test(file)
    );
  }
  function isOwnerHelperStore(owner: PortableOwner): boolean {
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    const file = owner.fileName.split('/').at(-1) ?? '';
    if (
      !name ||
      relative.length !== 2 ||
      relative[0] !== config.storesDirectory ||
      !file.endsWith(config.storeSuffix)
    ) {
      return false;
    }
    const prefix = camelName(name);
    const stem = file.slice(0, -config.storeSuffix.length);
    return stem.startsWith(prefix) && /^[A-Z0-9][A-Za-z0-9]*$/.test(stem.slice(prefix.length));
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
  const uiFunctionMeaningfulLineLimit = 200;
  const uiFileMeaningfulLineLimit = 300;
  const uiContractMemberLimit = 16;
  function isCommentLikeNode(node: ts.Node): boolean {
    return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;
  }
  function countMeaningfulLines(sourceFile: ts.SourceFile, root: ts.Node): number {
    const lines = new Set<number>();
    function visit(node: ts.Node): void {
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
        if (
          /\S/u.test(
            sourceFile.text.slice(Math.max(start, lineStart), Math.min(end, nextLineStart)),
          )
        ) {
          lines.add(line);
        }
      }
    }
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
  function resolve(origin: string, specifier: string): string | null {
    let candidate: string | null = null;
    if (specifier.startsWith('.')) candidate = clean(path.resolve(path.dirname(origin), specifier));
    else {
      const alias = matchingAlias(specifier);
      if (alias) {
        const [prefix, target] = alias;
        candidate = clean(path.resolve(projectRoot, target, specifier.slice(prefix.length)));
      } else if (specifier.startsWith('src/')) {
        candidate = clean(path.resolve(projectRoot, specifier));
      }
    }
    if (!candidate) return null;
    return fileMap.get(candidate) ?? fileMap.get(stripExtension(candidate)) ?? candidate;
  }
  function matchingAlias(specifier: string): readonly [string, string] | undefined {
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
  const sharedDependencyEdges: Array<{
    originKey: string;
    targetKey: string;
    originName: string;
    targetName: string;
    fileName: string;
    targetFileName: string;
    span: PortableSpan;
  }> = [];
  for (const file of files) {
    const owner = classify(file.fileName);
    const key = ownerKey(owner);
    const capability = ownerCapability(owner);
    const privateCapability = isOwnerHelperHook(owner)
      ? 'hook'
      : isOwnerHelperStore(owner)
        ? 'store'
        : null;
    if (key && (capability || privateCapability)) {
      fileCapabilities.set(file.fileName, capability ?? privateCapability!);
    }
    if (!key || !capability) continue;
    const current = ownerCapabilities.get(key) ?? new Set<RuntimeCapability | 'types'>();
    current.add(capability);
    ownerCapabilities.set(key, current);
    const capabilityFiles =
      ownerCapabilityFiles.get(key) ?? new Map<RuntimeCapability | 'types', string>();
    capabilityFiles.set(capability, file.fileName);
    ownerCapabilityFiles.set(key, capabilityFiles);
  }
  const layouts = new Map<
    string,
    {
      name: string;
      flatHook?: PortableFile;
      expandedHook?: PortableFile;
      helperHooks: PortableFile[];
      flatStore?: PortableFile;
      expandedStore?: PortableFile;
      helperStores: PortableFile[];
    }
  >();
  for (const file of files) {
    const owner = classify(file.fileName);
    const key = ownerKey(owner);
    const name = ownerName(owner);
    const relative = ownerRelative(owner);
    if (!key || !name) continue;
    const layout = layouts.get(key) ?? {
      name,
      helperHooks: [],
      helperStores: [],
    };
    if (relative.join('/') === `use${pascalName(name)}.ts`) layout.flatHook = file;
    if (relative.join('/') === `${config.hooksDirectory}/use${pascalName(name)}.ts`)
      layout.expandedHook = file;
    if (isOwnerHelperHook(owner)) layout.helperHooks.push(file);
    if (relative.join('/') === `${camelName(name)}${config.storeSuffix}`) layout.flatStore = file;
    if (relative.join('/') === `${config.storesDirectory}/${camelName(name)}${config.storeSuffix}`)
      layout.expandedStore = file;
    if (isOwnerHelperStore(owner)) layout.helperStores.push(file);
    layouts.set(key, layout);
  }
  function layoutSpan(file: PortableFile): PortableSpan {
    const sourceFile = ts.createSourceFile(
      file.fileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForFile(file.fileName),
    );
    const first = sourceFile.statements[0];
    const start = first?.getStart(sourceFile) ?? 0;
    const point = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      start,
      end: first?.getFirstToken(sourceFile)?.getEnd() ?? start,
      line: point.line + 1,
      column: point.character + 1,
    };
  }
  for (const layout of layouts.values()) {
    const validateLayout = (
      capability: 'Hook' | 'Store',
      flat: PortableFile | undefined,
      expanded: PortableFile | undefined,
      helpers: readonly PortableFile[],
      gatewayName: string,
      directory: string,
    ) => {
      if (flat && expanded) {
        report(
          'SRIJIKA4111',
          expanded.fileName,
          layoutSpan(expanded),
          `${layout.name} has both flat and expanded ${capability} gateways.`,
          `Keep exactly one gateway. Move ${gatewayName} into ${directory}/ and remove the root copy.`,
        );
      }
      if (helpers.length > 0 && flat && !expanded) {
        report(
          'SRIJIKA4111',
          helpers[0]!.fileName,
          layoutSpan(helpers[0]!),
          `${layout.name} mixes a flat ${capability} gateway with expanded ${directory}/ helpers.`,
          `Move ${gatewayName} into ${directory}/ and update all imports.`,
        );
      }
      if (helpers.length > 0 && !flat && !expanded) {
        report(
          'SRIJIKA4112',
          helpers[0]!.fileName,
          layoutSpan(helpers[0]!),
          `${layout.name} ${directory}/ helpers have no canonical expanded ${gatewayName} gateway.`,
          `Create ${directory}/${gatewayName}. All ${capability} access must pass through it.`,
        );
      }
    };
    validateLayout(
      'Hook',
      layout.flatHook,
      layout.expandedHook,
      layout.helperHooks,
      `use${pascalName(layout.name)}.ts`,
      config.hooksDirectory,
    );
    validateLayout(
      'Store',
      layout.flatStore,
      layout.expandedStore,
      layout.helperStores,
      `${camelName(layout.name)}${config.storeSuffix}`,
      config.storesDirectory,
    );
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
    function inspect(node: ts.Node): void {
      if (ts.isTypeQueryNode(node)) {
        violations.push(node.exprName);
        return;
      }
      if (ts.isComputedPropertyName(node)) {
        violations.push(node.expression);
        return;
      }
      ts.forEachChild(node, inspect);
    }
    inspect(statement);
    return violations;
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
  function forbiddenUiModule(
    targetFileName: string,
  ): 'store' | 'hook' | 'connector' | 'logic' | 'api' | null {
    const normalized = clean(targetFileName);
    const file = normalized.split('/').at(-1) ?? '';
    if (file.endsWith(config.storeSuffix) || /\.store(?:\.(?:ts|tsx))?$/.test(file)) {
      return 'store';
    }
    if (
      normalized.includes(`/${config.hooksDirectory}/`) ||
      /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(file)
    ) {
      return 'hook';
    }
    if (file.endsWith(config.connectorSuffix) || /\.connector(?:\.(?:ts|tsx))?$/.test(file)) {
      return 'connector';
    }
    if (file.endsWith(config.logicSuffix) || /\.logic(?:\.(?:ts|tsx))?$/.test(file)) {
      return 'logic';
    }
    if (file.endsWith(config.apiSuffix) || /\.api(?:\.(?:ts|tsx))?$/.test(file)) {
      return 'api';
    }
    return null;
  }
  function isPresentationalExternalImport(
    sourceFile: ts.SourceFile,
    moduleNode: ts.StringLiteralLike,
  ): boolean {
    if (isPresentationalAssetSpecifier(moduleNode.text)) return true;
    const declaration = moduleNode.parent;
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
      function inspect(node: ts.Node): void {
        if (!rendererOnly || node === declaration) return;
        if (ts.isIdentifier(node) && node.text === binding.text) {
          references += 1;
          if (!isJsxTagReference(node)) rendererOnly = false;
        }
        ts.forEachChild(node, inspect);
      }
      inspect(sourceFile);
      if (!rendererOnly || references === 0) return false;
    }
    return true;
  }
  function isSafeReactUiSupportImport(
    sourceFile: ts.SourceFile,
    moduleNode: ts.StringLiteralLike,
  ): boolean {
    if (moduleNode.text === 'react/jsx-runtime' || moduleNode.text === 'react/jsx-dev-runtime') {
      return true;
    }
    if (moduleNode.text !== 'react') return false;
    const declaration = moduleNode.parent;
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
      function inspect(node: ts.Node): void {
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
        ts.forEachChild(node, inspect);
      }
      inspect(sourceFile);
      if (!safe) return false;
    }
    return true;
  }
  function nodeLocation(sourceFile: ts.SourceFile, node: ts.Node): PortableSpan {
    const start = node.getStart(sourceFile);
    const point = sourceFile.getLineAndCharacterOfPosition(start);
    return {
      start,
      end: node.getEnd(),
      line: point.line + 1,
      column: point.character + 1,
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
      (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === identifier
    );
  }

  for (const file of files) {
    const sourceFile = ts.createSourceFile(
      file.fileName,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForFile(file.fileName),
    );
    const origin = classify(file.fileName);
    const isUi = file.fileName.endsWith(config.uiSuffix);
    const isLogic = file.fileName.endsWith(config.logicSuffix);
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

    if (isNoncanonicalSharedSourcePath(file.fileName)) {
      report(
        'SRIJIKA4110',
        file.fileName,
        anchor,
        `${currentBase} is inside ${config.sharedRoot} but outside its strict owner categories.`,
        `Shared source belongs only under ${config.sharedRoot}/ui/<owner>, ${config.sharedRoot}/widgets/<owner>, or ${config.sharedRoot}/capabilities/<owner>. Freehand root files, utils, common, and alternate categories are forbidden.`,
        'error',
        'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
      );
    }
    const invalidOwnerFolders = noncanonicalOwnerFolders(origin);
    if (invalidOwnerFolders.length > 0) {
      report(
        'SRIJIKA4110',
        file.fileName,
        anchor,
        `This source uses noncanonical owner folder naming: ${invalidOwnerFolders
          .map(({ role, actual }) => `${role} "${actual}"`)
          .join(', ')}.`,
        `Rename each owner folder to its exact kebab-case path: ${invalidOwnerFolders
          .map(({ role, expected }) => `${role} → ${expected}`)
          .join(
            ', ',
          )}. UI, Connector, and capability filenames remain derived from the same PascalCase owner name.`,
        'error',
        'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
      );
    }

    if (file.fileName.endsWith(config.typesSuffix)) {
      for (const statement of sourceFile.statements) {
        if (!isPassiveTypesStatement(statement)) {
          report(
            'SRIJIKA4117',
            file.fileName,
            nodeLocation(sourceFile, statement),
            `${currentBase} contains a runtime declaration or value import/export.`,
            'Types files are passive contracts. Keep only interfaces, type aliases, import type/export type declarations, and an optional empty export {}; move runtime values to Hook, Store, Logic, or API.',
            'error',
            'SRIJIKA-ARCH-PASSIVE-TYPES',
          );
          continue;
        }
        for (const reference of passiveTypesReferenceViolations(statement)) {
          report(
            'SRIJIKA4117',
            file.fileName,
            nodeLocation(sourceFile, reference),
            `${currentBase} references a runtime value from its passive Types contract.`,
            'Replace typeof/computed runtime references with an explicit passive interface or type alias imported through import type/export type.',
            'error',
            'SRIJIKA-ARCH-PASSIVE-TYPES',
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
          forbiddenUiModule(modulePath) !== null && resolve(file.fileName, modulePath) !== null;
        if (clause.name && (clause.name.text === 'use' || /^use[A-Z0-9]/.test(clause.name.text))) {
          importedHookNames.add(clause.name.text);
          if (!architectureHookTarget) {
            report(
              'SRIJIKA4101',
              file.fileName,
              nodeLocation(sourceFile, clause.name),
              `Pure UI files cannot import the ${clause.name.text} hook.`,
              'Call this hook in the matching Connector and pass its values or event callbacks into the UI through typed props.',
            );
          }
        }
        if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
        for (const element of clause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          if (importedName !== 'use' && !/^use[A-Z0-9]/.test(importedName)) continue;
          importedHookNames.add(element.name.text);
          if (!architectureHookTarget) {
            report(
              'SRIJIKA4101',
              file.fileName,
              nodeLocation(sourceFile, element.name),
              `Pure UI files cannot import the ${importedName} hook.`,
              'Call this hook in the matching Connector and pass its values or event callbacks into the UI through typed props.',
            );
          }
        }
      }
    }

    if (owner) {
      if (origin.kind === 'shared-ui') {
        const expectedUi = `${pascalName(owner)}${config.uiSuffix}`;
        const expectedTypes = `${camelName(owner)}${config.typesSuffix}`;
        if (
          relative.length !== 1 ||
          (currentBase !== expectedUi && currentBase !== expectedTypes)
        ) {
          report(
            'SRIJIKA4110',
            file.fileName,
            anchor,
            `${currentBase} is outside the strict ${owner} shared UI primitive contract.`,
            `A shared UI primitive contains only ${expectedUi} and optional ${expectedTypes}. Runtime code belongs in a Shared Widget.`,
            'error',
            'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
          );
        }
      } else if (currentBase.endsWith('.store.tsx')) {
        report(
          'SRIJIKA4105',
          file.fileName,
          anchor,
          `Store files do not render JSX: ${currentBase} must use the .store.ts suffix.`,
          `Rename this file to ${camelName(owner)}${config.storeSuffix}.`,
        );
      } else if (currentBase.endsWith(config.storeSuffix)) {
        const expected = `${camelName(owner)}${config.storeSuffix}`;
        const helperStem = currentBase.slice(0, -config.storeSuffix.length);
        const ownerPrefix = camelName(owner);
        const helperSuffix = helperStem.slice(ownerPrefix.length);
        const privateSlice =
          relative.length === 2 &&
          relative[0] === config.storesDirectory &&
          helperStem.startsWith(ownerPrefix) &&
          /^[A-Z0-9][A-Za-z0-9]*$/.test(helperSuffix);
        const flatGateway = relative.length === 1 && currentBase === expected;
        const expandedGateway =
          relative.length === 2 &&
          relative[0] === config.storesDirectory &&
          currentBase === expected;
        if (!flatGateway && !expandedGateway && !privateSlice) {
          report(
            'SRIJIKA4105',
            file.fileName,
            anchor,
            `The ${owner} Store must be its canonical ${expected} gateway or an owner-prefixed concern directly inside ${config.storesDirectory}/.`,
            `Use ${expected} in flat mode, or ${config.storesDirectory}/${expected} plus ${config.storesDirectory}/${ownerPrefix}<Concern>${config.storeSuffix} in expanded mode.`,
          );
        }
      }
      if (origin.kind !== 'shared-ui')
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
      const insideHooksDirectory =
        origin.kind !== 'shared-ui' && relative[0] === config.hooksDirectory;
      const expectedHook = `use${pascalName(owner)}.ts`;
      const canonicalGatewayHook =
        (relative.length === 1 && currentBase === expectedHook) ||
        (relative.length === 2 &&
          relative[0] === config.hooksDirectory &&
          currentBase === expectedHook);
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
            `The ${owner} Hook must be the canonical ${expectedPrefix}.ts gateway or an owner-prefixed behavior directly inside ${config.hooksDirectory}/.`,
            `Use ${expectedPrefix}.ts in flat mode, or ${config.hooksDirectory}/${expectedPrefix}.ts plus ${config.hooksDirectory}/${expectedPrefix}<Behavior>.ts in expanded mode.`,
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
      if (
        origin.kind !== 'shared-ui' &&
        architectureFile &&
        relative.length === 1 &&
        origin.kind !== 'shared-capability'
      ) {
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
              : origin.kind === 'shared-widget'
                ? `${config.sharedRoot}/widgets/<another-widget>/`
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
      const canonicalRootFiles = new Set([
        ...(origin.kind === 'shared-capability'
          ? []
          : [
              `${pascalName(owner)}${config.uiSuffix}`,
              `${pascalName(owner)}${config.connectorSuffix}`,
            ]),
        `use${pascalName(owner)}.ts`,
        `${camelName(owner)}${config.storeSuffix}`,
        `${camelName(owner)}${config.logicSuffix}`,
        `${camelName(owner)}${config.apiSuffix}`,
        `${camelName(owner)}${config.typesSuffix}`,
      ]);
      const allowedRoot =
        origin.kind !== 'shared-ui' && relative.length === 1 && canonicalRootFiles.has(currentBase);
      const allowedHookFile =
        relative.length === 2 &&
        relative[0] === config.hooksDirectory &&
        (currentBase === `use${pascalName(owner)}.ts` ||
          new RegExp(`^use${pascalName(owner)}[A-Z0-9][A-Za-z0-9]*\\.ts$`).test(currentBase));
      const storePrefix = camelName(owner);
      const allowedStoreFile =
        relative.length === 2 &&
        relative[0] === config.storesDirectory &&
        (currentBase === `${storePrefix}${config.storeSuffix}` ||
          new RegExp(`^${storePrefix}[A-Z0-9][A-Za-z0-9]*\\.store\\.ts$`).test(currentBase));
      const recognizedButMisnamed =
        architectureFile ||
        canonicalGatewayHook ||
        insideHooksDirectory ||
        /^use[A-Z0-9].*\.(?:ts|tsx)$/.test(currentBase) ||
        currentBase.endsWith('.store.ts') ||
        currentBase.endsWith('.store.tsx');
      const forbiddenHeadlessVisual =
        origin.kind === 'shared-capability' &&
        (currentBase.endsWith(config.uiSuffix) || currentBase.endsWith(config.connectorSuffix));
      if (forbiddenHeadlessVisual) {
        report(
          'SRIJIKA4110',
          file.fileName,
          anchor,
          `${currentBase} is a visual boundary inside the headless ${owner} shared capability.`,
          `Headless capabilities contain only Hook, Store, Logic, API, and Types.`,
          'error',
          'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
        );
      }
      if (
        origin.kind !== 'shared-ui' &&
        !allowedRoot &&
        !allowedHookFile &&
        !allowedStoreFile &&
        !recognizedButMisnamed &&
        !forbiddenHeadlessVisual
      ) {
        report(
          'SRIJIKA4110',
          file.fileName,
          anchor,
          `${currentBase} is outside the strict ${owner} owner file contract.`,
          `Only canonical UI, Connector, Hook, Store, Logic, API, and Types files are allowed. Expanded capability files belong only one level deep in ${config.hooksDirectory}/ or ${config.storesDirectory}/.`,
        );
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
    if (
      (origin.kind === 'shared-ui' ||
        origin.kind === 'shared-widget' ||
        origin.kind === 'shared-capability') &&
      origin.shared
    ) {
      registerOwner(
        `${origin.kind}:${origin.shared}`,
        origin,
        origin.kind !== 'shared-capability' && isOwnerUi(origin),
        origin.kind === 'shared-widget' && isOwnerConnector(origin),
        origin.kind !== 'shared-capability',
        file.fileName,
        anchor,
      );
    }

    if (isUi && isOwnerUi(origin)) {
      const key = ownerKey(origin);
      const name = ownerName(origin);
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
        const contractMembers = contract?.members.length ?? 0;
        const breaches: string[] = [];
        if (functionLines > uiFunctionMeaningfulLineLimit) {
          breaches.push(`${functionLines} meaningful exported-function lines`);
        }
        if (fileLines > uiFileMeaningfulLineLimit) {
          breaches.push(`${fileLines} meaningful file lines`);
        }
        if (contractMembers > uiContractMemberLimit) {
          breaches.push(`${contractMembers} top-level contract members`);
        }
        const recommendationKey = `${key}:SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER`;
        if (breaches.length > 0 && !reportedRecommendations.has(recommendationKey)) {
          reportedRecommendations.add(recommendationKey);
          report(
            'SRIJIKA4202',
            file.fileName,
            anchor,
            `The ${name} UI exceeds its owner guardrail (${breaches.join(', ')}); split it into a focused child owner.`,
            `This deterministic recommendation is non-blocking. The limits are strictly greater than 200 meaningful UI-function lines, 300 meaningful UI-file lines, or 16 top-level contract members. Extract a focused Part, Slot, or separate Shared owner without flattening ownership.`,
            'warning',
            'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
          );
        }
      }
    }

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
    function reportUiRuntimeReference(node: ts.Node, name: string): void {
      const span = nodeLocation(sourceFile, node);
      const key = `${span.start}:${span.end}:${name}`;
      if (reportedRuntimeReferences.has(key)) return;
      reportedRuntimeReferences.add(key);
      report(
        'SRIJIKA4101',
        file.fileName,
        span,
        `Pure UI files cannot access the ${name} browser/runtime API.`,
        'Move requests, sockets, and browser state access to the matching Connector or its Hook → Store → Logic → API chain, then pass values and event callbacks through typed props.',
        'error',
        'SRIJIKA-ARCH-UI-RUNTIME-IMPORT',
      );
    }
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
    const logicBrowserGlobals = new Set(['window', 'globalThis', 'self']);
    const reportedLogicRuntimeReferences = new Set<string>();
    function reportLogicRuntimeReference(node: ts.Node, name: string): void {
      const span = nodeLocation(sourceFile, node);
      const key = `${span.start}:${span.end}:${name}`;
      if (reportedLogicRuntimeReferences.has(key)) return;
      reportedLogicRuntimeReferences.add(key);
      report(
        'SRIJIKA4118',
        file.fileName,
        span,
        `Business Logic cannot use the ${name} React, state, router, or query lifecycle concern.`,
        'Keep Logic framework-free and deterministic. Put React and query lifecycle behavior in the owner Hook, shared client state in Store, routing in Connector, and request transport in API.',
        'error',
        'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN',
      );
    }

    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteralLike(argument)) {
          report(
            'SRIJIKA4119',
            file.fileName,
            nodeLocation(sourceFile, node),
            'This dynamic module reference cannot be proven against Srijika ownership boundaries.',
            'Use a static string literal or no-substitution template literal in import()/require(). Computed module targets are forbidden inside Feature, Slot, Part, and Shared ownership roots.',
            'error',
            'SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT',
          );
        }
      }
      let moduleNode: ts.StringLiteralLike | null = null;
      let moduleTypeOnly = false;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        moduleNode = node.moduleSpecifier;
        moduleTypeOnly = isTypeOnlyModuleReference(node);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        moduleNode = node.moduleReference.expression;
        moduleTypeOnly = isTypeOnlyModuleReference(node);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        moduleNode = node.argument.literal;
        moduleTypeOnly = true;
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
        const span = location(sourceFile, moduleNode);
        const uiRuntimeImport = isUi && !moduleTypeOnly;
        const sharedUiRuntimeImport = origin.kind === 'shared-ui' && !moduleTypeOnly;
        if (isPresentationalAssetSpecifier(moduleNode.text)) {
          ts.forEachChild(node, visit);
          return;
        }
        const targetName = resolve(file.fileName, moduleNode.text);
        const declaredAlias = matchingAlias(moduleNode.text);
        if (
          (declaredAlias !== undefined || isReservedProjectAlias(moduleNode.text)) &&
          (!declaredAlias ||
            !targetName ||
            !collectedFiles.has(targetName) ||
            classify(targetName).kind === 'outside')
        ) {
          report(
            'SRIJIKA4120',
            file.fileName,
            span,
            `The project-local alias ${moduleNode.text} does not resolve to a scanned governed source file.`,
            'Declare the alias in tsconfig.json compilerOptions.paths and point it to a source inside the configured Feature or Shared ownership roots. Unresolved project aliases fail closed; use ordinary package specifiers only for external npm dependencies.',
            'error',
            'SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS',
          );
          ts.forEachChild(node, visit);
          return;
        }
        const projectLocalImport =
          moduleNode.text.startsWith('.') || moduleNode.text.startsWith('src/');
        if (
          projectLocalImport &&
          (!targetName ||
            !collectedFiles.has(targetName) ||
            classify(targetName).kind === 'outside')
        ) {
          report(
            'SRIJIKA4121',
            file.fileName,
            span,
            `The project-local module ${moduleNode.text} does not resolve to a scanned governed source file.`,
            `Keep source imports inside ${config.featuresRoot} or ${config.sharedRoot}, and make sure the target exists in the bounded architecture scan. Styles and static assets remain allowed; external packages must use bare npm specifiers.`,
            'error',
            'SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT',
          );
          ts.forEachChild(node, visit);
          return;
        }
        if (!targetName) {
          const concern = externalRuntimeConcern(moduleNode.text);
          if (isLogic && isForbiddenLogicExternalConcern(concern)) {
            report(
              'SRIJIKA4118',
              file.fileName,
              span,
              `Business Logic cannot import the ${concern} runtime module ${moduleNode.text}.`,
              'Keep Logic framework-free and deterministic. Put React and query lifecycle behavior in the owner Hook, shared client state in Store, routing in Connector, and request transport in API.',
              'error',
              'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN',
            );
          }
          const safeReactSupport =
            concern === 'react' && isSafeReactUiSupportImport(sourceFile, moduleNode);
          if (
            uiRuntimeImport &&
            !safeReactSupport &&
            (concern !== null || !isPresentationalExternalImport(sourceFile, moduleNode))
          ) {
            report(
              'SRIJIKA4101',
              file.fileName,
              span,
              origin.kind === 'shared-ui'
                ? `Shared UI primitives cannot import the non-presentational runtime module ${moduleNode.text}.`
                : `Pure UI files cannot import the non-presentational runtime module ${moduleNode.text}.`,
              origin.kind === 'shared-ui'
                ? 'Keep this primitive renderer-only. External imports are limited to styles/assets, safe React JSX support, or bindings used exclusively as JSX tags; move hooks, state, routing, data access, and callable utilities into a Shared Widget Connector.'
                : 'Keep this UI renderer-only. External imports are limited to styles/assets, safe React JSX support, or bindings used exclusively as JSX tags; move hooks, state, routing, data access, and callable utilities into the matching Connector chain.',
              'error',
              'SRIJIKA-ARCH-UI-RUNTIME-IMPORT',
            );
          }
        }
        if (targetName) {
          const target = classify(targetName);
          const sharedUiPublicPrimitiveImport =
            sharedUiRuntimeImport && target.kind === 'shared-ui' && isOwnerUi(target);
          if (sharedUiRuntimeImport && !sharedUiPublicPrimitiveImport) {
            report(
              'SRIJIKA4101',
              file.fileName,
              span,
              `Shared UI primitives cannot import the runtime module ${moduleNode.text}.`,
              `Keep this primitive renderer-only. It may compose another canonical ${config.sharedRoot}/ui public UI boundary, styles/assets, and external bindings used exclusively as JSX tags; all behavior belongs in a Shared Widget Connector.`,
            );
          }
          const forbidden = forbiddenUiModule(targetName);
          if (isUi && forbidden && !sharedUiRuntimeImport) {
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
          if (targetName.endsWith(config.typesSuffix) && !moduleTypeOnly) {
            report(
              'SRIJIKA4117',
              file.fileName,
              span,
              `${moduleNode.text} is a passive Types contract but is imported or exported as a runtime value.`,
              'Use import type/export type for canonical Types modules. Move every runtime value to the matching Hook, Store, Logic, or API owner capability.',
              'error',
              'SRIJIKA-ARCH-PASSIVE-TYPES',
            );
            return;
          }
          const targetIsOwnerUi = isOwnerUi(target);
          const matchingConnectorOwnUi =
            originKey !== null && originKey === targetKey && originCapability === 'connector';
          const pureUiSharedPrimitive =
            isUi && originKey !== targetKey && target.kind === 'shared-ui' && targetIsOwnerUi;
          if (targetIsOwnerUi && !matchingConnectorOwnUi && !pureUiSharedPrimitive) {
            report(
              'SRIJIKA4116',
              file.fileName,
              span,
              `${ownerName(origin) ?? currentBase} cannot import the ${ownerName(target) ?? 'target'} UI directly.`,
              `A UI is rendered only by its matching Connector. Compose ${ownerName(target) ?? 'the child'} through ${pascalName(ownerName(target) ?? 'Owner')}${config.connectorSuffix}; the only cross-owner UI exception is pure UI composition of a canonical Shared UI Primitive.`,
              'error',
              'SRIJIKA-ARCH-DIRECT-CHILD-UI',
            );
            return;
          }
          const privateStoreBypass =
            isOwnerHelperStore(target) &&
            origin.kind !== 'outside' &&
            (target.feature
              ? origin.feature === target.feature
              : originKey !== null && originKey === targetKey) &&
            !(originKey === targetKey && ownerCapability(origin) === 'store');
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
          if (privateStoreBypass) {
            const name = ownerName(target) ?? 'owner';
            report(
              'SRIJIKA4201',
              file.fileName,
              span,
              `The ${ownerName(origin) ?? 'module'} ${originCapability ?? 'module'} bypasses the ${name} canonical Store gateway to import the private slice ${moduleNode.text}.`,
              `Import ${camelName(name)}${config.storeSuffix}. Only that public Store gateway may compose owner-private slices from ${config.storesDirectory}/.`,
            );
          }
          if (
            originKey &&
            originKey === targetKey &&
            originCapability &&
            originCapability !== 'types' &&
            targetCapability &&
            targetCapability !== 'types' &&
            !privateStoreBypass &&
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
          const originIsShared =
            origin.kind === 'shared-ui' ||
            origin.kind === 'shared-widget' ||
            origin.kind === 'shared-capability';
          const targetIsShared =
            target.kind === 'shared-ui' ||
            target.kind === 'shared-widget' ||
            target.kind === 'shared-capability';
          if (originIsShared && !targetIsShared && target.kind !== 'outside') {
            report(
              'SRIJIKA4113',
              file.fileName,
              span,
              `Shared code cannot import the Feature-owned module ${moduleNode.text}.`,
              `Shared dependencies are one-way: Features consume public Shared boundaries, but Shared never imports src/features.`,
              'error',
              'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY',
            );
          } else if (targetIsShared) {
            if (originKey !== targetKey) {
              const publicTargetCapability = ownerCapability(target);
              const targetCapabilities = targetKey
                ? (ownerCapabilities.get(targetKey) ?? new Set<RuntimeCapability | 'types'>())
                : new Set<RuntimeCapability | 'types'>();
              const highestCapability = (['hook', 'store', 'logic', 'api'] as const).find((role) =>
                targetCapabilities.has(role),
              );
              const publicBoundary =
                publicTargetCapability === 'types' ||
                (target.kind === 'shared-ui' && isOwnerUi(target)) ||
                (target.kind === 'shared-widget' && publicTargetCapability === 'connector') ||
                (target.kind === 'shared-capability' &&
                  highestCapability !== undefined &&
                  (publicTargetCapability === highestCapability ||
                    publicTargetCapability === 'api'));
              if (!publicBoundary) {
                report(
                  'SRIJIKA4114',
                  file.fileName,
                  span,
                  `The ${target.shared ?? 'target'} ${target.kind} keeps ${moduleNode.text} behind its public Shared boundary.`,
                  target.kind === 'shared-ui'
                    ? `Import only its canonical pure UI entry or passive Types contract.`
                    : target.kind === 'shared-widget'
                      ? `Import only its canonical Connector entry or passive Types contract.`
                      : `Import the highest available capability gateway (${highestCapability ?? 'Hook, Store, Logic, or API'}), an explicit API boundary, or passive Types.`,
                  'error',
                  'SRIJIKA-ARCH-SHARED-PRIVATE-IMPORT',
                );
              } else if (
                originIsShared &&
                originKey &&
                targetKey &&
                !moduleTypeOnly &&
                (!sharedUiRuntimeImport || sharedUiPublicPrimitiveImport)
              ) {
                sharedDependencyEdges.push({
                  originKey,
                  targetKey,
                  originName: ownerName(origin) ?? originKey,
                  targetName: ownerName(target) ?? targetKey,
                  fileName: file.fileName,
                  targetFileName: targetName,
                  span,
                });
              }
            }
          } else if (target.kind !== 'outside') {
            const sameFeature = origin.feature && origin.feature === target.feature;
            const publicFeatureEntry = target.kind === 'feature' && isEntry(target);
            if (!sameFeature && !publicFeatureEntry) {
              const promotion = promotionForImport(origin, target, targetCapability);
              report(
                'SRIJIKA4102',
                file.fileName,
                span,
                `The ${target.feature} feature keeps ${moduleNode.text} private.`,
                promotion
                  ? `Promote this private ${targetCapability} to ${promotion.label}; both feature owners now consume it. Use ${promotion.suggestedFileName} as the canonical promoted gateway in the shared domain.`
                  : `Import the public feature entry, or promote genuinely shared code to the nearest shared domain.`,
                'error',
                promotion ? 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER' : undefined,
              );
            } else if (
              sameFeature &&
              (target.kind === 'part' || (target.kind === 'slot' && !isEntry(target))) &&
              origin.slot !== target.slot
            ) {
              const promotion = promotionForImport(origin, target, targetCapability);
              report(
                'SRIJIKA4103',
                file.fileName,
                span,
                `The ${target.slot} slot keeps ${moduleNode.text} inside its own subtree.`,
                promotion
                  ? `Promote this private ${targetCapability} to ${promotion.label}; both slot owners now consume it. Use ${promotion.suggestedFileName} as the canonical promoted gateway.`
                  : `Promote it to the ${target.feature} feature scope if multiple slots need it.`,
                'error',
                promotion ? 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER' : undefined,
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
                const promotion = promotionForImport(origin, target, targetCapability);
                report(
                  'SRIJIKA4104',
                  file.fileName,
                  span,
                  targetIsPublicEntry && importingSibling
                    ? `The ${origin.part ?? 'current'} sibling part cannot import the ${target.part ?? 'target'} part public entry ${moduleNode.text}.`
                    : `The ${target.part ?? 'target'} part keeps ${moduleNode.text} private to its own subtree.`,
                  promotion
                    ? `Promote this private ${targetCapability} to ${promotion.label}; both part owners now consume it. Use ${promotion.suggestedFileName} as the canonical promoted gateway at the slot scope.`
                    : targetIsPublicEntry && importingSibling
                      ? `Compose the ${target.part ?? 'target'} public UI/Connector from the owning ${target.slot ?? 'slot'} slot. Promote shared sibling behavior to that slot scope.`
                      : `The owning ${target.slot ?? 'slot'} slot may compose only this part's public UI/Connector. Keep part stores, hooks, and private files inside ${target.part ?? 'the part'}; promote genuinely shared behavior to the slot scope.`,
                  'error',
                  promotion ? 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER' : undefined,
                );
              }
            }
          }
        }
      }
      if (isUi && ts.isCallExpression(node)) {
        const accessPath = propertyAccessPath(node.expression);
        const name = accessPath?.at(-1);
        const importedIdentifier =
          ts.isIdentifier(node.expression) && importedHookNames.has(node.expression.text);
        if (name && (name === 'use' || /^use[A-Z0-9]/.test(name)) && !importedIdentifier) {
          report(
            'SRIJIKA4101',
            file.fileName,
            nodeLocation(sourceFile, node.expression),
            `Pure UI files cannot call the ${accessPath?.join('.') ?? name} hook.`,
            'Move lifecycle, state, store access, and data wiring to the matching Connector, then pass authored values and events through typed props.',
          );
        }
      }
      if (isLogic && ts.isCallExpression(node)) {
        const accessPath = propertyAccessPath(node.expression);
        const name = accessPath?.at(-1);
        if (
          name &&
          (name === 'use' ||
            /^use[A-Z0-9]/.test(name) ||
            queryLifecycleNames.has(name) ||
            logicTransportNames.has(name))
        ) {
          reportLogicRuntimeReference(node.expression, accessPath?.join('.') ?? name);
        }
      } else if (isLogic && ts.isNewExpression(node)) {
        const accessPath = propertyAccessPath(node.expression);
        const name = accessPath?.at(-1);
        if (name && (queryRuntimeConstructors.has(name) || logicTransportNames.has(name))) {
          reportLogicRuntimeReference(node.expression, accessPath?.join('.') ?? name);
        }
      }
      if (isUi && ts.isIdentifier(node) && browserRuntimeNames.has(node.text)) {
        if (isStandaloneRuntimeIdentifier(node)) reportUiRuntimeReference(node, node.text);
      } else if (isUi && ts.isIdentifier(node) && browserGlobals.has(node.text)) {
        if (
          isStandaloneRuntimeIdentifier(node) &&
          !isCoveredByRuntimePropertyAccess(node, browserRuntimeNames)
        ) {
          reportUiRuntimeReference(node, node.text);
        }
      } else if (
        isUi &&
        !isTypePosition(node) &&
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      ) {
        const accessPath = propertyAccessPath(node);
        const name = accessPath?.at(-1);
        if (
          accessPath &&
          name &&
          browserRuntimeNames.has(name) &&
          browserGlobals.has(accessPath[0] ?? '')
        ) {
          reportUiRuntimeReference(node, name);
        }
      }
      if (isLogic && ts.isIdentifier(node) && logicTransportNames.has(node.text)) {
        if (isStandaloneRuntimeIdentifier(node) && !isDirectInvocationTarget(node)) {
          reportLogicRuntimeReference(node, node.text);
        }
      } else if (isLogic && ts.isIdentifier(node) && logicBrowserGlobals.has(node.text)) {
        if (isStandaloneRuntimeIdentifier(node) && !isCoveredByStaticPropertyAccess(node)) {
          reportLogicRuntimeReference(node, node.text);
        }
      } else if (
        isLogic &&
        !isTypePosition(node) &&
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      ) {
        const accessPath = propertyAccessPath(node);
        if (accessPath && logicBrowserGlobals.has(accessPath[0] ?? '')) {
          reportLogicRuntimeReference(node, accessPath.join('.'));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  const sharedAdjacency = new Map<string, Set<string>>();
  for (const edge of sharedDependencyEdges) {
    const targets = sharedAdjacency.get(edge.originKey) ?? new Set<string>();
    targets.add(edge.targetKey);
    sharedAdjacency.set(edge.originKey, targets);
  }
  function canReachSharedOwner(start: string, goal: string): boolean {
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
  }
  const reportedCycleEdges = new Set<string>();
  for (const edge of [...sharedDependencyEdges].sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.span.start - right.span.start ||
      left.targetKey.localeCompare(right.targetKey),
  )) {
    const edgeKey = `${edge.originKey}->${edge.targetKey}`;
    if (reportedCycleEdges.has(edgeKey) || !canReachSharedOwner(edge.targetKey, edge.originKey)) {
      continue;
    }
    reportedCycleEdges.add(edgeKey);
    report(
      'SRIJIKA4113',
      edge.fileName,
      edge.span,
      `The ${edge.originName} Shared owner import of ${edge.targetName} participates in a Shared dependency cycle.`,
      `Shared owners may consume another Shared owner's public runtime boundary, but the owner graph must remain acyclic. Move the common behavior to a narrower independent Shared owner and remove one direction of this cycle.`,
      'error',
      'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY',
    );
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
        scriptKindForFile(fileName),
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
    const name = ownerName(record.owner);
    if (!name) continue;
    if (record.owner.kind === 'shared-capability') {
      const key = ownerKey(record.owner);
      const capabilities = key ? ownerCapabilities.get(key) : undefined;
      if (
        !capabilities ||
        !(['hook', 'store', 'logic', 'api', 'types'] as const).some((role) =>
          capabilities.has(role),
        )
      ) {
        report(
          'SRIJIKA4115',
          record.fileName,
          record.span,
          `The ${name} shared headless capability has no public runtime gateway.`,
          `Add at least one canonical Hook, Store, Logic, API, or passive Types contract. Types-only capabilities expose no runtime behavior and consumers must import them with import type.`,
          'error',
          'SRIJIKA-ARCH-SHARED-MISSING-RUNTIME-GATEWAY',
        );
      }
      continue;
    }
    if (!record.requiresUi) continue;
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
    if (record.owner.kind !== 'shared-ui' && !record.hasConnector) {
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
    "import { constants as fsConstants } from 'node:fs';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import ts from 'typescript';",
    '',
    `const validate = ${portableMain.toString()};`,
    'const processCwd = process.cwd();',
    'let projectRoot = processCwd;',
    'if (process.env.PWD) {',
    '  try {',
    '    if ((await fs.realpath(process.env.PWD)) === (await fs.realpath(processCwd))) {',
    '      projectRoot = process.env.PWD;',
    '    }',
    '  } catch {',
    '    // Ignore a stale shell PWD; the canonical process cwd remains authoritative.',
    '  }',
    '}',
    `await validate({ fs, fsConstants, path, ts }, projectRoot, ${JSON.stringify(config, null, 2)});`,
    '',
  ].join('\n');
}
