import { describe, expect, it } from 'vitest';

import {
  activeResponsiveBreakpointKeys,
  resolveResponsiveStyle,
  type StyleDeclaration,
} from '@sutra/contracts';

describe('responsive style resolution', () => {
  const declaration: StyleDeclaration = {
    base: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 24,
      padding: { top: 32, right: 32, bottom: 32, left: 32 },
    },
    breakpoints: {
      tablet: {
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 16,
      },
      mobile: {
        gridTemplateColumns: 'minmax(0, 1fr)',
        gap: 10,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
      },
      wide: {
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      },
    },
  };

  it('keeps source geometry at desktop and applies named overrides by viewport', () => {
    expect(resolveResponsiveStyle(declaration, 1180)).toMatchObject({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: 24,
    });
    expect(resolveResponsiveStyle(declaration, 800)).toMatchObject({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 16,
    });
    expect(resolveResponsiveStyle(declaration, 390)).toMatchObject({
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 10,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
    });
    expect(resolveResponsiveStyle(declaration, 1600)).toMatchObject({
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      gap: 24,
    });
  });

  it('cascades broad max-width rules before narrower rules', () => {
    expect(activeResponsiveBreakpointKeys(declaration, 390)).toEqual(['tablet', 'mobile']);
  });

  it('supports numeric, compact and CSS-style custom breakpoint keys', () => {
    const custom: StyleDeclaration = {
      base: { gap: 30, flexDirection: 'row' },
      breakpoints: {
        '1200': { gap: 24 },
        'max:720': { gap: 12, flexDirection: 'column' },
        '@media (min-width: 1600px)': { gap: 40 },
        unsupported: { gap: 999 },
      },
    };

    expect(resolveResponsiveStyle(custom, 680)).toMatchObject({ gap: 12, flexDirection: 'column' });
    expect(resolveResponsiveStyle(custom, 900)).toMatchObject({ gap: 24, flexDirection: 'row' });
    expect(resolveResponsiveStyle(custom, 1700)).toMatchObject({ gap: 40, flexDirection: 'row' });
  });

  it('does not mutate base or breakpoint styles while resolving', () => {
    const snapshot = structuredClone(declaration);
    const resolved = resolveResponsiveStyle(declaration, 390);
    resolved.gap = 999;
    expect(declaration).toEqual(snapshot);
  });
});
