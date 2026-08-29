import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileSrijikaTsx } from '@srijika/tsx-compiler';
import { describe, expect, it, vi } from 'vitest';

import { mutatePost } from '../src/features/posts/posts.api';

describe('Payload reference owner contracts', () => {
  it('adds governed source markers only in the managed development compiler', async () => {
    const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
    const loaderPath = fileURLToPath(
      new URL('../src/srijika/next-preview-loader.cjs', import.meta.url),
    );
    const loader = createRequire(import.meta.url)(loaderPath) as (
      this: {
        rootContext: string;
        resourcePath: string;
      },
      source: string,
    ) => string;
    const resourcePath = fileURLToPath(
      new URL('../src/features/posts/Posts.ui.tsx', import.meta.url),
    );
    const source = await readFile(resourcePath, 'utf8');
    try {
      vi.stubEnv('NODE_ENV', 'development');
      expect(loader.call({ rootContext: projectRoot, resourcePath }, source)).toContain(
        'data-srijika-source="src/features/posts/Posts.ui.tsx:',
      );
      vi.stubEnv('NODE_ENV', 'production');
      expect(loader.call({ rootContext: projectRoot, resourcePath }, source)).toBe(source);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps the post list UI free of Payload and database runtime imports', async () => {
    const fileName = fileURLToPath(new URL('../src/features/posts/Posts.ui.tsx', import.meta.url));
    const source = await readFile(fileName, 'utf8');
    const result = compileSrijikaTsx(fileName, source, {
      resolvedTypeModules: [
        {
          specifier: '../../server/posts',
          fileName: 'src/server/posts.ts',
          source:
            'export interface PostSummary { id: string; title: string; slug: string; summary: string; heroUrl: string | null }',
        },
      ],
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('creates and updates through authenticated Payload REST requests', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ doc: { id: 'post-1' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ doc: { id: 'post-1' } })));
    vi.stubGlobal('fetch', fetchMock);
    const input = { title: 'Title', slug: 'title', summary: 'Summary', _status: 'draft' as const };

    await expect(mutatePost(input, { token: 'session-token' })).resolves.toEqual({ id: 'post-1' });
    await expect(mutatePost(input, { id: 'post-1', token: 'session-token' })).resolves.toEqual({
      id: 'post-1',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/posts',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/posts/post-1',
      expect.objectContaining({ method: 'PATCH', credentials: 'include' }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'JWT session-token',
    });
    vi.unstubAllGlobals();
  });
});
