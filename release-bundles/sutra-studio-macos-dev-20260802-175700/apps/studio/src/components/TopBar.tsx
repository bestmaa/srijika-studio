import {
  Check,
  Code2,
  Download,
  Eye,
  FilePlus2,
  FileJson2,
  FolderOpen,
  LayoutTemplate,
  Maximize2,
  Monitor,
  Redo2,
  RotateCcw,
  Save,
  Settings2,
  Smartphone,
  Tablet,
  Undo2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  chooseAndLoadDocument,
  chooseAndSaveDocument,
  isTauriDesktop,
  openBrowserPreview,
} from '../lib/project-service';
import {
  createSavedTemplateDocument,
  saveStudioTemplate,
  type SavedStudioTemplate,
  type StudioTemplate,
} from '../lib/templates';
import type { LearningExample } from '../lib/learning-examples';
import {
  VIEWPORT_PRESET_SIZES,
  useStudioStore,
  type StudioPanel,
  type ViewportPreset,
} from '../store/studio-store';
import { TemplateGallery } from './TemplateGallery';
import { LearnGallery } from './LearnGallery';
import { SettingsDialog } from './SettingsDialog';

const panelItems: Array<{ id: StudioPanel; label: string; icon: typeof Monitor }> = [
  { id: 'canvas', label: 'UI', icon: Monitor },
  { id: 'tsx', label: 'JSX', icon: Code2 },
  { id: 'json', label: 'JSON', icon: FileJson2 },
];

const viewportItems: Array<{ id: ViewportPreset; label: string; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
];

interface TopBarProps {
  onEnterFullscreenPreview?: () => void;
}

export function TopBar({ onEnterFullscreenPreview }: TopBarProps) {
  const document = useStudioStore((state) => state.document);
  const panel = useStudioStore((state) => state.panel);
  const viewport = useStudioStore((state) => state.viewport);
  const customViewportSize = useStudioStore((state) => state.customViewportSize);
  const setPanel = useStudioStore((state) => state.setPanel);
  const setViewport = useStudioStore((state) => state.setViewport);
  const setCustomViewportSize = useStudioStore((state) => state.setCustomViewportSize);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const resetDocument = useStudioStore((state) => state.resetDocument);
  const createPage = useStudioStore((state) => state.createPage);
  const loadDocument = useStudioStore((state) => state.loadDocument);
  const notice = useStudioStore((state) => state.notice);
  const showStatus = useStudioStore((state) => state.showStatus);
  const reportError = useStudioStore((state) => state.reportError);
  const clearNotice = useStudioStore((state) => state.clearNotice);
  const importRef = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [fileOperation, setFileOperation] = useState<'opening' | 'saving' | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [activeGallery, setActiveGallery] = useState<'templates' | 'learn' | 'settings' | null>(
    null,
  );
  const activeViewportSize = customViewportSize ?? VIEWPORT_PRESET_SIZES[viewport];
  const viewportWidthRef = useRef<HTMLInputElement>(null);
  const viewportHeightRef = useRef<HTMLInputElement>(null);

  const applyCustomViewport = (): void => {
    const width = Number(viewportWidthRef.current?.value);
    const height = Number(viewportHeightRef.current?.value);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      if (viewportWidthRef.current)
        viewportWidthRef.current.value = String(activeViewportSize.width);
      if (viewportHeightRef.current)
        viewportHeightRef.current.value = String(activeViewportSize.height);
      return;
    }
    setCustomViewportSize(width, height);
  };

  useEffect(() => {
    if (!fileMenuOpen) return;
    const handlePointerDown = (event: PointerEvent): void => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFileMenuOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fileMenuOpen]);

  const exportDocument = async (): Promise<void> => {
    if (fileOperation) return;
    clearNotice();
    setFileOperation('saving');
    try {
      if (isTauriDesktop()) {
        const result = await chooseAndSaveDocument(document);
        if (result) showStatus(`Saved ${result.bytes.toLocaleString()} bytes`);
        return;
      }
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = window.document.createElement('a');
        anchor.href = url;
        anchor.download = `${document.id}.sutra.json`;
        anchor.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      showStatus('JSON exported');
    } catch (error) {
      reportError('Could not export document', error);
    } finally {
      setFileOperation(null);
    }
  };

  const importDocument = async (file: File | undefined): Promise<void> => {
    if (!file || fileOperation) return;
    clearNotice();
    setFileOperation('opening');
    try {
      const value: unknown = JSON.parse(await file.text());
      if (loadDocument(value)) showStatus('Document imported');
    } catch (error) {
      reportError('Could not import document', error);
    } finally {
      setFileOperation(null);
    }
  };

  const openDocument = async (): Promise<void> => {
    if (fileOperation) return;
    if (!isTauriDesktop()) {
      importRef.current?.click();
      return;
    }
    clearNotice();
    setFileOperation('opening');
    try {
      const result = await chooseAndLoadDocument();
      if (result && loadDocument(result.document))
        showStatus(`Loaded ${result.bytes.toLocaleString()} bytes`);
    } catch (error) {
      reportError('Could not open document', error);
    } finally {
      setFileOperation(null);
    }
  };

  const openPreview = async (): Promise<void> => {
    clearNotice();
    try {
      await openBrowserPreview();
      showStatus('Browser preview opened');
    } catch (error) {
      reportError('Could not open browser preview', error);
    }
  };

  const useBuiltInTemplate = (template: StudioTemplate): void => {
    if (loadDocument(template.createDocument(document.id))) {
      showStatus(`Loaded ${template.name} template`);
      setActiveGallery(null);
    }
  };

  const useSavedTemplate = (template: SavedStudioTemplate): void => {
    if (loadDocument(createSavedTemplateDocument(template, document.id))) {
      showStatus(`Loaded saved template ${template.name}`);
      setActiveGallery(null);
    }
  };

  const useLearningExample = (example: LearningExample): void => {
    const pageId = createPage(example.name);
    if (!pageId) {
      reportError('Could not create learning page', 'The example page name is invalid');
      return;
    }
    if (loadDocument(example.createDocument(pageId))) {
      showStatus(`Opened ${example.name} example`);
      setActiveGallery(null);
    }
  };

  return (
    <header className="topbar">
      <div className="brand" aria-label="Sutra Studio">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        <span className="brand-copy">
          <strong>Sutra</strong>
          <small>Studio</small>
        </span>
        <span className="mvp-badge">UI MVP</span>
      </div>

      <nav className="app-menu" aria-label="Application menu">
        <div className="file-menu" ref={fileMenuRef}>
          <button
            className={fileMenuOpen ? 'app-menu-button is-open' : 'app-menu-button'}
            type="button"
            aria-haspopup="menu"
            aria-expanded={fileMenuOpen}
            onClick={() => setFileMenuOpen((open) => !open)}
          >
            File
          </button>
          {fileMenuOpen && (
            <div className="file-menu-popover" role="menu" aria-label="File commands">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  createPage('Untitled Page');
                  setFileMenuOpen(false);
                }}
              >
                <FilePlus2 size={14} />
                <span>New page</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={fileOperation !== null}
                onClick={() => {
                  setFileMenuOpen(false);
                  void openDocument();
                }}
              >
                <FolderOpen size={14} />
                <span>Open document…</span>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={fileOperation !== null}
                onClick={() => {
                  setFileMenuOpen(false);
                  void exportDocument();
                }}
              >
                <Save size={14} />
                <span>Save as JSON…</span>
              </button>
              <span className="file-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const saved = saveStudioTemplate(document);
                  showStatus(`Saved ${saved.name} to My templates`);
                  setFileMenuOpen(false);
                }}
              >
                <LayoutTemplate size={14} />
                <span>Save as template</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setActiveGallery('templates');
                }}
              >
                <LayoutTemplate size={14} />
                <span>Browse templates…</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setFileMenuOpen(false);
                  setActiveGallery('settings');
                }}
              >
                <Settings2 size={14} />
                <span>Appearance settings…</span>
              </button>
              <span className="file-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  resetDocument();
                  setFileMenuOpen(false);
                }}
              >
                <RotateCcw size={14} />
                <span>Reset starter demo</span>
              </button>
            </div>
          )}
        </div>
        <button
          className="app-menu-button"
          type="button"
          onClick={() => setActiveGallery('templates')}
        >
          Templates
        </button>
        <button className="app-menu-button" type="button" onClick={() => setActiveGallery('learn')}>
          Learn
        </button>
      </nav>

      <div className="topbar-group history-controls" aria-label="History controls">
        <button className="icon-button" type="button" onClick={undo} title="Undo">
          <Undo2 size={16} />
        </button>
        <button className="icon-button" type="button" onClick={redo} title="Redo">
          <Redo2 size={16} />
        </button>
      </div>

      <nav className="mode-switcher" role="tablist" aria-label="Editor view">
        {panelItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={panel === item.id ? 'mode-button is-active' : 'mode-button'}
              key={item.id}
              type="button"
              role="tab"
              aria-selected={panel === item.id}
              onClick={() => setPanel(item.id)}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="topbar-spacer" />

      {notice && (
        <span
          className={`file-status is-${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.message}
        </span>
      )}

      <div className="viewport-switcher" aria-label="Preview viewport">
        {viewportItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={
                !customViewportSize && viewport === item.id
                  ? 'icon-button is-active'
                  : 'icon-button'
              }
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => setViewport(item.id)}
            >
              <Icon size={15} />
            </button>
          );
        })}
        <button
          className="icon-button fullscreen-preview-button"
          type="button"
          title="Fullscreen preview"
          aria-label="Enter fullscreen preview"
          onClick={onEnterFullscreenPreview}
        >
          <Maximize2 size={15} />
        </button>
      </div>

      <form
        className={customViewportSize ? 'viewport-size-control is-custom' : 'viewport-size-control'}
        aria-label="Custom viewport size"
        onSubmit={(event) => {
          event.preventDefault();
          applyCustomViewport();
        }}
      >
        <input
          aria-label="Viewport width"
          defaultValue={activeViewportSize.width}
          inputMode="numeric"
          key={`viewport-width-${activeViewportSize.width}`}
          max={3840}
          min={240}
          ref={viewportWidthRef}
          type="number"
        />
        <span aria-hidden="true">×</span>
        <input
          aria-label="Viewport height"
          defaultValue={activeViewportSize.height}
          inputMode="numeric"
          key={`viewport-height-${activeViewportSize.height}`}
          max={3840}
          min={240}
          ref={viewportHeightRef}
          type="number"
        />
        <button type="submit" title="Apply custom viewport size">
          <Check size={12} />
        </button>
      </form>

      <button className="secondary-button" type="button" onClick={() => void openPreview()}>
        <Eye size={15} />
        Browser preview
      </button>

      <div className="topbar-group">
        <button
          className="icon-button"
          type="button"
          onClick={() => setActiveGallery('settings')}
          title="Settings"
          aria-label="Open settings"
        >
          <Settings2 size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => void exportDocument()}
          title="Export JSON"
          disabled={fileOperation !== null}
        >
          <Download size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          onClick={() => void openDocument()}
          title="Import JSON"
          disabled={fileOperation !== null}
        >
          <Upload size={15} />
        </button>
        <button className="icon-button" type="button" onClick={resetDocument} title="Reset demo">
          <RotateCcw size={15} />
        </button>
      </div>

      <input
        ref={importRef}
        hidden
        type="file"
        accept=".json,.sutra.json,application/json"
        onChange={(event) => {
          void importDocument(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {activeGallery === 'templates' && (
        <TemplateGallery
          open
          onClose={() => setActiveGallery(null)}
          onUseBuiltIn={useBuiltInTemplate}
          onUseSaved={useSavedTemplate}
        />
      )}
      {activeGallery === 'learn' && (
        <LearnGallery
          open
          onClose={() => setActiveGallery(null)}
          onUseExample={useLearningExample}
        />
      )}
      {activeGallery === 'settings' && (
        <SettingsDialog open onClose={() => setActiveGallery(null)} />
      )}
    </header>
  );
}
