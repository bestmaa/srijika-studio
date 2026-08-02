// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openBrowserPreview } from '../../apps/studio/src/lib/project-service';

describe('openBrowserPreview', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('opens and focuses the preview route in a normal browser', async () => {
    const focus = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window);

    await openBrowserPreview();

    expect(open).toHaveBeenCalledWith('http://localhost:3000/preview', 'sutra-preview');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('reports a blocked browser popup', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(openBrowserPreview()).rejects.toThrow('browser blocked the preview window');
  });
});
