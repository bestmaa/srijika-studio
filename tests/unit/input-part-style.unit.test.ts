import { describe, expect, it } from 'vitest';

import { srijikaInputPartStyle } from '@srijika/core-components';

describe('srijikaInputPartStyle', () => {
  it('accepts plain primitive CSS entries and removes executable or invalid values', () => {
    expect(
      srijikaInputPartStyle({
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
    expect(srijikaInputPartStyle(null)).toEqual({});
    expect(srijikaInputPartStyle(['color', 'red'])).toEqual({});
    expect(
      srijikaInputPartStyle(
        new (class StyleRecord {
          color = 'red';
        })(),
      ),
    ).toEqual({});

    const prototypeFree = Object.create(null) as Record<string, unknown>;
    prototypeFree['color'] = '#f8fafc';
    expect(srijikaInputPartStyle(prototypeFree)).toEqual({ color: '#f8fafc' });
  });
});
