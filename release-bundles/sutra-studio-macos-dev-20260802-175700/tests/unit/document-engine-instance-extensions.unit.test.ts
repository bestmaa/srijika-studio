import { describe, expect, it } from 'vitest';

import { createInstanceEventSpec, literal } from '@sutra/contracts';
import { applyCommand } from '@sutra/document-engine';

import { createEngineDocument } from '../helpers/documents';

const stringProp = {
  displayName: 'Title',
  type: 'string',
  required: false,
} as const;

describe('instance extension document commands', () => {
  it('adds, updates and removes a typed prop atomically with its value', () => {
    const document = createEngineDocument();
    const added = applyCommand(document, {
      kind: 'addInstanceProp',
      nodeId: document.rootNodeId,
      propName: 'title',
      spec: stringProp,
      value: literal('Welcome'),
    }).document;

    expect(added.nodes[document.rootNodeId]).toMatchObject({
      instanceProps: { title: stringProp },
      props: { title: literal('Welcome') },
    });
    expect(document.nodes[document.rootNodeId]).not.toHaveProperty('instanceProps');

    const updated = applyCommand(added, {
      kind: 'updateInstanceProp',
      nodeId: document.rootNodeId,
      propName: 'title',
      nextPropName: 'tabIndex',
      spec: { displayName: 'Tab index', type: 'number', required: true },
      value: literal(3),
    }).document;
    expect(updated.nodes[document.rootNodeId]).toMatchObject({
      instanceProps: { tabIndex: { type: 'number', required: true } },
      props: { tabIndex: literal(3) },
    });
    expect(updated.nodes[document.rootNodeId]).not.toHaveProperty('props.title');

    const removed = applyCommand(updated, {
      kind: 'removeInstanceProp',
      nodeId: document.rootNodeId,
      propName: 'tabIndex',
    }).document;
    expect(removed.nodes[document.rootNodeId]).not.toHaveProperty('instanceProps');
    expect(removed.nodes[document.rootNodeId]).not.toHaveProperty('props.tabIndex');
  });

  it('rejects reserved/raw event prop names and inconsistent value shapes', () => {
    const document = createEngineDocument();
    for (const propName of [
      'children',
      'style',
      'className',
      'key',
      'ref',
      'dangerouslySetInnerHTML',
      'onClick',
    ]) {
      expect(() =>
        applyCommand(document, {
          kind: 'addInstanceProp',
          nodeId: document.rootNodeId,
          propName,
          spec: stringProp,
          value: null,
        }),
      ).toThrow(/reserved|raw event/);
    }

    expect(() =>
      applyCommand(document, {
        kind: 'addInstanceProp',
        nodeId: document.rootNodeId,
        propName: 'config',
        spec: {
          displayName: 'Config',
          type: 'object',
          required: false,
          valueShape: { kind: 'string' },
        },
        value: null,
      }),
    ).toThrow(/shape/);
  });

  it('renames and removes normalized event ports without leaving stale bindings', () => {
    const document = createEngineDocument();
    const click = createInstanceEventSpec('onClick');
    const doubleClick = createInstanceEventSpec('onDoubleClick');
    if (!click || !doubleClick) throw new Error('Expected event catalog entries');

    let current = applyCommand(document, {
      kind: 'addInstanceEvent',
      nodeId: document.rootNodeId,
      eventName: 'onClick',
      spec: click,
    }).document;
    current = applyCommand(current, {
      kind: 'setEventBinding',
      nodeId: document.rootNodeId,
      eventName: 'onClick',
      handler: { kind: 'reference', symbolId: 'event_open', path: [] },
      argument: { kind: 'expression', expression: literal(5) },
    }).document;
    current = applyCommand(current, {
      kind: 'updateInstanceEvent',
      nodeId: document.rootNodeId,
      eventName: 'onClick',
      nextEventName: 'onDoubleClick',
      spec: doubleClick,
    }).document;

    expect(current.nodes[document.rootNodeId]).toMatchObject({
      instanceEvents: { onDoubleClick: { source: 'doubleClick' } },
      events: { onDoubleClick: { symbolId: 'event_open' } },
      eventArguments: { onDoubleClick: { kind: 'expression' } },
    });

    const removed = applyCommand(current, {
      kind: 'removeInstanceEvent',
      nodeId: document.rootNodeId,
      eventName: 'onDoubleClick',
    }).document;
    expect(removed.nodes[document.rootNodeId]).not.toHaveProperty('instanceEvents');
    expect(removed.nodes[document.rootNodeId]).not.toHaveProperty('events.onDoubleClick');
    expect(removed.nodes[document.rootNodeId]).not.toHaveProperty('eventArguments.onDoubleClick');
  });

  it('rejects event names or signatures outside the normalized catalog', () => {
    const document = createEngineDocument();
    const click = createInstanceEventSpec('onClick');
    if (!click) throw new Error('Expected event catalog entry');

    expect(() =>
      applyCommand(document, {
        kind: 'addInstanceEvent',
        nodeId: document.rootNodeId,
        eventName: 'onPointerMove',
        spec: click,
      }),
    ).toThrow(/approved normalized/);
    expect(() =>
      applyCommand(document, {
        kind: 'addInstanceEvent',
        nodeId: document.rootNodeId,
        eventName: 'onClick',
        spec: {
          ...click,
          signature: { payload: { name: 'nativeEvent', shape: { kind: 'unknown' } } },
        },
      }),
    ).toThrow(/approved normalized/);
  });
});
