import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  APPEARANCE_STORAGE_KEY,
  SUTRA_THEME_COLORS,
  applyAppearanceToElement,
  cloneDefaultAppearance,
  loadAppearancePreferences,
  normalizeAppearancePreferences,
  removeAppearanceFromElement,
  resolveColorScheme,
  serializeAppearancePreferences,
  type StudioAppearancePreferences,
  type StudioColorScheme,
  type StudioThemeColors,
  type StudioThemeMode,
} from '../lib/appearance';
import { isTauriDesktop } from '../lib/project-service';

interface AppearanceContextValue {
  preferences: StudioAppearancePreferences;
  resolvedScheme: StudioColorScheme;
  setMode: (mode: StudioThemeMode) => void;
  setThemeColors: (scheme: StudioColorScheme, colors: Partial<StudioThemeColors>) => void;
  setUiFont: (font: string) => void;
  setCodeFont: (font: string) => void;
  setTranslucentSidebar: (enabled: boolean) => void;
  setContrast: (contrast: number) => void;
  applySutraPreset: () => void;
  replacePreferences: (preferences: StudioAppearancePreferences) => void;
  resetAppearance: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(loadAppearancePreferences);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window === 'undefined'
      ? true
      : (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ?? true),
  );
  const resolvedScheme = resolveColorScheme(preferences.mode, systemPrefersDark);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const handleChange = (event: MediaQueryListEvent): void => setSystemPrefersDark(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    applyAppearanceToElement(document.documentElement, preferences, resolvedScheme);
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = preferences.themes[resolvedScheme].background;
    try {
      window.localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        serializeAppearancePreferences(preferences),
      );
    } catch {
      // A private or locked-down webview can reject storage. The live theme still applies.
    }
    if (isTauriDesktop()) {
      void import('@tauri-apps/api/app')
        .then(({ setTheme }) => setTheme(preferences.mode === 'system' ? null : resolvedScheme))
        .catch(() => undefined);
    }
  }, [preferences, resolvedScheme]);

  useEffect(
    () => () => {
      removeAppearanceFromElement(document.documentElement);
    },
    [],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent): void => {
      if (event.key !== APPEARANCE_STORAGE_KEY || !event.newValue) return;
      try {
        setPreferences(normalizeAppearancePreferences(JSON.parse(event.newValue)));
      } catch {
        // Ignore malformed cross-window values and retain the last valid appearance.
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updatePreferences = useCallback(
    (update: (current: StudioAppearancePreferences) => StudioAppearancePreferences): void => {
      setPreferences((current) => normalizeAppearancePreferences(update(current)));
    },
    [],
  );

  const setMode = useCallback(
    (mode: StudioThemeMode): void => updatePreferences((current) => ({ ...current, mode })),
    [updatePreferences],
  );

  const setThemeColors = useCallback(
    (scheme: StudioColorScheme, colors: Partial<StudioThemeColors>): void => {
      updatePreferences((current) => ({
        ...current,
        preset: 'custom',
        themes: {
          ...current.themes,
          [scheme]: { ...current.themes[scheme], ...colors },
        },
      }));
    },
    [updatePreferences],
  );

  const setUiFont = useCallback(
    (uiFont: string): void => updatePreferences((current) => ({ ...current, uiFont })),
    [updatePreferences],
  );
  const setCodeFont = useCallback(
    (codeFont: string): void => updatePreferences((current) => ({ ...current, codeFont })),
    [updatePreferences],
  );
  const setTranslucentSidebar = useCallback(
    (translucentSidebar: boolean): void =>
      updatePreferences((current) => ({ ...current, translucentSidebar })),
    [updatePreferences],
  );
  const setContrast = useCallback(
    (contrast: number): void => updatePreferences((current) => ({ ...current, contrast })),
    [updatePreferences],
  );
  const applySutraPreset = useCallback(
    (): void =>
      updatePreferences((current) => ({
        ...current,
        preset: 'sutra',
        themes: {
          dark: { ...SUTRA_THEME_COLORS.dark },
          light: { ...SUTRA_THEME_COLORS.light },
        },
      })),
    [updatePreferences],
  );
  const replacePreferences = useCallback(
    (next: StudioAppearancePreferences): void =>
      setPreferences(normalizeAppearancePreferences(next)),
    [],
  );
  const resetAppearance = useCallback((): void => setPreferences(cloneDefaultAppearance()), []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      preferences,
      resolvedScheme,
      setMode,
      setThemeColors,
      setUiFont,
      setCodeFont,
      setTranslucentSidebar,
      setContrast,
      applySutraPreset,
      replacePreferences,
      resetAppearance,
    }),
    [
      applySutraPreset,
      preferences,
      replacePreferences,
      resetAppearance,
      resolvedScheme,
      setCodeFont,
      setContrast,
      setMode,
      setThemeColors,
      setTranslucentSidebar,
      setUiFont,
    ],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error('useAppearance must be used inside AppearanceProvider');
  return context;
}
