import type { CollectionConfig } from 'payload';
import path from 'node:path';

const uploadDirectory = process.env['PAYLOAD_UPLOADS_DIR'] ?? path.resolve(process.cwd(), 'media');

export const Media: CollectionConfig = {
  slug: 'media',
  upload: {
    staticDir: uploadDirectory,
    mimeTypes: ['image/*'],
    imageSizes: [{ name: 'card', width: 768, height: 432, position: 'centre' }],
  },
  access: { read: () => true },
  fields: [{ name: 'alt', type: 'text', required: true }],
};
