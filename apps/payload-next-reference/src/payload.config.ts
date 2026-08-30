import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from 'payload';
import sharp from 'sharp';

import { Media } from './collections/Media';
import { Posts } from './collections/Posts';
import { Users } from './collections/Users';
import { SiteSettings } from './globals/SiteSettings';
import { payloadRuntimeEnvironment } from './server/environment';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const environment = payloadRuntimeEnvironment();

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: sourceDirectory },
  },
  collections: [Users, Media, Posts],
  globals: [SiteSettings],
  editor: lexicalEditor(),
  db: postgresAdapter({
    migrationDir: path.resolve(sourceDirectory, 'migrations'),
    pool: {
      connectionString: environment.databaseUrl,
    },
  }),
  secret: environment.payloadSecret,
  sharp,
  typescript: { outputFile: path.resolve(sourceDirectory, 'payload-types.ts') },
});
