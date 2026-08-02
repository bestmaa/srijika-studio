export type StudioThemeMode = 'system' | 'light' | 'dark';
export type StudioColorScheme = Exclude<StudioThemeMode, 'system'>;
export type StudioThemePreset = 'sutra' | 'custom';

export interface StudioThemeColors {
  accent: string;
  background: string;
  foreground: string;
}

export interface StudioAppearancePreferences {
  version: 1;
  mode: StudioThemeMode;
  preset: StudioThemePreset;
  themes: Record<StudioColorScheme, StudioThemeColors>;
  uiFont: string;
  codeFont: string;
  translucentSidebar: boolean;
  contrast: number;
}

export const APPEARANCE_STORAGE_KEY = 'sutra-studio:appearance.v1';
export const APPEARANCE_EXPORT_KIND = 'sutra-studio-appearance';

const defaultUiFont =
  "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const defaultCodeFont = "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

export const SUTRA_THEME_COLORS: Readonly<Record<StudioColorScheme, StudioThemeColors>> = {
  dark: {
    accent: '#77767b',
    background: '#111111',
    foreground: '#fcfcfc',
  },
  light: {
    accent: '#77767b',
    background: '#f7f7f8',
    foreground: '#171717',
  },
};

export const DEFAULT_APPEARANCE: Readonly<StudioAppearancePreferences> = {
  version: 1,
  mode: 'dark',
  preset: 'sutra',
  themes: SUTRA_THEME_COLORS,
  uiFont: defaultUiFont,
  codeFont: defaultCodeFont,
  translucentSidebar: true,
  contrast: 49,
};

const colorPattern = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [red, green, blue] = trimmed.slice(1).split('');
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase();
  }
  return colorPattern.test(trimmed) ? trimmed.toLowerCase() : null;
}

function readThemeColors(value: unknown, fallback: StudioThemeColors): StudioThemeColors {
  if (!isRecord(value)) return { ...fallback };
  return {
    accent:
      normalizeHexColor(typeof value['accent'] === 'string' ? value['accent'] : '') ??
      fallback.accent,
    background:
      normalizeHexColor(typeof value['background'] === 'string' ? value['background'] : '') ??
      fallback.background,
    foreground:
      normalizeHexColor(typeof value['foreground'] === 'string' ? value['foreground'] : '') ??
      fallback.foreground,
  };
}

export function cloneDefaultAppearance(): StudioAppearancePreferences {
  return {
    ...DEFAULT_APPEARANCE,
    themes: {
      dark: { ...SUTRA_THEME_COLORS.dark },
      light: { ...SUTRA_THEME_COLORS.light },
    },
  };
}

export function normalizeAppearancePreferences(value: unknown): StudioAppearancePreferences {
  const fallback = cloneDefaultAppearance();
  if (!isRecord(value)) return fallback;
  const rawMode = value['mode'];
  const rawPreset = value['preset'];
  const rawThemes = isRecord(value['themes']) ? value['themes'] : {};
  const rawContrast = value['contrast'];
  // `codex` was the name of the original built-in appearance preset. Treat it
  // as Sutra and refresh its colors so existing installations migrate away
  // from the former blue accent without requiring a manual reset.
  const preset: StudioThemePreset = rawPreset === 'custom' ? 'custom' : 'sutra';
  return {
    version: 1,
    mode:
      rawMode === 'system' || rawMode === 'light' || rawMode === 'dark' ? rawMode : fallback.mode,
    preset,
    themes:
      preset === 'custom'
        ? {
            dark: readThemeColors(rawThemes['dark'], fallback.themes.dark),
            light: readThemeColors(rawThemes['light'], fallback.themes.light),
          }
        : {
            dark: { ...SUTRA_THEME_COLORS.dark },
            light: { ...SUTRA_THEME_COLORS.light },
          },
    uiFont:
      typeof value['uiFont'] === 'string' && value['uiFont'].trim().length > 0
        ? value['uiFont'].trim().slice(0, 240)
        : fallback.uiFont,
    codeFont:
      typeof value['codeFont'] === 'string' && value['codeFont'].trim().length > 0
        ? value['codeFont'].trim().slice(0, 240)
        : fallback.codeFont,
    translucentSidebar:
      typeof value['translucentSidebar'] === 'boolean'
        ? value['translucentSidebar']
        : fallback.translucentSidebar,
    contrast:
      typeof rawContrast === 'number' && Number.isFinite(rawContrast)
        ? Math.round(clamp(rawContrast, 0, 100))
        : fallback.contrast,
  };
}

export function loadAppearancePreferences(
  storage?: Pick<Storage, 'getItem'>,
): StudioAppearancePreferences {
  try {
    const resolvedStorage =
      storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolvedStorage) return cloneDefaultAppearance();
    const serialized = resolvedStorage.getItem(APPEARANCE_STORAGE_KEY);
    return serialized
      ? normalizeAppearancePreferences(JSON.parse(serialized))
      : cloneDefaultAppearance();
  } catch {
    return cloneDefaultAppearance();
  }
}

export function serializeAppearancePreferences(preferences: StudioAppearancePreferences): string {
  return JSON.stringify(normalizeAppearancePreferences(preferences));
}

export function createAppearanceExport(preferences: StudioAppearancePreferences): string {
  return JSON.stringify(
    {
      kind: APPEARANCE_EXPORT_KIND,
      version: 1,
      preferences: normalizeAppearancePreferences(preferences),
    },
    null,
    2,
  );
}

export function parseAppearanceExport(serialized: string): StudioAppearancePreferences {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) throw new Error('Theme file must contain a JSON object');
  const candidate = parsed['kind'] === APPEARANCE_EXPORT_KIND ? parsed['preferences'] : parsed;
  if (!isRecord(candidate) || (!('mode' in candidate) && !('themes' in candidate))) {
    throw new Error('This file does not contain Sutra Studio appearance settings');
  }
  return normalizeAppearancePreferences(candidate);
}

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

function hexToRgb(value: string): RgbColor {
  const normalized = normalizeHexColor(value) ?? '#000000';
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHex(color: RgbColor): string {
  const channel = (value: number): string =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function mixColors(from: string, to: string, amount: number): string {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const weight = clamp(amount, 0, 1);
  return rgbToHex({
    red: start.red + (end.red - start.red) * weight,
    green: start.green + (end.green - start.green) * weight,
    blue: start.blue + (end.blue - start.blue) * weight,
  });
}

function withAlpha(value: string, alpha: number): string {
  const color = hexToRgb(value);
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function relativeLuminance(value: string): number {
  const color = hexToRgb(value);
  const channel = (input: number): number => {
    const normalized = input / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
}

export function resolveColorScheme(
  mode: StudioThemeMode,
  systemPrefersDark: boolean,
): StudioColorScheme {
  return mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode;
}

export function createAppearanceTokens(
  preferences: StudioAppearancePreferences,
  scheme: StudioColorScheme,
): Record<string, string> {
  const normalized = normalizeAppearancePreferences(preferences);
  const theme = normalized.themes[scheme];
  const contrastScale = 0.72 + (normalized.contrast / 100) * 0.58;
  const surface = mixColors(theme.background, theme.foreground, 0.03 * contrastScale);
  const panel = mixColors(theme.background, theme.foreground, 0.052 * contrastScale);
  const raised = mixColors(theme.background, theme.foreground, 0.082 * contrastScale);
  const hover = mixColors(theme.background, theme.foreground, 0.118 * contrastScale);
  const border = mixColors(theme.background, theme.foreground, 0.15 * contrastScale);
  const borderStrong = mixColors(theme.background, theme.foreground, 0.22 * contrastScale);
  const textMuted = mixColors(theme.foreground, theme.background, 0.34);
  const textSubtle = mixColors(theme.foreground, theme.background, 0.48);
  const accentText =
    scheme === 'dark' ? mixColors(theme.accent, theme.foreground, 0.38) : theme.accent;
  const accentContrast = relativeLuminance(theme.accent) > 0.42 ? '#111111' : '#ffffff';
  const opaqueSidebar = normalized.translucentSidebar ? 0.88 : 1;

  return {
    '--studio-background': theme.background,
    '--studio-foreground': theme.foreground,
    '--studio-accent': theme.accent,
    '--studio-ui-font': normalized.uiFont,
    '--studio-code-font': normalized.codeFont,
    '--chrome-bg': theme.background,
    '--chrome-surface': surface,
    '--chrome-panel': panel,
    '--chrome-raised': raised,
    '--chrome-hover': hover,
    '--chrome-border': border,
    '--chrome-border-strong': borderStrong,
    '--chrome-text': theme.foreground,
    '--chrome-text-muted': textMuted,
    '--chrome-text-subtle': textSubtle,
    '--chrome-accent': theme.accent,
    '--chrome-accent-text': accentText,
    '--chrome-accent-contrast': accentContrast,
    '--chrome-accent-strong': theme.accent,
    '--chrome-accent-soft': withAlpha(theme.accent, 0.14),
    '--chrome-accent-hover': withAlpha(theme.accent, 0.22),
    '--chrome-accent-border': withAlpha(theme.accent, 0.42),
    '--chrome-focus': `0 0 0 2px ${withAlpha(theme.accent, 0.34)}`,
    '--chrome-selection': withAlpha(theme.accent, 0.68),
    '--chrome-sidebar-bg': withAlpha(panel, opaqueSidebar),
    '--chrome-topbar-bg': withAlpha(surface, normalized.translucentSidebar ? 0.94 : 1),
    '--chrome-overlay': withAlpha(theme.background, scheme === 'dark' ? 0.78 : 0.58),
    '--chrome-canvas': mixColors(theme.background, theme.foreground, 0.022 * contrastScale),
    '--chrome-code-bg': mixColors(theme.background, '#000000', scheme === 'dark' ? 0.2 : 0.04),
    '--chrome-success': scheme === 'dark' ? '#57c89b' : '#157f5b',
    '--chrome-danger': scheme === 'dark' ? '#f1788b' : '#bf2942',
    '--chrome-danger-soft':
      scheme === 'dark' ? 'rgba(241, 120, 139, 0.13)' : 'rgba(191, 41, 66, 0.1)',
  };
}

export function createCanvasEditorTokens(
  preferences: StudioAppearancePreferences,
  scheme: StudioColorScheme,
): Record<string, string> {
  const tokens = createAppearanceTokens(preferences, scheme);
  return {
    '--sutra-editor-panel': tokens['--chrome-panel'] ?? '#1d1d1d',
    '--sutra-editor-surface': tokens['--chrome-surface'] ?? '#181818',
    '--sutra-editor-raised': tokens['--chrome-raised'] ?? '#242424',
    '--sutra-editor-hover': tokens['--chrome-hover'] ?? '#2b2b2b',
    '--sutra-editor-border': tokens['--chrome-border-strong'] ?? '#404040',
    '--sutra-editor-text': tokens['--chrome-text'] ?? '#fcfcfc',
    '--sutra-editor-muted': tokens['--chrome-text-muted'] ?? '#aaaaaa',
    '--sutra-editor-accent': tokens['--chrome-accent'] ?? '#77767b',
    '--sutra-editor-accent-text': tokens['--chrome-accent-text'] ?? '#aaa9ac',
    '--sutra-editor-accent-soft': tokens['--chrome-accent-soft'] ?? 'rgba(119, 118, 123, 0.14)',
    '--sutra-editor-accent-hover': tokens['--chrome-accent-hover'] ?? 'rgba(119, 118, 123, 0.22)',
    '--sutra-editor-accent-border': tokens['--chrome-accent-border'] ?? 'rgba(119, 118, 123, 0.42)',
    '--sutra-editor-accent-contrast': tokens['--chrome-accent-contrast'] ?? '#ffffff',
    '--sutra-editor-focus': tokens['--chrome-focus'] ?? '0 0 0 2px rgba(119, 118, 123, 0.34)',
    '--sutra-editor-danger': tokens['--chrome-danger'] ?? '#f1788b',
    '--sutra-editor-danger-soft': tokens['--chrome-danger-soft'] ?? 'rgba(241, 120, 139, 0.13)',
  };
}

export function applyCanvasEditorAppearance(
  element: HTMLElement,
  preferences: StudioAppearancePreferences,
  scheme: StudioColorScheme,
): void {
  element.dataset['sutraEditorScheme'] = scheme;
  for (const [property, value] of Object.entries(createCanvasEditorTokens(preferences, scheme))) {
    element.style.setProperty(property, value);
  }
}

export function applyAppearanceToElement(
  element: HTMLElement,
  preferences: StudioAppearancePreferences,
  scheme: StudioColorScheme,
): void {
  const normalized = normalizeAppearancePreferences(preferences);
  element.dataset['studioColorScheme'] = scheme;
  element.dataset['studioThemePreset'] = normalized.preset;
  element.dataset['studioTranslucentSidebar'] = String(normalized.translucentSidebar);
  element.style.colorScheme = scheme;
  for (const [property, value] of Object.entries(createAppearanceTokens(normalized, scheme))) {
    element.style.setProperty(property, value);
  }
}

export function removeAppearanceFromElement(element: HTMLElement): void {
  delete element.dataset['studioColorScheme'];
  delete element.dataset['studioThemePreset'];
  delete element.dataset['studioTranslucentSidebar'];
  element.style.removeProperty('color-scheme');
  const properties = Object.keys(createAppearanceTokens(cloneDefaultAppearance(), 'dark'));
  for (const property of properties) element.style.removeProperty(property);
}
