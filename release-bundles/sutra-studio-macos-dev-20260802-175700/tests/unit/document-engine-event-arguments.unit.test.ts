import { describe, expect, it } from 'vitest';

import {
  eventExpressionArgument,
  eventPayloadArgument,
  literal,
  type PublicProp,
} from '@sutra/contracts';
import { applyCommand, DocumentHistory, validateDocumentGraph } from '@sutra/document-engine';

import { createEngineDocument } from '../helpers/documents';

const handler = (symbolId = 'event_onCount') => ({
  kind: 'reference' as const,
  symbolId,
  path: [],
});

describe('document event argument commands', () => {
  it('sets, replaces and removes a handler with its single argument atomically', () => {
    const original = createEngineDocument();
    const literalArgument = eventExpressionArgument(literal(5));

    const mapped = applyCommand(original, {
      kind: 'setEventBinding',
      nodeId: original.rootNodeId,
      eventName: 'onClick',
      handler: handler(),
      argument: literalArgument,
    }).document;

    expect(original.revision).toBe(0);
    expect(original.nodes[original.rootNodeId]).not.toHaveProperty('eventArguments');
    expect(mapped.revision).toBe(1);
    expect(mapped.nodes[mapped.rootNodeId]).toMatchObject({
      events: { onClick: handler() },
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: literal(5),
        },
      },
    });
    const mappedRoot = mapped.nodes[mapped.rootNodeId];
    if (!mappedRoot || mappedRoot.kind !== 'element') throw new Error('Expected element root');
    expect(mappedRoot.eventArguments?.['onClick']).not.toBe(literalArgument);

    const passthrough = applyCommand(mapped, {
      kind: 'setEventBinding',
      nodeId: mapped.rootNodeId,
      eventName: 'onClick',
      handler: handler(),
      argument: eventPayloadArgument(),
    }).document;
    expect(passthrough.nodes[passthrough.rootNodeId]).toMatchObject({
      eventArguments: { onClick: { kind: 'eventPayload' } },
    });

    const unbound = applyCommand(passthrough, {
      kind: 'setEventBinding',
      nodeId: passthrough.rootNodeId,
      eventName: 'onClick',
      handler: null,
      argument: null,
    }).document;
    expect(unbound.nodes[unbound.rootNodeId]).toMatchObject({ events: {} });
    expect(unbound.nodes[unbound.rootNodeId]).not.toHaveProperty('eventArguments');
    expect(validateDocumentGraph(unbound)).toEqual([]);
  });

  it('rejects an argument without a handler without mutating the source document', () => {
    const document = createEngineDocument();
    const snapshot = structuredClone(document);

    expect(() =>
      applyCommand(document, {
        kind: 'setEventBinding',
        nodeId: document.rootNodeId,
        eventName: 'onClick',
        handler: null,
        argument: eventExpressionArgument(literal(3)),
      }),
    ).toThrow(/argument cannot be set without an event handler/);
    expect(document).toEqual(snapshot);
  });

  it('makes the legacy setEvent command clear stale argument mappings', () => {
    const document = applyCommand(createEngineDocument(), {
      kind: 'setEventBinding',
      nodeId: 'root',
      eventName: 'onClick',
      handler: handler('event_first'),
      argument: eventExpressionArgument(literal(4)),
    }).document;

    const replaced = applyCommand(document, {
      kind: 'setEvent',
      nodeId: document.rootNodeId,
      eventName: 'onClick',
      value: handler('event_second'),
    }).document;

    expect(replaced.nodes[replaced.rootNodeId]).toMatchObject({
      events: { onClick: handler('event_second') },
    });
    expect(replaced.nodes[replaced.rootNodeId]).not.toHaveProperty('eventArguments');
  });

  it('protects page props referenced by event argument expressions', () => {
    const countProp: PublicProp = {
      symbolId: 'prop_count',
      name: 'count',
      displayName: 'Count',
      valueType: 'number',
      required: false,
      defaultValue: 0,
    };
    const withCount = applyCommand(createEngineDocument(), {
      kind: 'addPublicProp',
      prop: countProp,
    }).document;
    const mapped = applyCommand(withCount, {
      kind: 'setEventBinding',
      nodeId: withCount.rootNodeId,
      eventName: 'onClick',
      handler: handler(),
      argument: eventExpressionArgument({
        kind: 'reference',
        symbolId: countProp.symbolId,
        path: [],
      }),
    }).document;

    expect(() =>
      applyCommand(mapped, {
        kind: 'removePublicProp',
        propName: countProp.name,
      }),
    ).toThrow(/is still referenced by the document/);
  });

  it('restores the complete handler and argument mapping through undo and redo', () => {
    const original = createEngineDocument();
    const history = new DocumentHistory(original);
    const updated = history.dispatch({
      kind: 'setEventBinding',
      nodeId: original.rootNodeId,
      eventName: 'onClick',
      handler: handler(),
      argument: eventExpressionArgument(literal(9)),
    });

    expect(history.undo()).toEqual(original);
    expect(history.redo()).toEqual(updated);
  });

  it('reports persisted arguments whose event handler is missing', () => {
    const document = createEngineDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected element root');
    root.eventArguments = {
      onClick: eventExpressionArgument(literal(1)),
    };

    expect(validateDocumentGraph(document)).toContainEqual({
      code: 'orphan-event-argument',
      message: `Element ${root.id} has an argument for unbound event onClick`,
      nodeId: root.id,
    });
  });
});
