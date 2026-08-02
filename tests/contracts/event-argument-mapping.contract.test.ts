import { describe, expect, it } from 'vitest';

import {
  createBlankDocument,
  eventExpressionArgument,
  eventPayloadArgument,
  literal,
  validateUiDocument,
} from '@sutra/contracts';

describe('event argument mapping contract', () => {
  it('keeps legacy direct event references valid when no argument mapping exists', () => {
    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected element root');

    root.events['onClick'] = {
      kind: 'reference',
      symbolId: 'event_onClick',
      path: [],
    };

    expect(root.eventArguments).toBeUndefined();
    expect(validateUiDocument(document)).toMatchObject({ valid: true, errors: [] });
  });

  it('round-trips payload passthrough, literal and page-prop expression mappings', () => {
    const document = createBlankDocument();
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected element root');

    document.publicProps['count'] = {
      symbolId: 'prop_count',
      name: 'count',
      displayName: 'Count',
      valueType: 'number',
      required: false,
      defaultValue: 0,
    };
    document.symbols['prop_count'] = {
      id: 'prop_count',
      name: 'count',
      displayName: 'Count',
      provider: 'prop',
      valueType: 'number',
      required: false,
      defaultValue: 0,
    };

    root.events = {
      onChange: { kind: 'reference', symbolId: 'event_onChange', path: [] },
      onFixedCount: { kind: 'reference', symbolId: 'event_onFixedCount', path: [] },
      onCurrentCount: { kind: 'reference', symbolId: 'event_onCurrentCount', path: [] },
    };
    root.eventArguments = {
      onChange: eventPayloadArgument(),
      onFixedCount: eventExpressionArgument(literal(7)),
      onCurrentCount: eventExpressionArgument({
        kind: 'reference',
        symbolId: 'prop_count',
        path: [],
      }),
    };

    const reloaded: unknown = JSON.parse(JSON.stringify(document));
    const result = validateUiDocument(reloaded);

    expect(document.formatVersion).toBe(1);
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result.value).toEqual(document);
  });

  it('rejects malformed event argument mappings', () => {
    const document = createBlankDocument();
    const malformed = structuredClone(document) as unknown as {
      nodes: Record<
        string,
        {
          events: Record<string, unknown>;
          eventArguments: Record<string, unknown>;
        }
      >;
    };
    const root = malformed.nodes[document.rootNodeId]!;
    root.events['onClick'] = {
      kind: 'reference',
      symbolId: 'event_onClick',
      path: [],
    };
    root.eventArguments = {
      onClick: { kind: 'eventPayload', unexpected: true },
    };

    expect(validateUiDocument(malformed).valid).toBe(false);

    root.eventArguments = {
      onClick: { kind: 'expression' },
    };
    expect(validateUiDocument(malformed).valid).toBe(false);
  });
});
