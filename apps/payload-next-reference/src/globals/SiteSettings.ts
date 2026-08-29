import type { GlobalConfig } from 'payload';

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  access: { read: () => true },
  fields: [{ name: 'siteName', type: 'text', required: true, defaultValue: 'Payload reference' }],
};
