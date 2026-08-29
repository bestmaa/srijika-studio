import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from 'payload';

import { Media } from './collections/Media';
import { Posts } from './collections/Posts';
import { Users } from './collections/Users';
import { SiteSettings } from './globals/SiteSettings';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: sourceDirectory },
  },
  collections: [Users, Media, Posts],
  globals: [SiteSettings],
  editor: lexicalEditor(),
  db: postgresAdapter({
    pool: {
      connectionString:
        process.env['DATABASE_URL'] ??
        'postgresql://postgres:postgres@127.0.0.1:5432/srijika_payload',
    },
  }),
  secret: process.env['PAYLOAD_SECRET'] ?? 'local-reference-secret-change-before-deploy',
  typescript: { outputFile: path.resolve(sourceDirectory, 'payload-types.ts') },
});
