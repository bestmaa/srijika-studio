import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  typedRoutes: true,
};

export default withPayload(config);
