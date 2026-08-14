import { describe, expect, it } from 'vitest';

import { createCoreComponentRegistry } from '@srijika/core-components';
import { createBlankDocument, literal, type SrijikaProject } from '@srijika/contracts';

import {
  CAPABILITIES,
  DOCUMENT_FORMAT_VERSION,
  PROTOCOL_VERSION,
  ProtocolAdapterRegistry,
  SRIJIKA_RPC_METHODS,
  SRIJIKA_TOOL_NAMES,
  TOOL_VERSION,
  applyOperations,
  buildComponentCatalog,
  buildNodeDetail,
  buildPageOutline,
  buildProjectSummary,
  validateAutomationDocument,
  type AutomationIdFactory,
  type SrijikaOperation,
} from '../../packages/automation-protocol/src/index';

function idFactory(): AutomationIdFactory {
  let sequence = 0;
  return ({ hint }) => `${hint.replace(/[^A-Za-z0-9_-]/g, '_')}_${sequence++}`;
}

function project(pageIds: string[]): SrijikaProject {
  return {
    formatVersion: 1,
    id: 'srijika_test',
    name: 'Srijika Test',
    entryPageId: pageIds[0] ?? 'page_home',
    pages: pageIds,
    components: ['component_card'],
    toolchain: {
      node: '22.13.0',
      packageManager: 'pnpm',
      packageManagerVersion: '11.18.0',
      vite: '8.2.0',
    },
  };
}

describe('automation protocol versions and capabilities', () => {
  it('publishes one stable bridge version and canonical RPC/tool names', () => {
    expect(PROTOCOL_VERSION).toBe('1.0');
    expect(TOOL_VERSION).toBe('0.3.1');
    expect(DOCUMENT_FORMAT_VERSION).toBe(1);
    expect(CAPABILITIES.features).toMatchObject({
      atomicBatches: true,
      optimisticConcurrency: true,
      localBatchNodeReferences: true,
      structuredDesignPlans: true,
      generatedTsxInspection: true,
      schemaValidation: true,
    });
    expect(CAPABILITIES.limits).toEqual({
      customViewport: { minWidth: 240, maxWidth: 4_096, minHeight: 200, maxHeight: 4_096 },
      operations: { maxBatch: 500, maxDesignPlanBatch: 1_000 },
      outline: { maxDepth: 64, maxNodes: 2_000 },
      layout: { maxNodeIds: 500, maxInstances: 5_000 },
      capture: { minPixelRatio: 1, maxPixelRatio: 2 },
      repetitions: { minInstances: 2, maxInstances: 100, maxCandidates: 500 },
    });
    expect(SRIJIKA_RPC_METHODS).toMatchObject({
      applyOperations: 'srijika.applyOperations',
      analyzeRepetitions: 'srijika.analyzeRepetitions',
      getGeneratedCode: 'srijika.getGeneratedCode',
      importDesignPlan: 'srijika.importDesignPlan',
      undo: 'srijika.undo',
      redo: 'srijika.redo',
    });
    expect(SRIJIKA_TOOL_NAMES).toMatchObject({
      applyOperations: 'srijika_apply_operations',
      analyzeRepetitions: 'srijika_analyze_repetitions',
      getGeneratedCode: 'srijika_get_generated_code',
      importDesignPlan: 'srijika_import_design_plan',
      undo: 'srijika_undo',
      redo: 'srijika_redo',
    });
    expect(CAPABILITIES.deprecated.rpcMethods).toContain('srijika.importDesignImage');
  });
});

describe('compact automation read models', () => {
  it('builds a compact project summary and reports unloaded documents', () => {
    const home = createBlankDocument('page_home', 'Home');
    const summary = buildProjectSummary(project(['page_home', 'page_missing']), {
      page_home: home,
    });

    expect(summary).toMatchObject({
      protocolVersion: '1.0',
      documentFormatVersion: 1,
      selectedPageId: 'page_home',
      project: {
        id: 'srijika_test',
        name: 'Srijika Test',
        entryPageId: 'page_home',
        pageCount: 2,
        componentCount: 1,
      },
      pages: [
        {
          id: 'page_home',
          name: 'Home',
          revision: 0,
          nodeCount: 1,
          isEntryPage: true,
        },
      ],
      missingDocumentIds: ['page_missing'],
    });
  });

  it('returns deterministic page outlines, truncation and focused node details', () => {
    const registry = createCoreComponentRegistry();
    const original = createBlankDocument('page_home', 'Home');
    const result = applyOperations(
      original,
      0,
      [
        {
          kind: 'insertComponent',
          operationId: 'container',
          id: 'container_a',
          componentId: 'srijika.container',
          parentId: 'root',
        },
        {
          kind: 'insertComponent',
          operationId: 'heading',
          id: 'heading_a',
          componentId: 'srijika.heading',
          parentId: 'container_a',
        },
      ],
      registry,
      idFactory(),
    );
    if (!result.ok) throw new Error('Expected the setup batch to succeed');

    const outline = buildPageOutline(result.document);
    expect(outline.nodes.map(({ id, depth }) => [id, depth])).toEqual([
      ['root', 0],
      ['container_a', 1],
      ['heading_a', 2],
    ]);
    expect(outline.truncated).toBe(false);
    expect(buildPageOutline(result.document, { maxDepth: 1 })).toMatchObject({
      returnedNodeCount: 2,
      truncated: true,
    });
    expect(buildPageOutline(result.document, { maxNodes: 1 })).toMatchObject({
      returnedNodeCount: 1,
      truncated: true,
    });

    const detail = buildNodeDetail(result.document, 'heading_a');
    expect(detail).toMatchObject({
      documentId: 'page_home',
      revision: 1,
      node: { id: 'heading_a', componentId: 'srijika.heading' },
      parent: { nodeId: 'container_a', slot: 'children', index: 0 },
      children: [],
    });
    expect(buildNodeDetail(result.document, 'missing')).toBeNull();
  });

  it('returns a sorted, compact registry catalog', () => {
    const catalog = buildComponentCatalog(createCoreComponentRegistry());
    const container = catalog.find(({ id }) => id === 'srijika.container');
    expect(container).toMatchObject({
      displayName: 'Container',
      slots: ['children'],
      draggable: true,
      dropStrategy: 'flex',
    });
    for (const propName of ['ariaLabel', 'as', 'className', 'style']) {
      expect(container?.props).toContain(propName);
    }
    expect(catalog.map(({ category, displayName }) => `${category}/${displayName}`)).toEqual(
      [...catalog]
        .sort((left, right) =>
          `${left.category}/${left.displayName}`.localeCompare(
            `${right.category}/${right.displayName}`,
          ),
        )
        .map(({ category, displayName }) => `${category}/${displayName}`),
    );
  });
});

describe('atomic high-level operations', () => {
  it('applies a rich batch through the document engine with one revision increment', () => {
    const registry = createCoreComponentRegistry();
    const original = createBlankDocument('page_home', 'Home');
    const operations: SrijikaOperation[] = [
      {
        kind: 'addPublicProp',
        operationId: 'title_prop',
        prop: {
          symbolId: 'prop_title',
          name: 'title',
          displayName: 'Title',
          valueType: 'string',
          required: true,
        },
      },
      {
        kind: 'insertComponent',
        operationId: 'surface',
        componentId: 'srijika.container',
        parentId: 'root',
        name: 'Hero surface',
      },
      {
        kind: 'setStyle',
        nodeId: { createdBy: 'surface' },
        style: { display: 'flex', flexDirection: 'column', gap: 24 },
      },
      {
        kind: 'insertComponent',
        operationId: 'title',
        id: 'title_node',
        componentId: 'srijika.heading',
        parentId: { createdBy: 'surface' },
      },
      {
        kind: 'setProp',
        nodeId: { createdBy: 'title' },
        propName: 'text',
        value: { kind: 'reference', symbolId: 'prop_title', path: [] },
      },
      {
        kind: 'insertText',
        operationId: 'raw_text',
        id: 'raw_text_node',
        parentId: { createdBy: 'surface' },
        value: literal('AST text'),
      },
      {
        kind: 'insertIf',
        operationId: 'condition',
        id: 'condition_node',
        parentId: { createdBy: 'surface' },
        condition: literal(true),
      },
      {
        kind: 'insertRepeat',
        operationId: 'rows',
        id: 'repeat_node',
        parentId: { createdBy: 'surface' },
        source: literal([]),
      },
    ];

    const result = applyOperations(original, 0, operations, registry, idFactory());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(original).toEqual(createBlankDocument('page_home', 'Home'));
    expect(result.previousRevision).toBe(0);
    expect(result.revision).toBe(1);
    expect(result.document.revision).toBe(1);
    expect(result.appliedOperationCount).toBe(operations.length);
    expect(result.createdIds).toMatchObject({
      surface: 'srijika_container_0',
      title: 'title_node',
      raw_text: 'raw_text_node',
      condition: 'condition_node',
      rows: 'repeat_node',
      'rows.itemSymbol': 'repeat_node_item_1',
      'rows.indexSymbol': 'repeat_node_index_2',
    });
    expect(result.document.nodes['srijika_container_0']).toMatchObject({
      name: 'Hero surface',
      style: { base: { display: 'flex', flexDirection: 'column', gap: 24 } },
      slots: {
        children: ['title_node', 'raw_text_node', 'condition_node', 'repeat_node'],
      },
    });
    expect(validateAutomationDocument(result.document, registry)).toEqual([]);
  });

  it('supports event argument binding, rename, move, style unset and subtree removal', () => {
    const registry = createCoreComponentRegistry();
    const first = applyOperations(
      createBlankDocument('page_home', 'Home'),
      0,
      [
        {
          kind: 'addPublicProp',
          prop: {
            symbolId: 'event_select',
            name: 'onSelect',
            displayName: 'Select',
            valueType: 'event',
            eventSignature: { payload: null },
            required: true,
          },
        },
        {
          kind: 'insertComponent',
          id: 'first_container',
          componentId: 'srijika.container',
          parentId: 'root',
        },
        {
          kind: 'insertComponent',
          id: 'second_container',
          componentId: 'srijika.container',
          parentId: 'root',
        },
        {
          kind: 'insertComponent',
          id: 'button_node',
          componentId: 'srijika.button',
          parentId: 'first_container',
        },
        {
          kind: 'setEventBinding',
          nodeId: 'button_node',
          eventName: 'onClick',
          handler: { kind: 'reference', symbolId: 'event_select', path: [] },
          argument: null,
        },
        {
          kind: 'setStyle',
          nodeId: 'button_node',
          style: { gap: 16 },
        },
      ],
      registry,
      idFactory(),
    );
    if (!first.ok) throw new Error('Expected setup batch to succeed');

    const second = applyOperations(
      first.document,
      1,
      [
        {
          kind: 'moveNode',
          nodeId: 'button_node',
          parentId: 'second_container',
          index: 0,
        },
        { kind: 'renameNode', nodeId: 'button_node', name: 'Primary action' },
        { kind: 'setStyle', nodeId: 'button_node', style: {}, unset: ['gap'] },
        { kind: 'removeNode', nodeId: 'first_container' },
      ],
      registry,
      idFactory(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.document.revision).toBe(2);
    expect(second.document.nodes['first_container']).toBeUndefined();
    const button = second.document.nodes['button_node'];
    expect(button).toMatchObject({
      name: 'Primary action',
      events: { onClick: { kind: 'reference', symbolId: 'event_select', path: [] } },
    });
    if (!button || button.kind !== 'element') throw new Error('Expected button element');
    expect(button.style.base).not.toHaveProperty('gap');
    expect(second.document.nodes['second_container']).toMatchObject({
      slots: { children: ['button_node'] },
    });
  });

  it('rejects stale batches without invoking the ID factory or changing the document', () => {
    const document = createBlankDocument('page_home', 'Home');
    let calls = 0;
    const result = applyOperations(
      document,
      9,
      [
        {
          kind: 'insertComponent',
          componentId: 'srijika.container',
          parentId: 'root',
        },
      ],
      createCoreComponentRegistry(),
      () => {
        calls += 1;
        return 'generated';
      },
    );

    expect(result).toMatchObject({
      ok: false,
      currentRevision: 0,
      createdIds: {},
      diagnostics: [{ code: 'revision-conflict' }],
    });
    expect(calls).toBe(0);
    expect(Object.keys(document.nodes)).toEqual(['root']);
  });

  it('rolls back engine and semantic failures with structured operation diagnostics', () => {
    const registry = createCoreComponentRegistry();
    const original = createBlankDocument('page_home', 'Home');
    const missingComponent = applyOperations(
      original,
      0,
      [
        {
          kind: 'insertComponent',
          operationId: 'unknown',
          componentId: 'srijika.missing',
          parentId: 'root',
        },
      ],
      registry,
      idFactory(),
    );
    expect(missingComponent).toMatchObject({
      ok: false,
      failedOperationIndex: 0,
      diagnostics: [
        {
          code: 'component-not-found',
          operationIndex: 0,
          operationId: 'unknown',
        },
      ],
    });

    const invalidSemantics = applyOperations(
      original,
      0,
      [
        {
          kind: 'insertComponent',
          id: 'heading_node',
          componentId: 'srijika.heading',
          parentId: 'root',
        },
        {
          kind: 'setProp',
          nodeId: 'heading_node',
          propName: 'text',
          value: literal(42),
        },
      ],
      registry,
      idFactory(),
    );
    expect(invalidSemantics.ok).toBe(false);
    expect(invalidSemantics.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['semantic-validation-failed', 'semantic:prop-type-mismatch']),
    );
    expect(original.revision).toBe(0);
    expect(original.nodes['heading_node']).toBeUndefined();
  });

  it('rejects runtime payloads that add fields outside the canonical document schema', () => {
    const operation = {
      kind: 'setStyle',
      nodeId: 'root',
      style: { imaginaryCssProperty: 'nope' },
    } as unknown as SrijikaOperation;

    const result = applyOperations(
      createBlankDocument('page_home', 'Home'),
      0,
      [operation],
      createCoreComponentRegistry(),
      idFactory(),
    );

    expect(result).toMatchObject({
      ok: false,
      currentRevision: 0,
      diagnostics: [
        {
          code: 'operation-failed',
          operationIndex: 0,
          operationId: 'operation_0',
        },
      ],
    });

    const malformed = createBlankDocument('page_home', 'Home');
    const root = malformed.nodes['root'];
    if (!root || root.kind !== 'element') throw new Error('Expected page root');
    (root.style.base as Record<string, unknown>)['imaginaryCssProperty'] = 'nope';
    const schemaDiagnostics = validateAutomationDocument(malformed, createCoreComponentRegistry());
    expect(schemaDiagnostics).toHaveLength(1);
    expect(schemaDiagnostics[0]?.code).toMatch(/^schema:/);
  });

  it('requires replaceDocument isolation, identity and final validation', () => {
    const registry = createCoreComponentRegistry();
    const original = createBlankDocument('page_home', 'Home');
    const replacement = createBlankDocument('page_home', 'Replacement');
    replacement.revision = 99;

    const mixed = applyOperations(
      original,
      0,
      [
        { kind: 'replaceDocument', document: replacement },
        { kind: 'renameNode', nodeId: 'root', name: 'Nope' },
      ],
      registry,
      idFactory(),
    );
    expect(mixed).toMatchObject({ ok: false, diagnostics: [{ code: 'invalid-operation' }] });

    const wrongIdentity = structuredClone(replacement);
    wrongIdentity.id = 'page_other';
    const mismatched = applyOperations(
      original,
      0,
      [{ kind: 'replaceDocument', operationId: 'replacement', document: wrongIdentity }],
      registry,
      idFactory(),
    );
    expect(mismatched).toMatchObject({
      ok: false,
      failedOperationIndex: 0,
      diagnostics: [{ code: 'document-id-mismatch', operationId: 'replacement' }],
    });

    const success = applyOperations(
      original,
      0,
      [{ kind: 'replaceDocument', document: replacement }],
      registry,
      idFactory(),
    );
    expect(success.ok).toBe(true);
    if (success.ok) {
      expect(success.document.name).toBe('Replacement');
      expect(success.document.revision).toBe(1);
    }
  });

  it('rejects empty batches and duplicate caller operation IDs', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_home', 'Home');
    expect(applyOperations(document, 0, [], registry, idFactory())).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'empty-operation-batch' }],
    });
    expect(
      applyOperations(
        document,
        0,
        [
          { kind: 'renameNode', operationId: 'same', nodeId: 'root', name: 'One' },
          { kind: 'renameNode', operationId: 'same', nodeId: 'root', name: 'Two' },
        ],
        registry,
        idFactory(),
      ),
    ).toMatchObject({
      ok: false,
      failedOperationIndex: 1,
      diagnostics: [{ code: 'duplicate-operation-id', operationId: 'same' }],
    });
  });
});

describe('document diagnostics and future protocol adapters', () => {
  it('returns graph diagnostics before semantic diagnostics', () => {
    const invalid = createBlankDocument('page_home', 'Home');
    invalid.rootNodeId = 'missing';
    const diagnostics = validateAutomationDocument(invalid, createCoreComponentRegistry());
    expect(diagnostics.map(({ code }) => code)).toContain('graph:missing-root');
    expect(diagnostics.every(({ code }) => !code.startsWith('semantic:'))).toBe(true);
  });

  it('finds deterministic chained migration paths and supports identity adaptation', () => {
    const adapters = new ProtocolAdapterRegistry()
      .register<{ count: number }, { count: number; label: string }>({
        fromVersion: '1.0',
        toVersion: '1.1',
        adapt: ({ count }) => ({ count, label: String(count) }),
      })
      .register<{ count: number; label: string }, { total: number; label: string }>({
        fromVersion: '1.1',
        toVersion: '2.0',
        adapt: ({ count, label }) => ({ total: count, label }),
      });

    expect(adapters.versions()).toEqual([
      { fromVersion: '1.0', toVersion: '1.1' },
      { fromVersion: '1.1', toVersion: '2.0' },
    ]);
    expect(adapters.adapt<{ total: number; label: string }>({ count: 7 }, '1.0', '2.0')).toEqual({
      ok: true,
      payload: { total: 7, label: '7' },
      fromVersion: '1.0',
      toVersion: '2.0',
      appliedVersions: ['1.0', '1.1', '2.0'],
      diagnostics: [],
    });
    expect(adapters.adapt<{ value: string }>({ value: 'same' }, '2.0', '2.0')).toMatchObject({
      ok: true,
      payload: { value: 'same' },
      appliedVersions: ['2.0'],
    });
  });

  it('reports missing migration paths and prevents duplicate adapters', () => {
    const adapters = new ProtocolAdapterRegistry().register({
      fromVersion: '1.0',
      toVersion: '1.1',
      adapt: (value: unknown) => value,
    });
    expect(adapters.adapt({}, '1.0', '3.0')).toMatchObject({
      ok: false,
      appliedVersions: ['1.0'],
      diagnostics: [{ code: 'migration-path-not-found' }],
    });
    expect(() =>
      adapters.register({
        fromVersion: '1.0',
        toVersion: '1.1',
        adapt: (value: unknown) => value,
      }),
    ).toThrow(/already exists/);
  });
});
