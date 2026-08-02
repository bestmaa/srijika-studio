import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudioApp } from '../../apps/studio/src/app/StudioApp';
import { PreviewApp } from '../../apps/studio/src/app/PreviewApp';
import { openBrowserPreview } from '../../apps/studio/src/lib/project-service';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

vi.mock('../../apps/studio/src/lib/project-service', () => ({
  chooseAndLoadDocument: vi.fn(),
  chooseAndSaveDocument: vi.fn(),
  isTauriDesktop: vi.fn(() => false),
  openBrowserPreview: vi.fn(),
}));

const openBrowserPreviewMock = vi.mocked(openBrowserPreview);

describe('preview controls', () => {
  beforeEach(() => {
    useStudioStore.getState().resetDocument();
    useStudioStore.setState({ viewport: 'desktop', customViewportSize: null });
    openBrowserPreviewMock.mockReset();
    openBrowserPreviewMock.mockResolvedValue();
  });

  it('opens a responsive fullscreen preview, can switch to exact size, and exits with Escape', () => {
    render(<StudioApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen preview' }));

    const preview = screen.getByRole('dialog', { name: 'Fullscreen design preview' });
    expect(preview).toBeInTheDocument();
    expect(preview.querySelector('.fullscreen-preview-stage')).toHaveAttribute(
      'data-preview-sizing',
      'responsive',
    );
    expect(preview.querySelector('.fullscreen-preview-stage')).toHaveAttribute(
      'data-viewport-width',
      String(window.innerWidth),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show exact design size' }));
    expect(preview.querySelector('.fullscreen-preview-stage')).toHaveAttribute(
      'data-preview-sizing',
      'exact',
    );
    expect(preview.querySelector('.fullscreen-preview-stage')).toHaveAttribute(
      'data-viewport-width',
      '1180',
    );
    expect(preview.querySelector('.fullscreen-preview-stage')).toHaveAttribute(
      'data-viewport-height',
      '820',
    );
    expect(screen.getByRole('button', { name: 'Exit fullscreen preview' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(
      screen.queryByRole('dialog', { name: 'Fullscreen design preview' }),
    ).not.toBeInTheDocument();
  });

  it('routes Browser preview through the environment-aware preview service', () => {
    render(<StudioApp />);

    fireEvent.click(screen.getByRole('button', { name: 'Browser preview' }));

    expect(openBrowserPreviewMock).toHaveBeenCalledOnce();
  });

  it('syncs preset and custom design viewport dimensions without changing document storage', () => {
    render(<StudioApp />);

    expect(JSON.parse(localStorage.getItem('sutra-studio:preview-viewport') ?? 'null')).toEqual({
      width: 1180,
      height: 820,
    });
    const initialDocumentStorage = localStorage.getItem('sutra-studio:active-document');
    expect(initialDocumentStorage).toContain('"formatVersion":1');
    expect(initialDocumentStorage).toContain(
      `"rootNodeId":"${useStudioStore.getState().document.rootNodeId}"`,
    );

    act(() => useStudioStore.getState().setCustomViewportSize(1440, 900));

    expect(JSON.parse(localStorage.getItem('sutra-studio:preview-viewport') ?? 'null')).toEqual({
      width: 1440,
      height: 900,
    });
    const customViewportDocumentStorage = localStorage.getItem('sutra-studio:active-document');
    expect(customViewportDocumentStorage).toContain('"formatVersion":1');
    expect(customViewportDocumentStorage).toContain(
      `"rootNodeId":"${useStudioStore.getState().document.rootNodeId}"`,
    );
  });

  it('switches Browser preview between its real content area and the synced exact design size', () => {
    localStorage.setItem(
      'sutra-studio:preview-viewport',
      JSON.stringify({ width: 1440, height: 900 }),
    );
    const { container } = render(<PreviewApp />);
    const stage = container.querySelector<HTMLElement>('.browser-preview-stage');
    const previewDocument = container.querySelector<HTMLElement>('.preview-document');
    if (!stage || !previewDocument) throw new Error('Expected Browser preview sizing surfaces');

    expect(stage).toHaveAttribute('data-preview-sizing', 'responsive');
    expect(stage).toHaveAttribute('data-viewport-width', String(window.innerWidth));
    expect(stage).toHaveAttribute('data-viewport-height', String(window.innerHeight - 36));
    expect(screen.getByRole('button', { name: 'Responsive' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Exact design' }));

    const expectedScale = Math.min(1, window.innerWidth / 1440, (window.innerHeight - 36) / 900);
    expect(stage).toHaveAttribute('data-preview-sizing', 'exact');
    expect(stage).toHaveAttribute('data-viewport-width', '1440');
    expect(stage).toHaveAttribute('data-viewport-height', '900');
    expect(Number(stage.dataset.previewScale)).toBeCloseTo(expectedScale);
    expect(previewDocument).toHaveStyle({
      width: '1440px',
      height: '900px',
      transform: `scale(${expectedScale})`,
    });
    expect(screen.getByRole('button', { name: 'Exact design' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Responsive' }));
    expect(stage).toHaveAttribute('data-preview-sizing', 'responsive');
    expect(stage).toHaveAttribute('data-viewport-width', String(window.innerWidth));
    expect(previewDocument.style.transform).toBe('');
  });
});
