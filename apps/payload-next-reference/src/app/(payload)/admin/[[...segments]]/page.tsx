import config from '@payload-config';
import { generatePageMetadata, RootPage } from '@payloadcms/next/views';
import type { Metadata } from 'next';

import { importMap } from '../importMap';

interface PageProps {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<Record<string, string | string[]>>;
}

export const generateMetadata = ({ params, searchParams }: PageProps): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams });

export default function AdminPage({ params, searchParams }: PageProps) {
  return RootPage({ config, params, searchParams, importMap });
}
