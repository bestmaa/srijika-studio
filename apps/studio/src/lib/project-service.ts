import type { UiDocument } from '@srijika/contracts';

interface LoadedDocumentResponse {
  path: string;
  bytes: number;
  document: unknown;
}

interface SavedDocumentResponse {
  path: string;
  bytes: number;
  replaced: boolean;
}

export interface CodeProjectFile {
  path: string;
  contents: string;
}

export interface CreatedCodeProjectResponse {
  path: string;
  entrySourcePath: string;
  fileCount: number;
  bytes: number;
}

export type CodeProjectUiSourceKind = 'page' | 'component';

export interface CreateCodeProjectUiSourceRequest {
  projectPath: string;
  relativePath: string;
  kind: CodeProjectUiSourceKind;
  componentName: string;
  createConnector: boolean;
}

export interface CreatedCodeProjectUiSourceResponse {
  path: string;
  relativePath: string;
  connectorPath: string | null;
  bytes: number;
  hash: string;
  source: string;
  kind: CodeProjectUiSourceKind;
  componentName: string;
}

export type CodeProjectScaffoldCapability =
  | {
      kind: 'feature';
      createConnector?: boolean;
      createHook?: boolean;
      createStore?: boolean;
      createLogic?: boolean;
      createApi?: boolean;
      createTypes?: boolean;
      hookName?: string | null;
    }
  | { kind: 'featureConnector' }
  | { kind: 'featureStore' }
  | { kind: 'featureHook' }
  | { kind: 'featureBehaviorHook'; hookName: string }
  | { kind: 'featureLogic' }
  | { kind: 'featureApi' }
  | { kind: 'featureTypes' }
  | {
      kind: 'slot';
      slotName: string;
      createConnector?: boolean;
      createHook?: boolean;
      createStore?: boolean;
      createLogic?: boolean;
      createApi?: boolean;
      createTypes?: boolean;
      hookName?: string | null;
      partName?: string | null;
      createPartConnector?: boolean;
    }
  | { kind: 'slotConnector'; slotName: string }
  | { kind: 'slotStore'; slotName: string }
  | { kind: 'slotHook'; slotName: string }
  | { kind: 'slotBehaviorHook'; slotName: string; hookName: string }
  | { kind: 'slotLogic'; slotName: string }
  | { kind: 'slotApi'; slotName: string }
  | { kind: 'slotTypes'; slotName: string }
  | {
      kind: 'part';
      slotName: string;
      partName: string;
      createConnector?: boolean;
      createHook?: boolean;
      createStore?: boolean;
      createLogic?: boolean;
      createApi?: boolean;
      createTypes?: boolean;
      hookName?: string | null;
    }
  | { kind: 'partConnector'; slotName: string; partName: string }
  | { kind: 'partStore'; slotName: string; partName: string }
  | { kind: 'partHook'; slotName: string; partName: string }
  | { kind: 'partBehaviorHook'; slotName: string; partName: string; hookName: string }
  | { kind: 'partLogic'; slotName: string; partName: string }
  | { kind: 'partApi'; slotName: string; partName: string }
  | { kind: 'partTypes'; slotName: string; partName: string };

export interface ScaffoldCodeProjectStructureRequest {
  projectPath: string;
  featureName: string;
  capability: CodeProjectScaffoldCapability;
}

export type CodeProjectScaffoldFileRole =
  | 'featureUi'
  | 'featureConnector'
  | 'featureStore'
  | 'featureHook'
  | 'featureLogic'
  | 'featureApi'
  | 'featureTypes'
  | 'slotUi'
  | 'slotConnector'
  | 'slotStore'
  | 'slotHook'
  | 'slotLogic'
  | 'slotApi'
  | 'slotTypes'
  | 'partUi'
  | 'partConnector'
  | 'partStore'
  | 'partHook'
  | 'partLogic'
  | 'partApi'
  | 'partTypes';

export interface ScaffoldedCodeProjectFile {
  path: string;
  relativePath: string;
  role: CodeProjectScaffoldFileRole;
  bytes: number;
  hash: string;
}

export interface ScaffoldedCodeProjectStructureResponse {
  projectPath: string;
  featureName: string;
  featurePath: string;
  capability: CodeProjectScaffoldCapability;
  files: readonly ScaffoldedCodeProjectFile[];
  bytes: number;
}

export interface OpenedCodeProjectResponse {
  path: string;
  entrySourcePath: string;
  bytes: number;
  hash: string;
  source: string;
}

export interface LoadedTsxSourceResponse {
  path: string;
  bytes: number;
  hash: string;
  source: string;
}

export interface SavedTsxSourceResponse {
  path: string;
  bytes: number;
  hash: string;
  replaced: boolean;
}

export type CodeProjectEntryKind = 'directory' | 'file';

export interface CodeProjectEntry {
  path: string;
  relativePath: string;
  kind: CodeProjectEntryKind;
  bytes: number | null;
  hash: string | null;
  isUiSource: boolean;
}

export interface ScannedCodeProjectResponse {
  path: string;
  entrySourcePath: string;
  entries: readonly CodeProjectEntry[];
  truncated: boolean;
}

export interface CodeProjectArchitectureSource {
  path: string;
  relativePath: string;
  bytes: number;
  hash: string;
  source: string;
}

export interface LoadedCodeProjectArchitectureSourcesResponse {
  path: string;
  configSource: string;
  sources: readonly CodeProjectArchitectureSource[];
  truncated: boolean;
}

export interface CodeProjectPreviewStylesheet {
  path: string;
  relativePath: string;
  bytes: number;
  hash: string;
  source: string;
}

export interface CodeProjectPreviewAsset {
  path: string;
  publicPath: string;
  bytes: number;
  hash: string;
  mediaType: string;
  source: string;
}

export interface LoadedCodeProjectPreviewStylesResponse {
  path: string;
  stylesheets: readonly CodeProjectPreviewStylesheet[];
  assets: readonly CodeProjectPreviewAsset[];
  designProps: Readonly<Record<string, unknown>>;
}

export interface OpenInVsCodeRequest {
  projectPath: string;
  relativePath?: string;
  line?: number;
  column?: number;
}

export interface OpenedInVsCodeResponse {
  projectPath: string;
  targetPath: string;
  line: number | null;
  column: number | null;
}

export interface OpenedCodeProjectAppResponse {
  projectPath: string;
  url: string;
}

export type ProjectDependencyState = 'missingLockfile' | 'notInstalled' | 'outdated' | 'ready';
export type ProjectTaskKind = 'install' | 'build';
export type DevServerState = 'stopped' | 'running' | 'exited';

export interface ProjectTaskActivity {
  kind: ProjectTaskKind;
  startedAtMillis: number;
}

export interface ProjectTaskResult {
  projectPath: string;
  kind: ProjectTaskKind;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  durationMillis: number;
}

export interface DevServerStatus {
  state: DevServerState;
  ready: boolean;
  pid: number | null;
  port: number | null;
  url: string | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  startedAtMillis: number | null;
}

export interface ProjectRuntimeStatus {
  path: string;
  lockfilePresent: boolean;
  dependenciesInstalled: boolean;
  dependenciesReady: boolean;
  dependencyState: ProjectDependencyState;
  activeTask: ProjectTaskActivity | null;
  lastTask: ProjectTaskResult | null;
  running: boolean;
  port: number | null;
  devServer: DevServerStatus;
  message: string;
}

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function openBrowserPreview(): Promise<void> {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_preview_window');
    return;
  }

  const previewUrl = new URL('/preview', window.location.href);
  const preview = window.open(previewUrl.href, 'srijika-preview');
  if (!preview) throw new Error('The browser blocked the preview window');
  preview.focus();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertByteCount(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Desktop returned an invalid byte count');
}

function nullableByteCount(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Desktop returned an invalid ${name}`);
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Desktop returned an invalid ${name}`);
  return value;
}

function nullablePosition(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`Desktop returned an invalid ${name}`);
  return value;
}

function loopbackApplicationUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Desktop returned an invalid application URL');
  }
  const port = Number(parsed.port);
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65_535
  ) {
    throw new Error('Desktop returned a non-loopback application URL');
  }
  return value;
}

function booleanField(value: Record<string, unknown>, name: string): boolean {
  const field = value[name];
  if (typeof field !== 'boolean') throw new Error(`Desktop returned an invalid ${name}`);
  return field;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Desktop returned an invalid ${name}`);
  return value;
}

function nullableInteger(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`Desktop returned an invalid ${name}`);
  return value;
}

function nullableNonNegativeInteger(value: unknown, name: string): number | null {
  if (value === null) return null;
  return nonNegativeInteger(value, name);
}

function loadedResponse(value: unknown): LoadedDocumentResponse {
  if (!isRecord(value) || typeof value['path'] !== 'string' || !('document' in value))
    throw new Error('Desktop returned an invalid document response');
  assertByteCount(value['bytes']);
  return {
    path: value['path'],
    bytes: value['bytes'],
    document: value['document'],
  };
}

function savedResponse(value: unknown): SavedDocumentResponse {
  if (
    !isRecord(value) ||
    typeof value['path'] !== 'string' ||
    typeof value['replaced'] !== 'boolean'
  )
    throw new Error('Desktop returned an invalid save response');
  assertByteCount(value['bytes']);
  return {
    path: value['path'],
    bytes: value['bytes'],
    replaced: value['replaced'],
  };
}

function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== 'string') throw new Error(`Desktop returned an invalid ${name}`);
  return field;
}

function createdCodeProjectResponse(value: unknown): CreatedCodeProjectResponse {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid project response');
  assertByteCount(value['bytes']);
  assertByteCount(value['fileCount']);
  return {
    path: stringField(value, 'path'),
    entrySourcePath: stringField(value, 'entrySourcePath'),
    fileCount: value['fileCount'],
    bytes: value['bytes'],
  };
}

function createdCodeProjectUiSourceResponse(value: unknown): CreatedCodeProjectUiSourceResponse {
  if (!isRecord(value) || (value['kind'] !== 'page' && value['kind'] !== 'component')) {
    throw new Error('Desktop returned an invalid created UI source response');
  }
  assertByteCount(value['bytes']);
  const connectorPath = value['connectorPath'];
  if (connectorPath !== null && typeof connectorPath !== 'string') {
    throw new Error('Desktop returned an invalid connectorPath');
  }
  return {
    path: stringField(value, 'path'),
    relativePath: stringField(value, 'relativePath'),
    connectorPath,
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
    source: stringField(value, 'source'),
    kind: value['kind'],
    componentName: stringField(value, 'componentName'),
  };
}

const codeProjectScaffoldFileRoles = new Set<CodeProjectScaffoldFileRole>([
  'featureUi',
  'featureConnector',
  'featureStore',
  'featureHook',
  'featureLogic',
  'featureApi',
  'featureTypes',
  'slotUi',
  'slotConnector',
  'slotStore',
  'slotHook',
  'slotLogic',
  'slotApi',
  'slotTypes',
  'partUi',
  'partConnector',
  'partStore',
  'partHook',
  'partLogic',
  'partApi',
  'partTypes',
]);

function nullableOptionalStringField(value: Record<string, unknown>, name: string): string | null {
  const field = value[name];
  if (field === null) return null;
  if (typeof field !== 'string') throw new Error(`Desktop returned an invalid ${name}`);
  return field;
}

function codeProjectScaffoldCapability(value: unknown): CodeProjectScaffoldCapability {
  if (!isRecord(value) || typeof value['kind'] !== 'string') {
    throw new Error('Desktop returned an invalid scaffold capability');
  }
  switch (value['kind']) {
    case 'feature':
      return {
        kind: value['kind'],
        createConnector: booleanField(value, 'createConnector'),
        createHook: booleanField(value, 'createHook'),
        createStore: booleanField(value, 'createStore'),
        createLogic: booleanField(value, 'createLogic'),
        createApi: booleanField(value, 'createApi'),
        createTypes: booleanField(value, 'createTypes'),
        hookName: nullableOptionalStringField(value, 'hookName'),
      };
    case 'featureConnector':
    case 'featureStore':
    case 'featureHook':
    case 'featureLogic':
    case 'featureApi':
    case 'featureTypes':
      return { kind: value['kind'] };
    case 'featureBehaviorHook':
      return { kind: value['kind'], hookName: stringField(value, 'hookName') };
    case 'slot':
      return {
        kind: value['kind'],
        slotName: stringField(value, 'slotName'),
        createConnector: booleanField(value, 'createConnector'),
        createHook: booleanField(value, 'createHook'),
        createStore: booleanField(value, 'createStore'),
        createLogic: booleanField(value, 'createLogic'),
        createApi: booleanField(value, 'createApi'),
        createTypes: booleanField(value, 'createTypes'),
        hookName: nullableOptionalStringField(value, 'hookName'),
        partName: nullableOptionalStringField(value, 'partName'),
        createPartConnector: booleanField(value, 'createPartConnector'),
      };
    case 'slotHook':
    case 'slotConnector':
    case 'slotStore':
    case 'slotLogic':
    case 'slotApi':
    case 'slotTypes':
      return {
        kind: value['kind'],
        slotName: stringField(value, 'slotName'),
      };
    case 'slotBehaviorHook':
      return {
        kind: value['kind'],
        slotName: stringField(value, 'slotName'),
        hookName: stringField(value, 'hookName'),
      };
    case 'part':
      return {
        kind: value['kind'],
        slotName: stringField(value, 'slotName'),
        partName: stringField(value, 'partName'),
        createConnector: booleanField(value, 'createConnector'),
        createHook: booleanField(value, 'createHook'),
        createStore: booleanField(value, 'createStore'),
        createLogic: booleanField(value, 'createLogic'),
        createApi: booleanField(value, 'createApi'),
        createTypes: booleanField(value, 'createTypes'),
        hookName: nullableOptionalStringField(value, 'hookName'),
      };
    case 'partHook':
    case 'partConnector':
    case 'partStore':
    case 'partLogic':
    case 'partApi':
    case 'partTypes':
      return {
        kind: value['kind'],
        slotName: stringField(value, 'slotName'),
        partName: stringField(value, 'partName'),
      };
    case 'partBehaviorHook':
      return {
        kind: value['kind'],
        slotName: stringField(value, 'slotName'),
        partName: stringField(value, 'partName'),
        hookName: stringField(value, 'hookName'),
      };
    default:
      throw new Error('Desktop returned an invalid scaffold capability');
  }
}

function scaffoldedCodeProjectFile(value: unknown): ScaffoldedCodeProjectFile {
  if (
    !isRecord(value) ||
    typeof value['role'] !== 'string' ||
    !codeProjectScaffoldFileRoles.has(value['role'] as CodeProjectScaffoldFileRole)
  ) {
    throw new Error('Desktop returned an invalid scaffolded file');
  }
  assertByteCount(value['bytes']);
  return {
    path: stringField(value, 'path'),
    relativePath: stringField(value, 'relativePath'),
    role: value['role'] as CodeProjectScaffoldFileRole,
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
  };
}

function scaffoldedCodeProjectStructureResponse(
  value: unknown,
): ScaffoldedCodeProjectStructureResponse {
  if (!isRecord(value) || !Array.isArray(value['files']) || value['files'].length === 0) {
    throw new Error('Desktop returned an invalid scaffold response');
  }
  assertByteCount(value['bytes']);
  return {
    projectPath: stringField(value, 'projectPath'),
    featureName: stringField(value, 'featureName'),
    featurePath: stringField(value, 'featurePath'),
    capability: codeProjectScaffoldCapability(value['capability']),
    files: value['files'].map(scaffoldedCodeProjectFile),
    bytes: value['bytes'],
  };
}

function loadedTsxSourceResponse(value: unknown): LoadedTsxSourceResponse {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid TSX source response');
  assertByteCount(value['bytes']);
  return {
    path: stringField(value, 'path'),
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
    source: stringField(value, 'source'),
  };
}

function openedCodeProjectResponse(value: unknown): OpenedCodeProjectResponse {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid opened project response');
  assertByteCount(value['bytes']);
  return {
    path: stringField(value, 'path'),
    entrySourcePath: stringField(value, 'entrySourcePath'),
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
    source: stringField(value, 'source'),
  };
}

function savedTsxSourceResponse(value: unknown): SavedTsxSourceResponse {
  if (!isRecord(value) || typeof value['replaced'] !== 'boolean')
    throw new Error('Desktop returned an invalid TSX save response');
  assertByteCount(value['bytes']);
  return {
    path: stringField(value, 'path'),
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
    replaced: value['replaced'],
  };
}

function codeProjectEntry(value: unknown): CodeProjectEntry {
  if (
    !isRecord(value) ||
    (value['kind'] !== 'directory' && value['kind'] !== 'file') ||
    typeof value['isUiSource'] !== 'boolean'
  ) {
    throw new Error('Desktop returned an invalid project entry');
  }
  return {
    path: stringField(value, 'path'),
    relativePath: stringField(value, 'relativePath'),
    kind: value['kind'],
    bytes: nullableByteCount(value['bytes'], 'project entry byte count'),
    hash: nullableString(value['hash'], 'project entry hash'),
    isUiSource: value['isUiSource'],
  };
}

function scannedCodeProjectResponse(value: unknown): ScannedCodeProjectResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value['entries']) ||
    typeof value['truncated'] !== 'boolean'
  )
    throw new Error('Desktop returned an invalid project scan');
  return {
    path: stringField(value, 'path'),
    entrySourcePath: stringField(value, 'entrySourcePath'),
    entries: value['entries'].map(codeProjectEntry),
    truncated: value['truncated'],
  };
}

const MAX_ARCHITECTURE_SOURCE_FILES = 4_096;
const MAX_ARCHITECTURE_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_ARCHITECTURE_SOURCES_BYTES = 24 * 1024 * 1024;
const MAX_ARCHITECTURE_CONFIG_BYTES = 64 * 1024;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSafeArchitectureRelativePath(value: string): boolean {
  if (!value || value.includes('\\') || value.startsWith('/')) return false;
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  return /\.(?:ts|tsx|mts|cts)$/.test(value);
}

function codeProjectArchitectureSource(value: unknown): CodeProjectArchitectureSource {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid architecture source');
  assertByteCount(value['bytes']);
  const relativePath = stringField(value, 'relativePath');
  const source = stringField(value, 'source');
  const hash = stringField(value, 'hash');
  if (
    !isSafeArchitectureRelativePath(relativePath) ||
    !/^fnv1a64:[0-9a-f]{16}$/.test(hash) ||
    value['bytes'] > MAX_ARCHITECTURE_SOURCE_BYTES ||
    utf8ByteLength(source) !== value['bytes']
  ) {
    throw new Error('Desktop returned an invalid architecture source');
  }
  return {
    path: stringField(value, 'path'),
    relativePath,
    bytes: value['bytes'],
    hash,
    source,
  };
}

function loadedCodeProjectArchitectureSourcesResponse(
  value: unknown,
): LoadedCodeProjectArchitectureSourcesResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value['sources']) ||
    value['sources'].length > MAX_ARCHITECTURE_SOURCE_FILES ||
    typeof value['truncated'] !== 'boolean'
  ) {
    throw new Error('Desktop returned invalid architecture sources');
  }
  const configSource = stringField(value, 'configSource');
  if (utf8ByteLength(configSource) > MAX_ARCHITECTURE_CONFIG_BYTES) {
    throw new Error('Desktop returned invalid architecture sources');
  }
  let config: unknown;
  try {
    config = JSON.parse(configSource);
  } catch {
    throw new Error('Desktop returned invalid architecture sources');
  }
  if (
    !isRecord(config) ||
    config['sourceOfTruth'] !== 'tsx' ||
    typeof config['entry'] !== 'string' ||
    !config['entry'].endsWith('.ui.tsx')
  ) {
    throw new Error('Desktop returned invalid architecture sources');
  }

  const sources = value['sources'].map(codeProjectArchitectureSource);
  const path = stringField(value, 'path');
  const normalizedRoot = path.replaceAll('\\', '/').replace(/\/$/, '');
  if (!normalizedRoot) throw new Error('Desktop returned invalid architecture sources');
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const source of sources) {
    const expectedPath = `${normalizedRoot}/${source.relativePath}`;
    if (source.path.replaceAll('\\', '/') !== expectedPath || seen.has(source.relativePath)) {
      throw new Error('Desktop returned invalid architecture sources');
    }
    seen.add(source.relativePath);
    totalBytes += source.bytes;
    if (totalBytes > MAX_ARCHITECTURE_SOURCES_BYTES) {
      throw new Error('Desktop returned invalid architecture sources');
    }
  }
  return {
    path,
    configSource,
    sources,
    truncated: value['truncated'],
  };
}

function codeProjectPreviewStylesheet(value: unknown): CodeProjectPreviewStylesheet {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid preview stylesheet');
  assertByteCount(value['bytes']);
  return {
    path: stringField(value, 'path'),
    relativePath: stringField(value, 'relativePath'),
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
    source: stringField(value, 'source'),
  };
}

function codeProjectPreviewAsset(value: unknown): CodeProjectPreviewAsset {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid preview asset');
  assertByteCount(value['bytes']);
  return {
    path: stringField(value, 'path'),
    publicPath: stringField(value, 'publicPath'),
    bytes: value['bytes'],
    hash: stringField(value, 'hash'),
    mediaType: stringField(value, 'mediaType'),
    source: stringField(value, 'source'),
  };
}

function loadedCodeProjectPreviewStylesResponse(
  value: unknown,
): LoadedCodeProjectPreviewStylesResponse {
  if (!isRecord(value) || !Array.isArray(value['stylesheets']) || !Array.isArray(value['assets'])) {
    throw new Error('Desktop returned invalid project preview styles');
  }
  if (!isRecord(value['designProps'])) {
    throw new Error('Desktop returned invalid project preview props');
  }
  return {
    path: stringField(value, 'path'),
    stylesheets: value['stylesheets'].map(codeProjectPreviewStylesheet),
    assets: value['assets'].map(codeProjectPreviewAsset),
    designProps: value['designProps'],
  };
}

function openedInVsCodeResponse(value: unknown): OpenedInVsCodeResponse {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid VS Code response');
  return {
    projectPath: stringField(value, 'projectPath'),
    targetPath: stringField(value, 'targetPath'),
    line: nullablePosition(value['line'], 'VS Code line'),
    column: nullablePosition(value['column'], 'VS Code column'),
  };
}

function openedCodeProjectAppResponse(value: unknown): OpenedCodeProjectAppResponse {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid opened application response');
  const url = loopbackApplicationUrl(stringField(value, 'url'));
  return {
    projectPath: stringField(value, 'projectPath'),
    url,
  };
}

function taskKind(value: unknown): ProjectTaskKind {
  if (value !== 'install' && value !== 'build')
    throw new Error('Desktop returned an invalid project task kind');
  return value;
}

function projectTaskActivity(value: unknown): ProjectTaskActivity | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Desktop returned an invalid active project task');
  return {
    kind: taskKind(value['kind']),
    startedAtMillis: nonNegativeInteger(value['startedAtMillis'], 'task start time'),
  };
}

function projectTaskResult(value: unknown): ProjectTaskResult | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Desktop returned an invalid project task result');
  return {
    projectPath: stringField(value, 'projectPath'),
    kind: taskKind(value['kind']),
    success: booleanField(value, 'success'),
    exitCode: nullableInteger(value['exitCode'], 'task exit code'),
    stdout: stringField(value, 'stdout'),
    stderr: stringField(value, 'stderr'),
    outputTruncated: booleanField(value, 'outputTruncated'),
    durationMillis: nonNegativeInteger(value['durationMillis'], 'task duration'),
  };
}

function devServerStatus(value: unknown): DevServerStatus {
  if (
    !isRecord(value) ||
    (value['state'] !== 'stopped' && value['state'] !== 'running' && value['state'] !== 'exited')
  ) {
    throw new Error('Desktop returned an invalid development server status');
  }
  const url = nullableString(value['url'], 'development server URL');
  return {
    state: value['state'],
    ready: booleanField(value, 'ready'),
    pid: nullableNonNegativeInteger(value['pid'], 'development server pid'),
    port: nullableNonNegativeInteger(value['port'], 'development server port'),
    url: url === null ? null : loopbackApplicationUrl(url),
    exitCode: nullableInteger(value['exitCode'], 'development server exit code'),
    stdout: stringField(value, 'stdout'),
    stderr: stringField(value, 'stderr'),
    outputTruncated: booleanField(value, 'outputTruncated'),
    startedAtMillis: nullableNonNegativeInteger(
      value['startedAtMillis'],
      'development server start time',
    ),
  };
}

function projectRuntimeStatus(value: unknown): ProjectRuntimeStatus {
  if (!isRecord(value)) throw new Error('Desktop returned an invalid project runtime status');
  const dependencyState = value['dependencyState'];
  if (
    dependencyState !== 'missingLockfile' &&
    dependencyState !== 'notInstalled' &&
    dependencyState !== 'outdated' &&
    dependencyState !== 'ready'
  ) {
    throw new Error('Desktop returned an invalid dependency state');
  }
  return {
    path: stringField(value, 'path'),
    lockfilePresent: booleanField(value, 'lockfilePresent'),
    dependenciesInstalled: booleanField(value, 'dependenciesInstalled'),
    dependenciesReady: booleanField(value, 'dependenciesReady'),
    dependencyState,
    activeTask: projectTaskActivity(value['activeTask']),
    lastTask: projectTaskResult(value['lastTask']),
    running: booleanField(value, 'running'),
    port: nullableNonNegativeInteger(value['port'], 'project runtime port'),
    devServer: devServerStatus(value['devServer']),
    message: stringField(value, 'message'),
  };
}

export async function chooseAndCreateCodeProject(
  files: readonly CodeProjectFile[],
  entrySource: string,
  suggestedName = 'srijika-app',
): Promise<CreatedCodeProjectResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ save }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await save({
    title: 'Create Srijika code project',
    defaultPath: suggestedName,
  });
  if (!path) return null;
  return createdCodeProjectResponse(
    await invoke<unknown>('create_code_project', {
      request: { path, entrySource, files },
    }),
  );
}

export async function chooseAndLoadTsxSource(): Promise<LoadedTsxSourceResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ open }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await open({
    title: 'Open Srijika UI source',
    multiple: false,
    directory: false,
    filters: [{ name: 'Srijika UI source', extensions: ['tsx'] }],
  });
  if (typeof path !== 'string') return null;
  if (!path.endsWith('.ui.tsx')) throw new Error('Choose a file ending in .ui.tsx');
  return loadedTsxSourceResponse(await invoke<unknown>('load_tsx_source', { request: { path } }));
}

export async function createCodeProjectUiSource(
  request: CreateCodeProjectUiSourceRequest,
): Promise<CreatedCodeProjectUiSourceResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return createdCodeProjectUiSourceResponse(
    await invoke<unknown>('create_code_project_ui_source', { request }),
  );
}

export async function scaffoldCodeProjectStructure(
  request: ScaffoldCodeProjectStructureRequest,
): Promise<ScaffoldedCodeProjectStructureResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return scaffoldedCodeProjectStructureResponse(
    await invoke<unknown>('scaffold_code_project_structure', { request }),
  );
}

export async function chooseAndOpenCodeProject(): Promise<OpenedCodeProjectResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ open }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await open({
    title: 'Open Srijika code project',
    multiple: false,
    directory: true,
  });
  if (typeof path !== 'string') return null;
  return openedCodeProjectResponse(
    await invoke<unknown>('open_code_project', { request: { path } }),
  );
}

export async function getLaunchProject(): Promise<string | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const value = await invoke<unknown>('get_launch_project');
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Desktop returned an invalid launch project.');
  }
  return value;
}

export async function openCodeProject(path: string): Promise<OpenedCodeProjectResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return openedCodeProjectResponse(
    await invoke<unknown>('open_code_project', { request: { path } }),
  );
}

export async function loadTsxSource(path: string): Promise<LoadedTsxSourceResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return loadedTsxSourceResponse(await invoke<unknown>('load_tsx_source', { request: { path } }));
}

export async function saveTsxSource(
  path: string,
  source: string,
  expectedHash: string | null,
): Promise<SavedTsxSourceResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return savedTsxSourceResponse(
    await invoke<unknown>('save_tsx_source', {
      request: { path, source, expectedHash },
    }),
  );
}

export async function scanCodeProject(path: string): Promise<ScannedCodeProjectResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return scannedCodeProjectResponse(
    await invoke<unknown>('scan_code_project', { request: { path } }),
  );
}

export async function loadCodeProjectArchitectureSources(
  path: string,
): Promise<LoadedCodeProjectArchitectureSourcesResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return loadedCodeProjectArchitectureSourcesResponse(
    await invoke<unknown>('load_code_project_architecture_sources', { request: { path } }),
  );
}

export async function loadCodeProjectPreviewStyles(
  path: string,
): Promise<LoadedCodeProjectPreviewStylesResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return loadedCodeProjectPreviewStylesResponse(
    await invoke<unknown>('load_code_project_preview_styles', { request: { path } }),
  );
}

export async function openInVsCode(
  request: OpenInVsCodeRequest,
): Promise<OpenedInVsCodeResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return openedInVsCodeResponse(await invoke<unknown>('open_in_vscode', { request }));
}

export async function openCodeProjectApp(
  path: string,
): Promise<OpenedCodeProjectAppResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return openedCodeProjectAppResponse(
    await invoke<unknown>('open_code_project_app', { request: { path } }),
  );
}

export async function openCodeProjectPreview(
  path: string,
): Promise<OpenedCodeProjectAppResponse | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return openedCodeProjectAppResponse(
    await invoke<unknown>('open_code_project_preview', { request: { path } }),
  );
}

export async function getProjectRuntimeStatus(path: string): Promise<ProjectRuntimeStatus | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return projectRuntimeStatus(
    await invoke<unknown>('get_project_runtime_status', { request: { path } }),
  );
}

async function runProjectTask(
  command: 'install_project_dependencies' | 'build_code_project',
  path: string,
): Promise<ProjectTaskResult | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return projectTaskResult(await invoke<unknown>(command, { request: { path } }));
}

export async function installProjectDependencies(path: string): Promise<ProjectTaskResult | null> {
  return runProjectTask('install_project_dependencies', path);
}

export async function buildCodeProject(path: string): Promise<ProjectTaskResult | null> {
  return runProjectTask('build_code_project', path);
}

export async function startCodeProject(
  path: string,
  port?: number,
): Promise<ProjectRuntimeStatus | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return projectRuntimeStatus(
    await invoke<unknown>('start_code_project', {
      request: { path, ...(port === undefined ? {} : { port }) },
    }),
  );
}

export async function stopCodeProject(path: string): Promise<ProjectRuntimeStatus | null> {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return projectRuntimeStatus(await invoke<unknown>('stop_code_project', { request: { path } }));
}

export async function chooseAndLoadDocument(): Promise<LoadedDocumentResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ open }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await open({
    title: 'Open Srijika UI document',
    multiple: false,
    directory: false,
    filters: [{ name: 'Srijika UI document', extensions: ['json'] }],
  });
  if (typeof path !== 'string') return null;
  return loadedResponse(await invoke<unknown>('load_ui_document', { request: { path } }));
}

export async function chooseAndSaveDocument(
  document: UiDocument,
): Promise<SavedDocumentResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ save }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await save({
    title: 'Save Srijika UI document',
    defaultPath: `${document.id}.srijika.json`,
    filters: [{ name: 'Srijika UI document', extensions: ['json'] }],
  });
  if (!path) return null;
  return savedResponse(
    await invoke<unknown>('save_ui_document', {
      request: { path, document },
    }),
  );
}
