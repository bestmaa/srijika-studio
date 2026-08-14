import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateUiDocument } from '@srijika/contracts';

import { PreviewApp } from '../../apps/studio/src/app/PreviewApp';
import { StudioApp } from '../../apps/studio/src/app/StudioApp';
import { TopBar } from '../../apps/studio/src/components/TopBar';
import {
  chooseAndLoadDocument,
  chooseAndSaveDocument,
  isTauriDesktop,
  openBrowserPreview,
} from '../../apps/studio/src/lib/project-service';
import {
  DEFAULT_CODE_PROJECT_FILE_NAME,
  DEFAULT_CODE_PROJECT_SOURCE,
  useCodeProjectStore,
} from '../../apps/studio/src/store/code-project-store';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

vi.mock('../../apps/studio/src/lib/project-service', () => ({
  chooseAndLoadDocument: vi.fn(),
  chooseAndSaveDocument: vi.fn(),
  isTauriDesktop: vi.fn(),
  openBrowserPreview: vi.fn(),
}));

const chooseAndLoadDocumentMock = vi.mocked(chooseAndLoadDocument);
const chooseAndSaveDocumentMock = vi.mocked(chooseAndSaveDocument);
const isTauriDesktopMock = vi.mocked(isTauriDesktop);
const openBrowserPreviewMock = vi.mocked(openBrowserPreview);

function uploadedJson(contents: string): File {
  const file = new File([contents], 'document.srijika.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: vi.fn().mockResolvedValue(contents),
  });
  return file;
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Expected the hidden JSON file input');
  return input;
}

describe('Studio file and command resilience', () => {
  beforeEach(() => {
    useStudioStore.getState().resetDocument();
    isTauriDesktopMock.mockReturnValue(false);
    openBrowserPreviewMock.mockReset();
    openBrowserPreviewMock.mockResolvedValue();
  });

  it('reports malformed browser imports and keeps the current document open', async () => {
    const user = userEvent.setup();
    const original = useStudioStore.getState().document;
    render(<TopBar />);

    await user.upload(fileInput(), uploadedJson('{not valid JSON'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not import document');
    expect(useStudioStore.getState().document).toBe(original);
  });

  it('rejects a structurally valid but semantically invalid import atomically', async () => {
    const user = userEvent.setup();
    const original = useStudioStore.getState().document;
    const invalid = structuredClone(original);
    const root = invalid.nodes[invalid.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected an element root');
    root.componentId = 'missing.component';
    expect(validateUiDocument(invalid).valid).toBe(true);
    render(<TopBar />);

    await user.upload(fileInput(), uploadedJson(JSON.stringify(invalid)));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The selected file is not a valid Srijika document',
    );
    expect(useStudioStore.getState().document).toBe(original);
  });

  it('turns native open and save rejections into user-visible errors', async () => {
    const user = userEvent.setup();
    isTauriDesktopMock.mockReturnValue(true);
    chooseAndLoadDocumentMock.mockRejectedValueOnce(new Error('permission denied'));
    chooseAndSaveDocumentMock.mockRejectedValueOnce('disk is read-only');
    render(<TopBar />);

    await user.click(screen.getByRole('button', { name: 'Import JSON' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open document: permission denied',
    );

    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not export document: disk is read-only',
    );
  });

  it('surfaces a browser preview failure without disturbing the editor', async () => {
    const user = userEvent.setup();
    openBrowserPreviewMock.mockRejectedValueOnce(new Error('preview window unavailable'));
    render(<TopBar />);

    await user.click(screen.getByRole('button', { name: 'Browser preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open browser preview: preview window unavailable',
    );
    expect(useStudioStore.getState().document).toBeDefined();
  });

  it('rejects an invalid command without throwing or changing the document', () => {
    const original = useStudioStore.getState().document;
    let accepted = true;
    act(() => {
      accepted = useStudioStore
        .getState()
        .dispatch({ kind: 'removeSubtree', nodeId: original.rootNodeId });
    });

    expect(accepted).toBe(false);
    expect(useStudioStore.getState().document).toBe(original);
    expect(useStudioStore.getState().notice?.kind).toBe('error');
    expect(useStudioStore.getState().notice?.message).toContain('Could not apply this change');
  });

  it('ignores self, root, and descendant drop targets before dispatch', () => {
    const original = useStudioStore.getState().document;

    act(() => {
      useStudioStore.getState().moveNode('hero', 'hero');
      useStudioStore.getState().moveNode(original.rootNodeId, 'hero');
      useStudioStore.getState().moveNode('hero', 'hero_actions');
    });

    expect(useStudioStore.getState().document).toBe(original);
    expect(useStudioStore.getState().notice).toBeNull();
  });

  it('surfaces unexpected editor errors without replacing the shell', async () => {
    useCodeProjectStore.getState().loadSource({
      fileName: DEFAULT_CODE_PROJECT_FILE_NAME,
      source: DEFAULT_CODE_PROJECT_SOURCE,
    });
    render(<StudioApp />);

    act(() => {
      window.dispatchEvent(
        new ErrorEvent('error', {
          cancelable: true,
          error: new Error('render bridge failed'),
          message: 'render bridge failed',
        }),
      );
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unexpected editor error: render bridge failed',
    );
    expect(screen.getByRole('main', { name: 'Page editor workspace' })).toBeInTheDocument();
  });

  it('falls back to a safe document when preview storage is semantically invalid', () => {
    const invalid = structuredClone(useStudioStore.getState().document);
    const root = invalid.nodes[invalid.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected an element root');
    root.componentId = 'missing.component';
    localStorage.setItem('srijika-studio:active-document', JSON.stringify(invalid));

    render(<PreviewApp />);

    expect(
      screen.getByRole('heading', { name: 'Build applications visually' }),
    ).toBeInTheDocument();
  });
});
