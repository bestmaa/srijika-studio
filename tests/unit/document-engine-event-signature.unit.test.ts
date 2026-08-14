import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@srijika/component-registry';
import { createCoreComponentRegistry } from '@srijika/core-components';
import {
  createBlankDocument,
  createElementNode,
  type EventSignature,
  type PublicProp,
  type UiDocument,
} from '@srijika/contracts';
import { applyCommand, DocumentHistory } from '@srijika/document-engine';

function eventProp(
  name = 'onSubmit',
  eventSignature: EventSignature = { payload: null },
): PublicProp {
  return {
    symbolId: `event_${name}`,
    name,
    displayName: name,
    valueType: 'event',
    eventSignature,
    required: false,
  };
}

function dataProp(name = 'title'): PublicProp {
  return {
    symbolId: `prop_${name}`,
    name,
    displayName: name,
    valueType: 'string',
    required: false,
    defaultValue: 'Srijika',
  };
}

function addPublicProp(document: UiDocument, prop: PublicProp): UiDocument {
  return applyCommand(document, { kind: 'addPublicProp', prop }).document;
}

describe('document event signatures', () => {
  it('mirrors signatures when adding events and rejects data metadata on event props', () => {
    const signature: EventSignature = {
      payload: { name: 'value', shape: { kind: 'string' } },
    };
    const document = addPublicProp(createBlankDocument(), eventProp('onChange', signature));
    const prop = document.publicProps['onChange'];
    const symbol = document.symbols['event_onChange'];

    expect(prop?.eventSignature).toEqual(signature);
    expect(symbol).toMatchObject({
      provider: 'event',
      valueType: 'event',
      eventSignature: signature,
    });
    expect(prop?.eventSignature).not.toBe(symbol?.eventSignature);
    expect(() =>
      applyCommand(document, {
        kind: 'setPublicPropDefaultValue',
        propName: 'onChange',
        value: 'invalid',
      }),
    ).toThrow(/Event prop onChange cannot define a default value/);
    expect(() =>
      applyCommand(document, {
        kind: 'setPublicPropShape',
        propName: 'onChange',
        valueShape: { kind: 'string' },
      }),
    ).toThrow(/Event prop onChange cannot define a value shape/);
  });

  it('updates mirrored signatures atomically and supports undo and redo', () => {
    const original = addPublicProp(createBlankDocument(), eventProp());
    const history = new DocumentHistory(original);
    const signature: EventSignature = {
      payload: {
        name: 'submission',
        shape: {
          kind: 'object',
          additionalProperties: false,
          fields: {
            id: { required: true, shape: { kind: 'string' } },
          },
        },
      },
    };

    const updated = history.dispatch({
      kind: 'setPublicPropEventSignature',
      propName: 'onSubmit',
      eventSignature: signature,
    });

    expect(updated.publicProps['onSubmit']?.eventSignature).toEqual(signature);
    expect(updated.symbols['event_onSubmit']?.eventSignature).toEqual(signature);
    expect(updated.publicProps['onSubmit']?.eventSignature).not.toBe(
      updated.symbols['event_onSubmit']?.eventSignature,
    );
    expect(history.undo()).toEqual(original);
    expect(history.redo()).toEqual(updated);
  });

  it('rejects signature updates for data props and missing mirrored symbols', () => {
    const dataDocument = addPublicProp(createBlankDocument(), dataProp());
    expect(() =>
      applyCommand(dataDocument, {
        kind: 'setPublicPropEventSignature',
        propName: 'title',
        eventSignature: { payload: null },
      }),
    ).toThrow(/Public prop title is not an event prop/);

    const brokenEventDocument = addPublicProp(createBlankDocument(), eventProp());
    delete brokenEventDocument.symbols['event_onSubmit'];
    expect(() =>
      applyCommand(brokenEventDocument, {
        kind: 'setPublicPropEventSignature',
        propName: 'onSubmit',
        eventSignature: { payload: null },
      }),
    ).toThrow(/has no mirrored symbol event_onSubmit/);
  });

  it('converts unbound data and event ports atomically with reversible metadata', () => {
    const original = addPublicProp(createBlankDocument(), dataProp());
    const history = new DocumentHistory(original);

    const asEvent = history.dispatch({
      kind: 'setPublicPropType',
      propName: 'title',
      valueType: 'event',
    });
    expect(asEvent.publicProps['title']).toMatchObject({
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(asEvent.publicProps['title']).not.toHaveProperty('defaultValue');
    expect(asEvent.publicProps['title']).not.toHaveProperty('valueShape');
    expect(asEvent.symbols['prop_title']).toMatchObject({
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(asEvent.publicProps['title']?.eventSignature).not.toBe(
      asEvent.symbols['prop_title']?.eventSignature,
    );

    const asObject = history.dispatch({
      kind: 'setPublicPropType',
      propName: 'title',
      valueType: 'object',
    });
    expect(asObject.publicProps['title']).toMatchObject({
      valueType: 'object',
      defaultValue: {},
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
    });
    expect(asObject.publicProps['title']).not.toHaveProperty('eventSignature');
    expect(asObject.symbols['prop_title']).toMatchObject({
      provider: 'prop',
      valueType: 'object',
      defaultValue: {},
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
    });
    expect(asObject.symbols['prop_title']).not.toHaveProperty('eventSignature');
    expect(history.undo()).toEqual(asEvent);
    expect(history.redo()).toEqual(asObject);
  });

  it('rejects bound cross-category conversions, including nested references', () => {
    const registry = createCoreComponentRegistry();
    const validate = (document: UiDocument): void => assertDocumentSemantics(document, registry);

    const dataDocument = addPublicProp(createBlankDocument(), dataProp());
    const dataRoot = dataDocument.nodes[dataDocument.rootNodeId];
    if (!dataRoot || dataRoot.kind !== 'element') throw new Error('Expected element root');
    const text = createElementNode('bound_text', 'srijika.text', 'Bound text', {
      props: {
        text: {
          kind: 'template',
          parts: ['Title: ', { kind: 'reference', symbolId: 'prop_title', path: [] }],
        },
      },
      slots: {},
    });
    dataRoot.slots['children'] = [text.id];
    dataDocument.nodes[text.id] = text;
    const dataHistory = new DocumentHistory(dataDocument, { validate });

    expect(() =>
      dataHistory.dispatch({
        kind: 'setPublicPropType',
        propName: 'title',
        valueType: 'event',
      }),
    ).toThrow(/is still bound/);
    expect(dataHistory.document.publicProps['title']?.valueType).toBe('string');

    const eventDocument = addPublicProp(createBlankDocument(), eventProp());
    const eventRoot = eventDocument.nodes[eventDocument.rootNodeId];
    if (!eventRoot || eventRoot.kind !== 'element') throw new Error('Expected element root');
    const button = createElementNode('bound_button', 'srijika.button', 'Bound button', {
      props: { label: { kind: 'literal', value: 'Submit' } },
      events: {
        onClick: { kind: 'reference', symbolId: 'event_onSubmit', path: [] },
      },
      slots: {},
    });
    eventRoot.slots['children'] = [button.id];
    eventDocument.nodes[button.id] = button;
    const eventHistory = new DocumentHistory(eventDocument, { validate });

    expect(() =>
      eventHistory.dispatch({
        kind: 'setPublicPropType',
        propName: 'onSubmit',
        valueType: 'string',
      }),
    ).toThrow(/is still bound/);
    expect(eventHistory.document.publicProps['onSubmit']?.valueType).toBe('event');
  });
});
