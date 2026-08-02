import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SUTRA_RPC_METHODS, SUTRA_TOOL_NAMES, TOOL_VERSION } from '@sutra/automation-protocol';

import { SutraBridgeClient, SutraBridgeError } from './bridge-client';
import { registerSutraDocumentation } from './documentation';
import { toolInputs } from './tool-schemas';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const MUTATING = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

type JsonObject = Record<string, unknown>;

export interface SutraMcpServerOptions {
  bridgeClient?: SutraBridgeCaller;
}

export interface SutraBridgeCaller {
  call<T>(method: string, params?: unknown): Promise<T>;
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|authorization|bearer|secret/i.test(key)) continue;
    result[key] = redactSensitive(nested);
  }
  return result;
}

function successResult(result: unknown) {
  const safeResult = redactSensitive(result);
  const structuredContent: JsonObject = { ok: true, result: safeResult };
  return {
    content: [
      {
        type: 'text' as const,
        text: 'Sutra Studio request completed. The result is in structuredContent.result.',
      },
    ],
    structuredContent,
  };
}

function errorResult(error: unknown) {
  const normalized =
    error instanceof SutraBridgeError
      ? {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: redactSensitive(error.details) }),
        }
      : {
          code: 'mcp_server_error',
          message: error instanceof Error ? error.message : 'Unexpected Sutra MCP server error.',
          retryable: false,
        };
  const structuredContent: JsonObject = { ok: false, error: normalized };
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Sutra Studio request failed [${normalized.code}]: ${normalized.message}`,
      },
    ],
    structuredContent,
  };
}

function imageCaptureResult(result: unknown) {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('capture' in result) ||
    typeof result.capture !== 'object' ||
    result.capture === null
  ) {
    return successResult(result);
  }

  const capture = result.capture as Record<string, unknown>;
  const data = capture['data'];
  const mimeType = capture['mimeType'];
  if (typeof data !== 'string' || typeof mimeType !== 'string') {
    return successResult(result);
  }

  const captureMetadata = { ...capture };
  delete captureMetadata['data'];
  const safeResult = redactSensitive({ ...result, capture: captureMetadata });
  const structuredContent: JsonObject = { ok: true, result: safeResult };
  return {
    content: [
      { type: 'image' as const, data, mimeType },
      {
        type: 'text' as const,
        text: 'Sutra Studio captured a clean preview. Metadata is in structuredContent.result.',
      },
    ],
    structuredContent,
  };
}

async function callBridge(bridge: SutraBridgeCaller, method: string, params: unknown) {
  try {
    return successResult(await bridge.call(method, params));
  } catch (error) {
    return errorResult(error);
  }
}

async function captureBridge(bridge: SutraBridgeCaller, params: unknown) {
  try {
    return imageCaptureResult(await bridge.call(SUTRA_RPC_METHODS.capturePreview, params));
  } catch (error) {
    return errorResult(error);
  }
}

export function createSutraMcpServer(options: SutraMcpServerOptions = {}): McpServer {
  const bridge = options.bridgeClient ?? new SutraBridgeClient();
  const server = new McpServer(
    { name: 'sutra-studio', version: TOOL_VERSION },
    {
      instructions:
        'Operate the running Sutra Studio document engine. Read the smallest useful model, include expectedRevision on every write, use createdBy references to build nested regions atomically, then validate, inspect rendered layout, and capture a clean preview.',
    },
  );
  registerSutraDocumentation(server);

  server.registerTool(
    SUTRA_TOOL_NAMES.getCapabilities,
    {
      title: 'Get Sutra capabilities',
      description:
        'Negotiate the running Studio protocol, tool/document versions, limits, supported operations, and deprecated aliases. Call this before other Sutra tools.',
      inputSchema: toolInputs.getCapabilities,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getCapabilities, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getProjectSummary,
    {
      title: 'Get Sutra project summary',
      description:
        'Read a compact project and page summary including active IDs, document revisions, node counts, and public prop counts.',
      inputSchema: toolInputs.getProjectSummary,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getProjectSummary, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getPageOutline,
    {
      title: 'Get Sutra page outline',
      description:
        'Read a bounded, compact hierarchy for one page with stable node IDs, parent slots, component IDs, depths, and child counts.',
      inputSchema: toolInputs.getPageOutline,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getPageOutline, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getNode,
    {
      title: 'Get Sutra node',
      description:
        'Read exact details for one node, including props, events, styles, parent location, children, and referenced symbols.',
      inputSchema: toolInputs.getNode,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getNode, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getComponentCatalog,
    {
      title: 'Get Sutra component catalog',
      description:
        'Discover registered components and their allowed props, events, slots, categories, and editor behavior before building UI.',
      inputSchema: toolInputs.getComponentCatalog,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getComponentCatalog, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.analyzeRepetitions,
    {
      title: 'Analyze repeated Sutra siblings',
      description:
        'Find conservative contiguous sibling patterns that can be converted into one typed Repeat template. This read is opt-in and never changes the document.',
      inputSchema: toolInputs.analyzeRepetitions,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.analyzeRepetitions, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getGeneratedCode,
    {
      title: 'Get generated Sutra TSX',
      description:
        'Inspect generated TSX from the canonical document. The default summary returns typed public-prop declarations and Repeat/If facts without the full source; request detail=full only when complete TSX is needed.',
      inputSchema: toolInputs.getGeneratedCode,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getGeneratedCode, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.applyOperations,
    {
      title: 'Apply atomic Sutra operations',
      description:
        'Apply one revision-checked atomic batch to the canonical page document. The entire batch validates and commits as one history entry or leaves the document unchanged.',
      inputSchema: toolInputs.applyOperations,
      annotations: DESTRUCTIVE,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.applyOperations, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.validateDocument,
    {
      title: 'Validate Sutra document',
      description:
        'Run canonical schema, graph, registry, and semantic validation without changing the document.',
      inputSchema: toolInputs.validateDocument,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.validateDocument, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getDiagnostics,
    {
      title: 'Get Sutra diagnostics',
      description:
        'Read bounded validation errors and warnings, optionally filtered by page, node, or severity.',
      inputSchema: toolInputs.getDiagnostics,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getDiagnostics, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.renderPreview,
    {
      title: 'Render Sutra preview',
      description:
        'Focus a page and viewport in Studio, synchronize the render, and return preview metadata for visual inspection.',
      inputSchema: toolInputs.renderPreview,
      annotations: MUTATING,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.renderPreview, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.getLayoutSnapshot,
    {
      title: 'Inspect rendered Sutra layout',
      description:
        'Read exact rendered bounding boxes, computed layout styles, instance indexes, clipping, and overflow diagnostics from the active design surface.',
      inputSchema: toolInputs.getLayoutSnapshot,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.getLayoutSnapshot, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.capturePreview,
    {
      title: 'Capture clean Sutra preview',
      description:
        'Render a page at an exact preset or custom viewport and return a clean PNG image without selection or structural editor chrome.',
      inputSchema: toolInputs.capturePreview,
      annotations: MUTATING,
    },
    (params) => captureBridge(bridge, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.undo,
    {
      title: 'Undo Sutra change',
      description: 'Undo one Studio history entry only when the visible document revision matches.',
      inputSchema: toolInputs.history,
      annotations: MUTATING,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.undo, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.redo,
    {
      title: 'Redo Sutra change',
      description: 'Redo one Studio history entry only when the visible document revision matches.',
      inputSchema: toolInputs.history,
      annotations: MUTATING,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.redo, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.importDesignPlan,
    {
      title: 'Import a structured design plan',
      description:
        'Apply the operation plan produced by Codex after visually analyzing a supplied design image. The image itself stays outside the local bridge.',
      inputSchema: toolInputs.importDesignPlan,
      annotations: DESTRUCTIVE,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.importDesignPlan, params),
  );

  server.registerTool(
    SUTRA_TOOL_NAMES.importDesignImage,
    {
      title: 'Import design image plan (deprecated)',
      description:
        'Deprecated compatibility alias. Send a Codex-produced structured operation plan; prefer sutra_import_design_plan.',
      inputSchema: toolInputs.importDesignImage,
      annotations: DESTRUCTIVE,
    },
    (params) => callBridge(bridge, SUTRA_RPC_METHODS.importDesignImage, params),
  );

  return server;
}
