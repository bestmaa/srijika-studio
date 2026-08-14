import { describe, expect, it, vi } from 'vitest';

import { persistSrijikaOwnershipFiles } from '../src/durable-save';

describe('VS Code durable ownership writer', () => {
  it('saves every created file instead of leaving zero-byte dirty buffers', async () => {
    const saves: string[] = [];
    await persistSrijikaOwnershipFiles(['Feature.ui.tsx', 'Feature.connector.tsx'], (path) =>
      Promise.resolve({
        save() {
          saves.push(path);
          return Promise.resolve(true);
        },
      }),
    );
    expect(saves).toEqual(['Feature.ui.tsx', 'Feature.connector.tsx']);
  });

  it('stops and reports the exact file when VS Code cannot persist it', async () => {
    const openDocument = vi.fn((path: string) =>
      Promise.resolve({
        save() {
          return Promise.resolve(path !== 'Feature.connector.tsx');
        },
      }),
    );
    await expect(
      persistSrijikaOwnershipFiles(
        ['Feature.ui.tsx', 'Feature.connector.tsx', 'feature.logic.ts'],
        openDocument,
      ),
    ).rejects.toThrow('VS Code could not persist Feature.connector.tsx to disk.');
    expect(openDocument).toHaveBeenCalledTimes(2);
  });
});
