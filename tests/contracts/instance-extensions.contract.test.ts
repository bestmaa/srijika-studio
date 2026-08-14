import { describe, expect, it } from 'vitest';

import {
  createBlankDocument,
  createInstanceEventSpec,
  literal,
  validateUiDocument,
} from '@srijika/contracts';

describe('instance extension contracts', () => {
  it('preserves format-1 documents that do not declare instance extensions', () => {
    const document = createBlankDocument('page_legacy_instance', 'Legacy instance');

    expect(validateUiDocument(JSON.parse(JSON.stringify(document)))).toMatchObject({
      valid: true,
      errors: [],
    });
  });

  it('round-trips typed instance props and normalized event ports', () => {
    const document = createBlankDocument('page_instance_extensions', 'Instance extensions');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page element');
    const click = createInstanceEventSpec('onClick');
    if (!click) throw new Error('Expected onClick catalog entry');

    root.instanceProps = {
      tabIndex: {
        displayName: 'Tab index',
        type: 'number',
        required: false,
      },
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
    root.props['tabIndex'] = literal(0);
    root.props['card'] = literal({ title: 'Hello' });
    root.instanceEvents = { onClick: click };

    const reloaded = JSON.parse(JSON.stringify(document)) as unknown;
    const result = validateUiDocument(reloaded);
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result.value?.nodes[document.rootNodeId]).toMatchObject({
      instanceProps: {
        tabIndex: { type: 'number' },
        card: { valueShape: { kind: 'object' } },
      },
      instanceEvents: { onClick: { source: 'click', signature: { payload: null } } },
    });
  });

  it('does not allow event callbacks to masquerade as instance data props', () => {
    const document = createBlankDocument('page_invalid_instance_prop', 'Invalid instance prop');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page element');
    root.instanceProps = {
      onUnsafe: {
        displayName: 'Unsafe',
        type: 'event',
        required: false,
      },
    } as never;

    expect(validateUiDocument(document).valid).toBe(false);
  });
});
