import { describe, expect, it } from 'vitest';

import { analyzeDocument } from '@sutra/component-registry';
import { createCoreComponentRegistry } from '@sutra/core-components';
import { createBlankDocument, createInstanceEventSpec, literal } from '@sutra/contracts';

function elementDocument(componentId = 'sutra.text') {
  const registry = createCoreComponentRegistry();
  const document = createBlankDocument('page_instance_analyzer', 'Instance analyzer');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected Page root');
  const node = registry.require(componentId).createNode('subject');
  if (node.kind !== 'element') throw new Error('Expected element subject');
  root.slots['children'] = [node.id];
  document.nodes[node.id] = node;
  return { document, node, registry };
}

describe('instance extension analyzer', () => {
  it('merges typed instance props and normalized instance events with a manifest', () => {
    const { document, node, registry } = elementDocument();
    const click = createInstanceEventSpec('onClick');
    if (!click) throw new Error('Expected onClick event port');
    node.instanceProps = {
      id: { displayName: 'ID', type: 'string', required: true },
      tabIndex: { displayName: 'Tab index', type: 'number', required: false },
    };
    node.props['id'] = literal('hero-title');
    node.props['tabIndex'] = literal(0);
    node.instanceEvents = { onClick: click };
    node.events['onClick'] = {
      kind: 'reference',
      symbolId: 'event_open',
      path: [],
    };
    document.publicProps['onOpen'] = {
      symbolId: 'event_open',
      name: 'onOpen',
      displayName: 'On open',
      valueType: 'event',
      eventSignature: { payload: null },
      required: false,
    };
    document.symbols['event_open'] = {
      id: 'event_open',
      name: 'onOpen',
      displayName: 'On open',
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: null },
      required: false,
    };

    expect(analyzeDocument(document, registry)).toEqual([]);
  });

  it('validates instance values, required declarations and recursive shapes', () => {
    const { document, node, registry } = elementDocument();
    node.instanceProps = {
      tabIndex: { displayName: 'Tab index', type: 'number', required: true },
      card: {
        displayName: 'Card',
        type: 'object',
        required: true,
        valueShape: {
          kind: 'object',
          fields: { title: { required: true, shape: { kind: 'string' } } },
          additionalProperties: false,
        },
      },
    };
    node.props['tabIndex'] = literal('first');
    node.props['card'] = literal({ title: 5 });

    expect(analyzeDocument(document, registry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'prop-type-mismatch',
          path: 'nodes.subject.props.tabIndex',
        }),
        expect.objectContaining({ code: 'value-shape-mismatch', path: 'nodes.subject.props.card' }),
      ]),
    );

    delete node.props['tabIndex'];
    expect(analyzeDocument(document, registry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing-required-prop',
          path: 'nodes.subject.props.tabIndex',
        }),
      ]),
    );
  });

  it('rejects reserved/raw event props and manifest declaration conflicts', () => {
    const { document, node, registry } = elementDocument();
    node.instanceProps = {
      style: { displayName: 'Unsafe style', type: 'object', required: false },
      onClick: { displayName: 'Raw click', type: 'unknown', required: false },
    };
    node.props['onMouseMove'] = literal('raw');

    const diagnostics = analyzeDocument(document, registry);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'unsafe-instance-prop',
          path: 'nodes.subject.instanceProps.style',
        }),
        expect.objectContaining({
          code: 'instance-prop-conflict',
          path: 'nodes.subject.instanceProps.style',
        }),
        expect.objectContaining({
          code: 'unsafe-instance-prop',
          path: 'nodes.subject.instanceProps.onClick',
        }),
        expect.objectContaining({
          code: 'unsafe-instance-prop',
          path: 'nodes.subject.props.onMouseMove',
        }),
      ]),
    );
  });

  it('rejects redefined manifest events and noncanonical normalized signatures', () => {
    const { document, node, registry } = elementDocument('sutra.button');
    const click = createInstanceEventSpec('onClick');
    const keyDown = createInstanceEventSpec('onKeyDown');
    if (!click || !keyDown) throw new Error('Expected normalized event ports');
    node.instanceEvents = {
      onClick: click,
      onKeyDown: { ...keyDown, signature: { payload: null } },
    };

    expect(analyzeDocument(document, registry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'instance-event-conflict',
          path: 'nodes.subject.instanceEvents.onClick',
        }),
        expect.objectContaining({
          code: 'invalid-instance-event',
          path: 'nodes.subject.instanceEvents.onKeyDown',
        }),
      ]),
    );
  });
});
