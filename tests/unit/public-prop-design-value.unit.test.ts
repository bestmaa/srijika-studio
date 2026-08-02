import { describe, expect, it } from 'vitest';

import { createBlankDocument, type PublicProp } from '@sutra/contracts';
import { applyCommand, DocumentHistory } from '@sutra/document-engine';

const settingsProp: PublicProp = {
  symbolId: 'prop_settings',
  name: 'settings',
  displayName: 'Settings',
  valueType: 'object',
  valueShape: { kind: 'object', fields: {}, additionalProperties: true },
  required: false,
  defaultValue: {},
};

describe('public prop design-value command', () => {
  it('mirrors a literal design value and remains reversible through history', () => {
    const blank = createBlankDocument('page_design_values', 'Design Values Page');
    const withProp = applyCommand(blank, { kind: 'addPublicProp', prop: settingsProp }).document;
    const history = new DocumentHistory(withProp);
    const designValue = { currency: 'INR', featured: true };

    const updated = history.dispatch({
      kind: 'setPublicPropDefaultValue',
      propName: 'settings',
      value: designValue,
    });

    expect(updated.publicProps['settings']?.defaultValue).toEqual(designValue);
    expect(updated.symbols['prop_settings']?.defaultValue).toEqual(designValue);
    expect(updated.publicProps['settings']?.defaultValue).not.toBe(
      updated.symbols['prop_settings']?.defaultValue,
    );
    expect(history.undo()).toEqual(withProp);
    expect(history.redo()).toEqual(updated);
  });

  it('rejects missing public props and missing mirrored symbols without mutating the source', () => {
    const blank = createBlankDocument('page_missing_design_value', 'Design Values Page');
    expect(() =>
      applyCommand(blank, {
        kind: 'setPublicPropDefaultValue',
        propName: 'missing',
        value: 'sample',
      }),
    ).toThrow(/Public prop missing does not exist/);

    const broken = applyCommand(blank, { kind: 'addPublicProp', prop: settingsProp }).document;
    delete broken.symbols['prop_settings'];
    const before = structuredClone(broken);
    expect(() =>
      applyCommand(broken, {
        kind: 'setPublicPropDefaultValue',
        propName: 'settings',
        value: { currency: 'INR' },
      }),
    ).toThrow(/has no mirrored symbol prop_settings/);
    expect(broken).toEqual(before);
  });
});
