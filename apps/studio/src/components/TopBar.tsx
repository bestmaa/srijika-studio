import {
  Code2,
  Download,
  Eye,
  FileJson2,
  Monitor,
  Redo2,
  RotateCcw,
  Smartphone,
  Tablet,
  Undo2,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';

import {
  chooseAndLoadDocument,
  chooseAndSaveDocument,
  isTauriDesktop,
} from '../lib/project-service';
import { useStudioStore, type StudioPanel, type ViewportPreset } from '../store/studio-store';

const panelItems: Array<{ id: StudioPanel; label: string; icon: typeof Monitor }> = [
  { id: 'canvas', label: 'Design', icon: Monitor },
  { id: 'json', label: 'JSON', icon: FileJson2 },
  { id: 'tsx', label: 'TSX', icon: Code2 },
];

const viewportItems: Array<{ id: ViewportPreset; label: string; icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop', icon: Monitor },
  { id: 'tablet', label: 'Tablet', icon: Tablet },
  { id: 'mobile', label: 'Mobile', icon: Smartphone },
];

export function TopBar() {
  const document = useStudioStore((state) => state.document);
  const panel = useStudioStore((state) => state.panel);
  const viewport = useStudioStore((state) => state.viewport);
  const setPanel = useStudioStore((state) => state.setPanel);
  const setViewport = useStudioStore((state) => state.setViewport);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const resetDocument = useStudioStore((state) => state.resetDocument);
  const loadDocument = useStudioStore((state) => state.loadDocument);
  const notice = useStudioStore((state) => state.notice);
  const showStatus = useStudioStore((state) => state.showStatus);
  const reportError = useStudioStore((state) => state.reportError);
  const clearNotice = useStudioStore((state) => state.clearNotice);
  const importRef = useRef<HTMLInputElement>(null);
  const [fileOperation, setFileOperation] = useState<'opening' | 'saving' | null>(null);

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

  return (
    <header className="topbar">
      <div className="brand" aria-label="Sutra Studio">
        <span className="brand-mark" aria-hidden="true">
          सू
        </span>
        <span className="brand-copy">
          <strong>Sutra</strong>
          <small>Studio</small>
        </span>
        <span className="mvp-badge">UI MVP</span>
      </div>

      <div className="topbar-group history-controls" aria-label="History controls">
        <button className="icon-button" type="button" onClick={undo} title="Undo">
          <Undo2 size={16} />
        </button>
        <button className="icon-button" type="button" onClick={redo} title="Redo">
          <Redo2 size={16} />
        </button>
      </div>

      <nav className="mode-switcher" aria-label="Editor mode">
        {panelItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={panel === item.id ? 'mode-button is-active' : 'mode-button'}
              key={item.id}
              type="button"
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
              className={viewport === item.id ? 'icon-button is-active' : 'icon-button'}
              key={item.id}
              type="button"
              title={item.label}
              onClick={() => setViewport(item.id)}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      <button
        className="secondary-button"
        type="button"
        onClick={() => window.open('/preview', 'sutra-preview')}
      >
        <Eye size={15} />
        Browser preview
      </button>

      <div className="topbar-group">
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
    </header>
  );
}
