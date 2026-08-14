import { describe, expect, it } from 'vitest';

import { createBlankDocument, type PublicProp, type ValueShape } from '@srijika/contracts';
import { assertDocumentSemantics } from '@srijika/component-registry';
import { createCoreComponentRegistry } from '@srijika/core-components';
import { DocumentHistory, applyCommand } from '@srijika/document-engine';

const profileShape: ValueShape = {
  kind: 'object',
  fields: {
    profile: {
      required: true,
      shape: {
        kind: 'object',
        fields: {
          displayName: { required: true, shape: { kind: 'string' } },
          tags: {
            required: false,
            shape: {
              kind: 'array',
              item: {
                kind: 'object',
                fields: {
                  label: { required: true, shape: { kind: 'string' } },
                },
                additionalProperties: false,
              },
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

function objectProp(valueShape: ValueShape): PublicProp {
  return {
    symbolId: 'prop_data',
    name: 'data',
    displayName: 'Data',
    valueType: 'object',
    valueShape,
    required: true,
  };
}

describe('public prop value-shape commands', () => {
  it('mirrors recursive shapes on add, update, clear, undo and redo', () => {
    const original = createBlankDocument('page_shapes', 'Shapes');
    const added = applyCommand(original, {
      kind: 'addPublicProp',
      prop: objectProp(profileShape),
    }).document;

    expect(added.publicProps['data']?.valueShape).toEqual(profileShape);
    expect(added.symbols['prop_data']?.valueShape).toEqual(profileShape);
    expect(added.symbols['prop_data']?.valueShape).not.toBe(added.publicProps['data']?.valueShape);

    const updatedShape: ValueShape = {
      kind: 'object',
      fields: {
        items: {
          required: true,
          shape: { kind: 'array', item: profileShape },
        },
      },
      additionalProperties: false,
    };
    const history = new DocumentHistory(added);
    const updated = history.dispatch({
      kind: 'setPublicPropShape',
      propName: 'data',
      valueShape: updatedShape,
    });

    expect(updated.publicProps['data']?.valueShape).toEqual(updatedShape);
    expect(updated.symbols['prop_data']?.valueShape).toEqual(updatedShape);
    expect(history.undo()).toEqual(added);
    expect(history.redo()).toEqual(updated);

    const cleared = history.dispatch({
      kind: 'setPublicPropShape',
      propName: 'data',
      valueShape: null,
    });
    expect(cleared.publicProps['data']).not.toHaveProperty('valueShape');
    expect(cleared.symbols['prop_data']).not.toHaveProperty('valueShape');
  });

  it('rejects a shape update that invalidates a referenced path without changing history', () => {
    const registry = createCoreComponentRegistry();
    const referencedShape: ValueShape = {
      kind: 'object',
      fields: {
        profile: {
          required: true,
          shape: {
            kind: 'object',
            fields: {
              isVisible: { required: true, shape: { kind: 'boolean' } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };

    let document = applyCommand(createBlankDocument('page_validation', 'Validation'), {
      kind: 'addPublicProp',
      prop: objectProp(referencedShape),
    }).document;
    document = applyCommand(document, {
      kind: 'setVisibility',
      nodeId: document.rootNodeId,
      value: {
        kind: 'reference',
        symbolId: 'prop_data',
        path: ['profile', 'isVisible'],
      },
    }).document;

    const validate = (candidate: typeof document): void =>
      assertDocumentSemantics(candidate, registry);
    const history = new DocumentHistory(document, { validate });

    expect(() =>
      history.dispatch({
        kind: 'setPublicPropShape',
        propName: 'data',
        valueShape: {
          kind: 'object',
          fields: {
            profile: {
              required: true,
              shape: {
                kind: 'object',
                fields: {
                  displayName: { required: true, shape: { kind: 'string' } },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      }),
    ).toThrow(/Invalid data reference: Object shape has no field named isVisible/);

    expect(history.document).toEqual(document);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('rejects updates for missing props or missing mirrored symbols', () => {
    const document = createBlankDocument('page_missing', 'Missing');
    expect(() =>
      applyCommand(document, {
        kind: 'setPublicPropShape',
        propName: 'missing',
        valueShape: profileShape,
      }),
    ).toThrow(/Public prop missing does not exist/);

    const broken = applyCommand(document, {
      kind: 'addPublicProp',
      prop: objectProp(profileShape),
    }).document;
    delete broken.symbols['prop_data'];
    expect(() =>
      applyCommand(broken, {
        kind: 'setPublicPropShape',
        propName: 'data',
        valueShape: null,
      }),
    ).toThrow(/has no mirrored symbol prop_data/);
  });
});
