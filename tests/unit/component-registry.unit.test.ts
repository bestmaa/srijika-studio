import { describe, expect, it } from 'vitest';

import {
  analyzeDocument,
  assertDocumentSemantics,
  ComponentRegistry,
  isTypeAssignable,
  type ComponentDefinition,
} from '@sutra/component-registry';
import { createCoreComponentRegistry } from '@sutra/core-components';
import {
  createBlankDocument,
  createElementNode,
  literal,
  type IfNode,
  type RepeatNode,
} from '@sutra/contracts';

function definition(
  id: string,
  displayName: string,
  category: 'Layout' | 'Typography' = 'Layout',
): ComponentDefinition<string> {
  return {
    manifest: {
      id,
      version: 1,
      displayName,
      description: displayName,
      category,
      icon: 'Square',
      props: {},
      events: {},
      slots: {},
      editor: {
        draggable: true,
        selectable: true,
        resizable: 'both',
        dropStrategy: 'none',
      },
    },
    implementation: id,
    createNode: (nodeId) => createElementNode(nodeId, id, displayName),
  };
}

describe('ComponentRegistry', () => {
  it('registers, requires and deterministically sorts component manifests', () => {
    const registry = new ComponentRegistry<string>();
    registry.register(definition('test.zeta', 'Zeta'));
    registry.register(definition('test.alpha', 'Alpha'));
    registry.register(definition('test.body', 'Body', 'Typography'));

    expect(registry.get('test.alpha')?.implementation).toBe('test.alpha');
    expect(registry.require('test.zeta').manifest.displayName).toBe('Zeta');
    expect(registry.manifests().map((manifest) => manifest.displayName)).toEqual([
      'Alpha',
      'Zeta',
      'Body',
    ]);
    expect(registry.definitions()).toHaveLength(3);
    expect(() => registry.register(definition('test.alpha', 'Duplicate'))).toThrow(
      /already registered/,
    );
    expect(() => registry.require('test.missing')).toThrow(/Unknown component/);
  });

  it('implements the strict prop compatibility rules', () => {
    expect(isTypeAssignable('string', 'string')).toBe(true);
    expect(isTypeAssignable('color', 'string')).toBe(true);
    expect(isTypeAssignable('number', 'unknown')).toBe(true);
    expect(isTypeAssignable('number', 'string')).toBe(false);
    expect(isTypeAssignable('event', 'boolean')).toBe(false);
  });

  it('creates every core component with manifest-aligned node metadata', () => {
    const registry = createCoreComponentRegistry();

    for (const registered of registry.definitions()) {
      const node = registered.createNode(`node_${registered.manifest.id.replace('.', '_')}`);
      expect(node).toMatchObject({
        kind: 'element',
        componentId: registered.manifest.id,
        componentVersion: registered.manifest.version,
      });
    }
  });

  it('reports component, version, prop type and symbol-reference errors', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument();
    expect(analyzeDocument(document, registry)).toEqual([]);

    const invalid = structuredClone(document);
    const root = invalid.nodes[invalid.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('expected element root');
    root.componentVersion = 99;
    root.props['unknown'] = literal(42);
    root.visible = { kind: 'reference', symbolId: 'missing_symbol', path: [] };

    const diagnostics = analyzeDocument(invalid, registry);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['component-version-mismatch', 'unknown-prop', 'missing-symbol']),
    );
    expect(() => assertDocumentSemantics(invalid, registry)).toThrow(
      /Invalid Sutra document semantics/,
    );
  });

  it('enforces manifest prop types independently from the Inspector UI', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument();
    const button = registry.require('sutra.button').createNode('root');
    if (button.kind !== 'element') throw new Error('expected button element');
    button.props['label'] = literal(123);
    document.nodes = { root: button };

    expect(analyzeDocument(document, registry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'prop-type-mismatch', nodeId: 'root' }),
      ]),
    );
  });

  it('diagnoses structural expressions, event bindings, scoped repeats, public props and slots', () => {
    const registry = createCoreComponentRegistry();
    registry.register({
      manifest: {
        id: 'test.panel',
        version: 1,
        displayName: 'Panel',
        description: 'Strict diagnostic fixture',
        category: 'Layout',
        icon: 'Square',
        props: {
          title: {
            type: 'string',
            displayName: 'Title',
            required: true,
            bindable: true,
            control: 'text',
          },
        },
        events: {},
        slots: {
          content: {
            displayName: 'Content',
            accepts: ['sutra.text'],
            minChildren: 1,
            maxChildren: 1,
          },
        },
        editor: {
          draggable: true,
          selectable: true,
          resizable: 'both',
          dropStrategy: 'flow',
        },
      },
      implementation: () => null,
      createNode: (id) => createElementNode(id, 'test.panel', 'Panel', { slots: { content: [] } }),
    });

    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('expected element root');
    document.publicProps['title'] = {
      symbolId: 'prop_title',
      name: 'title',
      displayName: 'Title',
      valueType: 'string',
      required: false,
    };
    document.symbols['prop_title'] = {
      id: 'prop_title',
      name: 'outOfSync',
      displayName: 'Title',
      provider: 'prop',
      valueType: 'string',
      required: false,
    };

    const condition: IfNode = {
      kind: 'if',
      id: 'condition',
      name: 'Invalid condition',
      condition: literal('truthy but not boolean'),
      whenTrue: [],
      whenFalse: [],
    };
    const repeat: RepeatNode = {
      kind: 'repeat',
      id: 'repeat',
      name: 'Invalid repeat',
      source: literal('not an array'),
      itemSymbolId: 'missing_item',
      indexSymbolId: 'missing_index',
      children: [],
    };
    const button = registry.require('sutra.button').createNode('button');
    if (button.kind !== 'element') throw new Error('expected button element');
    button.events['unknownEvent'] = literal(true);
    button.events['onClick'] = literal('not a callback');
    const panel = registry.require('test.panel').createNode('panel');
    if (panel.kind !== 'element') throw new Error('expected panel element');
    panel.slots['content'] = ['button', 'text'];
    panel.slots['unknown'] = [];
    const text = registry.require('sutra.text').createNode('text');
    const missing = createElementNode('missing', 'test.unknown', 'Missing');

    Object.assign(document.nodes, {
      condition,
      repeat,
      button,
      panel,
      text,
      missing,
    });

    const diagnosticCodes = analyzeDocument(document, registry).map(
      (diagnostic) => diagnostic.code,
    );
    expect(diagnosticCodes).toEqual(
      expect.arrayContaining([
        'public-prop-symbol-mismatch',
        'condition-type-mismatch',
        'repeat-source-type-mismatch',
        'invalid-repeat-symbol',
        'unknown-event',
        'event-type-mismatch',
        'missing-required-prop',
        'slot-overflow',
        'slot-component-mismatch',
        'unknown-slot',
        'unknown-component',
      ]),
    );
  });
});
