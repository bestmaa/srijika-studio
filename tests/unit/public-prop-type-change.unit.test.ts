import { describe, expect, it } from 'vitest';

import {
  createBlankDocument,
  createElementNode,
  type PublicProp,
  type ValueShape,
  type ValueType,
} from '@sutra/contracts';
import { applyCommand, DocumentHistory } from '@sutra/document-engine';

function publicProp(
  name: string,
  valueType: ValueType,
  options: { defaultValue?: PublicProp['defaultValue']; valueShape?: ValueShape } = {},
): PublicProp {
  return {
    symbolId: `prop_${name}`,
    name,
    displayName: name,
    valueType,
    required: false,
    ...options,
  };
}

describe('public prop type-change command', () => {
  it('synchronizes type, default and shape while remaining reversible', () => {
    const profileShape: ValueShape = {
      kind: 'object',
      fields: { name: { required: true, shape: { kind: 'string' } } },
      additionalProperties: false,
    };
    const blank = createBlankDocument('page_type_change', 'Type Change');
    const withProfile = applyCommand(blank, {
      kind: 'addPublicProp',
      prop: publicProp('profile', 'object', {
        defaultValue: { name: 'Ada' },
        valueShape: profileShape,
      }),
    }).document;
    const history = new DocumentHistory(withProfile);

    const asArray = history.dispatch({
      kind: 'setPublicPropType',
      propName: 'profile',
      valueType: 'array',
    });
    expect(asArray.publicProps['profile']).toMatchObject({
      valueType: 'array',
      defaultValue: [],
      valueShape: { kind: 'array', item: { kind: 'unknown' } },
    });
    expect(asArray.symbols['prop_profile']).toMatchObject({
      provider: 'prop',
      valueType: 'array',
      defaultValue: [],
      valueShape: { kind: 'array', item: { kind: 'unknown' } },
    });
    expect(asArray.publicProps['profile']?.valueShape).not.toBe(
      asArray.symbols['prop_profile']?.valueShape,
    );
    expect(asArray.publicProps['profile']?.defaultValue).not.toBe(
      asArray.symbols['prop_profile']?.defaultValue,
    );

    const asNumber = history.dispatch({
      kind: 'setPublicPropType',
      propName: 'profile',
      valueType: 'number',
    });
    expect(asNumber.publicProps['profile']).toMatchObject({ valueType: 'number', defaultValue: 0 });
    expect(asNumber.publicProps['profile']).not.toHaveProperty('valueShape');
    expect(asNumber.symbols['prop_profile']).toMatchObject({
      valueType: 'number',
      defaultValue: 0,
    });
    expect(asNumber.symbols['prop_profile']).not.toHaveProperty('valueShape');
    expect(history.undo()).toEqual(asArray);
    expect(history.redo()).toEqual(asNumber);

    const asObject = history.dispatch({
      kind: 'setPublicPropType',
      propName: 'profile',
      valueType: 'object',
    });
    expect(asObject.publicProps['profile']).toMatchObject({
      valueType: 'object',
      defaultValue: {},
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
    });
    expect(asObject.symbols['prop_profile']?.valueShape).toEqual(
      asObject.publicProps['profile']?.valueShape,
    );

    const asUnknown = history.dispatch({
      kind: 'setPublicPropType',
      propName: 'profile',
      valueType: 'unknown',
    });
    expect(asUnknown.publicProps['profile']).toMatchObject({ valueType: 'unknown' });
    expect(asUnknown.publicProps['profile']).not.toHaveProperty('defaultValue');
    expect(asUnknown.publicProps['profile']).not.toHaveProperty('valueShape');
    expect(asUnknown.symbols['prop_profile']).toMatchObject({
      provider: 'prop',
      valueType: 'unknown',
    });
    expect(asUnknown.symbols['prop_profile']).not.toHaveProperty('defaultValue');
    expect(asUnknown.symbols['prop_profile']).not.toHaveProperty('valueShape');
  });

  it('converts event and data ports while rejecting missing canonical records', () => {
    const blank = createBlankDocument('page_event_type', 'Event Type');
    const withEvent = applyCommand(blank, {
      kind: 'addPublicProp',
      prop: publicProp('onSave', 'event'),
    }).document;
    const eventAsString = applyCommand(withEvent, {
      kind: 'setPublicPropType',
      propName: 'onSave',
      valueType: 'string',
    }).document;
    expect(eventAsString.publicProps['onSave']).toMatchObject({
      valueType: 'string',
      defaultValue: '',
    });
    expect(eventAsString.publicProps['onSave']).not.toHaveProperty('eventSignature');
    expect(eventAsString.symbols['prop_onSave']).toMatchObject({
      provider: 'prop',
      valueType: 'string',
      defaultValue: '',
    });

    const withData = applyCommand(blank, {
      kind: 'addPublicProp',
      prop: publicProp('title', 'string', { defaultValue: '' }),
    }).document;
    const dataAsEvent = applyCommand(withData, {
      kind: 'setPublicPropType',
      propName: 'title',
      valueType: 'event',
    }).document;
    expect(dataAsEvent.publicProps['title']).toMatchObject({
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(dataAsEvent.publicProps['title']).not.toHaveProperty('defaultValue');
    expect(dataAsEvent.symbols['prop_title']).toMatchObject({
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(() =>
      applyCommand(blank, {
        kind: 'setPublicPropType',
        propName: 'missing',
        valueType: 'number',
      }),
    ).toThrow(/Public prop missing does not exist/);

    const missingSymbol = structuredClone(withData);
    delete missingSymbol.symbols['prop_title'];
    expect(() =>
      applyCommand(missingSymbol, {
        kind: 'setPublicPropType',
        propName: 'title',
        valueType: 'number',
      }),
    ).toThrow(/has no mirrored symbol prop_title/);
  });

  it('rejects a primitive target when a nested path still references the prop', () => {
    const document = createBlankDocument('page_nested_type', 'Nested Type');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    const profile = publicProp('profile', 'object', {
      defaultValue: {},
      valueShape: {
        kind: 'object',
        fields: { label: { required: true, shape: { kind: 'string' } } },
        additionalProperties: false,
      },
    });
    let withReference = applyCommand(document, { kind: 'addPublicProp', prop: profile }).document;
    const text = createElementNode('price_text', 'sutra.text', 'Price text', {
      props: {
        text: { kind: 'reference', symbolId: profile.symbolId, path: ['label'] },
      },
      slots: {},
    });
    withReference = applyCommand(withReference, {
      kind: 'insertNode',
      parentId: withReference.rootNodeId,
      slot: 'children',
      index: 0,
      node: text,
    }).document;

    expect(() =>
      applyCommand(withReference, {
        kind: 'setPublicPropType',
        propName: 'profile',
        valueType: 'string',
      }),
    ).toThrow(/nested references that are incompatible with string/);
    expect(withReference.publicProps['profile']?.valueType).toBe('object');
  });
});
