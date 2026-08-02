import { useEffect, useMemo, useRef, useState } from 'react';

import { assertDocumentSemantics } from '@sutra/component-registry';
import { validateUiDocument, type UiDocument } from '@sutra/contracts';
import { SutraRenderer } from '@sutra/react-renderer';

import {
  loadPreviewDocument,
  loadPreviewViewportSize,
  subscribePreviewDocument,
  subscribePreviewViewportSize,
  type PreviewViewportSize,
} from '../lib/preview-channel';
import { componentRegistry } from '../lib/registry';
import { createStarterDocument } from '../lib/starter';
import { VIEWPORT_PRESET_SIZES, defaultSymbolValues } from '../store/studio-store';

type PreviewSizingMode = 'responsive' | 'exact';

const PREVIEW_TOOLBAR_HEIGHT = 36;

function initialResponsiveViewport(): PreviewViewportSize {
  return {
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight - PREVIEW_TOOLBAR_HEIGHT)),
  };
}

function sameViewport(left: PreviewViewportSize, right: PreviewViewportSize): boolean {
  return left.width === right.width && left.height === right.height;
}

function safePreviewDocument(value: unknown): UiDocument | null {
  const result = validateUiDocument(value);
  if (!result.valid || !result.value) return null;
  try {
    assertDocumentSemantics(result.value, componentRegistry);
    return result.value;
  } catch {
    return null;
  }
}

export function PreviewApp() {
  const [document, setDocument] = useState<UiDocument>(() => {
    return safePreviewDocument(loadPreviewDocument()) ?? createStarterDocument();
  });
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [sizingMode, setSizingMode] = useState<PreviewSizingMode>('responsive');
  const [designViewport, setDesignViewport] = useState<PreviewViewportSize>(() => {
    return loadPreviewViewportSize() ?? VIEWPORT_PRESET_SIZES.desktop;
  });
  const [responsiveViewport, setResponsiveViewport] =
    useState<PreviewViewportSize>(initialResponsiveViewport);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const symbols = useMemo(() => defaultSymbolValues(document), [document]);
  const events = useMemo(
    () =>
      Object.fromEntries(
        Object.values(document.symbols)
          .filter((symbol) => symbol.valueType === 'event')
          .map((symbol) => [symbol.id, () => setLastEvent(symbol.displayName)]),
      ),
    [document],
  );

  useEffect(
    () =>
      subscribePreviewDocument((nextDocument) => {
        const valid = safePreviewDocument(nextDocument);
        if (valid) setDocument(valid);
      }),
    [],
  );

  useEffect(
    () =>
      subscribePreviewViewportSize((nextViewport) => {
        setDesignViewport(nextViewport);
      }),
    [],
  );

  useEffect(() => {
    const previewViewport = previewViewportRef.current;
    if (!previewViewport) return;

    const measure = (): void => {
      const nextViewport = {
        width: Math.max(1, Math.round(previewViewport.clientWidth || window.innerWidth)),
        height: Math.max(
          1,
          Math.round(previewViewport.clientHeight || window.innerHeight - PREVIEW_TOOLBAR_HEIGHT),
        ),
      };
      setResponsiveViewport((current) =>
        sameViewport(current, nextViewport) ? current : nextViewport,
      );
    };

    measure();
    window.addEventListener('resize', measure);
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure());
    resizeObserver?.observe(previewViewport);
    return () => {
      window.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, []);

  const exactScale = Math.max(
    0.01,
    Math.min(
      1,
      responsiveViewport.width / designViewport.width,
      responsiveViewport.height / designViewport.height,
    ),
  );
  const renderedViewport = sizingMode === 'responsive' ? responsiveViewport : designViewport;

  return (
    <div className="preview-shell">
      <div className="preview-toolbar">
        <span>
          <strong>Sutra</strong> live preview
        </span>
        <div className="preview-toolbar-controls">
          <span className="preview-viewport-readout" aria-live="polite">
            {renderedViewport.width} &times; {renderedViewport.height}
            {sizingMode === 'exact' && exactScale < 1 ? ` / ${Math.round(exactScale * 100)}%` : ''}
          </span>
          <div className="preview-sizing-switch" role="group" aria-label="Preview sizing mode">
            <button
              type="button"
              className={sizingMode === 'responsive' ? 'is-active' : undefined}
              aria-pressed={sizingMode === 'responsive'}
              onClick={() => setSizingMode('responsive')}
            >
              Responsive
            </button>
            <button
              type="button"
              className={sizingMode === 'exact' ? 'is-active' : undefined}
              aria-pressed={sizingMode === 'exact'}
              onClick={() => setSizingMode('exact')}
            >
              Exact design
            </button>
          </div>
          <span className="live-indicator">
            <i /> Synced
          </span>
        </div>
      </div>
      {lastEvent && (
        <div className="preview-toast" role="status">
          Event fired: {lastEvent}
          <button
            type="button"
            onClick={() => setLastEvent(null)}
            aria-label="Dismiss event message"
          >
            ×
          </button>
        </div>
      )}
      <div
        ref={previewViewportRef}
        className={`preview-viewport is-${sizingMode}`}
        data-preview-sizing={sizingMode}
      >
        <div
          className={`browser-preview-stage is-${sizingMode}`}
          data-preview-sizing={sizingMode}
          data-preview-scale={sizingMode === 'exact' ? exactScale : 1}
          data-viewport-height={renderedViewport.height}
          data-viewport-width={renderedViewport.width}
          style={
            sizingMode === 'exact'
              ? {
                  width: designViewport.width * exactScale,
                  height: designViewport.height * exactScale,
                }
              : undefined
          }
        >
          <div
            className={`preview-document is-${sizingMode}`}
            style={
              sizingMode === 'exact'
                ? {
                    width: designViewport.width,
                    height: designViewport.height,
                    transform: `scale(${exactScale})`,
                  }
                : undefined
            }
          >
            <SutraRenderer
              document={document}
              registry={componentRegistry}
              mode="preview"
              viewportWidth={renderedViewport.width}
              symbols={symbols}
              events={events}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
