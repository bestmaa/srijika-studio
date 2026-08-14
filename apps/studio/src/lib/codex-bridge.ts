import { nanoid } from 'nanoid';

import {
  CAPABILITIES,
  PROTOCOL_VERSION,
  SRIJIKA_RPC_METHODS,
  applyOperations,
  buildComponentCatalog,
  buildGeneratedCodeResult,
  buildNodeDetail,
  buildPageOutline,
  buildProjectSummary,
  buildRepetitionAnalysis,
  hasAutomationErrors,
  validateAutomationDocument,
  type ApplyOperationsResult,
  type AutomationIdFactory,
  type SrijikaOperation,
} from '@srijika/automation-protocol';
import type { SrijikaProject, UiDocument } from '@srijika/contracts';
import { generateTsx } from '@srijika/react-codegen';

import { componentRegistry } from './registry';
import { isTauriDesktop } from './project-service';
import {
  captureRenderedPreview,
  inspectRenderedLayout,
  waitForRenderedLayoutReady,
} from './render-inspection';
import { useStudioStore, type StudioPanel, type ViewportPreset } from '../store/studio-store';

export const CODEX_BRIDGE_REQUEST_EVENT = 'srijika://bridge-rpc-request';
export const CODEX_BRIDGE_RESOLVE_COMMAND = 'resolve_bridge_rpc';
export const CODEX_BRIDGE_READY_COMMAND = 'set_bridge_frontend_ready';

type StudioStoreSnapshot = ReturnType<typeof useStudioStore.getState>;

const LEGACY_RPC_PREFIX = 'sutra.';
const CANONICAL_RPC_PREFIX = 'srijika.';

function canonicalRpcMethod(method: string): string {
  if (!method.startsWith(LEGACY_RPC_PREFIX)) return method;
  const candidate = `${CANONICAL_RPC_PREFIX}${method.slice(LEGACY_RPC_PREFIX.length)}`;
  return Object.values(SRIJIKA_RPC_METHODS).includes(
    candidate as (typeof SRIJIKA_RPC_METHODS)[keyof typeof SRIJIKA_RPC_METHODS],
  )
    ? candidate
    : method;
}

export interface StudioBridgeDispatcherDependencies {
  getState: () => StudioStoreSnapshot;
  createId?: AutomationIdFactory;
}

export interface StudioBridgeRpcRequest {
  requestId: string;
  protocolVersion: string;
  method: string;
  params: unknown;
}

export class StudioBridgeRpcError extends Error {
  readonly code: string;
  readonly details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'StudioBridgeRpcError';
    this.code = code;
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  return fallback;
}

function paramsRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new StudioBridgeRpcError('invalid_params', 'RPC params must be a JSON object.');
  }
  return value;
}

function optionalString(
  params: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new StudioBridgeRpcError('invalid_params', `${key} must be a non-empty string.`, {
      key,
    });
  }
  return value;
}

function optionalBoolean(
  params: Readonly<Record<string, unknown>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    throw new StudioBridgeRpcError('invalid_params', `${key} must be a boolean.`, { key });
  }
  return value;
}

function integerParam(
  params: Readonly<Record<string, unknown>>,
  key: string,
  fallback?: number,
): number {
  const value = params[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new StudioBridgeRpcError('invalid_params', `${key} must be a non-negative integer.`, {
      key,
    });
  }
  return value;
}

const PRESET_VIEWPORT_SIZES: Record<ViewportPreset, { width: number; height: number }> = {
  desktop: { width: 1180, height: 820 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

function viewportRequest(params: Readonly<Record<string, unknown>>): {
  preset: ViewportPreset;
  size: { width: number; height: number };
  custom: boolean;
} {
  const rawViewport = params['viewport'] ?? 'desktop';
  if (typeof rawViewport !== 'string' || !['desktop', 'tablet', 'mobile'].includes(rawViewport)) {
    throw new StudioBridgeRpcError(
      'invalid_params',
      'viewport must be desktop, tablet, or mobile.',
      { key: 'viewport' },
    );
  }
  const preset = rawViewport as ViewportPreset;
  const width = params['width'];
  const height = params['height'];
  if ((width === undefined) !== (height === undefined)) {
    throw new StudioBridgeRpcError(
      'invalid_params',
      'width and height must be supplied together for a custom viewport.',
      { keys: ['width', 'height'] },
    );
  }
  if (width === undefined || height === undefined) {
    return { preset, size: PRESET_VIEWPORT_SIZES[preset], custom: false };
  }
  if (
    typeof width !== 'number' ||
    !Number.isSafeInteger(width) ||
    width < 240 ||
    width > 4096 ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(height) ||
    height < 200 ||
    height > 4096
  ) {
    throw new StudioBridgeRpcError(
      'invalid_params',
      'Custom viewport width and height must be integers within 240–4096 and 200–4096.',
      { width, height },
    );
  }
  return { preset, size: { width, height }, custom: true };
}

function activeViewportSize(state: StudioStoreSnapshot): { width: number; height: number } {
  return state.customViewportSize ?? PRESET_VIEWPORT_SIZES[state.viewport];
}

function defaultIdFactory(): AutomationIdFactory {
  return ({ kind, hint }) => {
    const prefix = hint.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || kind;
    return `${prefix}_${nanoid(10)}`;
  };
}

function dependencies(
  overrides?: StudioBridgeDispatcherDependencies,
): Required<StudioBridgeDispatcherDependencies> {
  return {
    getState: overrides?.getState ?? useStudioStore.getState,
    createId: overrides?.createId ?? defaultIdFactory(),
  };
}

interface ResolvedPage {
  pageId: string;
  document: UiDocument;
}

function resolvePage(
  params: Readonly<Record<string, unknown>>,
  adapter: Required<StudioBridgeDispatcherDependencies>,
): ResolvedPage {
  const initial = adapter.getState();
  const pageId = optionalString(params, 'pageId') ?? initial.selectedPageId;
  if (!initial.pages.some((page) => page.id === pageId)) {
    throw new StudioBridgeRpcError('page_not_found', `Page ${pageId} does not exist.`, {
      pageId,
      availablePageIds: initial.pages.map((page) => page.id),
    });
  }
  if (initial.selectedPageId !== pageId) initial.selectPage(pageId);
  const selected = adapter.getState();
  if (selected.selectedPageId !== pageId || selected.document.id !== pageId) {
    throw new StudioBridgeRpcError('page_selection_failed', `Could not select page ${pageId}.`, {
      pageId,
    });
  }
  return { pageId, document: selected.document };
}

function projectFromState(state: StudioStoreSnapshot): SrijikaProject {
  const pageIds = state.pages.map((page) => page.id);
  return {
    formatVersion: 1,
    id: 'srijika_studio_project',
    name: 'Srijika Studio Project',
    entryPageId: pageIds[0] ?? state.selectedPageId,
    pages: pageIds,
    components: [],
    toolchain: {
      node: '22.13.0',
      packageManager: 'pnpm',
      packageManagerVersion: '11.18.0',
      vite: '8.2.0',
    },
  };
}

function documentMap(state: StudioStoreSnapshot): Record<string, UiDocument> {
  return Object.fromEntries(state.pages.map((page) => [page.id, page.document]));
}

function compactOperationResult(pageId: string, result: ApplyOperationsResult): unknown {
  if (!result.ok) return { ...result, pageId };
  const { document, ...summary } = result;
  return {
    ...summary,
    pageId,
    rootNodeId: document.rootNodeId,
    nodeCount: Object.keys(document.nodes).length,
  };
}

function executeAtomicOperations(
  params: Readonly<Record<string, unknown>>,
  adapter: Required<StudioBridgeDispatcherDependencies>,
): unknown {
  const { pageId, document } = resolvePage(params, adapter);
  const expectedRevision = integerParam(params, 'expectedRevision');
  const rawOperations = params['operations'];
  if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
    throw new StudioBridgeRpcError(
      'invalid_params',
      'operations must contain at least one operation.',
      { key: 'operations' },
    );
  }
  const invalidOperationIndex = rawOperations.findIndex(
    (operation) =>
      !isRecord(operation) ||
      typeof operation['kind'] !== 'string' ||
      !CAPABILITIES.operations.includes(
        operation['kind'] as (typeof CAPABILITIES.operations)[number],
      ),
  );
  if (invalidOperationIndex >= 0) {
    throw new StudioBridgeRpcError(
      'invalid_params',
      `operations[${invalidOperationIndex}] has an unsupported operation kind.`,
      { key: 'operations', operationIndex: invalidOperationIndex },
    );
  }

  let result: ApplyOperationsResult;
  try {
    result = applyOperations(
      document,
      expectedRevision,
      rawOperations as SrijikaOperation[],
      componentRegistry,
      adapter.createId,
    );
  } catch (error) {
    throw new StudioBridgeRpcError(
      'invalid_operation_batch',
      error instanceof Error ? error.message : 'The operation batch is invalid.',
    );
  }
  if (!result.ok) return compactOperationResult(pageId, result);

  const committed = adapter.getState().dispatch({
    kind: 'replaceDocument',
    document: result.document,
  });
  if (!committed) {
    throw new StudioBridgeRpcError(
      'commit_failed',
      'Srijika Studio rejected the validated operation batch before commit.',
      { pageId, expectedRevision, currentRevision: adapter.getState().document.revision },
    );
  }
  return compactOperationResult(pageId, result);
}

function historyResult(
  direction: 'undo' | 'redo',
  params: Readonly<Record<string, unknown>>,
  adapter: Required<StudioBridgeDispatcherDependencies>,
): unknown {
  const { pageId, document } = resolvePage(params, adapter);
  const expectedRevision = integerParam(params, 'expectedRevision');
  if (document.revision !== expectedRevision) {
    return {
      ok: false,
      pageId,
      currentRevision: document.revision,
      diagnostics: [
        {
          code: 'revision-conflict',
          severity: 'error',
          message: `Expected revision ${expectedRevision}; current revision is ${document.revision}`,
        },
      ],
    };
  }
  if (direction === 'undo') adapter.getState().undo();
  else adapter.getState().redo();
  const next = adapter.getState().document;
  return {
    ok: true,
    pageId,
    direction,
    changed: next !== document,
    previousRevision: document.revision,
    revision: next.revision,
  };
}

function renderPreview(
  params: Readonly<Record<string, unknown>>,
  adapter: Required<StudioBridgeDispatcherDependencies>,
): unknown {
  const { pageId, document } = resolvePage(params, adapter);
  const requestedViewport = viewportRequest(params);
  const selectedNodeId = optionalString(params, 'selectedNodeId');
  if (selectedNodeId && !document.nodes[selectedNodeId]) {
    throw new StudioBridgeRpcError(
      'node_not_found',
      `Node ${selectedNodeId} does not exist on page ${pageId}.`,
      { pageId, nodeId: selectedNodeId },
    );
  }

  const state = adapter.getState();
  state.setViewport(requestedViewport.preset);
  if (requestedViewport.custom) {
    adapter
      .getState()
      .setCustomViewportSize(requestedViewport.size.width, requestedViewport.size.height);
  }
  state.setPanel('canvas' satisfies StudioPanel);
  if (selectedNodeId) adapter.getState().selectNode(selectedNodeId);
  const rendered = adapter.getState();
  return {
    ok: true,
    pageId,
    revision: rendered.document.revision,
    rootNodeId: rendered.document.rootNodeId,
    selectedNodeId: rendered.selectedNodeId,
    viewport: rendered.viewport,
    viewportSize: activeViewportSize(rendered),
    customViewport: rendered.customViewportSize !== null,
    panel: rendered.panel,
    renderer: 'react-dom',
    captureSupported: true,
    capture: null,
    captureTool: SRIJIKA_RPC_METHODS.capturePreview,
    layoutInspectionTool: SRIJIKA_RPC_METHODS.getLayoutSnapshot,
    message:
      'The page is open at the requested viewport. Capture or inspect it with the dedicated tools.',
  };
}

async function getLayoutSnapshot(
  params: Readonly<Record<string, unknown>>,
  adapter: Required<StudioBridgeDispatcherDependencies>,
): Promise<unknown> {
  const { document } = resolvePage(params, adapter);
  const nodeIds = params['nodeIds'];
  if (
    nodeIds !== undefined &&
    (!Array.isArray(nodeIds) || nodeIds.some((id) => typeof id !== 'string'))
  ) {
    throw new StudioBridgeRpcError(
      'invalid_params',
      'nodeIds must be an array of node ID strings.',
    );
  }
  const viewport = activeViewportSize(adapter.getState());
  const surface = await waitForRenderedLayoutReady(document);
  const result = inspectRenderedLayout(
    document,
    viewport,
    {
      ...(nodeIds === undefined ? {} : { nodeIds: nodeIds as string[] }),
      includeComputedStyles: optionalBoolean(params, 'includeComputedStyles', true),
      maxInstances: integerParam(params, 'maxInstances', 1_000),
    },
    surface,
  );
  if (result['ok'] === false && result['code'] === 'render_surface_unavailable') {
    throw new StudioBridgeRpcError('render_surface_unavailable', String(result['message']), {
      pageId: document.id,
    });
  }
  return result;
}

async function capturePreview(
  params: Readonly<Record<string, unknown>>,
  adapter: Required<StudioBridgeDispatcherDependencies>,
): Promise<unknown> {
  const preview = renderPreview(params, adapter) as Record<string, unknown>;
  const pixelRatio = params['pixelRatio'] ?? 1;
  if (
    typeof pixelRatio !== 'number' ||
    !Number.isFinite(pixelRatio) ||
    pixelRatio < 1 ||
    pixelRatio > 2
  ) {
    throw new StudioBridgeRpcError('invalid_params', 'pixelRatio must be between 1 and 2.', {
      key: 'pixelRatio',
    });
  }
  try {
    const capture = await captureRenderedPreview(
      activeViewportSize(adapter.getState()),
      pixelRatio,
    );
    return { ...preview, clean: true, capture };
  } catch (error) {
    throw new StudioBridgeRpcError(
      'preview_capture_failed',
      errorMessage(error, 'Srijika Studio could not capture the preview.'),
    );
  }
}

/**
 * Pure RPC router over an injected Studio store adapter. The production bridge
 * injects Zustand; tests can provide an isolated adapter without Tauri.
 */
export function dispatchStudioBridgeRpc(
  method: string,
  rawParams: unknown = {},
  overrides?: StudioBridgeDispatcherDependencies,
): unknown {
  const params = paramsRecord(rawParams);
  const adapter = dependencies(overrides);
  const resolvedMethod = canonicalRpcMethod(method);

  switch (resolvedMethod) {
    case SRIJIKA_RPC_METHODS.getCapabilities: {
      const state = adapter.getState();
      return {
        ...CAPABILITIES,
        runtime: {
          transport: 'authenticated-loopback',
          selectedPageId: state.selectedPageId,
          selectedPageRevision: state.document.revision,
          previewCaptureSupported: true,
          layoutInspectionSupported: true,
          viewportSize: activeViewportSize(state),
        },
        deprecatedRpcAliases: [
          {
            prefix: LEGACY_RPC_PREFIX,
            replacementPrefix: CANONICAL_RPC_PREFIX,
            removalTarget: '2.0',
          },
        ],
      };
    }
    case SRIJIKA_RPC_METHODS.getProjectSummary: {
      const state = adapter.getState();
      const summary = buildProjectSummary(
        projectFromState(state),
        documentMap(state),
        state.selectedPageId,
      );
      return optionalBoolean(params, 'includePages', true) ? summary : { ...summary, pages: [] };
    }
    case SRIJIKA_RPC_METHODS.getPageOutline: {
      const { document } = resolvePage(params, adapter);
      const maxDepth = integerParam(params, 'maxDepth', 12);
      const maxNodes = integerParam(params, 'maxNodes', 300);
      if (maxNodes < 1) {
        throw new StudioBridgeRpcError('invalid_params', 'maxNodes must be at least 1.');
      }
      return buildPageOutline(document, { maxDepth, maxNodes });
    }
    case SRIJIKA_RPC_METHODS.getNode: {
      const { pageId, document } = resolvePage(params, adapter);
      const nodeId = optionalString(params, 'nodeId');
      if (!nodeId) {
        throw new StudioBridgeRpcError('invalid_params', 'nodeId is required.', {
          key: 'nodeId',
        });
      }
      const detail = buildNodeDetail(document, nodeId);
      if (!detail) {
        throw new StudioBridgeRpcError(
          'node_not_found',
          `Node ${nodeId} does not exist on page ${pageId}.`,
          { pageId, nodeId },
        );
      }
      return detail;
    }
    case SRIJIKA_RPC_METHODS.getComponentCatalog: {
      const query = optionalString(params, 'query')?.toLocaleLowerCase();
      const category = optionalString(params, 'category');
      const detail = optionalString(params, 'detail') ?? 'summary';
      if (detail !== 'summary' && detail !== 'manifest') {
        throw new StudioBridgeRpcError('invalid_params', 'detail must be summary or manifest.', {
          key: 'detail',
        });
      }
      const rawIds = params['ids'];
      if (
        rawIds !== undefined &&
        (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string'))
      ) {
        throw new StudioBridgeRpcError('invalid_params', 'ids must be an array of component IDs.');
      }
      const ids = rawIds ? new Set(rawIds as string[]) : null;
      const limit = integerParam(params, 'limit', 100);
      const all = buildComponentCatalog(componentRegistry);
      const matching = all.filter((entry) => {
        if (ids && !ids.has(entry.id)) return false;
        if (category && entry.category !== category) return false;
        if (!query) return true;
        return `${entry.id} ${entry.displayName} ${entry.description}`
          .toLocaleLowerCase()
          .includes(query);
      });
      return {
        detail,
        totalCount: matching.length,
        returnedCount: Math.min(limit, matching.length),
        truncated: matching.length > limit,
        components: matching.slice(0, limit).map((entry) => {
          if (detail === 'manifest') return entry;
          const summary: Record<string, unknown> = { ...entry };
          delete summary['propSpecs'];
          delete summary['eventSpecs'];
          delete summary['slotSpecs'];
          delete summary['editor'];
          delete summary['defaultNode'];
          return summary;
        }),
      };
    }
    case SRIJIKA_RPC_METHODS.analyzeRepetitions: {
      const { document } = resolvePage(params, adapter);
      const minInstances = integerParam(params, 'minInstances', 2);
      const maxCandidates = integerParam(params, 'maxCandidates', 50);
      if (minInstances < 2) {
        throw new StudioBridgeRpcError('invalid_params', 'minInstances must be at least 2.', {
          key: 'minInstances',
        });
      }
      if (maxCandidates < 1) {
        throw new StudioBridgeRpcError('invalid_params', 'maxCandidates must be at least 1.', {
          key: 'maxCandidates',
        });
      }
      const candidateId = optionalString(params, 'candidateId');
      return buildRepetitionAnalysis(document, {
        minInstances,
        maxCandidates,
        includeValues: optionalBoolean(params, 'includeValues', false),
        ...(candidateId === undefined ? {} : { candidateId }),
      });
    }
    case SRIJIKA_RPC_METHODS.getGeneratedCode: {
      const { document } = resolvePage(params, adapter);
      const detail = optionalString(params, 'detail') ?? 'summary';
      if (detail !== 'summary' && detail !== 'full') {
        throw new StudioBridgeRpcError('invalid_params', 'detail must be either summary or full.', {
          key: 'detail',
        });
      }
      return buildGeneratedCodeResult(document, generateTsx(document), detail);
    }
    case SRIJIKA_RPC_METHODS.applyOperations:
      return executeAtomicOperations(params, adapter);
    case SRIJIKA_RPC_METHODS.validateDocument: {
      const { pageId, document } = resolvePage(params, adapter);
      const diagnostics = validateAutomationDocument(document, componentRegistry);
      return {
        ok: !hasAutomationErrors(diagnostics),
        pageId,
        revision: document.revision,
        diagnostics,
      };
    }
    case SRIJIKA_RPC_METHODS.getDiagnostics: {
      const { pageId, document } = resolvePage(params, adapter);
      const nodeId = optionalString(params, 'nodeId');
      const severity = optionalString(params, 'severity');
      if (severity && severity !== 'error' && severity !== 'warning') {
        throw new StudioBridgeRpcError('invalid_params', 'severity must be error or warning.', {
          key: 'severity',
        });
      }
      const limit = integerParam(params, 'limit', 200);
      const matching = validateAutomationDocument(document, componentRegistry).filter(
        (diagnostic) =>
          (!nodeId || diagnostic.nodeId === nodeId) &&
          (!severity || diagnostic.severity === severity),
      );
      return {
        pageId,
        revision: document.revision,
        totalCount: matching.length,
        returnedCount: Math.min(limit, matching.length),
        truncated: matching.length > limit,
        diagnostics: matching.slice(0, limit),
      };
    }
    case SRIJIKA_RPC_METHODS.renderPreview:
      return renderPreview(params, adapter);
    case SRIJIKA_RPC_METHODS.getLayoutSnapshot:
      return getLayoutSnapshot(params, adapter);
    case SRIJIKA_RPC_METHODS.capturePreview:
      return capturePreview(params, adapter);
    case SRIJIKA_RPC_METHODS.undo:
      return historyResult('undo', params, adapter);
    case SRIJIKA_RPC_METHODS.redo:
      return historyResult('redo', params, adapter);
    case SRIJIKA_RPC_METHODS.importDesignPlan: {
      const source = isRecord(params['source']) ? params['source'] : null;
      const hasSourceWidth = source ? Object.hasOwn(source, 'width') : false;
      const hasSourceHeight = source ? Object.hasOwn(source, 'height') : false;
      const sourceViewport =
        hasSourceWidth || hasSourceHeight
          ? viewportRequest({
              viewport: 'desktop',
              width: source?.['width'],
              height: source?.['height'],
            })
          : null;
      const result = executeAtomicOperations(params, adapter);
      if (isRecord(result) && result['ok'] === true && sourceViewport) {
        adapter.getState().setViewport(sourceViewport.preset);
        adapter
          .getState()
          .setCustomViewportSize(sourceViewport.size.width, sourceViewport.size.height);
      }
      return {
        ...(isRecord(result) ? result : { result }),
        planId: optionalString(params, 'planId') ?? null,
        phase: optionalString(params, 'phase') ?? 'geometry',
        source,
        requiredRegions: Array.isArray(params['requiredRegions']) ? params['requiredRegions'] : [],
        acceptance: isRecord(params['acceptance']) ? params['acceptance'] : {},
        assumptions: Array.isArray(params['assumptions']) ? params['assumptions'] : [],
      };
    }
    case SRIJIKA_RPC_METHODS.importDesignImage: {
      const result = executeAtomicOperations(params, adapter);
      return {
        ...(isRecord(result) ? result : { result }),
        source: isRecord(params['source']) ? params['source'] : null,
        assumptions: Array.isArray(params['assumptions']) ? params['assumptions'] : [],
        deprecated: true,
        replacementMethod: SRIJIKA_RPC_METHODS.importDesignPlan,
      };
    }
    default:
      throw new StudioBridgeRpcError('unsupported_method', `Unsupported RPC method: ${method}`, {
        method,
        supportedMethods: Object.values(SRIJIKA_RPC_METHODS),
      });
  }
}

export type CodexBridgePhase = 'unavailable' | 'connecting' | 'ready' | 'connected' | 'error';

export interface CodexBridgeStatus {
  phase: CodexBridgePhase;
  message: string;
}

export interface CodexBridgeRuntime {
  isDesktop: () => boolean;
  listen: (eventName: string, listener: (payload: unknown) => void) => Promise<() => void>;
  invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
}

function defaultRuntime(): CodexBridgeRuntime {
  return {
    isDesktop: isTauriDesktop,
    listen: async (eventName, listener) => {
      const { listen } = await import('@tauri-apps/api/event');
      return listen<unknown>(eventName, (event) => listener(event.payload));
    },
    invoke: async (command, args) => {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke(command, args);
    },
  };
}

function bridgeError(error: unknown): { code: string; message: string; details?: unknown } {
  if (error instanceof StudioBridgeRpcError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: 'internal_error',
    message:
      error instanceof Error ? error.message : 'Srijika Studio could not process the request.',
  };
}

export class CodexBridgeLifecycle {
  readonly #runtime: CodexBridgeRuntime;
  readonly #dispatcher: (method: string, params: unknown) => Promise<unknown>;
  readonly #listeners = new Set<(status: CodexBridgeStatus) => void>();
  #status: CodexBridgeStatus = {
    phase: 'unavailable',
    message: 'Codex bridge requires the desktop app',
  };
  #unlisten: (() => void) | null = null;
  #startPromise: Promise<void> | null = null;
  #stopTimer: ReturnType<typeof setTimeout> | null = null;
  #generation = 0;
  #ready = false;

  constructor(
    runtime: CodexBridgeRuntime,
    dispatcher: (method: string, params: unknown) => Promise<unknown> = (method, params) =>
      Promise.resolve(dispatchStudioBridgeRpc(method, params)),
  ) {
    this.#runtime = runtime;
    this.#dispatcher = dispatcher;
  }

  subscribe(listener: (status: CodexBridgeStatus) => void): () => void {
    if (this.#stopTimer) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    this.#listeners.add(listener);
    listener(this.#status);
    if (this.#runtime.isDesktop()) void this.#start();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0 && !this.#stopTimer) {
        // React StrictMode immediately re-subscribes. A macrotask grace period
        // prevents a duplicate Tauri listener and ready false/true flicker.
        this.#stopTimer = setTimeout(() => {
          this.#stopTimer = null;
          if (this.#listeners.size === 0) void this.#stop();
        }, 0);
      }
    };
  }

  async stop(): Promise<void> {
    if (this.#stopTimer) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    await this.#stop();
  }

  #emit(status: CodexBridgeStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }

  #start(): Promise<void> {
    if (this.#unlisten || this.#startPromise) return this.#startPromise ?? Promise.resolve();
    const generation = ++this.#generation;
    this.#emit({ phase: 'connecting', message: 'Connecting Codex bridge' });
    const starting = this.#initialize(generation);
    this.#startPromise = starting;
    void starting.finally(() => {
      if (this.#startPromise === starting) this.#startPromise = null;
    });
    return starting;
  }

  async #initialize(generation: number): Promise<void> {
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await this.#runtime.listen(CODEX_BRIDGE_REQUEST_EVENT, (payload) => {
        void this.#handlePayload(payload);
      });
      if (this.#generation !== generation || this.#listeners.size === 0) {
        unlisten();
        return;
      }
      this.#unlisten = unlisten;
      await this.#runtime.invoke(CODEX_BRIDGE_READY_COMMAND, { ready: true });
      this.#ready = true;
      if (this.#generation !== generation || this.#listeners.size === 0) {
        this.#unlisten = null;
        unlisten();
        this.#ready = false;
        await this.#runtime.invoke(CODEX_BRIDGE_READY_COMMAND, { ready: false });
        return;
      }
      this.#emit({ phase: 'ready', message: 'Codex bridge ready' });
    } catch (error) {
      if (this.#unlisten === unlisten) this.#unlisten = null;
      unlisten?.();
      this.#ready = false;
      if (this.#generation === generation) {
        this.#emit({
          phase: 'error',
          message: error instanceof Error ? error.message : 'Codex bridge failed to start',
        });
      }
    }
  }

  async #stop(): Promise<void> {
    ++this.#generation;
    this.#startPromise = null;
    const unlisten = this.#unlisten;
    this.#unlisten = null;
    unlisten?.();
    const shouldNotify = this.#ready;
    this.#ready = false;
    if (shouldNotify && this.#runtime.isDesktop()) {
      try {
        await this.#runtime.invoke(CODEX_BRIDGE_READY_COMMAND, { ready: false });
      } catch {
        // The app may already be shutting down; there is no active consumer to notify.
      }
    }
    this.#emit({
      phase: 'unavailable',
      message: this.#runtime.isDesktop()
        ? 'Codex bridge stopped'
        : 'Codex bridge requires the desktop app',
    });
  }

  async #handlePayload(payload: unknown): Promise<void> {
    const value = isRecord(payload) ? payload : {};
    const requestId = typeof value['requestId'] === 'string' ? value['requestId'] : null;
    if (!requestId) {
      this.#emit({ phase: 'error', message: 'Codex bridge received an invalid request' });
      return;
    }

    try {
      if (value['protocolVersion'] !== PROTOCOL_VERSION) {
        throw new StudioBridgeRpcError(
          'unsupported_protocol_version',
          `Srijika Studio expects protocol ${PROTOCOL_VERSION}.`,
          { expected: PROTOCOL_VERSION, actual: value['protocolVersion'] },
        );
      }
      if (typeof value['method'] !== 'string' || !value['method']) {
        throw new StudioBridgeRpcError('invalid_request', 'RPC method must be a non-empty string.');
      }
      this.#emit({ phase: 'connected', message: 'Codex connected' });
      const result = await this.#dispatcher(value['method'], value['params'] ?? {});
      await this.#runtime.invoke(CODEX_BRIDGE_RESOLVE_COMMAND, {
        response: { requestId, result },
      });
    } catch (error) {
      try {
        await this.#runtime.invoke(CODEX_BRIDGE_RESOLVE_COMMAND, {
          response: { requestId, error: bridgeError(error) },
        });
      } catch (resolutionError) {
        this.#emit({
          phase: 'error',
          message:
            resolutionError instanceof Error
              ? resolutionError.message
              : 'Codex bridge could not return the response',
        });
      }
    }
  }
}

const codexBridgeLifecycle = new CodexBridgeLifecycle(defaultRuntime());

export function subscribeCodexBridgeStatus(
  listener: (status: CodexBridgeStatus) => void,
): () => void {
  return codexBridgeLifecycle.subscribe(listener);
}
