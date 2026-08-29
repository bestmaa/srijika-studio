import { describe, expect, it } from 'vitest';

import {
  analyzeSrijikaPayloadNextProfile,
  classifySrijikaPayloadServerModule,
  srijikaRuntimeServerImports,
} from '../src/payload-next';

describe('Payload CMS + Next.js profile', () => {
  it('requires both Payload runtime packages before enabling the profile', () => {
    expect(
      analyzeSrijikaPayloadNextProfile({
        dependencies: { payload: '3.88.0' },
        files: [],
      }).detected,
    ).toBe(false);
    expect(
      analyzeSrijikaPayloadNextProfile({
        dependencies: { payload: '3.88.0', '@payloadcms/next': '3.88.0' },
        files: [],
      }).detected,
    ).toBe(true);
  });

  it('protects Payload configuration, routes, schema, migrations, Local API, and uploads', () => {
    const profile = analyzeSrijikaPayloadNextProfile({
      dependencies: {
        payload: '3.88.0',
        '@payloadcms/next': '3.88.0',
        '@payloadcms/db-postgres': '3.88.0',
      },
      files: [
        { relativePath: 'src/payload.config.ts', source: '' },
        { relativePath: 'src/collections/Posts.ts', source: '' },
        { relativePath: 'src/globals/Site.ts', source: '' },
        { relativePath: 'src/migrations/20260829.ts', source: '' },
        { relativePath: 'src/payload-types.ts', source: '' },
        { relativePath: 'src/app/(payload)/admin/importMap.ts', source: '' },
        { relativePath: 'src/app/(payload)/admin/[[...segments]]/page.tsx', source: '' },
        { relativePath: 'src/app/(payload)/api/[...slug]/route.ts', source: '' },
        { relativePath: 'src/lib/posts.ts', source: "import { getPayload } from 'payload';" },
        {
          relativePath: 'src/lib/storage.ts',
          source: "import { s3Storage } from '@payloadcms/storage-s3';",
        },
      ],
    });

    expect(profile).toMatchObject({
      detected: true,
      databaseAdapters: ['@payloadcms/db-postgres'],
      configPaths: ['src/payload.config.ts'],
      collections: ['src/collections/Posts.ts'],
      globals: ['src/globals/Site.ts'],
      migrations: ['src/migrations/20260829.ts'],
      generatedTypes: ['src/payload-types.ts'],
      generatedImportMaps: ['src/app/(payload)/admin/importMap.ts'],
      adminRoutes: [
        'src/app/(payload)/admin/[[...segments]]/page.tsx',
        'src/app/(payload)/admin/importMap.ts',
      ],
      apiRoutes: ['src/app/(payload)/api/[...slug]/route.ts'],
      localApiFiles: ['src/lib/posts.ts'],
      uploadStorage: ['src/lib/storage.ts'],
    });
    expect(profile.protectedServerFiles).toContain('src/payload-types.ts');
  });

  it('distinguishes type-only generated contracts from runtime server imports', () => {
    expect(
      srijikaRuntimeServerImports(
        'Post.ui.tsx',
        "import type { Post } from '../payload-types';\nimport { getPayload } from 'payload';",
      ),
    ).toEqual([expect.objectContaining({ specifier: 'payload', kind: 'payload' })]);
    expect(classifySrijikaPayloadServerModule('pg')).toBe('database');
    expect(classifySrijikaPayloadServerModule('@payloadcms/db-postgres')).toBe('database');
    expect(classifySrijikaPayloadServerModule('../payload-types')).toBeNull();
  });
});
