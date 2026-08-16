import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SRIJIKA_RPC_METHODS, SRIJIKA_TOOL_NAMES } from '@srijika/automation-protocol';
import { writeSrijikaProject } from '@srijika/project-scaffold';
import {
  SRIJIKA_REACT_MIGRATION_TOOL_NAMES,
  SrijikaBridgeError,
  createSrijikaMcpServer,
  type SrijikaBridgeCaller,
  type SrijikaReactMigrationCaller,
} from '../../packages/mcp-server/src';
import { toolInputs } from '../../packages/mcp-server/src/tool-schemas';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connectedClient(
  bridgeClient: SrijikaBridgeCaller,
  projectRoot?: string,
  reactMigrationService?: SrijikaReactMigrationCaller,
): Promise<Client> {
  const server = createSrijikaMcpServer({ bridgeClient, projectRoot, reactMigrationService });
  const client = new Client({ name: 'srijika-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe('Srijika MCP server', () => {
  it('rejects partial model-facing viewport dimensions before bridge dispatch', () => {
    expect(toolInputs.renderPreview.safeParse({ width: 1_180 }).success).toBe(false);
    expect(toolInputs.capturePreview.safeParse({ height: 820 }).success).toBe(false);
    expect(toolInputs.renderPreview.safeParse({ width: 1_180, height: 820 }).success).toBe(true);
    expect(toolInputs.capturePreview.safeParse({ width: 1_180, height: 820 }).success).toBe(true);
  });

  it('publishes the focused versioned tool surface and safety annotations', async () => {
    const client = await connectedClient({
      call: <T>() => Promise.resolve({} as T),
    });
    const listed = await client.listTools();
    expect(Buffer.byteLength(JSON.stringify(listed.tools), 'utf8')).toBeLessThan(80_000);
    const names = listed.tools.map(({ name }) => name);

    expect(names).toEqual(expect.arrayContaining(Object.values(SRIJIKA_TOOL_NAMES)));
    expect(names).toEqual(
      expect.arrayContaining([
        'srijika_get_code_project',
        'srijika_check_code_project',
        'srijika_plan_code_structure',
        'srijika_apply_code_structure',
        ...Object.values(SRIJIKA_REACT_MIGRATION_TOOL_NAMES),
      ]),
    );
    expect(listed.tools).toHaveLength(29);
    expect(
      listed.tools.find(({ name }) => name === SRIJIKA_TOOL_NAMES.getProjectSummary)?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(
      listed.tools.find(({ name }) => name === SRIJIKA_TOOL_NAMES.applyOperations)?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });

    const resources = await client.listResources();
    expect(resources.resources.map(({ uri }) => uri)).toEqual([
      'srijika://docs/protocol',
      'srijika://docs/document-model',
      'srijika://docs/design-plan',
      'srijika://docs/code-first-architecture',
      'srijika://docs/react-migration',
      'srijika://docs/cli-runtime',
    ]);
    const protocol = await client.readResource({ uri: 'srijika://docs/protocol' });
    expect(protocol.contents).toHaveLength(1);
    expect(protocol.contents[0]?.uri).toBe('srijika://docs/protocol');
    expect(protocol.contents[0]?.mimeType).toBe('application/json');
    expect('text' in protocol.contents[0]!).toBe(true);
    if (!('text' in protocol.contents[0]!)) throw new Error('Expected text resource');
    expect(protocol.contents[0].text).toContain('"protocolVersion": "1.0"');

    const architecture = await client.readResource({
      uri: 'srijika://docs/code-first-architecture',
    });
    expect(architecture.contents).toHaveLength(1);
    expect(architecture.contents[0]?.mimeType).toBe('application/json');
    if (!('text' in architecture.contents[0]!)) throw new Error('Expected text resource');
    const architectureContract = JSON.parse(architecture.contents[0].text) as {
      contractId: string;
      ownerContract: {
        required: string[];
        optional: string[];
        uiBoundary: {
          renderedOnlyByMatchingConnector: boolean;
          externalRuntimeBehaviorAllowed: boolean;
          allowedExternalImports: string[];
          directChildUiDiagnostic: { code: string; ruleId: string };
          behaviorDiagnostic: { code: string; ruleId: string };
          crossOwnerException: string;
          forbiddenBehavior: {
            hookCalls: string;
            browserRuntimeApis: string[];
            runtimeLayers: string[];
            externalRuntimeBehavior: string;
          };
        };
        logicBoundary: {
          frameworkFree: boolean;
          deterministic: boolean;
          allowed: string[];
          forbiddenRuntimeConcerns: string[];
          lifecycleOwners: Record<string, string>;
          diagnostic: { code: string; ruleId: string };
        };
        passiveTypes: {
          runtimeStep: boolean;
          allowedDeclarations: string[];
          runtimeDeclarationsAllowed: boolean;
          runtimeValueReferencesAllowed: boolean;
          consumption: string;
          diagnostic: { code: string; ruleId: string };
        };
      };
      ownerKinds: string[];
      sharedOwnerContract: {
        arbitraryFoldersAllowed: boolean;
        importsFeatures: boolean;
        consumersUsePublicBoundaryOnly: boolean;
        kinds: Record<
          string,
          {
            required: string[];
            optional: string[];
            forbidden: string[];
            publicBoundary: string;
            runtimeMinimum?: number;
            typesAloneAllowed?: boolean;
          }
        >;
      };
      creation: {
        ownerActions: Record<string, string[]>;
        compositeOwners: Record<string, { required: string[]; selectable: string[] }>;
        naming: { alternateNamesAllowed: boolean };
        writePolicy: { overwrite: boolean; arbitraryFolders: boolean };
      };
      architectureConfiguration: {
        profilePolicy: {
          supported: string;
          architectureBlockAbsent: string;
          architectureBlockPresent: string;
          missingProfile: string;
          unsupportedProfile: string;
          surfaces: string[];
        };
        supportedOverrides: {
          roots: string[];
          directories: string[];
          suffixes: string[];
        };
        safety: Record<string, string | number | boolean>;
        runtimeParity: {
          generatedValidator: {
            readsCurrentProjectConfigAtRuntime: boolean;
            retainsGeneratedArchitectureSnapshot: boolean;
          };
          cliWatch: { watches: string[]; hardcodedSrcWatch: boolean };
          exactFilePreviews: {
            surfaces: string[];
            source: string;
            hardcodedPaths: boolean;
          };
        };
      };
      capabilityOrder: string[];
      rules: {
        uiIsolation: string;
        composition: string;
        passiveTypes: string;
        sharedDirection: string;
        noFreehandShared: string;
        canonicalNaming: string;
        logicIsolation: string;
      };
      diagnostics: {
        numericCodes: Record<string, string>;
        errors: string[];
        recommendations: {
          deterministicVersion: number;
          blocking: boolean;
          entries: Array<{ code: string; emission?: string }>;
        };
      };
    };
    expect(architectureContract).toMatchObject({
      contractId: 'srijika.progressive-behavior-chain',
      ownerContract: {
        required: ['ui', 'connector'],
        optional: ['hook', 'store', 'logic', 'api', 'types'],
        uiBoundary: {
          renderedOnlyByMatchingConnector: true,
          externalRuntimeBehaviorAllowed: false,
          allowedExternalImports: [
            'type-only imports',
            'styles and assets',
            'safe React JSX support',
            'presentational bindings used exclusively as JSX tags',
          ],
          directChildUiDiagnostic: {
            code: 'SRIJIKA4116',
            ruleId: 'SRIJIKA-ARCH-DIRECT-CHILD-UI',
          },
          behaviorDiagnostic: {
            code: 'SRIJIKA4101',
            ruleId: 'SRIJIKA-ARCH-UI-RUNTIME-IMPORT',
          },
          forbiddenBehavior: {
            browserRuntimeApis: [
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
              'timers',
              'animation/idle callbacks',
              'DOM observers',
              'Image',
              'Audio',
              'FileReader',
              'DOMParser',
              'performance',
              'screen',
              'window',
              'globalThis',
              'self',
              'process',
              'Deno',
              'Bun',
            ],
            runtimeLayers: ['connector', 'hook', 'store', 'logic', 'api'],
          },
        },
        logicBoundary: {
          frameworkFree: true,
          deterministic: true,
          forbiddenRuntimeConcerns: [
            'React and React Hooks',
            'React Query and query-cache lifecycle',
            'router lifecycle and navigation state',
            'client-state libraries and state lifecycle',
            'browser globals and request transport',
          ],
          lifecycleOwners: {
            reactAndQuery: 'hook',
            sharedClientState: 'store',
            routing: 'connector',
            requestTransport: 'api',
          },
          diagnostic: {
            code: 'SRIJIKA4118',
            ruleId: 'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN',
          },
        },
        passiveTypes: {
          runtimeStep: false,
          allowedDeclarations: [
            'interface',
            'type-alias',
            'import-type',
            'export-type',
            'export {}',
          ],
          runtimeDeclarationsAllowed: false,
          runtimeValueReferencesAllowed: false,
          consumption: 'import type/export type only',
          diagnostic: {
            code: 'SRIJIKA4117',
            ruleId: 'SRIJIKA-ARCH-PASSIVE-TYPES',
          },
        },
      },
      ownerKinds: ['feature', 'slot', 'part', 'shared-ui', 'shared-widget', 'shared-capability'],
      sharedOwnerContract: {
        arbitraryFoldersAllowed: false,
        importsFeatures: false,
        consumersUsePublicBoundaryOnly: true,
        kinds: {
          'shared-ui': {
            required: ['ui'],
            optional: ['types'],
            forbidden: ['connector', 'hook', 'store', 'logic', 'api'],
            publicBoundary: 'ui',
          },
          'shared-widget': {
            required: ['ui', 'connector'],
            optional: ['hook', 'store', 'logic', 'api', 'types'],
            forbidden: [],
            publicBoundary: 'connector',
          },
          'shared-capability': {
            required: ['at-least-one-runtime-layer'],
            optional: ['hook', 'store', 'logic', 'api', 'types'],
            forbidden: ['ui', 'connector'],
            runtimeMinimum: 1,
            typesAloneAllowed: false,
            publicBoundary: 'hook-otherwise-store-otherwise-logic-otherwise-api',
          },
        },
      },
      capabilityOrder: ['connector', 'hook', 'store', 'logic', 'api'],
      architectureConfiguration: {
        profilePolicy: {
          supported: 'feature-slot-part-v1',
          architectureBlockAbsent: 'use canonical defaults',
          architectureBlockPresent: 'profile is required and must exactly match supported',
          missingProfile: 'fail closed',
          unsupportedProfile: 'fail closed',
          surfaces: ['generated validator', 'CLI', 'VS Code', 'Studio', 'MCP'],
        },
        supportedOverrides: {
          roots: ['featuresRoot', 'sharedRoot'],
          directories: ['slotsDirectory', 'partsDirectory', 'hooksDirectory', 'storesDirectory'],
          suffixes: [
            'uiSuffix',
            'connectorSuffix',
            'storeSuffix',
            'logicSuffix',
            'apiSuffix',
            'typesSuffix',
          ],
        },
        safety: {
          rootMaximumSegments: 10,
          rootsProjectRelative: true,
          rootsNonOverlapping: true,
          directoryNamesSingleSegment: true,
          directoryNamesDistinct: true,
          suffixesBasenameOnly: true,
          suffixesDistinct: true,
          traversalAllowed: false,
          absolutePathsAllowed: false,
          backslashesAllowed: false,
          symlinkEscapesAllowed: false,
        },
        runtimeParity: {
          generatedValidator: {
            readsCurrentProjectConfigAtRuntime: true,
            retainsGeneratedArchitectureSnapshot: false,
          },
          cliWatch: {
            watches: [
              'srijika.config.json',
              'root tsconfig.json',
              'configured entry',
              'resolved featuresRoot and sharedRoot',
              'ancestors where a future configured root may appear',
            ],
            hardcodedSrcWatch: false,
          },
          exactFilePreviews: {
            surfaces: ['VS Code', 'Studio'],
            source: 'canonical ownership planner with resolved project architecture',
            hardcodedPaths: false,
          },
        },
      },
      creation: {
        ownerActions: {
          featuresRoot: ['feature'],
          feature: [
            'featureConnector',
            'featureHook',
            'featureBehaviorHook',
            'featureStore',
            'featureStoreSlice',
            'featureLogic',
            'featureApi',
            'featureTypes',
            'slot',
          ],
          slot: [
            'slotConnector',
            'slotHook',
            'slotBehaviorHook',
            'slotStore',
            'slotStoreSlice',
            'slotLogic',
            'slotApi',
            'slotTypes',
            'part',
          ],
          part: [
            'partConnector',
            'partHook',
            'partBehaviorHook',
            'partStore',
            'partStoreSlice',
            'partLogic',
            'partApi',
            'partTypes',
          ],
          sharedRoot: ['sharedUi', 'sharedWidget', 'sharedCapability'],
          sharedUi: ['sharedUiTypes'],
          sharedWidget: [
            'sharedWidgetConnector',
            'sharedWidgetHook',
            'sharedWidgetBehaviorHook',
            'sharedWidgetStore',
            'sharedWidgetStoreSlice',
            'sharedWidgetLogic',
            'sharedWidgetApi',
            'sharedWidgetTypes',
          ],
          sharedCapability: [
            'sharedCapabilityHook',
            'sharedCapabilityBehaviorHook',
            'sharedCapabilityStore',
            'sharedCapabilityStoreSlice',
            'sharedCapabilityLogic',
            'sharedCapabilityApi',
            'sharedCapabilityTypes',
          ],
        },
        naming: { alternateNamesAllowed: false },
        writePolicy: { overwrite: false, arbitraryFolders: false },
      },
      diagnostics: {
        numericCodes: {
          uiRuntimeImport: 'SRIJIKA4101',
          directChildUi: 'SRIJIKA4116',
          passiveTypes: 'SRIJIKA4117',
          logicRuntimeConcern: 'SRIJIKA4118',
          recommendation: 'SRIJIKA4202',
        },
        recommendations: { deterministicVersion: 1, blocking: false },
      },
    });

    const cliRuntime = await client.readResource({ uri: 'srijika://docs/cli-runtime' });
    expect(cliRuntime.contents).toHaveLength(1);
    if (!('text' in cliRuntime.contents[0]!)) throw new Error('Expected text resource');
    expect(JSON.parse(cliRuntime.contents[0].text)).toMatchObject({
      contractId: 'srijika.fast-developer-workflow',
      runtime: {
        default: 'node',
        optional: ['bun'],
        bunActivation: 'explicit-and-vite-only',
        dependencyResolutionIndependent: true,
      },
      safety: { overwrite: false, desktopRequiredForCliOrVscode: false },
      optionalIntegrations: {
        reactQuery: {
          default: false,
          createFlag: '--react-query',
          independentOfRuntime: true,
        },
      },
    });
    const reactMigration = await client.readResource({ uri: 'srijika://docs/react-migration' });
    expect(reactMigration.contents).toHaveLength(1);
    if (!('text' in reactMigration.contents[0]!)) throw new Error('Expected text resource');
    const reactMigrationContract: unknown = JSON.parse(reactMigration.contents[0].text);
    expect(reactMigrationContract).toMatchObject({
      contractId: 'srijika.react-migration-v1',
      sourceContract: {
        immutable: true,
        finalBaselineMatchRequired: true,
        sourceAndTargetMustBeDistinct: true,
        nestedOrOverlappingRootsAllowed: false,
      },
      targetContract: {
        atomicSliceWrites: true,
        writesOutsideTargetAllowed: false,
      },
      verificationEvidence: {
        alwaysRequired: ['typecheck', 'build', 'test'],
        routeFilesPresent: {
          name: 'routes',
          requiredStatus: 'passed',
          detailsRequired: true,
        },
        semanticRoutesPresent: {
          name: 'routes',
          requiredStatus: 'passed',
          detailsRequired: true,
        },
        visualSourcesPresent: {
          categories: ['entry', 'component', 'style', 'asset'],
          name: 'visual',
          requiredStatus: 'passed',
          detailsRequired: true,
          minimumReviewedViewports: 2,
          acceptedDetailForms: ['mobile|tablet|desktop|wide', 'WxH-measurements'],
        },
        duplicateOrOversizedEvidenceRejected: true,
        sliceVerificationAlsoChecksSourceBaseline: true,
      },
    });
    const completionEvidence = (reactMigrationContract as { completionEvidence?: unknown })
      .completionEvidence;
    expect(completionEvidence).toEqual(
      expect.arrayContaining([
        'source-unchanged',
        'complete-source-to-target-traceability',
        'strict-srijika-architecture',
        'build',
        'typecheck',
        'tests',
      ]),
    );
    expect(architectureContract.diagnostics.errors).toContain('SRIJIKA-ARCH-LAYER-JUMP');
    expect(architectureContract.diagnostics.errors).toEqual(
      expect.arrayContaining([
        'SRIJIKA-ARCH-STRICT-OWNER-SHAPE',
        'SRIJIKA-ARCH-MIXED-CAPABILITY-LAYOUT',
        'SRIJIKA-ARCH-MISSING-CAPABILITY-GATEWAY',
        'SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY',
        'SRIJIKA-ARCH-SHARED-PRIVATE-IMPORT',
        'SRIJIKA-ARCH-SHARED-MISSING-RUNTIME-GATEWAY',
        'SRIJIKA-ARCH-PASSIVE-TYPES',
        'SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN',
      ]),
    );
    const promotion = architectureContract.diagnostics.recommendations.entries.find(
      ({ code }) => code === 'SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER',
    );
    const split = architectureContract.diagnostics.recommendations.entries.find(
      ({ code }) => code === 'SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER',
    );
    expect(promotion?.emission).toContain('blocking private-ownership diagnostic');
    expect(split?.emission).toContain('non-blocking SRIJIKA4202');
    expect(architectureContract.rules.uiIsolation).toContain('no Hook invocation');
    expect(architectureContract.rules.composition).toContain('only cross-owner UI exception');
    expect(architectureContract.rules.passiveTypes).toContain('import type/export type');
    expect(architectureContract.rules.sharedDirection).toContain('acyclic');
    expect(architectureContract.rules.noFreehandShared).toContain('utilities, common folders');
    expect(architectureContract.rules.canonicalNaming).toContain('exact derived kebab-case');
    expect(architectureContract.rules.logicIsolation).toContain('framework-free');
    expect(architectureContract.creation.compositeOwners['slot']).toMatchObject({
      required: ['ui', 'connector'],
      selectable: ['hook', 'store', 'logic', 'api', 'types'],
    });
  });

  it('dispatches immutable-source React migration tools to the canonical service', async () => {
    const scanMigration = vi.fn((request: Parameters<SrijikaReactMigrationCaller['scan']>[0]) =>
      Promise.resolve({ phase: 'inventory', request }),
    );
    const planMigration = vi.fn((request: Parameters<SrijikaReactMigrationCaller['plan']>[0]) =>
      Promise.resolve({ phase: 'plan', request }),
    );
    const startMigration = vi.fn((request: Parameters<SrijikaReactMigrationCaller['start']>[0]) =>
      Promise.resolve({ phase: 'scaffold', request }),
    );
    const migrationStatus = vi.fn((target: string) =>
      Promise.resolve({ phase: 'slice-migration', target }),
    );
    const applyMigrationSlice = vi.fn(
      (request: Parameters<SrijikaReactMigrationCaller['applySlice']>[0]) =>
        Promise.resolve({ phase: 'slice-verification', request }),
    );
    const verifyMigrationSlice = vi.fn(
      (request: Parameters<SrijikaReactMigrationCaller['verifySlice']>[0]) =>
        Promise.resolve({ ok: true, request }),
    );
    const verifyMigration = vi.fn((request: Parameters<SrijikaReactMigrationCaller['verify']>[0]) =>
      Promise.resolve({ ok: true, request }),
    );
    const finalizeMigration = vi.fn(
      (request: Parameters<SrijikaReactMigrationCaller['finalize']>[0]) =>
        Promise.resolve({ phase: 'finalized', request }),
    );
    const migration: SrijikaReactMigrationCaller = {
      scan: scanMigration,
      plan: planMigration,
      start: startMigration,
      status: migrationStatus,
      applySlice: applyMigrationSlice,
      verifySlice: verifyMigrationSlice,
      verify: verifyMigration,
      finalize: finalizeMigration,
    };
    const client = await connectedClient(
      { call: () => Promise.reject(new Error('no Studio')) },
      undefined,
      migration,
    );

    const source = '/projects/legacy-react';
    const target = '/projects/new-srijika';
    const created = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.create,
      arguments: { source, target, projectName: 'new-srijika', displayName: 'New Srijika' },
    });
    expect(created.isError).toBeUndefined();
    expect(startMigration).toHaveBeenCalledWith({
      source,
      target,
      projectName: 'new-srijika',
      displayName: 'New Srijika',
    });

    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.scanSource,
      arguments: { source, target },
    });
    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getPlan,
      arguments: { source, target },
    });
    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getStatus,
      arguments: { target },
    });
    expect(scanMigration).toHaveBeenCalledWith({ source, target });
    expect(planMigration).toHaveBeenCalledWith({ source, target });
    expect(migrationStatus).toHaveBeenCalledWith(target);

    const slice = {
      id: 'home-route',
      title: 'Migrate home route',
      writes: [{ relativePath: 'src/features/home/Home.ui.tsx', content: 'export {};' }],
      mappings: [
        {
          sourcePath: 'src/pages/Home.tsx',
          targetPaths: ['src/features/home/Home.ui.tsx'],
          kind: 'migrated' as const,
        },
      ],
    };
    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.applySlice,
      arguments: { target, slice },
    });
    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verifySlice,
      arguments: { target, sliceId: slice.id },
    });
    const commands = [
      { name: 'typecheck' as const, status: 'passed' as const },
      { name: 'build' as const, status: 'passed' as const },
      { name: 'test' as const, status: 'passed' as const },
      { name: 'routes' as const, status: 'passed' as const, details: 'Route matrix passed.' },
      {
        name: 'visual' as const,
        status: 'passed' as const,
        details: 'Mobile, tablet, desktop, and wide comparisons passed.',
      },
    ];
    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verify,
      arguments: { target, commands },
    });
    await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.finalize,
      arguments: { target, commands },
    });
    expect(applyMigrationSlice).toHaveBeenCalledWith({ target, slice });
    expect(verifyMigrationSlice).toHaveBeenCalledWith({ target, sliceId: slice.id });
    expect(verifyMigration).toHaveBeenCalledWith({ target, commands });
    expect(finalizeMigration).toHaveBeenCalledWith({ target, commands });

    const skippedRequired = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verify,
      arguments: {
        target,
        commands: [{ name: 'typecheck', status: 'skipped' }],
      },
    });
    expect(skippedRequired.isError).toBe(true);
    const unreviewedVisual = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.finalize,
      arguments: {
        target,
        commands: [{ name: 'visual', status: 'passed', details: 'Looked good.' }],
      },
    });
    expect(unreviewedVisual.isError).toBe(true);
    const duplicateEvidence = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.verify,
      arguments: {
        target,
        commands: [
          { name: 'build', status: 'passed' },
          { name: 'build', status: 'passed' },
        ],
      },
    });
    expect(duplicateEvidence.isError).toBe(true);
  });

  it('creates and reads a real migration session without modifying the React source', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-mcp-react-migration-'));
    cleanups.push(() => rm(parent, { recursive: true, force: true }));
    const source = join(parent, 'legacy-react');
    const target = join(parent, 'new-srijika');
    await mkdir(join(source, 'src'), { recursive: true });
    await writeFile(
      join(source, 'package.json'),
      `${JSON.stringify({
        name: 'legacy-react',
        scripts: { build: 'vite build' },
        dependencies: { react: '^19.0.0', vite: '^7.0.0' },
      })}\n`,
      'utf8',
    );
    const entry =
      "import React from 'react';\nexport const LegacyApp = () => <main>Legacy</main>;\n";
    await writeFile(join(source, 'src/main.tsx'), entry, 'utf8');

    const client = await connectedClient({
      call: () => Promise.reject(new Error('no Studio')),
    });
    const created = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.create,
      arguments: { source, target },
    });
    expect(created.isError).toBeUndefined();
    expect(created.structuredContent).toMatchObject({
      ok: true,
      result: {
        sourceRoot: source,
        targetRoot: target,
        phase: 'scaffolded',
      },
    });
    await expect(readFile(join(source, 'src/main.tsx'), 'utf8')).resolves.toBe(entry);
    await expect(
      readFile(join(target, '.srijika/migrations/react/session.json'), 'utf8'),
    ).resolves.toContain('"sourceRoot"');

    const scanned = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.scanSource,
      arguments: { source, target },
    });
    expect(scanned.structuredContent).toMatchObject({
      ok: true,
      result: { sourceRoot: source, framework: 'vite' },
    });
    const planned = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getPlan,
      arguments: { source, target },
    });
    expect(planned.structuredContent).toMatchObject({
      ok: true,
      result: { sourceRoot: source, targetRoot: target },
    });
    const status = await client.callTool({
      name: SRIJIKA_REACT_MIGRATION_TOOL_NAMES.getStatus,
      arguments: { target },
    });
    expect(status.structuredContent).toMatchObject({
      ok: true,
      result: { sourceRoot: source, targetRoot: target, phase: 'scaffolded' },
    });
  });

  it('inspects, validates, plans, and scaffolds a code project without Studio', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-mcp-code-'));
    cleanups.push(() => rm(parent, { recursive: true, force: true }));
    const root = join(parent, 'app');
    await writeSrijikaProject(root, { projectName: 'mcp-code', displayName: 'MCP Code' });
    const client = await connectedClient(
      { call: () => Promise.reject(new Error('no Studio')) },
      root,
    );

    const inspected = await client.callTool({ name: 'srijika_get_code_project', arguments: {} });
    expect(inspected.isError).toBeUndefined();
    expect(inspected.structuredContent).toMatchObject({
      ok: true,
      result: {
        contractId: 'srijika.cli-first-code-project',
        projectName: 'mcp-code',
        ownershipRoots: ['src/features', 'src/shared'],
        adapters: { mcp: 'active without Studio' },
      },
    });

    const input = {
      kind: 'feature',
      name: 'McpAudit',
      optionalCapabilities: ['logic', 'api', 'types'],
    };
    const planned = await client.callTool({
      name: 'srijika_plan_code_structure',
      arguments: input,
    });
    expect(planned.structuredContent).toMatchObject({
      ok: true,
      result: { dryRun: true, owner: 'McpAudit' },
    });
    const plannedContent = planned.structuredContent as {
      result: { planId: string };
    };
    expect(plannedContent.result.planId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(
      readFile(join(root, 'src/features/mcp-audit/McpAudit.ui.tsx'), 'utf8'),
    ).rejects.toThrow();

    const applied = await client.callTool({
      name: 'srijika_apply_code_structure',
      arguments: { planId: plannedContent.result.planId },
    });
    expect(applied.structuredContent).toMatchObject({
      ok: true,
      result: { dryRun: false, owner: 'McpAudit' },
    });
    await expect(
      readFile(join(root, 'src/features/mcp-audit/McpAudit.ui.tsx'), 'utf8'),
    ).resolves.toContain('function McpAuditUI');

    for (const expansion of [
      { kind: 'behavior-hook', name: 'Keyboard', expected: 'hooks/useHome.ts' },
      { kind: 'store-slice', name: 'Filters', expected: 'stores/home.store.ts' },
    ]) {
      const expansionPlan = await client.callTool({
        name: 'srijika_plan_code_structure',
        arguments: {
          kind: expansion.kind,
          name: expansion.name,
          ownerFolder: 'src/features/home',
        },
      });
      const content = expansionPlan.structuredContent as {
        result: { planId: string; moved: Array<{ from: string; to: string }> };
      };
      expect(content.result.moved[0]?.to).toBe(`src/features/home/${expansion.expected}`);
      await client.callTool({
        name: 'srijika_apply_code_structure',
        arguments: { planId: content.result.planId },
      });
    }
    await expect(readFile(join(root, 'src/features/home/useHome.ts'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(root, 'src/features/home/home.store.ts'), 'utf8')).rejects.toThrow();

    for (const shared of [
      {
        kind: 'shared-ui',
        name: 'Button',
        optionalCapabilities: ['types'],
        expected: 'src/shared/ui/button/Button.ui.tsx',
      },
      {
        kind: 'shared-widget',
        name: 'UserMenu',
        optionalCapabilities: ['hook', 'types'],
        expected: 'src/shared/widgets/user-menu/UserMenu.connector.tsx',
      },
      {
        kind: 'shared-capability',
        name: 'Auth',
        optionalCapabilities: ['logic', 'api', 'types'],
        expected: 'src/shared/capabilities/auth/auth.logic.ts',
      },
    ]) {
      const sharedPlan = await client.callTool({
        name: 'srijika_plan_code_structure',
        arguments: shared,
      });
      expect(sharedPlan.isError).toBeUndefined();
      const content = sharedPlan.structuredContent as {
        result: { planId: string; created: string[] };
      };
      expect(content.result.created).toContain(shared.expected);
      await client.callTool({
        name: 'srijika_apply_code_structure',
        arguments: { planId: content.result.planId },
      });
      await expect(readFile(join(root, shared.expected), 'utf8')).resolves.toBeTruthy();
    }

    for (const invalidShared of [
      {
        kind: 'shared-ui',
        name: 'UnsafeButton',
        optionalCapabilities: ['hook'],
      },
      {
        kind: 'shared-capability',
        name: 'ContractsOnly',
        optionalCapabilities: ['types'],
      },
    ]) {
      const rejected = await client.callTool({
        name: 'srijika_plan_code_structure',
        arguments: invalidShared,
      });
      expect(rejected.isError).toBe(true);
    }

    const reinspected = await client.callTool({
      name: 'srijika_get_code_project',
      arguments: {},
    });
    expect(reinspected.structuredContent).toMatchObject({ ok: true });
    const reinspectedJson = JSON.stringify(reinspected.structuredContent);
    expect(reinspectedJson).toContain('src/shared/ui/button/Button.ui.tsx');
    expect(reinspectedJson).toContain('src/shared/widgets/user-menu/UserMenu.connector.tsx');
    expect(reinspectedJson).toContain('src/shared/capabilities/auth/auth.logic.ts');

    const checked = await client.callTool({ name: 'srijika_check_code_project', arguments: {} });
    expect(checked.structuredContent).toMatchObject({
      ok: true,
      result: { diagnostics: [] },
    });
  });

  it('rejects traversal roots before MCP project inspection can read outside files', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-mcp-traversal-'));
    cleanups.push(() => rm(parent, { recursive: true, force: true }));
    const root = join(parent, 'app');
    await writeSrijikaProject(root, { projectName: 'mcp-safe', displayName: 'MCP Safe' });
    await mkdir(join(parent, 'outside'), { recursive: true });
    await writeFile(join(parent, 'outside/SECRET.txt'), 'must-not-be-exposed', 'utf8');
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        architecture: {
          profile: 'feature-slot-part-v1',
          featuresRoot: '../outside',
          sharedRoot: 'src/shared',
        },
      }),
      'utf8',
    );
    const client = await connectedClient(
      { call: () => Promise.reject(new Error('no Studio')) },
      root,
    );

    const inspected = await client.callTool({
      name: 'srijika_get_code_project',
      arguments: {},
    });

    expect(inspected.isError).toBe(true);
    expect(JSON.stringify(inspected)).not.toContain('must-not-be-exposed');
  });

  it.each(['root', 'ancestor', 'file'] as const)(
    'rejects a symlinked MCP ownership %s without enumerating outside files',
    async (scenario) => {
      const parent = await mkdtemp(join(tmpdir(), `srijika-mcp-symlink-${scenario}-`));
      cleanups.push(() => rm(parent, { recursive: true, force: true }));
      const root = join(parent, 'app');
      const outside = join(parent, 'outside');
      await writeSrijikaProject(root, { projectName: 'mcp-safe', displayName: 'MCP Safe' });
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, 'MUST_NOT_BE_ENUMERATED.ts'), 'export const secret = 1;\n');
      if (scenario === 'root') {
        await rm(join(root, 'src/shared'), { recursive: true });
        await symlink(outside, join(root, 'src/shared'), 'dir');
      } else if (scenario === 'ancestor') {
        await symlink(outside, join(root, 'src/features/home/slots/outside'), 'dir');
      } else {
        await symlink(
          join(outside, 'MUST_NOT_BE_ENUMERATED.ts'),
          join(root, 'src/features/home/outside.ts'),
          'file',
        );
      }
      const client = await connectedClient(
        { call: () => Promise.reject(new Error('no Studio')) },
        root,
      );

      const inspected = await client.callTool({
        name: 'srijika_get_code_project',
        arguments: {},
      });

      expect(inspected.isError).toBe(true);
      expect(JSON.stringify(inspected)).not.toContain('MUST_NOT_BE_ENUMERATED');
    },
  );

  it('fails MCP inspection closed when ownership recursion exceeds its depth bound', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-mcp-depth-'));
    cleanups.push(() => rm(parent, { recursive: true, force: true }));
    const root = join(parent, 'app');
    await writeSrijikaProject(root, { projectName: 'mcp-depth', displayName: 'MCP Depth' });
    const segments = Array.from({ length: 33 }, (_, index) => `d${index}`);
    await mkdir(join(root, 'src/shared', ...segments), { recursive: true });
    const client = await connectedClient(
      { call: () => Promise.reject(new Error('no Studio')) },
      root,
    );

    const inspected = await client.callTool({
      name: 'srijika_get_code_project',
      arguments: {},
    });

    expect(inspected.isError).toBe(true);
    expect(JSON.stringify(inspected)).toContain('depth safety limit');
  });

  it('forwards validated tool input to the canonical bridge method', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const client = await connectedClient({
      call: <T>(method: string, params?: unknown) => {
        calls.push({ method, params });
        return Promise.resolve({ protocolVersion: '1.0', revision: 5 } as T);
      },
    });
    const result = await client.callTool({
      name: SRIJIKA_TOOL_NAMES.getPageOutline,
      arguments: { pageId: 'page_home', maxDepth: 4, maxNodes: 50 },
    });

    expect(calls).toEqual([
      {
        method: SRIJIKA_RPC_METHODS.getPageOutline,
        params: { pageId: 'page_home', maxDepth: 4, maxNodes: 50 },
      },
    ]);
    expect(result.structuredContent).toEqual({
      ok: true,
      result: { protocolVersion: '1.0', revision: 5 },
    });
  });

  it('maps all validated tools to their canonical RPC method and params', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true });
    const client = await connectedClient({ call });
    const insertContainer = {
      kind: 'insertComponent',
      operationId: 'surface',
      parentId: 'root',
      componentId: 'srijika.container',
    };
    const insertText = {
      kind: 'insertText',
      operationId: 'copy',
      parentId: { createdBy: 'surface' },
      value: { kind: 'literal', value: 'Hello' },
    };
    const designPlan = {
      pageId: 'page_home',
      expectedRevision: 4,
      planId: 'orbit-pass-1',
      phase: 'geometry',
      source: { name: 'reference.png', width: 1440, height: 900 },
      requiredRegions: [
        { id: 'header', label: 'Top header', expectedInstances: 1, nodeIds: ['header'] },
      ],
      acceptance: {
        exactViewport: true,
        noHorizontalOverflow: true,
        allRegionsVisible: true,
      },
      assumptions: ['Desktop layout'],
      operations: [insertContainer, insertText],
    };
    const cases: Array<{
      tool: string;
      method: string;
      params: Record<string, unknown>;
    }> = [
      {
        tool: SRIJIKA_TOOL_NAMES.getCapabilities,
        method: SRIJIKA_RPC_METHODS.getCapabilities,
        params: {},
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getProjectSummary,
        method: SRIJIKA_RPC_METHODS.getProjectSummary,
        params: { includePages: false },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getPageOutline,
        method: SRIJIKA_RPC_METHODS.getPageOutline,
        params: { pageId: 'page_home', maxDepth: 4, maxNodes: 50 },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getNode,
        method: SRIJIKA_RPC_METHODS.getNode,
        params: { pageId: 'page_home', nodeId: 'root' },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getComponentCatalog,
        method: SRIJIKA_RPC_METHODS.getComponentCatalog,
        params: { query: 'container', category: 'Layout', detail: 'summary', limit: 5 },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.analyzeRepetitions,
        method: SRIJIKA_RPC_METHODS.analyzeRepetitions,
        params: {
          pageId: 'page_home',
          candidateId: 'repeat_candidate',
          minInstances: 3,
          maxCandidates: 20,
          includeValues: true,
        },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getGeneratedCode,
        method: SRIJIKA_RPC_METHODS.getGeneratedCode,
        params: { pageId: 'page_home', detail: 'summary' },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.applyOperations,
        method: SRIJIKA_RPC_METHODS.applyOperations,
        params: {
          pageId: 'page_home',
          expectedRevision: 4,
          operations: [
            insertContainer,
            insertText,
            {
              kind: 'setStyle',
              nodeId: { createdBy: 'surface' },
              breakpoint: 'mobile',
              style: { flexDirection: 'column' },
            },
            {
              kind: 'convertRepeatedSiblings',
              operationId: 'rows',
              candidateId: 'repeat_candidate',
              propName: 'rows',
            },
          ],
        },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.validateDocument,
        method: SRIJIKA_RPC_METHODS.validateDocument,
        params: { pageId: 'page_home' },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getDiagnostics,
        method: SRIJIKA_RPC_METHODS.getDiagnostics,
        params: { pageId: 'page_home', nodeId: 'root', severity: 'warning', limit: 10 },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.renderPreview,
        method: SRIJIKA_RPC_METHODS.renderPreview,
        params: { pageId: 'page_home', viewport: 'mobile', selectedNodeId: 'root' },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.getLayoutSnapshot,
        method: SRIJIKA_RPC_METHODS.getLayoutSnapshot,
        params: {
          pageId: 'page_home',
          nodeIds: ['root'],
          includeComputedStyles: false,
          maxInstances: 25,
        },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.capturePreview,
        method: SRIJIKA_RPC_METHODS.capturePreview,
        params: {
          pageId: 'page_home',
          viewport: 'desktop',
          width: 1586,
          height: 992,
          pixelRatio: 1,
        },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.undo,
        method: SRIJIKA_RPC_METHODS.undo,
        params: { pageId: 'page_home', expectedRevision: 4 },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.redo,
        method: SRIJIKA_RPC_METHODS.redo,
        params: { pageId: 'page_home', expectedRevision: 4 },
      },
      {
        tool: SRIJIKA_TOOL_NAMES.importDesignPlan,
        method: SRIJIKA_RPC_METHODS.importDesignPlan,
        params: designPlan,
      },
      {
        tool: SRIJIKA_TOOL_NAMES.importDesignImage,
        method: SRIJIKA_RPC_METHODS.importDesignImage,
        params: {
          pageId: designPlan.pageId,
          expectedRevision: designPlan.expectedRevision,
          source: designPlan.source,
          assumptions: designPlan.assumptions,
          operations: designPlan.operations,
        },
      },
    ];

    for (const testCase of cases) {
      const result = await client.callTool({ name: testCase.tool, arguments: testCase.params });
      expect(result.isError).toBeUndefined();
    }
    expect(call.mock.calls).toEqual(cases.map(({ method, params }) => [method, params]));
  });

  it('returns preview captures as MCP image content without duplicating base64 in text', async () => {
    const client = await connectedClient({
      call: <T>() =>
        Promise.resolve({
          ok: true,
          pageId: 'page_home',
          clean: true,
          capture: {
            mimeType: 'image/png',
            data: 'cG5nLWJ5dGVz',
            width: 1586,
            height: 992,
            pixelRatio: 1,
          },
        } as T),
    });

    const result = await client.callTool({
      name: SRIJIKA_TOOL_NAMES.capturePreview,
      arguments: {
        pageId: 'page_home',
        viewport: 'desktop',
        width: 1586,
        height: 992,
        pixelRatio: 1,
      },
    });
    expect(result.content[0]).toMatchObject({
      type: 'image',
      mimeType: 'image/png',
      data: 'cG5nLWJ5dGVz',
    });
    expect(JSON.stringify(result.content[1])).not.toContain('cG5nLWJ5dGVz');
    expect(result.structuredContent).toMatchObject({
      ok: true,
      result: {
        clean: true,
        capture: { mimeType: 'image/png', width: 1586, height: 992 },
      },
    });
  });

  it('returns a structured MCP error instead of crashing when Studio is unavailable', async () => {
    const client = await connectedClient({
      call: () =>
        Promise.reject(
          new SrijikaBridgeError({
            code: 'studio_not_running',
            message: 'Studio is closed',
            retryable: true,
          }),
        ),
    });
    const result = await client.callTool({
      name: SRIJIKA_TOOL_NAMES.getCapabilities,
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.stringify(result.content)).toContain('studio_not_running');
  });
});
