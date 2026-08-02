import { describe, expect, it } from 'vitest';

import { sutraStyle } from '@sutra/react-renderer';

describe('sutraStyle', () => {
  it('rejects values that are not style objects', () => {
    expect(sutraStyle(null)).toEqual({});
    expect(sutraStyle('color: red')).toEqual({});
    expect(sutraStyle([{ color: 'red' }])).toEqual({});
  });

  it('keeps supported primitive CSS values and removes everything else', () => {
    const externalStyle = JSON.parse(
      '{"backgroundColor":"#fff7ed","borderWidth":2,"boxShadow":"0 4px 12px #0002","backgroundImage":"url(https://example.test/a.png)","unknownProperty":"bad","color":{"nested":true},"__proto__":{"polluted":true}}',
    ) as unknown;

    expect(sutraStyle(externalStyle)).toEqual({
      backgroundColor: '#fff7ed',
      backgroundImage: 'url(https://example.test/a.png)',
      borderWidth: 2,
      boxShadow: '0 4px 12px #0002',
    });
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});
