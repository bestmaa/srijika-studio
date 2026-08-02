import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUTRA_RPC_METHODS, SUTRA_TOOL_NAMES } from '@sutra/automation-protocol';
import {
  SutraBridgeError,
  createSutraMcpServer,
  type SutraBridgeCaller,
} from '../../packages/mcp-server/src';
import { toolInputs } from '../../packages/mcp-server/src/tool-schemas';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function connectedClient(bridgeClient: SutraBridgeCaller): Promise<Client> {
  const server = createSutraMcpServer({ bridgeClient });
  const client = new Client({ name: 'sutra-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

describe('Sutra MCP server', () => {
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
    expect(Buffer.byteLength(JSON.stringify(listed.tools), 'utf8')).toBeLessThan(65_000);
    const names = listed.tools.map(({ name }) => name);

    expect([...names].sort()).toEqual([...Object.values(SUTRA_TOOL_NAMES)].sort());
    expect(listed.tools).toHaveLength(17);
    expect(
      listed.tools.find(({ name }) => name === SUTRA_TOOL_NAMES.getProjectSummary)?.annotations,
    ).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(
      listed.tools.find(({ name }) => name === SUTRA_TOOL_NAMES.applyOperations)?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });

    const resources = await client.listResources();
    expect(resources.resources.map(({ uri }) => uri)).toEqual([
      'sutra://docs/protocol',
      'sutra://docs/document-model',
      'sutra://docs/design-plan',
    ]);
    const protocol = await client.readResource({ uri: 'sutra://docs/protocol' });
    expect(protocol.contents).toHaveLength(1);
    expect(protocol.contents[0]?.uri).toBe('sutra://docs/protocol');
    expect(protocol.contents[0]?.mimeType).toBe('application/json');
    expect('text' in protocol.contents[0]!).toBe(true);
    if (!('text' in protocol.contents[0]!)) throw new Error('Expected text resource');
    expect(protocol.contents[0].text).toContain('"protocolVersion": "1.0"');
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
      name: SUTRA_TOOL_NAMES.getPageOutline,
      arguments: { pageId: 'page_home', maxDepth: 4, maxNodes: 50 },
    });

    expect(calls).toEqual([
      {
        method: SUTRA_RPC_METHODS.getPageOutline,
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
      componentId: 'sutra.container',
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
        tool: SUTRA_TOOL_NAMES.getCapabilities,
        method: SUTRA_RPC_METHODS.getCapabilities,
        params: {},
      },
      {
        tool: SUTRA_TOOL_NAMES.getProjectSummary,
        method: SUTRA_RPC_METHODS.getProjectSummary,
        params: { includePages: false },
      },
      {
        tool: SUTRA_TOOL_NAMES.getPageOutline,
        method: SUTRA_RPC_METHODS.getPageOutline,
        params: { pageId: 'page_home', maxDepth: 4, maxNodes: 50 },
      },
      {
        tool: SUTRA_TOOL_NAMES.getNode,
        method: SUTRA_RPC_METHODS.getNode,
        params: { pageId: 'page_home', nodeId: 'root' },
      },
      {
        tool: SUTRA_TOOL_NAMES.getComponentCatalog,
        method: SUTRA_RPC_METHODS.getComponentCatalog,
        params: { query: 'container', category: 'Layout', detail: 'summary', limit: 5 },
      },
      {
        tool: SUTRA_TOOL_NAMES.analyzeRepetitions,
        method: SUTRA_RPC_METHODS.analyzeRepetitions,
        params: {
          pageId: 'page_home',
          candidateId: 'repeat_candidate',
          minInstances: 3,
          maxCandidates: 20,
          includeValues: true,
        },
      },
      {
        tool: SUTRA_TOOL_NAMES.getGeneratedCode,
        method: SUTRA_RPC_METHODS.getGeneratedCode,
        params: { pageId: 'page_home', detail: 'summary' },
      },
      {
        tool: SUTRA_TOOL_NAMES.applyOperations,
        method: SUTRA_RPC_METHODS.applyOperations,
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
        tool: SUTRA_TOOL_NAMES.validateDocument,
        method: SUTRA_RPC_METHODS.validateDocument,
        params: { pageId: 'page_home' },
      },
      {
        tool: SUTRA_TOOL_NAMES.getDiagnostics,
        method: SUTRA_RPC_METHODS.getDiagnostics,
        params: { pageId: 'page_home', nodeId: 'root', severity: 'warning', limit: 10 },
      },
      {
        tool: SUTRA_TOOL_NAMES.renderPreview,
        method: SUTRA_RPC_METHODS.renderPreview,
        params: { pageId: 'page_home', viewport: 'mobile', selectedNodeId: 'root' },
      },
      {
        tool: SUTRA_TOOL_NAMES.getLayoutSnapshot,
        method: SUTRA_RPC_METHODS.getLayoutSnapshot,
        params: {
          pageId: 'page_home',
          nodeIds: ['root'],
          includeComputedStyles: false,
          maxInstances: 25,
        },
      },
      {
        tool: SUTRA_TOOL_NAMES.capturePreview,
        method: SUTRA_RPC_METHODS.capturePreview,
        params: {
          pageId: 'page_home',
          viewport: 'desktop',
          width: 1586,
          height: 992,
          pixelRatio: 1,
        },
      },
      {
        tool: SUTRA_TOOL_NAMES.undo,
        method: SUTRA_RPC_METHODS.undo,
        params: { pageId: 'page_home', expectedRevision: 4 },
      },
      {
        tool: SUTRA_TOOL_NAMES.redo,
        method: SUTRA_RPC_METHODS.redo,
        params: { pageId: 'page_home', expectedRevision: 4 },
      },
      {
        tool: SUTRA_TOOL_NAMES.importDesignPlan,
        method: SUTRA_RPC_METHODS.importDesignPlan,
        params: designPlan,
      },
      {
        tool: SUTRA_TOOL_NAMES.importDesignImage,
        method: SUTRA_RPC_METHODS.importDesignImage,
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
      name: SUTRA_TOOL_NAMES.capturePreview,
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
          new SutraBridgeError({
            code: 'studio_not_running',
            message: 'Studio is closed',
            retryable: true,
          }),
        ),
    });
    const result = await client.callTool({ name: SUTRA_TOOL_NAMES.getCapabilities, arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.stringify(result.content)).toContain('studio_not_running');
  });
});
