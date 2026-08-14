/**
 * Tauri rejects commands with a serialized `{ code, message }` object rather
 * than a JavaScript Error instance. Keep native failures human-readable in the
 * Studio status bar instead of collapsing them to "[object Object]".
 */
export function projectServiceErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const message = record['message'];
    const code = record['code'];
    if (typeof message === 'string' && message.trim()) {
      return typeof code === 'string' && code.trim() ? `${message} [${code}]` : message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown desktop error.';
    }
  }
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  return 'Unknown desktop error.';
}
