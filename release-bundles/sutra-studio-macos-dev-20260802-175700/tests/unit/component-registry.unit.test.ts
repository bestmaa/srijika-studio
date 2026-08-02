import { describe, expect, it } from 'vitest';

import {
  analyzeDocument,
  assertDocumentSemantics,
  ComponentRegistry,
  isEventSignatureAssignable,
  isTypeAssignable,
  isValueDeclarationAssignableToShape,
  literalMatchesValueShape,
  type ComponentDefinition,
} from '@sutra/component-registry';
import { createCoreComponentRegistry } from '@sutra/core-components';
import {
  createBlankDocument,
  createElementNode,
  eventExpressionArgument,
  eventPayloadArgument,
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

  it('checks mapped literals and declarations against recursive payload shapes', () => {
    const closedCount = {
      kind: 'object',
      fields: {
        count: { required: true, shape: { kind: 'number' } },
      },
      additionalProperties: false,
    } as const;

    expect(literalMatchesValueShape({ count: 5 }, closedCount)).toBe(true);
    expect(literalMatchesValueShape({}, closedCount)).toBe(false);
    expect(literalMatchesValueShape({ count: 5, extra: true }, closedCount)).toBe(false);
    expect(isValueDeclarationAssignableToShape('object', closedCount, closedCount)).toBe(true);
    expect(isValueDeclarationAssignableToShape('object', undefined, closedCount)).toBe(false);
    expect(isValueDeclarationAssignableToShape('event', undefined, { kind: 'unknown' })).toBe(
      false,
    );
  });

  it('checks normalized event payload compatibility without leaking native events', () => {
    const noPayload = { payload: null } as const;
    const stringPayload = {
      payload: { name: 'value', shape: { kind: 'string' } },
    } as const;
    const numberPayload = {
      payload: { name: 'value', shape: { kind: 'number' } },
    } as const;

    expect(isEventSignatureAssignable(noPayload, noPayload)).toBe(true);
    expect(isEventSignatureAssignable(stringPayload, noPayload)).toBe(true);
    expect(isEventSignatureAssignable(noPayload, stringPayload)).toBe(false);
    expect(isEventSignatureAssignable(stringPayload, stringPayload)).toBe(true);
    expect(isEventSignatureAssignable(stringPayload, numberPayload)).toBe(false);
  });

  it('reports an event signature mismatch at a bound component port', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_event_signature', 'Event signature');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    document.publicProps['onValue'] = {
      symbolId: 'event_value',
      name: 'onValue',
      displayName: 'On value',
      valueType: 'event',
      eventSignature: { payload: { name: 'value', shape: { kind: 'string' } } },
      required: false,
    };
    document.symbols['event_value'] = {
      id: 'event_value',
      name: 'onValue',
      displayName: 'On value',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'value', shape: { kind: 'string' } } },
      required: false,
    };
    const button = registry.require('sutra.button').createNode('button');
    if (button.kind !== 'element') throw new Error('Expected Button element');
    button.events['onClick'] = { kind: 'reference', symbolId: 'event_value', path: [] };
    root.slots['children'] = [button.id];
    document.nodes[button.id] = button;

    expect(analyzeDocument(document, registry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'event-signature-mismatch',
          nodeId: button.id,
          symbolId: 'event_value',
        }),
      ]),
    );
  });

  it('uses an explicit page-prop argument when checking event compatibility', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_event_argument', 'Event argument');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');

    document.publicProps['count'] = {
      symbolId: 'prop_count',
      name: 'count',
      displayName: 'Count',
      valueType: 'number',
      valueShape: { kind: 'number' },
      required: false,
      defaultValue: 3,
    };
    document.symbols['prop_count'] = {
      id: 'prop_count',
      name: 'count',
      displayName: 'Count',
      provider: 'prop',
      valueType: 'number',
      valueShape: { kind: 'number' },
      required: false,
      defaultValue: 3,
    };
    document.symbols['event_count'] = {
      id: 'event_count',
      name: 'onCount',
      displayName: 'On count',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'count', shape: { kind: 'number' } } },
      required: false,
    };

    const button = registry.require('sutra.button').createNode('count_button');
    if (button.kind !== 'element') throw new Error('Expected Button element');
    button.events['onClick'] = { kind: 'reference', symbolId: 'event_count', path: [] };
    button.eventArguments = {
      onClick: eventExpressionArgument({
        kind: 'reference',
        symbolId: 'prop_count',
        path: [],
      }),
    };
    root.slots['children'] = [button.id];
    document.nodes[button.id] = button;

    const diagnostics = analyzeDocument(document, registry);

    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.nodeId === button.id &&
          (diagnostic.code === 'event-argument-mismatch' ||
            diagnostic.code === 'event-signature-mismatch'),
      ),
    ).toEqual([]);
  });

  it('diagnoses unavailable, incompatible and unexpected explicit event arguments', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_invalid_arguments', 'Invalid arguments');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    document.symbols['event_count'] = {
      id: 'event_count',
      name: 'onCount',
      displayName: 'On count',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'count', shape: { kind: 'number' } } },
      required: false,
    };
    document.symbols['event_save'] = {
      id: 'event_save',
      name: 'onSave',
      displayName: 'On save',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: null },
      required: false,
    };

    const unavailable = registry.require('sutra.button').createNode('unavailable_payload');
    const wrongType = registry.require('sutra.button').createNode('wrong_argument_type');
    const unexpected = registry.require('sutra.button').createNode('unexpected_argument');
    if (
      unavailable.kind !== 'element' ||
      wrongType.kind !== 'element' ||
      unexpected.kind !== 'element'
    ) {
      throw new Error('Expected Button elements');
    }
    unavailable.events['onClick'] = {
      kind: 'reference',
      symbolId: 'event_count',
      path: [],
    };
    unavailable.eventArguments = { onClick: eventPayloadArgument() };
    wrongType.events['onClick'] = {
      kind: 'reference',
      symbolId: 'event_count',
      path: [],
    };
    wrongType.eventArguments = {
      onClick: eventExpressionArgument(literal('not a number')),
    };
    unexpected.events['onClick'] = {
      kind: 'reference',
      symbolId: 'event_save',
      path: [],
    };
    unexpected.eventArguments = {
      onClick: eventExpressionArgument(literal(5)),
    };
    root.slots['children'] = [unavailable.id, wrongType.id, unexpected.id];
    Object.assign(document.nodes, {
      [unavailable.id]: unavailable,
      [wrongType.id]: wrongType,
      [unexpected.id]: unexpected,
    });

    const diagnostics = analyzeDocument(document, registry);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'event-argument-mismatch',
          nodeId: unavailable.id,
          path: `nodes.${unavailable.id}.eventArguments.onClick`,
        }),
        expect.objectContaining({
          code: 'event-argument-mismatch',
          nodeId: wrongType.id,
          path: `nodes.${wrongType.id}.eventArguments.onClick`,
        }),
        expect.objectContaining({
          code: 'event-argument-mismatch',
          nodeId: unexpected.id,
          path: `nodes.${unexpected.id}.eventArguments.onClick`,
        }),
      ]),
    );
  });

  it('checks event-argument references in the owning repeat scope', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_repeat_arguments', 'Repeat arguments');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    document.symbols['event_select'] = {
      id: 'event_select',
      name: 'onSelect',
      displayName: 'On select',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: { name: 'index', shape: { kind: 'number' } } },
      required: false,
    };
    document.symbols['repeat_item'] = {
      id: 'repeat_item',
      name: 'item',
      displayName: 'Item',
      provider: 'repeatItem',
      valueType: 'string',
      valueShape: { kind: 'string' },
      required: true,
    };
    document.symbols['repeat_index'] = {
      id: 'repeat_index',
      name: 'index',
      displayName: 'Index',
      provider: 'repeatIndex',
      valueType: 'number',
      valueShape: { kind: 'number' },
      required: true,
    };

    const outside = registry.require('sutra.button').createNode('outside_repeat');
    const inside = registry.require('sutra.button').createNode('inside_repeat');
    if (outside.kind !== 'element' || inside.kind !== 'element') {
      throw new Error('Expected Button elements');
    }
    for (const button of [outside, inside]) {
      button.events['onClick'] = {
        kind: 'reference',
        symbolId: 'event_select',
        path: [],
      };
      button.eventArguments = {
        onClick: eventExpressionArgument({
          kind: 'reference',
          symbolId: 'repeat_index',
          path: [],
        }),
      };
    }
    const repeat: RepeatNode = {
      kind: 'repeat',
      id: 'repeat',
      name: 'Repeat',
      source: literal(['first']),
      itemSymbolId: 'repeat_item',
      indexSymbolId: 'repeat_index',
      children: [inside.id],
    };
    root.slots['children'] = [outside.id, repeat.id];
    Object.assign(document.nodes, {
      [outside.id]: outside,
      [repeat.id]: repeat,
      [inside.id]: inside,
    });

    const diagnostics = analyzeDocument(document, registry);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'repeat-symbol-out-of-scope',
          nodeId: outside.id,
          symbolId: 'repeat_index',
          path: `nodes.${outside.id}.eventArguments.onClick.expression`,
        }),
      ]),
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'repeat-symbol-out-of-scope',
          nodeId: inside.id,
        }),
      ]),
    );
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

    const inputDefinition = registry.require('sutra.input');
    expect(inputDefinition.manifest.props).toMatchObject({
      hideLabel: { type: 'boolean', defaultValue: false, bindable: true },
      labelStyle: { type: 'object', defaultValue: {}, bindable: true },
      controlStyle: { type: 'object', defaultValue: {}, bindable: true },
    });
    expect(inputDefinition.createNode('styled_input')).toMatchObject({
      props: {
        hideLabel: { kind: 'literal', value: false },
        labelStyle: { kind: 'literal', value: {} },
        controlStyle: { kind: 'literal', value: {} },
      },
    });
  });

  it('adds bindable className and style props to every registered component', () => {
    const registry = new ComponentRegistry<string>();
    registry.register(definition('test.surface', 'Surface'));

    expect(registry.require('test.surface').manifest.props).toMatchObject({
      className: { type: 'string', bindable: true },
      style: { type: 'object', bindable: true },
    });
    expect(
      createCoreComponentRegistry().require('sutra.container').manifest.props['as'],
    ).toMatchObject({
      type: 'string',
      bindable: false,
      control: 'select',
      options: ['div', 'section', 'header', 'footer', 'nav', 'article', 'aside'],
    });
  });

  it('validates declared reference paths and repeat lexical scope', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('expected element root');

    const itemShape = {
      kind: 'object',
      additionalProperties: false,
      fields: {
        title: { required: true, shape: { kind: 'string' } },
      },
    } as const;
    document.publicProps['items'] = {
      symbolId: 'prop_items',
      name: 'items',
      displayName: 'Items',
      valueType: 'array',
      valueShape: { kind: 'array', item: itemShape },
      required: true,
    };
    // The analyzer intentionally falls back to the public-prop descriptor for
    // format-1 symbols created before valueShape was mirrored onto them.
    document.symbols['prop_items'] = {
      id: 'prop_items',
      name: 'items',
      displayName: 'Items',
      provider: 'prop',
      valueType: 'array',
      required: true,
    };
    document.symbols['repeat_item'] = {
      id: 'repeat_item',
      name: 'item',
      displayName: 'Item',
      provider: 'repeatItem',
      valueType: 'unknown',
      required: true,
    };
    document.symbols['repeat_index'] = {
      id: 'repeat_index',
      name: 'index',
      displayName: 'Index',
      provider: 'repeatIndex',
      valueType: 'number',
      valueShape: { kind: 'number' },
      required: true,
    };
    root.slots['children'] = ['outside', 'repeat'];
    Object.assign(document.nodes, {
      outside: {
        kind: 'expression',
        id: 'outside',
        name: 'Out-of-scope item',
        expression: { kind: 'reference', symbolId: 'repeat_item', path: ['title'] },
      },
      repeat: {
        kind: 'repeat',
        id: 'repeat',
        name: 'Items',
        source: { kind: 'reference', symbolId: 'prop_items', path: [] },
        itemSymbolId: 'repeat_item',
        indexSymbolId: 'repeat_index',
        children: ['inside', 'invalid_path'],
      },
      inside: {
        kind: 'expression',
        id: 'inside',
        name: 'Item title',
        expression: { kind: 'reference', symbolId: 'repeat_item', path: ['title'] },
      },
      invalid_path: {
        kind: 'expression',
        id: 'invalid_path',
        name: 'Missing item field',
        expression: { kind: 'reference', symbolId: 'repeat_item', path: ['missing'] },
      },
    });

    const diagnostics = analyzeDocument(document, registry);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'repeat-symbol-out-of-scope',
          nodeId: 'outside',
          symbolId: 'repeat_item',
        }),
        expect.objectContaining({
          code: 'invalid-reference-path',
          nodeId: 'invalid_path',
          symbolId: 'repeat_item',
        }),
      ]),
    );
    expect(diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'repeat-symbol-out-of-scope',
          nodeId: 'inside',
        }),
      ]),
    );
  });

  it('rejects prototype path segments and accepts common React prop bindings', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('expected element root');
    document.symbols['settings'] = {
      id: 'settings',
      name: 'settings',
      displayName: 'Settings',
      provider: 'prop',
      valueType: 'object',
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
      required: true,
    };
    root.props['className'] = literal('page');
    root.props['style'] = { kind: 'reference', symbolId: 'settings', path: [] };
    root.props['unsafe'] = {
      kind: 'reference',
      symbolId: 'settings',
      path: ['__proto__'],
    };

    const diagnostics = analyzeDocument(document, registry);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-reference-path', symbolId: 'settings' }),
        expect.objectContaining({ code: 'unknown-prop', nodeId: root.id }),
      ]),
    );
    const unknownPropMessages = diagnostics
      .filter((diagnostic) => diagnostic.code === 'unknown-prop')
      .map((diagnostic) => diagnostic.message);
    expect(unknownPropMessages.some((message) => message.includes('style'))).toBe(false);
    expect(unknownPropMessages.some((message) => message.includes('className'))).toBe(false);
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

  it('analyzes symbol references nested in custom connector arguments', () => {
    const registry = createCoreComponentRegistry();
    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('expected element root');
    document.symbols['settings'] = {
      id: 'settings',
      name: 'settings',
      displayName: 'Settings',
      provider: 'state',
      valueType: 'object',
      valueShape: {
        kind: 'object',
        additionalProperties: false,
        fields: { title: { required: true, shape: { kind: 'string' } } },
      },
      required: true,
    };
    root.visible = {
      kind: 'customCodeReference',
      moduleId: 'visibility_connector',
      exportName: 'isVisible',
      args: [
        { kind: 'reference', symbolId: 'missing_symbol', path: [] },
        { kind: 'reference', symbolId: 'settings', path: ['missing'] },
      ],
    };

    const diagnostics = analyzeDocument(document, registry);

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-symbol',
          nodeId: root.id,
          symbolId: 'missing_symbol',
        }),
        expect.objectContaining({
          code: 'invalid-reference-path',
          nodeId: root.id,
          symbolId: 'settings',
        }),
      ]),
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
