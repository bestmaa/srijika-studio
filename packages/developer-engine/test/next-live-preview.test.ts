import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inspectSrijikaNextLivePreview, resolveSrijikaNextPreviewPath } from '../src/index.js';

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'srijika-next-preview-'));
  roots.push(root);
  for (const directory of [
    'src/app/(account)/auth/[provider]',
    'src/app/blog/[...slug]',
    'src/app/docs/[[...section]]',
  ]) {
    await mkdir(join(root, directory), { recursive: true });
  }
  for (const file of [
    'src/app/page.tsx',
    'src/app/loading.tsx',
    'src/app/error.tsx',
    'src/app/(account)/auth/[provider]/page.tsx',
    'src/app/(account)/auth/loading.tsx',
    'src/app/blog/[...slug]/page.tsx',
    'src/app/docs/[[...section]]/page.tsx',
  ]) {
    await writeFile(join(root, file), 'export default function Page() { return null; }\n');
  }
  return root;
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

describe('Next managed live preview', () => {
  it('discovers route groups, dynamic parameters, and inherited route states', async () => {
    const manifest = await inspectSrijikaNextLivePreview(await fixture());
    expect(manifest).toMatchObject({
      version: 'srijika-next-live-preview-v1',
      appRoot: 'src/app',
    });
    const auth = manifest.routes.find(({ pathname }) => pathname === '/auth/[provider]');
    expect(auth).toMatchObject({
      routeGroups: ['(account)'],
      parameters: [{ name: 'provider', kind: 'single' }],
      boundaries: {
        loading: 'src/app/(account)/auth/loading.tsx',
        error: 'src/app/error.tsx',
      },
    });
    expect(resolveSrijikaNextPreviewPath(auth!, { provider: 'github' })).toBe('/auth/github');
    const docs = manifest.routes.find(({ pathname }) => pathname.includes('section'))!;
    expect(resolveSrijikaNextPreviewPath(docs)).toBe('/docs');
    const blog = manifest.routes.find(({ pathname }) => pathname.startsWith('/blog'))!;
    expect(resolveSrijikaNextPreviewPath(blog, { slug: ['2026', 'launch'] })).toBe(
      '/blog/2026/launch',
    );
  });

  it('rejects route traversal, undeclared parameters, and project symlinks', async () => {
    const root = await fixture();
    const manifest = await inspectSrijikaNextLivePreview(root);
    const auth = manifest.routes.find(({ pathname }) => pathname === '/auth/[provider]')!;
    expect(() => resolveSrijikaNextPreviewPath(auth, { provider: '..' })).toThrow(/unsafe/);
    expect(() => resolveSrijikaNextPreviewPath(auth, { provider: 'github', extra: 'no' })).toThrow(
      /selected discovered route/,
    );
    await symlink(join(root, 'src/app/page.tsx'), join(root, 'src/app/linked.tsx'));
    await expect(inspectSrijikaNextLivePreview(root)).rejects.toThrow(/symbolic link/);
  });
});
