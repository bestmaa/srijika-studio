import { useEffect, useMemo, useState } from 'react';

import { assertDocumentSemantics } from '@sutra/component-registry';
import { validateUiDocument, type UiDocument } from '@sutra/contracts';
import { SutraRenderer } from '@sutra/react-renderer';

import { loadPreviewDocument, subscribePreviewDocument } from '../lib/preview-channel';
import { componentRegistry } from '../lib/registry';
import { createStarterDocument } from '../lib/starter';
import { defaultSymbolValues } from '../store/studio-store';

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

  return (
    <div className="preview-shell">
      <div className="preview-toolbar">
        <span>
          <strong>Sutra</strong> live preview
        </span>
        <span className="live-indicator">
          <i /> Synced
        </span>
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
      <div className="preview-document">
        <SutraRenderer
          document={document}
          registry={componentRegistry}
          mode="preview"
          symbols={symbols}
          events={events}
        />
      </div>
    </div>
  );
}
