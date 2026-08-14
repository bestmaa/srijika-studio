import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SRIJIKA_RPC_METHODS, SRIJIKA_TOOL_NAMES } from '@srijika/automation-protocol';
import { writeSrijikaProject } from '@srijika/project-scaffold';
import {
  SrijikaBridgeError,
  createSrijikaMcpServer,
  type SrijikaBridgeCaller,
} from '../../packages/mcp-server/src';
import { toolInputs } from '../../packages/mcp-server/src/tool-schemas';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connectedClient(
  bridgeClient: SrijikaBridgeCaller,
  projectRoot?: string,
): Promise<Client> {
  const server = createSrijikaMcpServer({ bridgeClient, projectRoot });
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
    expect(Buffer.byteLength(JSON.stringify(listed.tools), 'utf8')).toBeLessThan(70_000);
    const names = listed.tools.map(({ name }) => name);

    expect(names).toEqual(expect.arrayContaining(Object.values(SRIJIKA_TOOL_NAMES)));
    expect(names).toEqual(
      expect.arrayContaining([
        'srijika_get_code_project',
        'srijika_check_code_project',
        'srijika_plan_code_structure',
        'srijika_apply_code_structure',
      ]),
    );
    expect(listed.tools).toHaveLength(21);
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
      ownerContract: { required: string[]; optional: string[] };
      creation: {
        ownerActions: Record<string, string[]>;
        compositeOwners: Record<string, { required: string[]; selectable: string[] }>;
        naming: { alternateNamesAllowed: boolean };
        writePolicy: { overwrite: boolean; arbitraryFolders: boolean };
      };
      capabilityOrder: string[];
      diagnostics: {
        errors: string[];
        recommendations: { deterministicVersion: number; blocking: boolean };
      };
    };
    expect(architectureContract).toMatchObject({
      contractId: 'srijika.progressive-behavior-chain',
      ownerContract: {
        required: ['ui', 'connector'],
        optional: ['hook', 'store', 'logic', 'api', 'types'],
      },
      capabilityOrder: ['connector', 'hook', 'store', 'logic', 'api'],
      creation: {
        ownerActions: {
          featuresRoot: ['feature'],
          feature: [
            'featureConnector',
            'featureHook',
            'featureStore',
            'featureLogic',
            'featureApi',
            'featureTypes',
            'slot',
          ],
          slot: [
            'slotConnector',
            'slotHook',
            'slotStore',
            'slotLogic',
            'slotApi',
            'slotTypes',
            'part',
          ],
          part: ['partConnector', 'partHook', 'partStore', 'partLogic', 'partApi', 'partTypes'],
        },
        naming: { alternateNamesAllowed: false },
        writePolicy: { overwrite: false, arbitraryFolders: false },
      },
      diagnostics: {
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
    });
    expect(architectureContract.diagnostics.errors).toContain('SRIJIKA-ARCH-LAYER-JUMP');
    expect(architectureContract.creation.compositeOwners['slot']).toMatchObject({
      required: ['ui', 'connector'],
      selectable: ['hook', 'store', 'logic', 'api', 'types'],
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

    const checked = await client.callTool({ name: 'srijika_check_code_project', arguments: {} });
    expect(checked.structuredContent).toMatchObject({
      ok: true,
      result: { diagnostics: [] },
    });
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
