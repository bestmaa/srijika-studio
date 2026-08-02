import { describe, expect, it } from 'vitest';

import { sutraInputPartStyle } from '@sutra/core-components';

describe('sutraInputPartStyle', () => {
  it('accepts plain primitive CSS entries and removes executable or invalid values', () => {
    expect(
      sutraInputPartStyle({
        backgroundColor: '#10141d',
        borderRadius: 12,
        opacity: Number.NaN,
        nested: { color: 'red' },
        onClick: () => undefined,
        constructor: 'unsafe',
      }),
    ).toEqual({ backgroundColor: '#10141d', borderRadius: 12 });
  });

  it('rejects non-plain containers but accepts prototype-free JSON records', () => {
    expect(sutraInputPartStyle(null)).toEqual({});
    expect(sutraInputPartStyle(['color', 'red'])).toEqual({});
    expect(
      sutraInputPartStyle(
        new (class StyleRecord {
          color = 'red';
        })(),
      ),
    ).toEqual({});

    const prototypeFree = Object.create(null) as Record<string, unknown>;
    prototypeFree['color'] = '#f8fafc';
    expect(sutraInputPartStyle(prototypeFree)).toEqual({ color: '#f8fafc' });
  });
});
