import { Braces, CircleCheck, Database, Layers3 } from 'lucide-react';
import { useEffect } from 'react';

import { CodePanel } from '../components/CodePanel';
import { DesignFrame } from '../components/DesignFrame';
import { Hierarchy } from '../components/Hierarchy';
import { Inspector } from '../components/Inspector';
import { Palette } from '../components/Palette';
import { TopBar } from '../components/TopBar';
import { persistPreviewDocument } from '../lib/preview-channel';
import { useStudioStore } from '../store/studio-store';

export function StudioApp() {
  const document = useStudioStore((state) => state.document);
  const panel = useStudioStore((state) => state.panel);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const removeSelectedNode = useStudioStore((state) => state.removeSelectedNode);
  const reportError = useStudioStore((state) => state.reportError);

  useEffect(() => {
    try {
      persistPreviewDocument(document);
    } catch (error) {
      reportError('Could not sync the browser preview', error);
    }
  }, [document, reportError]);

  useEffect(() => {
    const handleError = (event: ErrorEvent): void => {
      reportError('Unexpected editor error', event.error ?? event.message);
      if (event.cancelable) event.preventDefault();
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
      reportError('Unexpected editor error', event.reason);
      event.preventDefault();
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [reportError]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const target = event.target;
      const editingText =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!editingText && (event.key === 'Delete' || event.key === 'Backspace')) {
        removeSelectedNode();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [redo, removeSelectedNode, undo]);

  return (
    <div className="studio-shell">
      <TopBar />
      <div className="studio-body">
        <div className="left-rail">
          <Palette />
          <Hierarchy />
        </div>

        <main className="workspace" aria-label="Visual editor workspace">
          {panel === 'canvas' ? <DesignFrame /> : <CodePanel mode={panel} />}
        </main>

        <Inspector />
      </div>

      <footer className="statusbar">
        <span className="status-ready">
          <CircleCheck size={13} /> Document valid
        </span>
        <span>
          <Layers3 size={13} /> {Object.keys(document.nodes).length} nodes
        </span>
        <span>
          <Braces size={13} /> AST v{document.formatVersion}
        </span>
        <span className="statusbar-spacer" />
        <span>
          <Database size={13} /> revision {document.revision}
        </span>
        <span>React DOM renderer</span>
      </footer>
    </div>
  );
}
