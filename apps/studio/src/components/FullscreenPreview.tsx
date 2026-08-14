import { Focus, Minimize2, Radio, Scaling } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { UiDocument } from '@srijika/contracts';
import { SrijikaRenderer } from '@srijika/react-renderer';

import { componentRegistry } from '../lib/registry';
import { VIEWPORT_PRESET_SIZES, defaultSymbolValues, useStudioStore } from '../store/studio-store';

interface FullscreenPreviewProps {
  documentOverride?: UiDocument;
  symbolValuesOverride?: Record<string, unknown>;
  onClose: () => void;
}

export function FullscreenPreview({
  documentOverride,
  symbolValuesOverride,
  onClose,
}: FullscreenPreviewProps) {
  const storedDocument = useStudioStore((state) => state.document);
  const document = documentOverride ?? storedDocument;
  const viewport = useStudioStore((state) => state.viewport);
  const customViewportSize = useStudioStore((state) => state.customViewportSize);
  const viewportSize = customViewportSize ?? VIEWPORT_PRESET_SIZES[viewport];
  const symbols = useMemo(
    () => ({ ...defaultSymbolValues(document), ...symbolValuesOverride }),
    [document, symbolValuesOverride],
  );
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [sizingMode, setSizingMode] = useState<'responsive' | 'exact'>('responsive');
  const [windowSize, setWindowSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [scale, setScale] = useState(1);
  const events = useMemo(
    () =>
      Object.fromEntries(
        Object.values(document.symbols)
          .filter((symbol) => symbol.valueType === 'event')
          .map((symbol) => [symbol.id, () => setLastEvent(symbol.displayName)]),
      ),
    [document],
  );

  useEffect(() => {
    const fitPreview = (): void => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
      setScale(
        Math.min(window.innerWidth / viewportSize.width, window.innerHeight / viewportSize.height),
      );
    };
    fitPreview();
    window.addEventListener('resize', fitPreview);
    return () => window.removeEventListener('resize', fitPreview);
  }, [viewportSize.height, viewportSize.width]);

  const renderedViewport = sizingMode === 'responsive' ? windowSize : viewportSize;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <section
      className="fullscreen-preview"
      role="dialog"
      aria-label="Fullscreen design preview"
      aria-modal="true"
    >
      <div className={`fullscreen-preview-viewport is-${sizingMode}`}>
        <div
          className={`fullscreen-preview-stage is-${sizingMode}`}
          data-preview-sizing={sizingMode}
          data-viewport-height={renderedViewport.height}
          data-viewport-width={renderedViewport.width}
          style={
            sizingMode === 'exact'
              ? {
                  width: viewportSize.width * scale,
                  height: viewportSize.height * scale,
                }
              : undefined
          }
        >
          <div
            className={`fullscreen-preview-document is-${sizingMode}`}
            style={
              sizingMode === 'exact'
                ? {
                    width: viewportSize.width,
                    height: viewportSize.height,
                    transform: `scale(${scale})`,
                  }
                : undefined
            }
          >
            <SrijikaRenderer
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

      <div className="fullscreen-preview-controls">
        <span>
          <Radio size={13} /> {renderedViewport.width} × {renderedViewport.height}
        </span>
        <button
          type="button"
          onClick={() =>
            setSizingMode((current) => (current === 'responsive' ? 'exact' : 'responsive'))
          }
          aria-label={
            sizingMode === 'responsive' ? 'Show exact design size' : 'Show responsive viewport'
          }
        >
          {sizingMode === 'responsive' ? <Focus size={15} /> : <Scaling size={15} />}
          {sizingMode === 'responsive' ? 'Exact size' : 'Responsive'}
        </button>
        <button type="button" onClick={onClose} aria-label="Exit fullscreen preview">
          <Minimize2 size={16} />
          Exit preview
        </button>
      </div>

      {lastEvent && (
        <button
          className="fullscreen-preview-event"
          type="button"
          onClick={() => setLastEvent(null)}
          aria-label={`Dismiss event ${lastEvent}`}
        >
          Event fired: {lastEvent}
        </button>
      )}
    </section>
  );
}
