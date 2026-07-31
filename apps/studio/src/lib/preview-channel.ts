import type { UiDocument } from '@sutra/contracts';

const CHANNEL_NAME = 'sutra-studio-preview-v1';
const STORAGE_KEY = 'sutra-studio:active-document';

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
