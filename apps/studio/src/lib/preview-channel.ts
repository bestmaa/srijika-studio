import type { UiDocument } from '@srijika/contracts';

const CHANNEL_NAME = 'srijika-studio-preview-v1';
const STORAGE_KEY = 'srijika-studio:active-document';
const VIEWPORT_CHANNEL_NAME = 'srijika-studio-preview-viewport-v1';
const VIEWPORT_STORAGE_KEY = 'srijika-studio:preview-viewport';

export interface PreviewViewportSize {
  width: number;
  height: number;
}

function safePreviewViewportSize(value: unknown): PreviewViewportSize | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PreviewViewportSize>;
  if (
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height) ||
    Number(candidate.width) <= 0 ||
    Number(candidate.height) <= 0
  ) {
    return null;
  }
  return {
    width: Math.round(Number(candidate.width)),
    height: Math.round(Number(candidate.height)),
  };
}

export function persistPreviewDocument(document: UiDocument): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(document);
  channel.close();
}

export function loadPreviewDocument(): UiDocument | null {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) return null;
  try {
    return JSON.parse(serialized) as UiDocument;
  } catch {
    return null;
  }
}

export function subscribePreviewDocument(listener: (document: UiDocument) => void): () => void {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.addEventListener('message', (event: MessageEvent<UiDocument>) => {
    listener(event.data);
  });
  return () => channel.close();
}

export function persistPreviewViewportSize(viewport: PreviewViewportSize): void {
  const safeViewport = safePreviewViewportSize(viewport);
  if (!safeViewport) throw new Error('Preview viewport dimensions must be positive numbers');
  localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(safeViewport));
  const channel = new BroadcastChannel(VIEWPORT_CHANNEL_NAME);
  channel.postMessage(safeViewport);
  channel.close();
}

export function loadPreviewViewportSize(): PreviewViewportSize | null {
  const serialized = localStorage.getItem(VIEWPORT_STORAGE_KEY);
  if (!serialized) return null;
  try {
    return safePreviewViewportSize(JSON.parse(serialized));
  } catch {
    return null;
  }
}

export function subscribePreviewViewportSize(
  listener: (viewport: PreviewViewportSize) => void,
): () => void {
  const channel = new BroadcastChannel(VIEWPORT_CHANNEL_NAME);
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    const viewport = safePreviewViewportSize(event.data);
    if (viewport) listener(viewport);
  });
  return () => channel.close();
}
