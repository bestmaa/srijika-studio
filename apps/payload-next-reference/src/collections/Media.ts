import type { CollectionConfig } from 'payload';

export const Media: CollectionConfig = {
  slug: 'media',
  upload: {
    mimeTypes: ['image/*'],
    imageSizes: [{ name: 'card', width: 768, height: 432, position: 'centre' }],
  },
  access: { read: () => true },
  fields: [{ name: 'alt', type: 'text', required: true }],
};
