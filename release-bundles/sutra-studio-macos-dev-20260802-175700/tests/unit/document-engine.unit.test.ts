import { describe, expect, it, vi } from 'vitest';

import { literal, type RepeatNode, type SymbolDeclaration } from '@sutra/contracts';
import {
  DocumentHistory,
  applyCommand,
  dispatchCommand,
  validateDocumentGraph,
} from '@sutra/document-engine';

import { createContainer, createEngineDocument } from '../helpers/documents';

function createRepeat(id = 'repeat_a'): {
  node: RepeatNode;
  itemSymbol: SymbolDeclaration;
  indexSymbol: SymbolDeclaration;
} {
  const itemSymbol: SymbolDeclaration = {
    id: `${id}_item`,
    name: 'item',
    displayName: 'Item',
    provider: 'repeatItem',
    valueType: 'unknown',
    required: true,
  };
  const indexSymbol: SymbolDeclaration = {
    id: `${id}_index`,
    name: 'index',
    displayName: 'Index',
    provider: 'repeatIndex',
    valueType: 'number',
    required: true,
  };
  return {
    node: {
      kind: 'repeat',
      id,
      name: 'Repeat',
      source: literal(null),
      itemSymbolId: itemSymbol.id,
      indexSymbolId: indexSymbol.id,
      children: [],
    },
    itemSymbol,
    indexSymbol,
  };
}

describe('document commands', () => {
  it('applies immutable insert and prop commands with monotonic revisions', () => {
    const original = createEngineDocument();
    const container = createContainer('container_a');

    const inserted = applyCommand(original, {
      kind: 'insertNode',
      parentId: original.rootNodeId,
      slot: 'children',
      index: 0,
      node: container,
    }).document;
    const updated = applyCommand(inserted, {
      kind: 'setProp',
      nodeId: container.id,
      propName: 'ariaLabel',
      value: literal('Main content'),
    }).document;

    expect(original.nodes[container.id]).toBeUndefined();
    expect(original.revision).toBe(0);
    expect(inserted.revision).toBe(1);
    expect(updated.revision).toBe(2);
    expect(updated.nodes[container.id]).toMatchObject({
      props: { ariaLabel: literal('Main content') },
    });
    expect(validateDocumentGraph(updated)).toEqual([]);
  });

  it('moves nodes across parents and rejects cycles', () => {
    let document = createEngineDocument();
    for (const [parentId, node] of [
      [document.rootNodeId, createContainer('container_a')],
      [document.rootNodeId, createContainer('container_b')],
      ['container_a', createContainer('nested')],
    ] as const) {
      document = applyCommand(document, {
        kind: 'insertNode',
        parentId,
        slot: 'children',
        index: 99,
        node,
      }).document;
    }

    const moved = applyCommand(document, {
      kind: 'moveNode',
      nodeId: 'nested',
      parentId: 'container_b',
      slot: 'children',
      index: 0,
    }).document;

    expect(moved.nodes['container_a']).toMatchObject({
      slots: { children: [] },
    });
    expect(moved.nodes['container_b']).toMatchObject({
      slots: { children: ['nested'] },
    });
    expect(() =>
      applyCommand(document, {
        kind: 'moveNode',
        nodeId: 'container_a',
        parentId: 'nested',
        slot: 'children',
        index: 0,
      }),
    ).toThrow(/cannot be moved into itself or one of its descendants/);
  });

  it('rejects stale or incorrectly targeted command envelopes', () => {
    const document = createEngineDocument();
    const command = {
      kind: 'renameNode' as const,
      nodeId: document.rootNodeId,
      name: 'Renamed root',
    };

    expect(() =>
      dispatchCommand(document, {
        commandVersion: 1,
        commandId: 'command_1',
        documentId: 'another_document',
        baseRevision: 0,
        origin: 'user',
        command,
      }),
    ).toThrow(/targets another_document/);

    expect(() =>
      dispatchCommand(document, {
        commandVersion: 1,
        commandId: 'command_2',
        documentId: document.id,
        baseRevision: 1,
        origin: 'ai',
        command,
      }),
    ).toThrow(/Stale command revision/);
  });

  it('supports style, event, visibility and rename edits including removal', () => {
    let document = createEngineDocument();
    document = applyCommand(document, {
      kind: 'insertNode',
      parentId: document.rootNodeId,
      slot: 'children',
      index: 0,
      node: createContainer('target'),
    }).document;
    document = applyCommand(document, {
      kind: 'setStyleProperty',
      nodeId: 'target',
      property: 'gap',
      value: 24,
    }).document;
    document = applyCommand(document, {
      kind: 'setEvent',
      nodeId: 'target',
      eventName: 'onClick',
      value: { kind: 'reference', symbolId: 'action', path: [] },
    }).document;
    document = applyCommand(document, {
      kind: 'setVisibility',
      nodeId: 'target',
      value: literal(false),
    }).document;
    document = applyCommand(document, {
      kind: 'renameNode',
      nodeId: 'target',
      name: '  Renamed target  ',
    }).document;

    expect(document.nodes['target']).toMatchObject({
      name: 'Renamed target',
      events: { onClick: { kind: 'reference', symbolId: 'action', path: [] } },
      style: { base: { gap: 24 } },
      visible: literal(false),
    });

    document = applyCommand(document, {
      kind: 'setStyleProperty',
      nodeId: 'target',
      property: 'gap',
      value: null,
    }).document;
    document = applyCommand(document, {
      kind: 'setEvent',
      nodeId: 'target',
      eventName: 'onClick',
      value: null,
    }).document;
    expect(document.nodes['target']).toMatchObject({ events: {}, style: { base: {} } });
    expect(() =>
      applyCommand(document, { kind: 'renameNode', nodeId: 'target', name: '   ' }),
    ).toThrow(/cannot be empty/);
  });

  it('adds and removes public props together with their symbols', () => {
    const document = createEngineDocument();
    const prop = {
      symbolId: 'prop_title',
      name: 'title',
      displayName: 'Title',
      valueType: 'string' as const,
      required: false,
      defaultValue: 'Sutra',
    };
    const added = applyCommand(document, { kind: 'addPublicProp', prop }).document;

    expect(added.publicProps['title']).toEqual(prop);
    expect(added.symbols['prop_title']).toMatchObject({
      provider: 'prop',
      valueType: 'string',
      defaultValue: 'Sutra',
    });
    expect(() => applyCommand(added, { kind: 'addPublicProp', prop })).toThrow(/already exists/);

    const removed = applyCommand(added, {
      kind: 'removePublicProp',
      propName: 'title',
    }).document;
    expect(removed.publicProps['title']).toBeUndefined();
    expect(removed.symbols['prop_title']).toBeUndefined();
    expect(() => applyCommand(removed, { kind: 'removePublicProp', propName: 'title' })).toThrow(
      /does not exist/,
    );
  });

  it('protects public props referenced by custom connector arguments', () => {
    const original = createEngineDocument();
    const prop = {
      symbolId: 'prop_title',
      name: 'title',
      displayName: 'Title',
      valueType: 'string' as const,
      required: true,
    };
    const added = applyCommand(original, { kind: 'addPublicProp', prop }).document;
    const referenced = applyCommand(added, {
      kind: 'setVisibility',
      nodeId: added.rootNodeId,
      value: {
        kind: 'customCodeReference',
        moduleId: 'visibility_connector',
        exportName: 'isVisible',
        args: [{ kind: 'reference', symbolId: prop.symbolId, path: [] }],
      },
    }).document;

    expect(() =>
      applyCommand(referenced, { kind: 'removePublicProp', propName: prop.name }),
    ).toThrow(/still referenced/);
  });

  it('removes complete subtrees and protects the root', () => {
    let document = createEngineDocument();
    document = applyCommand(document, {
      kind: 'insertNode',
      parentId: 'root',
      slot: 'children',
      index: 0,
      node: createContainer('parent'),
    }).document;
    document = applyCommand(document, {
      kind: 'insertNode',
      parentId: 'parent',
      slot: 'children',
      index: 0,
      node: createContainer('child'),
    }).document;

    const removed = applyCommand(document, {
      kind: 'removeSubtree',
      nodeId: 'parent',
    }).document;
    expect(removed.nodes['parent']).toBeUndefined();
    expect(removed.nodes['child']).toBeUndefined();
    expect(() => applyCommand(document, { kind: 'removeSubtree', nodeId: 'root' })).toThrow(
      /Root node cannot be removed/,
    );
    expect(() =>
      applyCommand(document, {
        kind: 'moveNode',
        nodeId: 'root',
        parentId: 'parent',
        slot: 'children',
        index: 0,
      }),
    ).toThrow(/Root node cannot be moved/);
  });

  it('rejects duplicate IDs and invalid insertion indices', () => {
    const document = createEngineDocument();
    expect(() =>
      applyCommand(document, {
        kind: 'insertNode',
        parentId: 'root',
        slot: 'children',
        index: 0,
        node: createContainer('root'),
      }),
    ).toThrow(/already exists/);
    expect(() =>
      applyCommand(document, {
        kind: 'insertNode',
        parentId: 'root',
        slot: 'children',
        index: 0.5,
        node: createContainer('fractional'),
      }),
    ).toThrow(/must be an integer/);
  });
});

describe('document history', () => {
  it('undoes and redoes a complete command deterministically', () => {
    const original = createEngineDocument();
    const history = new DocumentHistory(original);

    history.dispatch({
      kind: 'insertNode',
      parentId: original.rootNodeId,
      slot: 'children',
      index: 0,
      node: createContainer('container_a'),
    });
    const after = structuredClone(history.document);

    expect(history.canUndo).toBe(true);
    expect(history.undo()).toEqual(original);
    expect(history.canRedo).toBe(true);
    expect(history.redo()).toEqual(after);
  });

  it('clears redo history after a divergent command', () => {
    const history = new DocumentHistory(createEngineDocument());
    history.dispatch({ kind: 'renameNode', nodeId: 'root', name: 'First' });
    history.undo();
    history.dispatch({ kind: 'renameNode', nodeId: 'root', name: 'Second' });

    expect(history.canRedo).toBe(false);
    expect(history.document.nodes['root']?.name).toBe('Second');
  });

  it('inserts a repeat and both scoped symbols as one atomic history entry', () => {
    const original = createEngineDocument();
    const history = new DocumentHistory(original);
    const repeat = createRepeat();

    const inserted = history.dispatch({
      kind: 'insertRepeat',
      parentId: original.rootNodeId,
      slot: 'children',
      index: 0,
      ...repeat,
    });

    expect(inserted.revision).toBe(1);
    expect(inserted.nodes[repeat.node.id]).toEqual(repeat.node);
    expect(inserted.symbols[repeat.itemSymbol.id]).toEqual(repeat.itemSymbol);
    expect(inserted.symbols[repeat.indexSymbol.id]).toEqual(repeat.indexSymbol);
    expect(history.undo()).toEqual(original);
    expect(history.redo()).toEqual(inserted);
  });

  it('removes repeat symbols with their containing subtree and restores them on undo', () => {
    const history = new DocumentHistory(createEngineDocument());
    history.dispatch({
      kind: 'insertNode',
      parentId: 'root',
      slot: 'children',
      index: 0,
      node: createContainer('parent'),
    });
    const repeat = createRepeat('nested_repeat');
    history.dispatch({
      kind: 'insertRepeat',
      parentId: 'parent',
      slot: 'children',
      index: 0,
      ...repeat,
    });
    const beforeRemoval = structuredClone(history.document);

    const removed = history.dispatch({ kind: 'removeSubtree', nodeId: 'parent' });

    expect(removed.nodes['parent']).toBeUndefined();
    expect(removed.nodes[repeat.node.id]).toBeUndefined();
    expect(removed.symbols[repeat.itemSymbol.id]).toBeUndefined();
    expect(removed.symbols[repeat.indexSymbol.id]).toBeUndefined();
    expect(history.undo()).toEqual(beforeRemoval);
  });

  it('coalesces rapid edits to one field but keeps edits outside the window separate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    try {
      const original = createEngineDocument();
      const history = new DocumentHistory(original, { coalesceWindowMs: 650 });

      history.dispatch({
        kind: 'setProp',
        nodeId: 'root',
        propName: 'title',
        value: literal('First'),
      });
      vi.advanceTimersByTime(100);
      const coalesced = history.dispatch({
        kind: 'setProp',
        nodeId: 'root',
        propName: 'title',
        value: literal('Second'),
      });

      expect(history.undo()).toEqual(original);
      expect(history.redo()).toEqual(coalesced);

      vi.advanceTimersByTime(651);
      history.dispatch({
        kind: 'setProp',
        nodeId: 'root',
        propName: 'title',
        value: literal('Third'),
      });
      expect(history.undo()).toEqual(coalesced);
      expect(history.undo()).toEqual(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a stale envelope through history without changing the current document', () => {
    const original = createEngineDocument();
    const history = new DocumentHistory(original);
    history.dispatchEnvelope({
      commandVersion: 1,
      commandId: 'command_1',
      documentId: original.id,
      baseRevision: 0,
      origin: 'user',
      command: { kind: 'renameNode', nodeId: 'root', name: 'Current' },
    });
    const current = structuredClone(history.document);

    expect(() =>
      history.dispatchEnvelope({
        commandVersion: 1,
        commandId: 'command_2',
        documentId: original.id,
        baseRevision: 0,
        origin: 'ai',
        command: { kind: 'renameNode', nodeId: 'root', name: 'Stale' },
      }),
    ).toThrow(/Stale command revision/);
    expect(history.document).toEqual(current);
  });
});

describe('graph diagnostics', () => {
  it('reports missing children and unreachable nodes without crashing', () => {
    const document = createEngineDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.slots['children']?.push('missing_child');
    document.nodes['orphan'] = createContainer('orphan');

    const codes = validateDocumentGraph(document).map((diagnostic) => diagnostic.code);

    expect(codes).toContain('missing-child');
    expect(codes).toContain('unreachable-node');
  });

  it('reports duplicate parents, duplicate children and cycles', () => {
    const document = createEngineDocument();
    const root = document.nodes['root'];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const first = createContainer('first');
    const second = createContainer('second');
    root.slots['children'] = ['first', 'first', 'second'];
    first.slots['children'] = ['second'];
    second.slots['children'] = ['first'];
    document.nodes['first'] = first;
    document.nodes['second'] = second;

    const codes = validateDocumentGraph(document).map((diagnostic) => diagnostic.code);
    expect(codes).toContain('duplicate-child');
    expect(codes).toContain('duplicate-parent');
    expect(codes).toContain('cycle');
  });

  it('reports a missing root and assertValidDocumentGraph failures', async () => {
    const document = createEngineDocument();
    document.rootNodeId = 'missing';

    expect(validateDocumentGraph(document).map((diagnostic) => diagnostic.code)).toContain(
      'missing-root',
    );
    const { assertValidDocumentGraph } = await import('@sutra/document-engine');
    expect(() => assertValidDocumentGraph(document)).toThrow(/does not exist/);
  });
});
