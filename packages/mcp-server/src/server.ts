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

async function callReactMigrationReview(operation: () => Promise<unknown>) {
  try {
    const result = await operation();
    if (
      typeof result !== 'object' ||
      result === null ||
      !('token' in result) ||
      typeof result.token !== 'string'
    ) {
      return successResult(result, 'Native React migration slice reviewed.');
    }
    const { token, ...metadata } = result;
    const safeMetadata = redactSensitive(metadata) as Record<string, unknown>;
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Native React migration slice reviewed. Pass structuredContent.result.reviewToken unchanged to the apply tool.',
        },
      ],
      structuredContent: {
        ok: true,
        result: { ...safeMetadata, reviewToken: token },
      },
    };
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
        'For CLI-first TSX projects, inspect and validate the code project before planning or applying canonical Feature, Slot, Part, strict Shared, and capability files; no Studio required. For an existing React project, create a migration only to a distinct new target or a recognizable clean generated Srijika starter; source is immutable. Follow the paged deterministic ownership plan, implement one semantic slice, review its native owner/role mappings, apply only the bound review token, then verify. The engine executes target gates and snapshot-signs receipts; never submit a caller-authored command status or receipt. For route and visual parity the engine prepares an isolated temporary source copy plus the target runtime, chooses distinct loopback ports, derives routes, captures fixed-viewport DOM and PNG evidence, applies fixed thresholds, and persists a snapshot-bound manifest. Never accept caller URLs, routes, viewports, screenshots, evidence paths, details, or pass claims. Compatibility and adapter findings are planning hints only and cannot be reviewed or applied; runtime ignores, bookkeeping targets, copied legacy code, wrappers, fallbacks, open target graphs, and unowned target modules block completion. Never claim arbitrary rewrites or zero context loss. Shared kinds are exactly shared-ui, shared-widget, and shared-capability. Only a matching Connector renders owner UI (except pure Shared UI Primitive composition); UI never owns Hooks, browser APIs, or external runtime behavior. Types remain passive import type/export type contracts. Logic remains framework-free and deterministic: React/query/router/state lifecycle belongs in Hook, Connector, or Store, while request transport belongs in API. Honor validated bounded custom roots/directories/suffixes. An absent architecture block uses defaults; an explicit block requires exact feature-slot-part-v1 and otherwise fails closed. Treat generated validation, configured-root watch, and exact-file/safe-move previews as resolved canonical-planner behavior, never hardcoded paths. Never bypass direct-child-UI, passive-Types, Logic-runtime-concern, path-containment, canonical-name, freehand-Shared, Shared-cycle, PROMOTE, or SPLIT diagnostics. Use bridge tools only for a running Studio document, include expectedRevision on every document write, and validate before preview.',
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
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  };
  const migrationPlanInput = {
    ...migrationRootInput,
    sliceId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
      .optional(),
  };
  const migrationTargetInput = {
    target: z.string().min(1).max(4_096),
  };
  const migrationStatusInput = {
    ...migrationTargetInput,
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  };
  const migrationVerifyInput = {
    ...migrationTargetInput,
    includeInstall: z.boolean().optional(),
    commands: z.never().optional(),
    receipts: z.never().optional(),
    status: z.never().optional(),
    details: z.never().optional(),
    routes: z.never().optional(),
    visual: z.never().optional(),
    coveredSourcePaths: z.never().optional(),
    sourceArtifacts: z.never().optional(),
    targetArtifacts: z.never().optional(),
    browserParity: z.never().optional(),
    sourceBaseUrl: z.never().optional(),
    targetBaseUrl: z.never().optional(),
    viewports: z.never().optional(),
  };
  const migrationMappingInput = z
    .object({
      sourcePath: z.string().min(1).max(1_024),
      targetPaths: z.array(z.string().min(1).max(1_024)).min(1).max(64),
      kind: z.enum(['migrated', 'asset', 'style']),
      mode: z.literal('native'),
      ownerId: z.string().min(1).max(1_024),
      role: z.enum([
        'shell',
        'route',
        'ui',
        'hook',
        'store',
        'api',
        'logic',
        'types',
        'style',
        'asset',
        'test',
        'configuration',
      ]),
      rationale: z.string().min(8).max(8_192),
      legacyAdapter: z.never().optional(),
      mergeGroupId: z.string().min(1).max(160).optional(),
      traceRanges: z
        .array(
          z.object({
            sourceStartLine: z.number().int().min(1).max(10_000_000),
            sourceEndLine: z.number().int().min(1).max(10_000_000),
            targetStartLine: z.number().int().min(1).max(10_000_000),
            targetEndLine: z.number().int().min(1).max(10_000_000),
          }),
        )
        .max(2_048)
        .optional(),
      notes: z.string().max(8_192).optional(),
    })
    .strict();
  const migrationSliceInput = z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
      title: z.string().min(1).max(320),
      writes: z
        .array(
          z.object({
            relativePath: z.string().min(1).max(1_024),
            content: z.string().max(4 * 1_024 * 1_024),
            encoding: z.enum(['utf8', 'base64']).optional(),
            expectedSha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/i)
              .optional(),
          }),
        )
        .max(512),
      sourceArtifactCopies: z
        .array(
          z
            .object({
              sourcePath: z.string().min(1).max(1_024),
              relativePath: z.string().min(1).max(1_024),
              expectedSourceSha256: z.string().regex(/^[a-f0-9]{64}$/i),
              expectedSha256: z
                .string()
                .regex(/^[a-f0-9]{64}$/i)
                .optional(),
            })
            .strict(),
        )
        .max(512)
        .optional(),
      sourcePackageDependencies: z
        .array(
          z
            .object({
              name: z.string().min(1).max(214),
              version: z.string().min(1).max(512),
              scope: z.enum([
                'dependency',
                'devDependency',
                'peerDependency',
                'optionalDependency',
              ]),
            })
            .strict(),
        )
        .max(128)
        .optional(),
      sourcePackageScripts: z
        .array(
          z
            .object({
              name: z.string().regex(/^[a-z][a-z0-9:_-]{0,79}$/),
              command: z.string().min(1).max(4_096),
            })
            .strict(),
        )
        .max(64)
        .optional(),
      deletes: z
        .array(
          z.object({
            relativePath: z.string().min(1).max(1_024),
            expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .max(512)
        .optional(),
      mappings: z.array(migrationMappingInput).max(2_048),
      ignoredSources: z
        .array(
          z.object({
            sourcePath: z.string().min(1).max(1_024),
            reason: z.string().min(3).max(8_192),
          }),
        )
        .max(2_048)
        .optional(),
    })
    .superRefine((slice, context) => {
      if (
        slice.writes.length +
          (slice.sourceArtifactCopies?.length ?? 0) +
          (slice.deletes?.length ?? 0) >
        512
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A migration slice may write and delete at most 512 target paths.',
        });
      }
    });

  server.registerTool(
    'srijika_get_code_project',
    {
      title: 'Inspect Srijika code project',
      description: 'Inspect bounded code-project metadata and files.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => callCodeProject(() => codeProject.inspect(), 'Srijika code project inspected.'),
  );

  server.registerTool(
    'srijika_check_code_project',
    {
      title: 'Check Srijika code project',
      description: 'Run strict UI and architecture checks.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    () => callCodeProject(() => codeProject.check(), 'Srijika code project checked.'),
  );

  server.registerTool(
    'srijika_plan_code_structure',
    {
      title: 'Plan Srijika code structure',
      description: 'Plan canonical owner files without writing.',
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
    'srijika_owner_tests',
    {
      description: 'Owner tests.',
      inputSchema: {
        action: z.enum(['sync', 'verify', 'evidence']),
        dryRun: z.boolean().optional(),
        port: z.number().int().min(1_024).max(65_535).optional(),
        framework: z.enum(['vite', 'next-app-router']).optional(),
        skipInstall: z.boolean().optional(),
      },
      annotations: MUTATING,
    },
    ({ action, dryRun, port, framework, skipInstall }) =>
      action === 'sync'
        ? callCodeProject(
            () => codeProject.synchronizeTests({ dryRun, port, framework }),
            'Srijika owner tests synchronized.',
          )
        : action === 'verify'
          ? callCodeProject(
              () => codeProject.verifyTests({ framework, port, skipInstall }),
              'Srijika owner tests verified.',
            )
          : callCodeProject(
              () => codeProject.testEvidence({ framework }),
              'Srijika owner evidence collected.',
            ),
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
        'Read a bounded immutable React inventory. It writes neither tree and rejects unsafe or unsupported entries.',
      inputSchema: migrationRootInput,
      annotations: READ_ONLY,
    },
    ({ source, target, cursor, limit }) =>
      callCodeProject(
        () =>
          reactMigration.scan({
            source,
            ...(target === undefined ? {} : { target }),
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
          }),
        'React migration source inventory completed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getPlan,
    {
      title: 'Get React migration ownership plan',
      description:
        'Read deterministic graph, owner/role decisions, native obligations, slices, adapter hints, and blockers. Codex implements this plan.',
      inputSchema: migrationPlanInput,
      annotations: READ_ONLY,
    },
    ({ source, target, cursor, limit, sliceId }) =>
      callCodeProject(
        () =>
          reactMigration.plan({
            source,
            ...(target === undefined ? {} : { target }),
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
            ...(sliceId === undefined ? {} : { sliceId }),
          }),
        'React migration plan completed without writing.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getStatus,
    {
      title: 'Get React migration status',
      description:
        'Read persisted progress, pending review handles, blockers, traceability, and verification for safe resume.',
      inputSchema: migrationStatusInput,
      annotations: READ_ONLY,
    },
    ({ target, cursor, limit }) =>
      callCodeProject(
        () =>
          reactMigration.status({
            target,
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
          }),
        'React migration status loaded.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.reviewOwnership,
    {
      title: 'Review React migration ownership',
      description:
        'Before work starts, atomically correct bounded ownership using exact plan/source/target snapshots. Canonical names, paths, roles, and SCC slices are engine-validated; freehand targets fail.',
      inputSchema: {
        ...migrationTargetInput,
        expectedPlanId: z.string().regex(/^[a-f0-9]{24}$/),
        expectedSourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
        expectedTargetSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
        overrides: z
          .array(
            z.object({
              sourcePath: z.string().min(1).max(1_024),
              ownerKind: z.enum([
                'application',
                'feature',
                'slot',
                'part',
                'shared-ui',
                'shared-widget',
                'shared-capability',
                'project',
              ]),
              ownerName: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
              ownerPath: z.string().min(1).max(1_024),
              role: z.enum([
                'shell',
                'route',
                'ui',
                'hook',
                'store',
                'api',
                'logic',
                'types',
                'style',
                'asset',
                'test',
                'configuration',
              ]),
              rationale: z.string().min(16).max(1_000),
            }),
          )
          .min(1)
          .max(256),
      },
      annotations: MUTATING,
    },
    ({
      target,
      expectedPlanId,
      expectedSourceSnapshotSha256,
      expectedTargetSnapshotSha256,
      overrides,
    }) =>
      callCodeProject(
        () =>
          reactMigration.reviewOwnership({
            target,
            expectedPlanId,
            expectedSourceSnapshotSha256,
            expectedTargetSnapshotSha256,
            overrides,
          }),
        'React migration ownership reviewed and the canonical plan recomputed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getSliceContext,
    {
      title: 'Get React migration slice context',
      description:
        'Read hash-checked content/imports/exports/ownership for one slice, bound to exact plan/source/target snapshots. Reuse its opaque cursor only with the same query.',
      inputSchema: {
        ...migrationTargetInput,
        sliceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        expectedPlanId: z.string().regex(/^[a-f0-9]{24}$/),
        expectedSourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
        expectedTargetSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
        cursor: z.string().min(1).max(2_048).optional(),
        limit: z.number().int().min(1).max(32).optional(),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(2 * 1_024 * 1_024)
          .optional(),
      },
      annotations: READ_ONLY,
    },
    ({
      target,
      sliceId,
      expectedPlanId,
      expectedSourceSnapshotSha256,
      expectedTargetSnapshotSha256,
      cursor,
      limit,
      maxBytes,
    }) =>
      callCodeProject(
        () =>
          reactMigration.getSliceContext({
            target,
            sliceId,
            expectedPlanId,
            expectedSourceSnapshotSha256,
            expectedTargetSnapshotSha256,
            ...(cursor === undefined ? {} : { cursor }),
            ...(limit === undefined ? {} : { limit }),
            ...(maxBytes === undefined ? {} : { maxBytes }),
          }),
        'Immutable React migration slice context loaded.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.reviewSlice,
    {
      title: 'Review native React migration slice',
      description:
        'Persist one exact native slice and return a bound token. Compatibility, runtime ignores, bookkeeping targets, wrappers, unsafe writes, and stale state fail.',
      inputSchema: {
        ...migrationTargetInput,
        slice: migrationSliceInput,
      },
      annotations: MUTATING,
    },
    ({ target, slice }) =>
      callReactMigrationReview(() =>
        reactMigration.reviewSlice({
          target,
          slice: {
            id: slice.id,
            title: slice.title,
            writes: slice.writes.map(({ relativePath, content, encoding, expectedSha256 }) => ({
              relativePath,
              content,
              ...(encoding === undefined ? {} : { encoding }),
              ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
            })),
            ...(slice.sourceArtifactCopies === undefined
              ? {}
              : {
                  sourceArtifactCopies: slice.sourceArtifactCopies.map(
                    ({ sourcePath, relativePath, expectedSourceSha256, expectedSha256 }) => ({
                      sourcePath,
                      relativePath,
                      expectedSourceSha256,
                      ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
                    }),
                  ),
                }),
            ...(slice.sourcePackageDependencies === undefined
              ? {}
              : {
                  sourcePackageDependencies: slice.sourcePackageDependencies.map(
                    ({ name, version, scope }) => ({ name, version, scope }),
                  ),
                }),
            ...(slice.sourcePackageScripts === undefined
              ? {}
              : {
                  sourcePackageScripts: slice.sourcePackageScripts.map(({ name, command }) => ({
                    name,
                    command,
                  })),
                }),
            ...(slice.deletes === undefined ? {} : { deletes: slice.deletes }),
            mappings: slice.mappings.map(
              ({
                sourcePath,
                targetPaths,
                kind,
                mode,
                ownerId,
                role,
                rationale,
                legacyAdapter,
                mergeGroupId,
                traceRanges,
                notes,
              }) => ({
                sourcePath,
                targetPaths,
                kind,
                mode,
                ownerId,
                role,
                rationale,
                ...(legacyAdapter === undefined ? {} : { legacyAdapter }),
                ...(mergeGroupId === undefined ? {} : { mergeGroupId }),
                ...(traceRanges === undefined ? {} : { traceRanges }),
                ...(notes === undefined ? {} : { notes }),
              }),
            ),
            ...(slice.ignoredSources === undefined ? {} : { ignoredSources: slice.ignoredSources }),
          },
        }),
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.applySlice,
    {
      title: 'Apply reviewed React migration slice',
      description:
        'Atomically apply only the persisted payload selected by its token. Stale source, target, plan, or payload state fails.',
      inputSchema: {
        ...migrationTargetInput,
        reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
      },
      annotations: MUTATING,
    },
    ({ target, reviewToken }) =>
      callCodeProject(
        () => reactMigration.applySlice({ target, reviewToken }),
        'Reviewed React migration slice applied atomically to the target.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verifySlice,
    {
      title: 'Verify React migration slice',
      description:
        'Engine-run typecheck/build, diagnostics, and architecture must pass against the current snapshots. Caller statuses and receipts are rejected.',
      inputSchema: {
        ...migrationTargetInput,
        sliceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        commands: z.never().optional(),
        receipts: z.never().optional(),
        status: z.never().optional(),
      },
      annotations: MUTATING,
    },
    ({ target, sliceId }) =>
      callCodeProject(
        () => reactMigration.verifySlice({ target, sliceId }),
        'React migration slice verification completed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verify,
    {
      title: 'Verify React migration',
      description:
        'With target and optional includeInstall only, let the engine prepare isolated source/target runtimes, select loopback ports, derive routes, capture fixed viewport DOM/PNG evidence, run target gates, and bind receipts/manifest to current snapshots. Caller URLs, routes, viewports, artifacts, details, statuses, and receipts are rejected.',
      inputSchema: migrationVerifyInput,
      annotations: MUTATING,
    },
    ({ target, includeInstall }) =>
      callCodeProject(
        () =>
          reactMigration.verify({
            target,
            ...(includeInstall === undefined ? {} : { includeInstall }),
          }),
        'React migration verification completed.',
      ),
  );

  server.registerTool(
    SRIJIKA_REACT_MIGRATION_TOOL_NAMES.finalize,
    {
      title: 'Finalize React migration',
      description:
        'With target only, rebuild isolated browser runtimes, recapture engine-owned parity, rerun gates, and finalize only native traceability, a closed graph, architecture, real tests, and fresh snapshot-bound evidence.',
      inputSchema: {
        ...migrationTargetInput,
        commands: z.never().optional(),
        receipts: z.never().optional(),
        status: z.never().optional(),
      },
      annotations: MUTATING,
    },
    ({ target }) =>
      callCodeProject(
        () => reactMigration.finalize({ target }),
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
