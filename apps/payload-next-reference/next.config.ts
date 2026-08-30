import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';

const config: NextConfig = {
  typedRoutes: true,
  turbopack: {
    rules: {
      '**/*.ui.tsx': {
        loaders: ['./src/srijika/next-preview-loader.cjs'],
        as: '*.tsx',
      },
    },
  },
};

export default withPayload(config);
