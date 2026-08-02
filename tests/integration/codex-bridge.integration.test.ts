import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PROTOCOL_VERSION, SUTRA_RPC_METHODS, TOOL_VERSION } from '@sutra/automation-protocol';
import { literal } from '@sutra/contracts';

import {
  CODEX_BRIDGE_READY_COMMAND,
  CODEX_BRIDGE_REQUEST_EVENT,
  CODEX_BRIDGE_RESOLVE_COMMAND,
  CodexBridgeLifecycle,
  dispatchStudioBridgeRpc,
  type CodexBridgeRuntime,
  type StudioBridgeRpcError,
} from '../../apps/studio/src/lib/codex-bridge';
import { StudioApp } from '../../apps/studio/src/app/StudioApp';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function rpc(method: string, params: unknown = {}): Promise<unknown> {
  return Promise.resolve().then(() =>
    dispatchStudioBridgeRpc(method, params, {
      getState: useStudioStore.getState,
      createId: ({ hint, operationIndex }) => `${hint}_${operationIndex}`,
    }),
  );
}

function resultRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an RPC result object');
  }
  return value as Record<string, unknown>;
}

describe('Studio Codex bridge RPC dispatcher', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('serves every compact read route without requiring Tauri', async () => {
    const capabilities = resultRecord(await rpc(SUTRA_RPC_METHODS.getCapabilities));
    expect(capabilities).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      runtime: {
        transport: 'authenticated-loopback',
        previewCaptureSupported: true,
        layoutInspectionSupported: true,
      },
    });

    const summary = resultRecord(await rpc(SUTRA_RPC_METHODS.getProjectSummary));
    expect(summary).toMatchObject({
      selectedPageId: 'page_home',
      project: { pageCount: 1 },
      pages: [{ id: 'page_home', revision: 0, nodeCount: 1 }],
    });
    expect(await rpc(SUTRA_RPC_METHODS.getProjectSummary, { includePages: false })).toMatchObject({
      pages: [],
    });

    expect(
      await rpc(SUTRA_RPC_METHODS.getPageOutline, {
        pageId: 'page_home',
        maxDepth: 4,
        maxNodes: 20,
      }),
    ).toMatchObject({ documentId: 'page_home', rootNodeId: 'root', returnedNodeCount: 1 });
    expect(
      await rpc(SUTRA_RPC_METHODS.getNode, { pageId: 'page_home', nodeId: 'root' }),
    ).toMatchObject({ documentId: 'page_home', node: { id: 'root' }, parent: null });

    const catalog = resultRecord(
      await rpc(SUTRA_RPC_METHODS.getComponentCatalog, {
        query: 'container',
        category: 'Layout',
        limit: 10,
      }),
    );
    expect(catalog).toMatchObject({ returnedCount: 1, truncated: false });
    expect(catalog['components']).toEqual([
      expect.objectContaining({ id: 'sutra.container', displayName: 'Container' }),
    ]);
    expect((catalog['components'] as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'propSpecs',
    );

    const manifestCatalog = resultRecord(
      await rpc(SUTRA_RPC_METHODS.getComponentCatalog, {
        ids: ['sutra.container'],
        detail: 'manifest',
        limit: 5,
      }),
    );
    expect(manifestCatalog).toMatchObject({
      detail: 'manifest',
      totalCount: 1,
      components: [
        {
          id: 'sutra.container',
          propSpecs: {
            as: { type: 'string', defaultValue: 'div', required: true },
          },
          slotSpecs: { children: { minChildren: 0 } },
          editor: { dropStrategy: 'flex' },
          defaultNode: {
            id: '__catalog_default__',
            componentId: 'sutra.container',
            style: { base: { display: 'flex', flexDirection: 'column' } },
          },
        },
      ],
    });

    expect(
      await rpc(SUTRA_RPC_METHODS.analyzeRepetitions, {
        minInstances: 2,
        maxCandidates: 10,
        includeValues: false,
      }),
    ).toMatchObject({
      documentId: 'page_home',
      revision: 0,
      totalCount: 0,
      candidates: [],
    });

    expect(await rpc(SUTRA_RPC_METHODS.validateDocument)).toMatchObject({
      ok: true,
      pageId: 'page_home',
      diagnostics: [],
    });
    expect(await rpc(SUTRA_RPC_METHODS.getDiagnostics)).toMatchObject({
      pageId: 'page_home',
      totalCount: 0,
      diagnostics: [],
    });
  });

  it('applies one atomic batch, commits once, and honors optimistic revision checks', async () => {
    const before = useStudioStore.getState().document;
    const result = await rpc(SUTRA_RPC_METHODS.applyOperations, {
      pageId: 'page_home',
      expectedRevision: 0,
      operations: [
        {
          kind: 'insertComponent',
          operationId: 'card',
          id: 'container_card',
          componentId: 'sutra.container',
          parentId: 'root',
          props: { ariaLabel: literal('Card') },
        },
        {
          kind: 'insertText',
          operationId: 'copy',
          id: 'text_copy',
          parentId: 'container_card',
          value: literal('Created through Codex'),
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      pageId: 'page_home',
      previousRevision: 0,
      revision: 1,
      appliedOperationCount: 2,
      createdIds: { card: 'container_card', copy: 'text_copy' },
      nodeCount: 3,
    });
    expect(resultRecord(result)).not.toHaveProperty('document');
    const committed = useStudioStore.getState().document;
    expect(committed).not.toBe(before);
    expect(committed.revision).toBe(1);
    expect(committed.nodes['container_card']).toBeDefined();
    expect(committed.nodes['text_copy']).toBeDefined();

    const stale = await rpc(SUTRA_RPC_METHODS.applyOperations, {
      expectedRevision: 0,
      operations: [
        {
          kind: 'insertText',
          parentId: 'root',
          value: literal('Must not commit'),
        },
      ],
    });
    expect(stale).toMatchObject({ ok: false, currentRevision: 1 });
    expect(useStudioStore.getState().document).toBe(committed);
  });

  it('returns revisioned generated TSX with typed props and Repeat mapping', async () => {
    const itemShape = {
      kind: 'object',
      fields: { label: { required: true, shape: { kind: 'string' } } },
      additionalProperties: false,
    } as const;
    const applied = await rpc(SUTRA_RPC_METHODS.applyOperations, {
      expectedRevision: 0,
      operations: [
        {
          kind: 'addPublicProp',
          prop: {
            symbolId: 'prop_items',
            name: 'items',
            displayName: 'Items',
            valueType: 'array',
            valueShape: { kind: 'array', item: itemShape },
            required: false,
            defaultValue: [{ label: 'Alpha' }, { label: 'Beta' }],
          },
        },
        {
          kind: 'insertRepeat',
          id: 'repeat_items',
          parentId: 'root',
          source: { kind: 'reference', symbolId: 'prop_items', path: [] },
          item: {
            id: 'repeat_item',
            name: 'item',
            displayName: 'Item',
            valueType: 'object',
            valueShape: itemShape,
          },
          indexSymbol: { id: 'repeat_index', name: 'itemIndex', displayName: 'Item index' },
        },
        {
          kind: 'insertText',
          id: 'repeat_label',
          parentId: 'repeat_items',
          value: { kind: 'reference', symbolId: 'repeat_item', path: ['label'] },
        },
      ],
    });
    expect(applied).toMatchObject({ ok: true, revision: 1 });

    const summary = resultRecord(await rpc(SUTRA_RPC_METHODS.getGeneratedCode));
    expect(summary).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      toolVersion: TOOL_VERSION,
      documentFormatVersion: 1,
      documentId: 'page_home',
      revision: 1,
      language: 'tsx',
      fileName: 'page_home.tsx',
      detail: 'summary',
      publicProps: [
        {
          name: 'items',
          valueType: 'array',
          required: false,
          hasDefault: true,
        },
      ],
      structure: { nodeCount: 3, repeatCount: 1, conditionalCount: 0 },
      repeatMapSignatures: ['.map((item, itemIndex) => ('],
    });
    expect(summary).not.toHaveProperty('code');
    expect(summary['publicPropInterface']).toContain('items?: ReadonlyArray<{ label: string; }>');

    const generated = resultRecord(
      await rpc(SUTRA_RPC_METHODS.getGeneratedCode, { detail: 'full' }),
    );
    expect(generated).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      toolVersion: TOOL_VERSION,
      documentFormatVersion: 1,
      documentId: 'page_home',
      revision: 1,
      language: 'tsx',
      fileName: 'page_home.tsx',
      detail: 'full',
    });
    const code = generated['code'];
    if (typeof code !== 'string') throw new Error('Expected generated TSX');
    expect(generated['characterCount']).toBe(code.length);
    expect(code).toContain('items?: ReadonlyArray<{ label: string; }>');
    expect(code).toContain('Array.isArray((props.items ??');
    expect(code).toContain('.map((item, itemIndex) => (');
    expect(code).toContain('item?.["label"]');
  });

  it('routes preview state, page selection, undo, and redo', async () => {
    let secondPageId: string | null = null;
    act(() => {
      secondPageId = useStudioStore.getState().createPage('Details Page');
    });
    if (!secondPageId) throw new Error('Expected the page to be created');
    expect(await rpc(SUTRA_RPC_METHODS.getProjectSummary)).toMatchObject({
      selectedPageId: secondPageId,
    });

    const preview = await rpc(SUTRA_RPC_METHODS.renderPreview, {
      pageId: 'page_home',
      viewport: 'mobile',
      selectedNodeId: 'root',
    });
    expect(preview).toMatchObject({
      ok: true,
      pageId: 'page_home',
      viewport: 'mobile',
      panel: 'canvas',
      selectedNodeId: 'root',
      captureSupported: true,
      capture: null,
    });
    expect(useStudioStore.getState()).toMatchObject({
      selectedPageId: 'page_home',
      viewport: 'mobile',
      panel: 'canvas',
    });

    const exactPreview = await rpc(SUTRA_RPC_METHODS.renderPreview, {
      pageId: 'page_home',
      viewport: 'desktop',
      width: 1586,
      height: 992,
    });
    expect(exactPreview).toMatchObject({
      viewport: 'desktop',
      viewportSize: { width: 1586, height: 992 },
      customViewport: true,
    });
    expect(useStudioStore.getState()).toMatchObject({
      customViewportSize: { width: 1586, height: 992 },
    });
    expect(await rpc(SUTRA_RPC_METHODS.getProjectSummary)).toMatchObject({
      selectedPageId: 'page_home',
    });

    await rpc(SUTRA_RPC_METHODS.applyOperations, {
      pageId: 'page_home',
      expectedRevision: 0,
      operations: [
        {
          kind: 'insertText',
          id: 'history_text',
          parentId: 'root',
          value: literal('History'),
        },
      ],
    });
    expect(await rpc(SUTRA_RPC_METHODS.undo, { expectedRevision: 1 })).toMatchObject({
      ok: true,
      changed: true,
      revision: 0,
    });
    expect(useStudioStore.getState().document.nodes['history_text']).toBeUndefined();
    expect(await rpc(SUTRA_RPC_METHODS.redo, { expectedRevision: 0 })).toMatchObject({
      ok: true,
      changed: true,
      revision: 1,
    });
    expect(useStudioStore.getState().document.nodes['history_text']).toBeDefined();
  });

  it('uses the same atomic executor for design plans and the deprecated image alias', async () => {
    await expect(
      rpc(SUTRA_RPC_METHODS.importDesignPlan, {
        expectedRevision: 0,
        source: { name: 'Too-wide.png', width: 5_000, height: 900 },
        operations: [
          {
            kind: 'insertText',
            id: 'must_not_commit',
            parentId: 'root',
            value: literal('Invalid viewport'),
          },
        ],
      }),
    ).rejects.toMatchObject<StudioBridgeRpcError>({ code: 'invalid_params' });
    expect(useStudioStore.getState().document).toMatchObject({ revision: 0 });
    expect(useStudioStore.getState().document.nodes['must_not_commit']).toBeUndefined();

    await expect(
      rpc(SUTRA_RPC_METHODS.importDesignPlan, {
        expectedRevision: 0,
        source: { name: 'Incomplete-size.png', width: 1_440 },
        operations: [
          {
            kind: 'insertText',
            id: 'also_must_not_commit',
            parentId: 'root',
            value: literal('Incomplete viewport'),
          },
        ],
      }),
    ).rejects.toMatchObject<StudioBridgeRpcError>({ code: 'invalid_params' });
    expect(useStudioStore.getState().document).toMatchObject({ revision: 0 });
    expect(useStudioStore.getState().document.nodes['also_must_not_commit']).toBeUndefined();

    expect(
      await rpc(SUTRA_RPC_METHODS.importDesignPlan, {
        expectedRevision: 0,
        planId: 'reference-pass-1',
        phase: 'geometry',
        source: { name: 'Reference.png', width: 1440, height: 900 },
        requiredRegions: [
          {
            id: 'content',
            label: 'Main content',
            expectedInstances: 1,
            nodeIds: ['planned_container'],
          },
        ],
        acceptance: {
          exactViewport: true,
          noHorizontalOverflow: true,
          allRegionsVisible: true,
        },
        assumptions: ['Desktop-first layout'],
        operations: [
          {
            kind: 'insertComponent',
            id: 'planned_container',
            componentId: 'sutra.container',
            parentId: 'root',
          },
        ],
      }),
    ).toMatchObject({
      ok: true,
      revision: 1,
      planId: 'reference-pass-1',
      phase: 'geometry',
      source: { name: 'Reference.png' },
      requiredRegions: [{ id: 'content' }],
      acceptance: { exactViewport: true },
      assumptions: ['Desktop-first layout'],
    });
    expect(useStudioStore.getState().customViewportSize).toEqual({ width: 1440, height: 900 });

    useStudioStore.getState().resetProject();
    expect(
      await rpc(SUTRA_RPC_METHODS.importDesignImage, {
        expectedRevision: 0,
        source: { name: 'Legacy-reference.png' },
        assumptions: ['Compatibility path'],
        operations: [
          {
            kind: 'insertText',
            id: 'legacy_text',
            parentId: 'root',
            value: literal('Legacy alias'),
          },
        ],
      }),
    ).toMatchObject({
      ok: true,
      revision: 1,
      deprecated: true,
      replacementMethod: SUTRA_RPC_METHODS.importDesignPlan,
      source: { name: 'Legacy-reference.png' },
      assumptions: ['Compatibility path'],
    });
  });

  it('returns structured page and method errors', async () => {
    await expect(
      rpc(SUTRA_RPC_METHODS.getPageOutline, { pageId: 'missing_page' }),
    ).rejects.toMatchObject<StudioBridgeRpcError>({ code: 'page_not_found' });
    await expect(rpc('sutra.unknown')).rejects.toMatchObject<StudioBridgeRpcError>({
      code: 'unsupported_method',
    });
    await expect(
      rpc(SUTRA_RPC_METHODS.applyOperations, {
        expectedRevision: 0,
        operations: [{ kind: 'unsafeUnknownOperation' }],
      }),
    ).rejects.toMatchObject<StudioBridgeRpcError>({ code: 'invalid_params' });
    expect(useStudioStore.getState().document.revision).toBe(0);
  });

  it('shows the bridge state subtly in the Studio status bar', () => {
    render(createElement(StudioApp));

    expect(screen.getByLabelText('Codex bridge requires the desktop app')).toHaveTextContent(
      'Codex bridge offline',
    );
  });
});

describe('Tauri Codex bridge lifecycle', () => {
  it('keeps one StrictMode-safe listener and resolves structured success and errors', async () => {
    let eventListener: ((payload: unknown) => void) | null = null;
    const unlisten = vi.fn();
    const listen = vi.fn<CodexBridgeRuntime['listen']>((eventName, listener) => {
      expect(eventName).toBe(CODEX_BRIDGE_REQUEST_EVENT);
      eventListener = listener;
      return Promise.resolve(unlisten);
    });
    const invoke = vi.fn<CodexBridgeRuntime['invoke']>(() => Promise.resolve(undefined));
    const runtime: CodexBridgeRuntime = {
      isDesktop: () => true,
      listen,
      invoke,
    };
    const dispatcher = vi.fn(() => Promise.resolve({ ok: true, pageId: 'page_home' }));
    const lifecycle = new CodexBridgeLifecycle(runtime, dispatcher);
    const statuses: string[] = [];

    const unsubscribeFirst = lifecycle.subscribe((status) => statuses.push(status.phase));
    await waitFor(() => expect(statuses).toContain('ready'));
    unsubscribeFirst();
    const unsubscribeSecond = lifecycle.subscribe((status) => statuses.push(status.phase));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listen).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(CODEX_BRIDGE_READY_COMMAND, { ready: true });

    if (!eventListener) throw new Error('Expected the Tauri event listener');
    const sendEvent = eventListener as (payload: unknown) => void;
    sendEvent({
      requestId: 'request_success',
      protocolVersion: PROTOCOL_VERSION,
      method: SUTRA_RPC_METHODS.getCapabilities,
      params: {},
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(CODEX_BRIDGE_RESOLVE_COMMAND, {
        response: {
          requestId: 'request_success',
          result: { ok: true, pageId: 'page_home' },
        },
      }),
    );
    expect(dispatcher).toHaveBeenCalledWith(SUTRA_RPC_METHODS.getCapabilities, {});
    expect(statuses).toContain('connected');

    sendEvent({
      requestId: 'request_wrong_version',
      protocolVersion: '99.0',
      method: SUTRA_RPC_METHODS.getCapabilities,
      params: {},
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(CODEX_BRIDGE_RESOLVE_COMMAND, {
        response: {
          requestId: 'request_wrong_version',
          error: {
            code: 'unsupported_protocol_version',
            message: `Sutra Studio expects protocol ${PROTOCOL_VERSION}.`,
            details: { expected: PROTOCOL_VERSION, actual: '99.0' },
          },
        },
      }),
    );

    unsubscribeSecond();
    await lifecycle.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(CODEX_BRIDGE_READY_COMMAND, { ready: false });
  });

  it('can restart after being stopped while its first listener is still initializing', async () => {
    let resolveFirstListener: ((unlisten: () => void) => void) | null = null;
    const firstUnlisten = vi.fn();
    const secondUnlisten = vi.fn();
    const firstListener = new Promise<() => void>((resolve) => {
      resolveFirstListener = resolve;
    });
    const listen = vi
      .fn<CodexBridgeRuntime['listen']>()
      .mockReturnValueOnce(firstListener)
      .mockResolvedValueOnce(secondUnlisten);
    const invoke = vi.fn<CodexBridgeRuntime['invoke']>(() => Promise.resolve(undefined));
    const lifecycle = new CodexBridgeLifecycle({ isDesktop: () => true, listen, invoke }, () =>
      Promise.resolve({ ok: true }),
    );

    const unsubscribeFirst = lifecycle.subscribe(() => undefined);
    await waitFor(() => expect(listen).toHaveBeenCalledTimes(1));
    unsubscribeFirst();
    await lifecycle.stop();

    const statuses: string[] = [];
    const unsubscribeSecond = lifecycle.subscribe((status) => statuses.push(status.phase));
    await waitFor(() => expect(statuses).toContain('ready'));
    expect(listen).toHaveBeenCalledTimes(2);

    if (!resolveFirstListener) throw new Error('Expected the first listener resolver');
    const resolvePendingListener = resolveFirstListener as (unlisten: () => void) => void;
    resolvePendingListener(firstUnlisten);
    await waitFor(() => expect(firstUnlisten).toHaveBeenCalledTimes(1));

    unsubscribeSecond();
    await lifecycle.stop();
    expect(secondUnlisten).toHaveBeenCalledTimes(1);
  });
});
