import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import {
  SRIJIKA_RPC_METHODS,
  SRIJIKA_TOOL_NAMES,
  TOOL_VERSION,
} from '@srijika/automation-protocol';
import * as z from 'zod/v4';

import { SrijikaBridgeClient, SrijikaBridgeError } from './bridge-client';
import { SrijikaCodeProjectService } from './code-project';
import { registerSrijikaDocumentation } from './documentation';
import { SRIJIKA_REACT_MIGRATION_TOOL_NAMES } from './react-migration-contract';
import { SrijikaReactMigrationService, type SrijikaReactMigrationCaller } from './react-migration';
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

export interface SrijikaMcpServerOptions {
  bridgeClient?: SrijikaBridgeCaller;
  projectRoot?: string;
  reactMigrationService?: SrijikaReactMigrationCaller;
}

export interface SrijikaBridgeCaller {
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

function successResult(result: unknown, message = 'Srijika request completed.') {
  const safeResult = redactSensitive(result);
  const structuredContent: JsonObject = { ok: true, result: safeResult };
  return {
    content: [
      {
        type: 'text' as const,
        text: `${message} The result is in structuredContent.result.`,
      },
    ],
    structuredContent,
  };
}

function errorResult(error: unknown) {
  const normalized =
    error instanceof SrijikaBridgeError
      ? {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details === undefined ? {} : { details: redactSensitive(error.details) }),
        }
      : {
          code: 'mcp_server_error',
          message: error instanceof Error ? error.message : 'Unexpected Srijika MCP server error.',
          retryable: false,
        };
  const structuredContent: JsonObject = { ok: false, error: normalized };
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Srijika request failed [${normalized.code}]: ${normalized.message}`,
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
        text: 'Srijika Studio captured a clean preview. Metadata is in structuredContent.result.',
      },
    ],
    structuredContent,
  };
}

async function callBridge(bridge: SrijikaBridgeCaller, method: string, params: unknown) {
  try {
    return successResult(await bridge.call(method, params));
  } catch (error) {
    return errorResult(error);
  }
}

async function captureBridge(bridge: SrijikaBridgeCaller, params: unknown) {
  try {
    return imageCaptureResult(await bridge.call(SRIJIKA_RPC_METHODS.capturePreview, params));
  } catch (error) {
    return errorResult(error);
  }
}

async function callCodeProject(operation: () => Promise<unknown>, message: string) {
  try {
    return successResult(await operation(), message);
  } catch (error) {
    return errorResult(error);
  }
}

export function createSrijikaMcpServer(options: SrijikaMcpServerOptions = {}): McpServer {
  const bridge = options.bridgeClient ?? new SrijikaBridgeClient();
  const codeProject = new SrijikaCodeProjectService(
    options.projectRoot ? { projectRoot: options.projectRoot } : {},
  );
  const reactMigration = options.reactMigrationService ?? new SrijikaReactMigrationService();
  const plannedStructures = new Map<string, Parameters<typeof codeProject.scaffold>[0]>();
  const server = new McpServer(
    { name: 'srijika-studio', version: TOOL_VERSION },
    {
      instructions:
        'For a CLI-first TSX project, inspect and validate the code project before planning or applying canonical Feature, Slot, Part, strict Shared, and capability files; these tools work without Desktop Studio. For an existing React project, create a migration only to a distinct new target or a recognizable clean generated Srijika starter; source is immutable. Scan and review the complete source inventory and plan, let Codex perform semantic analysis one coherent slice at a time, apply only reviewed target writes with traceability, verify each slice, and finalize only with unchanged-source, complete-traceability, architecture, build, typecheck, and test evidence. Unsupported behavior blocks migration. Never claim arbitrary automatic rewriting or guaranteed zero context loss. Shared kinds are exactly shared-ui, shared-widget, and shared-capability. Only a matching Connector renders owner UI (except pure Shared UI Primitive composition); UI never owns Hooks, browser APIs, or external runtime behavior. Types remain passive import type/export type contracts. Logic remains framework-free and deterministic: React/query/router/state lifecycle belongs in Hook, Connector, or Store, while request transport belongs in API. Honor validated bounded custom roots/directories/suffixes. An absent architecture block uses defaults; an explicit block requires exact feature-slot-part-v1 and otherwise fails closed. Treat generated validation, configured-root watch, and exact-file/safe-move previews as resolved canonical-planner behavior, never hardcoded paths. Never bypass direct-child-UI, passive-Types, Logic-runtime-concern, path-containment, canonical-name, freehand-Shared, Shared-cycle, PROMOTE, or SPLIT diagnostics. Use bridge tools only for a running Studio document, include expectedRevision on every document write, and validate before preview.',
    },
  );
  registerSrijikaDocumentation(server);

  const structureInput = {
    kind: z.enum([
      'feature',
      'slot',
      'part',
      'shared-ui',
      'shared-widget',
      'shared-capability',
      'connector',
      'hook',
      'behavior-hook',
      'store',
      'store-slice',
      'logic',
      'api',
      'types',
    ]),
    name: z
      .string()
      .regex(/^[A-Z][A-Za-z0-9]{0,63}$/)
      .optional(),
    ownerFolder: z.string().min(1).max(1_024).optional(),
    optionalCapabilities: z
      .array(z.enum(['hook', 'store', 'logic', 'api', 'types']))
      .max(5)
      .default([]),
  };

  const migrationRootInput = {
    source: z.string().min(1).max(4_096),
    target: z.string().min(1).max(4_096).optional(),
  };
  const migrationTargetInput = {
    target: z.string().min(1).max(4_096),
  };
  const responsiveVisualDetails = z
    .string()
    .min(1)
    .max(8_192)
    .refine((details) => {
      const normalized = details.toLowerCase();
      const named = ['mobile', 'tablet', 'desktop', 'wide'].filter((viewport) =>
        normalized.includes(viewport),
      );
      const measured = normalized.match(/\b\d{2,5}\s*[x×]\s*\d{2,5}\b/gu) ?? [];
      return named.length >= 2 || measured.length >= 2;
    }, 'Visual evidence must name at least two viewports (mobile, tablet, desktop, or wide) or two WxH measurements.');
  const migrationCommandEvidence = z.union([
    z.object({
      name: z.literal('install'),
      status: z.enum(['passed', 'failed', 'skipped']),
      details: z.string().max(8_192).optional(),
    }),
    z.object({
      name: z.enum(['typecheck', 'build', 'test']),
      status: z.enum(['passed', 'failed']),
      details: z.string().max(8_192).optional(),
    }),
    z.object({
      name: z.literal('routes'),
      status: z.literal('passed'),
      details: z.string().min(1).max(8_192),
    }),
    z.object({
      name: z.literal('routes'),
      status: z.literal('failed'),
      details: z.string().max(8_192).optional(),
    }),
    z.object({
      name: z.literal('visual'),
      status: z.literal('passed'),
      details: responsiveVisualDetails,
    }),
    z.object({
      name: z.literal('visual'),
      status: z.literal('failed'),
      details: z.string().max(8_192).optional(),
    }),
  ]);
  const migrationCommandEvidenceList = z
    .array(migrationCommandEvidence)
    .max(6)
    .superRefine((commands, context) => {
      const seen = new Set<string>();
      for (const [index, command] of commands.entries()) {
        if (seen.has(command.name)) {
          context.addIssue({
            code: 'custom',
            message: `Duplicate migration evidence: ${command.name}`,
            path: [index, 'name'],
          });
        }
        seen.add(command.name);
      }
    });
  const migrationVerifyInput = {
    ...migrationTargetInput,
    commands: migrationCommandEvidenceList.optional(),
  };
  const migrationSliceEvidence = z
    .array(
      z.object({
        name: z.enum(['typecheck', 'build']),
        status: z.literal('passed'),
        details: z.string().max(8_192).optional(),
      }),
    )
    .length(2)
    .superRefine((commands, context) => {
      const names = new Set(commands.map((command) => command.name));
      for (const name of ['typecheck', 'build'] as const) {
        if (!names.has(name)) {
          context.addIssue({ code: 'custom', message: `Missing passed ${name} evidence.` });
        }
      }
    });
  const migrationSliceInput = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    title: z.string().min(1).max(320),
    writes: z
      .array(
        z.object({
          relativePath: z.string().min(1).max(1_024),
          content: z.string().max(4 * 1_024 * 1_024),
          expectedSha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/i)
            .optional(),
        }),
      )
      .max(512),
    mappings: z
      .array(
        z.object({
          sourcePath: z.string().min(1).max(1_024),
          targetPaths: z.array(z.string().min(1).max(1_024)).min(1).max(64),
          kind: z.enum(['migrated', 'compatibility', 'asset', 'style']),
          notes: z.string().max(8_192).optional(),
        }),
      )
      .max(2_048),
    ignoredSources: z
      .array(
        z.object({
          sourcePath: z.string().min(1).max(1_024),
          reason: z.string().min(1).max(8_192),
        }),
      )
      .max(2_048)
      .optional(),
  });

  server.registerTool(
    'srijika_get_code_project',
    {
      title: 'Inspect Srijika code project',
      description:
        'Read bounded metadata, architecture, scripts, and canonical files without Studio.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => callCodeProject(() => codeProject.inspect(), 'Srijika code project inspected.'),
  );

  server.registerTool(
    'srijika_check_code_project',
    {
      title: 'Check Srijika code project',
      description:
        'Run the canonical project gate without Studio: zero Srijika UI diagnostics plus strict architecture validation.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => callCodeProject(() => codeProject.check(), 'Srijika code project checked.'),
  );

  server.registerTool(
    'srijika_plan_code_structure',
    {
      title: 'Plan Srijika code structure',
      description:
        'Plan exact canonical Feature, Slot, Part, or strict Shared files and safe rewires without writing.',
      inputSchema: structureInput,
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const result = await codeProject.scaffold(input, true);
        const planId = randomUUID();
        if (plannedStructures.size >= 32)
          plannedStructures.delete(plannedStructures.keys().next().value!);
        plannedStructures.set(planId, input);
        return successResult({ ...result, planId }, 'Srijika structure plan completed.');
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'srijika_apply_code_structure',
    {
      title: 'Apply Srijika code structure',
      description: 'Apply a reviewed one-time structure plan without overwrite.',
      inputSchema: { planId: z.string().uuid() },
      annotations: MUTATING,
    },
    ({ planId }) => {
      const input = plannedStructures.get(planId);
      if (!input)
        return errorResult(
          new Error('The structure plan is missing, expired, or already applied.'),
        );
      plannedStructures.delete(planId);
      return callCodeProject(
        () => codeProject.scaffold(input, false),
        'Srijika structure files created.',
      );
    },
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.create,
    {
      title: 'Create React to Srijika migration',
      description:
        'Preflight canonical non-overlapping roots, capture an immutable-source baseline, scaffold only a distinct new target or accept a recognizable clean generated Srijika starter, and persist a resumable session. The source is never written.',
      inputSchema: {
        source: z.string().min(1).max(4_096),
        target: z.string().min(1).max(4_096),
        projectName: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,213}$/)
          .optional(),
        displayName: z.string().min(1).max(160).optional(),
        dryRun: z.boolean().optional(),
      },
      annotations: MUTATING,
    },
    ({ source, target, projectName, displayName, dryRun }) =>
      callCodeProject(
        () =>
          reactMigration.start({
            source,
            target,
            ...(projectName === undefined ? {} : { projectName }),
            ...(displayName === undefined ? {} : { displayName }),
            ...(dryRun === undefined ? {} : { dryRun }),
          }),
        'React migration session created without modifying the source.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.scanSource,
    {
      title: 'Scan React migration source',
      description:
        'Read a bounded React source inventory for Codex semantic analysis. This never writes source or target and fails closed on unsafe or unsupported entries.',
      inputSchema: migrationRootInput,
      annotations: READ_ONLY,
    },
    ({ source, target }) =>
      callCodeProject(
        () => reactMigration.scan({ source, ...(target === undefined ? {} : { target }) }),
        'React migration source inventory completed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getPlan,
    {
      title: 'Get React migration plan',
      description:
        'Read a deterministic target ownership plan, migration slices, mappings, blockers, and verification gates. Codex must review semantic behavior before any slice is applied.',
      inputSchema: migrationRootInput,
      annotations: READ_ONLY,
    },
    ({ source, target }) =>
      callCodeProject(
        () => reactMigration.plan({ source, ...(target === undefined ? {} : { target }) }),
        'React migration plan completed without writing.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getStatus,
    {
      title: 'Get React migration status',
      description:
        'Read the persisted target session, reviewed slice progress, blockers, traceability, and current verification evidence for safe resume.',
      inputSchema: migrationTargetInput,
      annotations: READ_ONLY,
    },
    ({ target }) =>
      callCodeProject(() => reactMigration.status(target), 'React migration status loaded.'),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.applySlice,
    {
      title: 'Apply reviewed React migration slice',
      description:
        'Atomically apply one Codex-reviewed semantic slice inside the target only. UI writes must have zero Srijika diagnostics before any target file is committed.',
      inputSchema: {
        ...migrationTargetInput,
        slice: migrationSliceInput,
      },
      annotations: MUTATING,
    },
    ({ target, slice }) =>
      callCodeProject(
        () =>
          reactMigration.applySlice({
            target,
            slice: {
              id: slice.id,
              title: slice.title,
              writes: slice.writes.map(({ relativePath, content, expectedSha256 }) => ({
                relativePath,
                content,
                ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
              })),
              mappings: slice.mappings.map(({ sourcePath, targetPaths, kind, notes }) => ({
                sourcePath,
                targetPaths,
                kind,
                ...(notes === undefined ? {} : { notes }),
              })),
              ...(slice.ignoredSources === undefined
                ? {}
                : { ignoredSources: slice.ignoredSources }),
            },
          }),
        'Reviewed React migration slice applied atomically to the target.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verifySlice,
    {
      title: 'Verify React migration slice',
      description:
        'Advance only after this fixed gate: zero Srijika diagnostics; architecture passed; TypeScript passed; production build passed.',
      inputSchema: {
        ...migrationTargetInput,
        sliceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        commands: migrationSliceEvidence,
      },
      annotations: MUTATING,
    },
    ({ target, sliceId, commands }) =>
      callCodeProject(
        () =>
          reactMigration.verifySlice({
            target,
            sliceId,
            commands: commands.map(({ name, status, details }) => ({
              name,
              status,
              ...(details === undefined ? {} : { details }),
            })),
          }),
        'React migration slice verification completed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verify,
    {
      title: 'Verify React migration',
      description:
        'Run fail-closed session verification. Source must remain unchanged; traceability and architecture must pass; typecheck, build, and test evidence must be passed; routes must be passed with reviewed nonblank details when route files or semantic routes are present; visual must be passed with reviewed details naming at least two viewports or two WxH measurements when entry, component, style, or asset sources are present. Duplicate or oversized evidence is rejected.',
      inputSchema: migrationVerifyInput,
      annotations: MUTATING,
    },
    ({ target, commands }) =>
      callCodeProject(
        () =>
          reactMigration.verify({
            target,
            ...(commands === undefined
              ? {}
              : {
                  commands: commands.map(({ name, status, details }) => ({
                    name,
                    status,
                    ...(details === undefined ? {} : { details }),
                  })),
                }),
          }),
        'React migration verification completed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.finalize,
    {
      title: 'Finalize React migration',
      description:
        'Finalize only when unchanged-source and complete-traceability checks pass, strict architecture passes, typecheck/build/test evidence is passed, routes evidence has reviewed nonblank details when required, and visual evidence names at least two reviewed viewports or two WxH measurements when required. Duplicate or oversized evidence is rejected. Unsupported or ambiguous behavior remains blocking; no zero-loss guarantee is implied.',
      inputSchema: migrationVerifyInput,
      annotations: MUTATING,
    },
    ({ target, commands }) =>
      callCodeProject(
        () =>
          reactMigration.finalize({
            target,
            ...(commands === undefined
              ? {}
              : {
                  commands: commands.map(({ name, status, details }) => ({
                    name,
                    status,
                    ...(details === undefined ? {} : { details }),
                  })),
                }),
          }),
        'React migration finalized with required evidence.',
      ),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getCapabilities,
    {
      title: 'Get Srijika capabilities',
      description:
        'Negotiate the running Studio protocol, tool/document versions, limits, supported operations, and deprecated aliases. Call this before other Srijika tools.',
      inputSchema: toolInputs.getCapabilities,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getCapabilities, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getProjectSummary,
    {
      title: 'Get Srijika project summary',
      description:
        'Read a compact project and page summary including active IDs, document revisions, node counts, and public prop counts.',
      inputSchema: toolInputs.getProjectSummary,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getProjectSummary, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getPageOutline,
    {
      title: 'Get Srijika page outline',
      description:
        'Read a bounded, compact hierarchy for one page with stable node IDs, parent slots, component IDs, depths, and child counts.',
      inputSchema: toolInputs.getPageOutline,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getPageOutline, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getNode,
    {
      title: 'Get Srijika node',
      description:
        'Read exact details for one node, including props, events, styles, parent location, children, and referenced symbols.',
      inputSchema: toolInputs.getNode,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getNode, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getComponentCatalog,
    {
      title: 'Get Srijika component catalog',
      description:
        'Discover registered components and their allowed props, events, slots, categories, and editor behavior before building UI.',
      inputSchema: toolInputs.getComponentCatalog,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getComponentCatalog, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.analyzeRepetitions,
    {
      title: 'Analyze repeated Srijika siblings',
      description:
        'Find conservative contiguous sibling patterns that can be converted into one typed Repeat template. This read is opt-in and never changes the document.',
      inputSchema: toolInputs.analyzeRepetitions,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.analyzeRepetitions, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getGeneratedCode,
    {
      title: 'Get generated Srijika TSX',
      description:
        'Inspect generated TSX from the canonical document. The default summary returns typed public-prop declarations and Repeat/If facts without the full source; request detail=full only when complete TSX is needed.',
      inputSchema: toolInputs.getGeneratedCode,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getGeneratedCode, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.applyOperations,
    {
      title: 'Apply atomic Srijika operations',
      description:
        'Apply one revision-checked atomic batch to the canonical page document. The entire batch validates and commits as one history entry or leaves the document unchanged.',
      inputSchema: toolInputs.applyOperations,
      annotations: DESTRUCTIVE,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.applyOperations, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.validateDocument,
    {
      title: 'Validate Srijika document',
      description:
        'Run canonical schema, graph, registry, and semantic validation without changing the document.',
      inputSchema: toolInputs.validateDocument,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.validateDocument, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getDiagnostics,
    {
      title: 'Get Srijika diagnostics',
      description:
        'Read bounded validation errors and warnings, optionally filtered by page, node, or severity.',
      inputSchema: toolInputs.getDiagnostics,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getDiagnostics, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.renderPreview,
    {
      title: 'Render Srijika preview',
      description:
        'Focus a page and viewport in Studio, synchronize the render, and return preview metadata for visual inspection.',
      inputSchema: toolInputs.renderPreview,
      annotations: MUTATING,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.renderPreview, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.getLayoutSnapshot,
    {
      title: 'Inspect rendered Srijika layout',
      description:
        'Read exact rendered bounding boxes, computed layout styles, instance indexes, clipping, and overflow diagnostics from the active design surface.',
      inputSchema: toolInputs.getLayoutSnapshot,
      annotations: READ_ONLY,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.getLayoutSnapshot, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.capturePreview,
    {
      title: 'Capture clean Srijika preview',
      description:
        'Render a page at an exact preset or custom viewport and return a clean PNG image without selection or structural editor chrome.',
      inputSchema: toolInputs.capturePreview,
      annotations: MUTATING,
    },
    (params) => captureBridge(bridge, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.undo,
    {
      title: 'Undo Srijika change',
      description: 'Undo one Studio history entry only when the visible document revision matches.',
      inputSchema: toolInputs.history,
      annotations: MUTATING,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.undo, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.redo,
    {
      title: 'Redo Srijika change',
      description: 'Redo one Studio history entry only when the visible document revision matches.',
      inputSchema: toolInputs.history,
      annotations: MUTATING,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.redo, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.importDesignPlan,
    {
      title: 'Import a structured design plan',
      description:
        'Apply the operation plan produced by Codex after visually analyzing a supplied design image. The image itself stays outside the local bridge.',
      inputSchema: toolInputs.importDesignPlan,
      annotations: DESTRUCTIVE,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.importDesignPlan, params),
  );

  server.registerTool(
    SRIJIKA_TOOL_NAMES.importDesignImage,
    {
      title: 'Import design image plan (deprecated)',
      description:
        'Deprecated compatibility alias. Send a Codex-produced structured operation plan; prefer srijika_import_design_plan.',
      inputSchema: toolInputs.importDesignImage,
      annotations: DESTRUCTIVE,
    },
    (params) => callBridge(bridge, SRIJIKA_RPC_METHODS.importDesignImage, params),
  );

  return server;
}
