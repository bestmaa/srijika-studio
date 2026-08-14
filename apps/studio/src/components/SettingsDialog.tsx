import { Check, Copy, Monitor, Moon, Palette, RotateCcw, Sun, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { useAppearance } from '../app/AppearanceProvider';
import {
  createAppearanceExport,
  normalizeHexColor,
  parseAppearanceExport,
  type StudioThemeMode,
} from '../lib/appearance';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ThemeColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInvalid: (message: string) => void;
}

interface ThemeTextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onInvalid: (message: string) => void;
}

const themeChoices: Array<{
  mode: StudioThemeMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { mode: 'system', label: 'System', icon: Monitor },
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]',
    ),
  ].filter((element) => element.tabIndex >= 0 && !element.hidden);
}

function ThemeColorField({ label, value, onChange, onInvalid }: ThemeColorFieldProps) {
  const [draft, setDraft] = useState(value.toUpperCase());

  const commit = (): void => {
    const normalized = normalizeHexColor(draft);
    if (!normalized) {
      setDraft(value.toUpperCase());
      onInvalid(`${label} must be a hex color such as #77767B`);
      return;
    }
    setDraft(normalized.toUpperCase());
    onChange(normalized);
  };

  return (
    <div className="appearance-setting-row appearance-color-row">
      <label htmlFor={`appearance-${label.toLowerCase()}`}>{label}</label>
      <div className="appearance-color-control">
        <input
          className="appearance-color-swatch"
          type="color"
          aria-label={`${label} color picker`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          id={`appearance-${label.toLowerCase()}`}
          aria-label={label}
          value={draft}
          spellCheck={false}
          onBlur={commit}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            }
          }}
        />
      </div>
    </div>
  );
}

function ThemeTextField({ label, value, onChange, onInvalid }: ThemeTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const id = `appearance-${label.toLowerCase().replaceAll(' ', '-')}`;
  const commit = (): void => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      onInvalid(`${label} cannot be empty`);
      return;
    }
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="appearance-setting-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-label={label}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const {
    preferences,
    resolvedScheme,
    setMode,
    setThemeColors,
    setUiFont,
    setCodeFont,
    setTranslucentSidebar,
    setContrast,
    applySrijikaPreset,
    replacePreferences,
    resetAppearance,
  } = useAppearance();
  const activeTheme = preferences.themes[resolvedScheme];

  useEffect(() => {
    if (!open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-settings-primary]')?.focus();
    });
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  const trapFocus = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const moveThemeChoice = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: StudioThemeMode,
  ): void => {
    const currentIndex = themeChoices.findIndex((choice) => choice.mode === currentMode);
    let nextIndex: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % themeChoices.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + themeChoices.length) % themeChoices.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = themeChoices.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextMode = themeChoices[nextIndex]?.mode;
    if (!nextMode) return;
    setMode(nextMode);
    setMessage(null);
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(`[data-theme-mode="${nextMode}"]`)
        ?.focus();
    });
  };

  const importTheme = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      replacePreferences(parseAppearanceExport(await file.text()));
      setMessage(`Imported ${file.name}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import this theme');
    }
  };

  const copyTheme = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(createAppearanceExport(preferences));
      setMessage('Theme JSON copied');
    } catch {
      setMessage('Clipboard is unavailable in this window');
    }
  };

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        aria-describedby="settings-description"
        onKeyDown={trapFocus}
      >
        <aside className="settings-sidebar">
          <div className="settings-sidebar-heading">
            <span className="settings-mark" aria-hidden="true">
              S
            </span>
            <div>
              <span>Preferences</span>
              <strong id="settings-title">Settings</strong>
            </div>
          </div>
          <nav aria-label="Settings categories">
            <button type="button" className="is-active" aria-current="page">
              <Palette size={16} />
              Appearance
            </button>
          </nav>
          <p>More Studio settings will appear here as the product grows.</p>
        </aside>

        <div className="settings-content">
          <header className="settings-content-header">
            <div>
              <span className="eyebrow">STUDIO PREFERENCES</span>
              <h2>Appearance</h2>
              <p id="settings-description">
                Change the editor chrome without changing colors in your React page.
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>

          <div className="settings-scroll">
            <section
              className="appearance-theme-section"
              aria-labelledby="appearance-theme-heading"
            >
              <h3 id="appearance-theme-heading">Theme</h3>
              <div className="appearance-theme-cards" role="radiogroup" aria-label="Theme">
                {themeChoices.map((choice) => {
                  const Icon = choice.icon;
                  const selected = preferences.mode === choice.mode;
                  return (
                    <button
                      key={choice.mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      data-theme-mode={choice.mode}
                      className={
                        selected ? 'appearance-theme-card is-selected' : 'appearance-theme-card'
                      }
                      data-settings-primary={selected ? '' : undefined}
                      onClick={() => {
                        setMode(choice.mode);
                        setMessage(null);
                      }}
                      onKeyDown={(event) => moveThemeChoice(event, choice.mode)}
                    >
                      <span
                        className={`appearance-theme-preview is-${choice.mode}`}
                        aria-hidden="true"
                      >
                        <i />
                        <b />
                        <em />
                      </span>
                      <span>
                        <Icon size={13} /> {choice.label}
                      </span>
                      {selected && <Check size={14} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="appearance-editor" aria-labelledby="appearance-editor-heading">
              <header>
                <h3 id="appearance-editor-heading">
                  {resolvedScheme === 'dark' ? 'Dark theme' : 'Light theme'}
                </h3>
                <div className="appearance-editor-actions">
                  <button type="button" onClick={() => importRef.current?.click()}>
                    <Upload size={13} /> Import
                  </button>
                  <button type="button" onClick={() => void copyTheme()}>
                    <Copy size={13} /> Copy theme
                  </button>
                  <label>
                    <span className="appearance-preset-mark" aria-hidden="true">
                      Aa
                    </span>
                    <select
                      aria-label="Theme preset"
                      value={preferences.preset}
                      onChange={(event) => {
                        if (event.target.value === 'srijika') applySrijikaPreset();
                        else setThemeColors(resolvedScheme, {});
                        setMessage(null);
                      }}
                    >
                      <option value="srijika">Srijika</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                </div>
              </header>

              <ThemeColorField
                key={`${resolvedScheme}-accent-${activeTheme.accent}`}
                label="Accent"
                value={activeTheme.accent}
                onChange={(accent) => setThemeColors(resolvedScheme, { accent })}
                onInvalid={setMessage}
              />
              <ThemeColorField
                key={`${resolvedScheme}-background-${activeTheme.background}`}
                label="Background"
                value={activeTheme.background}
                onChange={(background) => setThemeColors(resolvedScheme, { background })}
                onInvalid={setMessage}
              />
              <ThemeColorField
                key={`${resolvedScheme}-foreground-${activeTheme.foreground}`}
                label="Foreground"
                value={activeTheme.foreground}
                onChange={(foreground) => setThemeColors(resolvedScheme, { foreground })}
                onInvalid={setMessage}
              />

              <ThemeTextField
                key={`ui-font-${preferences.uiFont}`}
                label="UI font"
                value={preferences.uiFont}
                onChange={setUiFont}
                onInvalid={setMessage}
              />
              <ThemeTextField
                key={`code-font-${preferences.codeFont}`}
                label="Code font"
                value={preferences.codeFont}
                onChange={setCodeFont}
                onInvalid={setMessage}
              />
              <div className="appearance-setting-row">
                <span>Translucent sidebar</span>
                <button
                  className={
                    preferences.translucentSidebar ? 'appearance-switch is-on' : 'appearance-switch'
                  }
                  type="button"
                  role="switch"
                  aria-checked={preferences.translucentSidebar}
                  aria-label="Translucent sidebar"
                  onClick={() => setTranslucentSidebar(!preferences.translucentSidebar)}
                >
                  <span />
                </button>
              </div>
              <div className="appearance-setting-row appearance-contrast-row">
                <label htmlFor="appearance-contrast">Contrast</label>
                <div>
                  <input
                    id="appearance-contrast"
                    aria-label="Contrast"
                    aria-valuetext={`${preferences.contrast} percent`}
                    type="range"
                    min={0}
                    max={100}
                    value={preferences.contrast}
                    onChange={(event) => setContrast(Number(event.target.value))}
                  />
                  <output htmlFor="appearance-contrast">{preferences.contrast}</output>
                </div>
              </div>
              {message && (
                <p className="appearance-message" role="status">
                  {message}
                </p>
              )}
            </section>
          </div>

          <footer className="settings-footer">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                resetAppearance();
                setMessage('Restored Srijika defaults');
              }}
            >
              <RotateCcw size={14} /> Reset defaults
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              Done
            </button>
          </footer>
        </div>

        <input
          ref={importRef}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="Import theme file"
          onChange={(event) => void importTheme(event)}
        />
      </section>
    </div>
  );
}
