import type { UiDocument } from '@sutra/contracts';

interface LoadedDocumentResponse {
  path: string;
  bytes: number;
  document: unknown;
}

interface SavedDocumentResponse {
  path: string;
  bytes: number;
  replaced: boolean;
}

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertByteCount(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Desktop returned an invalid byte count');
}

function loadedResponse(value: unknown): LoadedDocumentResponse {
  if (!isRecord(value) || typeof value['path'] !== 'string' || !('document' in value))
    throw new Error('Desktop returned an invalid document response');
  assertByteCount(value['bytes']);
  return {
    path: value['path'],
    bytes: value['bytes'],
    document: value['document'],
  };
}

function savedResponse(value: unknown): SavedDocumentResponse {
  if (
    !isRecord(value) ||
    typeof value['path'] !== 'string' ||
    typeof value['replaced'] !== 'boolean'
  )
    throw new Error('Desktop returned an invalid save response');
  assertByteCount(value['bytes']);
  return {
    path: value['path'],
    bytes: value['bytes'],
    replaced: value['replaced'],
  };
}

export async function chooseAndLoadDocument(): Promise<LoadedDocumentResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ open }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await open({
    title: 'Open Sutra UI document',
    multiple: false,
    directory: false,
    filters: [{ name: 'Sutra UI document', extensions: ['json'] }],
  });
  if (typeof path !== 'string') return null;
  return loadedResponse(await invoke<unknown>('load_ui_document', { request: { path } }));
}

export async function chooseAndSaveDocument(
  document: UiDocument,
): Promise<SavedDocumentResponse | null> {
  if (!isTauriDesktop()) return null;
  const [{ save }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ]);
  const path = await save({
    title: 'Save Sutra UI document',
    defaultPath: `${document.id}.sutra.json`,
    filters: [{ name: 'Sutra UI document', extensions: ['json'] }],
  });
  if (!path) return null;
  return savedResponse(
    await invoke<unknown>('save_ui_document', {
      request: { path, document },
    }),
  );
}
