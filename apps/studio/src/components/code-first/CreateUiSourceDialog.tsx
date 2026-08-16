import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import type { CodeProjectUiSourceKind } from '../../lib/project-service';

const PASCAL_CASE_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
const FOLDER_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export interface CreateUiSourceInput {
  kind: Extract<CodeProjectUiSourceKind, 'page'>;
  componentName: string;
  folder: string;
  relativePath: string;
  createConnector: boolean;
}

export interface CreateUiSourceDialogProps {
  initialFolder?: string | undefined;
  uiSuffix?: string | undefined;
  connectorSuffix?: string | undefined;
  existingRelativePaths: readonly string[];
  onClose: () => void;
  onCreate: (input: CreateUiSourceInput) => Promise<string | null>;
}

function normalizedFolder(value: string): string {
  return value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
}

function folderError(value: string): string | null {
  const normalized = normalizedFolder(value);
  if (!normalized) return 'Choose a project-relative folder such as src/pages.';
  if (normalized.length > 180) return 'The folder path is too long.';
  if (value.trim().startsWith('/') || /^[A-Za-z]:/.test(value.trim())) {
    return 'Use a project-relative folder, not an absolute path.';
  }
  if (normalized !== 'src/pages' && !normalized.startsWith('src/pages/')) {
    return 'Route-level UI pages must be created inside src/pages.';
  }
  if (
    normalized
      .split('/')
      .some((segment) => segment === '.' || segment === '..' || !FOLDER_SEGMENT.test(segment))
  ) {
    return 'Folder segments may use letters, numbers, underscores, and hyphens.';
  }
  return null;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]',
    ),
  ].filter((element) => element.tabIndex >= 0 && !element.hidden);
}

export function CreateUiSourceDialog({
  initialFolder,
  uiSuffix = '.ui.tsx',
  connectorSuffix = '.connector.tsx',
  existingRelativePaths,
  onClose,
  onCreate,
}: CreateUiSourceDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const creatingRef = useRef(false);
  const requestedFolder = initialFolder ? normalizedFolder(initialFolder) : null;
  const contextualFolder =
    requestedFolder === 'src/pages' || requestedFolder?.startsWith('src/pages/')
      ? requestedFolder
      : null;
  const kind = 'page' as const;
  const [componentName, setComponentName] = useState('');
  const [folder, setFolder] = useState(contextualFolder ?? 'src/pages');
  const createConnector = true;
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const normalizedDirectory = normalizedFolder(folder);
  const uiFileName = componentName ? `${componentName}${uiSuffix}` : `Name${uiSuffix}`;
  const connectorFileName = componentName
    ? `${componentName}${connectorSuffix}`
    : `Name${connectorSuffix}`;
  const relativePath = `${normalizedDirectory || 'src'}/${uiFileName}`;
  const connectorPath = `${normalizedDirectory || 'src'}/${connectorFileName}`;
  const existingPaths = useMemo(
    () =>
      new Set(
        existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLocaleLowerCase('en-US')),
      ),
    [existingRelativePaths],
  );

  useEffect(() => {
    creatingRef.current = creating;
  }, [creating]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !creatingRef.current) onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

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

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedName = componentName.trim();
    if (!PASCAL_CASE_NAME.test(trimmedName)) {
      setError('Name must be PascalCase, for example Dashboard or ProfileCard.');
      nameRef.current?.focus();
      return;
    }
    const invalidFolder = folderError(folder);
    if (invalidFolder) {
      setError(invalidFolder);
      return;
    }
    const finalFolder = normalizedFolder(folder);
    const finalRelativePath = `${finalFolder}/${trimmedName}${uiSuffix}`;
    const finalConnectorPath = `${finalFolder}/${trimmedName}${connectorSuffix}`;
    if (
      existingPaths.has(finalRelativePath.toLocaleLowerCase('en-US')) ||
      (createConnector && existingPaths.has(finalConnectorPath.toLocaleLowerCase('en-US')))
    ) {
      setError('A UI or Connector with this name already exists in that folder.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const creationError = await onCreate({
        kind,
        componentName: trimmedName,
        folder: finalFolder,
        relativePath: finalRelativePath,
        createConnector,
      });
      if (creationError) setError(creationError);
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  };

  const kindLabel = 'UI page';

  return (
    <div
      className="code-first-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !creating) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="code-first-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ui-title"
        aria-describedby="create-ui-description"
        onKeyDown={trapFocus}
      >
        <header>
          <div>
            <span className="code-first-dialog-eyebrow">SRIJIKA UI SOURCE</span>
            <h2 id="create-ui-title">Create {kindLabel}</h2>
            <p id="create-ui-description">
              Pages live only in <code>src/pages</code>. Srijika creates the pure UI and its
              required Connector together; feature UI belongs in <code>src/features</code>.
            </p>
          </div>
          <button
            type="button"
            className="code-first-dialog-close"
            aria-label="Close create dialog"
            disabled={creating}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <label className="code-first-dialog-field" htmlFor="create-ui-name">
            <span>Name</span>
            <input
              ref={nameRef}
              id="create-ui-name"
              aria-label="Name"
              value={componentName}
              placeholder="Dashboard"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              disabled={creating}
              aria-describedby="create-ui-name-help"
              onChange={(event) => {
                setComponentName(event.target.value);
                setError(null);
              }}
            />
            <small id="create-ui-name-help">Use a PascalCase TypeScript name.</small>
          </label>

          <label className="code-first-dialog-field" htmlFor="create-ui-folder">
            <span>{contextualFolder ? 'Selected project folder' : 'Project folder'}</span>
            <input
              id="create-ui-folder"
              aria-label="Project folder"
              value={folder}
              autoComplete="off"
              spellCheck={false}
              disabled={creating}
              aria-describedby="create-ui-folder-help"
              onChange={(event) => {
                setFolder(event.target.value);
                setError(null);
              }}
            />
            <small id="create-ui-folder-help">
              {contextualFolder
                ? 'Prefilled from the folder selected in Project Explorer.'
                : 'Relative to the open project root.'}
            </small>
          </label>

          <div className="code-first-connector-choice is-selected">
            <span>
              <strong>Connector included</strong>
              <small>Required route boundary for page data, state, hooks, and actions.</small>
            </span>
          </div>

          <section className="code-first-generated-files" aria-label="Files to create">
            <span>Files to create</span>
            <code>{relativePath}</code>
            <code>{connectorPath}</code>
          </section>

          <p className="code-first-dialog-note">
            Need a general TypeScript, style, asset, or config file? Create it in VS Code; Studio
            owns only standardized UI and optional Connector creation.
          </p>

          {error && (
            <p className="code-first-dialog-error" role="alert">
              {error}
            </p>
          )}

          <footer>
            <button type="button" disabled={creating} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="is-primary" disabled={creating}>
              {creating ? 'Creating…' : `Create ${kindLabel}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
