import { describe, expect, it } from 'vitest';

import {
  SRIJIKA_THEME_COLORS,
  cloneDefaultAppearance,
  createAppearanceExport,
  createAppearanceTokens,
  createCanvasEditorTokens,
  normalizeAppearancePreferences,
  normalizeHexColor,
  parseAppearanceExport,
  resolveColorScheme,
} from '../../apps/studio/src/lib/appearance';

describe('Studio appearance model', () => {
  it('uses the neutral Srijika palette and dark mode by default', () => {
    const appearance = cloneDefaultAppearance();

    expect(appearance.mode).toBe('dark');
    expect(appearance.preset).toBe('srijika');
    expect(appearance.themes.dark).toEqual({
      accent: '#77767b',
      background: '#111111',
      foreground: '#fcfcfc',
    });
    expect(appearance.themes.light.accent).toBe('#77767b');
    expect(createAppearanceTokens(appearance, 'dark')['--chrome-accent']).toBe('#77767b');
    expect(createCanvasEditorTokens(appearance, 'dark')['--srijika-editor-accent']).toBe('#77767b');
    expect(appearance.contrast).toBe(49);
    expect(appearance.translucentSidebar).toBe(true);
  });

  it('normalizes partial or malformed persisted values without accepting invalid colors', () => {
    const appearance = normalizeAppearancePreferences({
      mode: 'unknown',
      preset: 'custom',
      contrast: 900,
      uiFont: '',
      themes: {
        dark: { accent: '#abc', background: 'purple', foreground: '#EFEFEF' },
      },
    });

    expect(appearance.mode).toBe('dark');
    expect(appearance.contrast).toBe(100);
    expect(appearance.themes.dark).toEqual({
      accent: '#aabbcc',
      background: SRIJIKA_THEME_COLORS.dark.background,
      foreground: '#efefef',
    });
    expect(normalizeHexColor('#09c')).toBe('#0099cc');
    expect(normalizeHexColor('rgb(1, 2, 3)')).toBeNull();
  });

  it('migrates the former built-in preset and blue accent to the current Srijika default', () => {
    const appearance = normalizeAppearancePreferences({
      version: 1,
      mode: 'dark',
      preset: 'codex',
      themes: {
        dark: { accent: '#0169cc', background: '#111111', foreground: '#fcfcfc' },
        light: { accent: '#0169cc', background: '#f7f7f8', foreground: '#171717' },
      },
    });

    expect(appearance.preset).toBe('srijika');
    expect(appearance.themes.dark.accent).toBe('#77767b');
    expect(appearance.themes.light.accent).toBe('#77767b');
  });

  it('resolves System independently while retaining explicit Dark and Light choices', () => {
    expect(resolveColorScheme('system', true)).toBe('dark');
    expect(resolveColorScheme('system', false)).toBe('light');
    expect(resolveColorScheme('dark', false)).toBe('dark');
    expect(resolveColorScheme('light', true)).toBe('light');
  });

  it('derives neutral chrome and private canvas-editor tokens from custom colors', () => {
    const appearance = cloneDefaultAppearance();
    appearance.preset = 'custom';
    appearance.themes.dark = {
      accent: '#1177dd',
      background: '#101010',
      foreground: '#f0f0f0',
    };

    const chrome = createAppearanceTokens(appearance, 'dark');
    const canvas = createCanvasEditorTokens(appearance, 'dark');

    expect(chrome['--chrome-bg']).toBe('#101010');
    expect(chrome['--chrome-panel']).toMatch(/^#[0-9a-f]{6}$/);
    expect(chrome['--chrome-panel']).not.toMatch(/(?:8c|7c|f6)/i);
    expect(chrome['--chrome-accent']).toBe('#1177dd');
    expect(canvas['--srijika-editor-accent']).toBe('#1177dd');
    expect(canvas['--srijika-editor-panel']).toBe(chrome['--chrome-panel']);
  });

  it('round-trips a versioned portable theme and rejects unrelated JSON', () => {
    const appearance = cloneDefaultAppearance();
    appearance.mode = 'light';
    appearance.contrast = 68;
    appearance.uiFont = 'Arial, sans-serif';

    expect(parseAppearanceExport(createAppearanceExport(appearance))).toEqual(appearance);
    expect(() => parseAppearanceExport('{"hello":"world"}')).toThrow(
      'does not contain Srijika Studio appearance settings',
    );
  });
});
