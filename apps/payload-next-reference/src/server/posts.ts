import 'server-only';

import config from '@payload-config';
import { headers } from 'next/headers';
import { getPayload } from 'payload';

import type { Post } from '../payload-types';

export interface PostSummary {
  id: string;
  title: string;
  slug: string;
  summary: string;
  heroUrl: string | null;
}

const mockPosts: readonly Post[] = Object.freeze([
  {
    id: 'reference-1',
    title: 'Server-owned content, pure UI',
    slug: 'server-owned-content',
    summary: 'Payload loads on the server and Srijika UI receives only serializable data.',
    _status: 'published',
  },
  {
    id: 'reference-2',
    title: 'Authenticated mutations',
    slug: 'authenticated-mutations',
    summary: 'Client owners create and update through the Payload REST boundary.',
    _status: 'published',
  },
]);

function summary(post: Post): PostSummary {
  const heroUrl = post.hero && typeof post.hero === 'object' ? (post.hero.url ?? null) : null;
  return {
    id: String(post.id),
    title: post.title,
    slug: post.slug,
    summary: post.summary,
    heroUrl,
  };
}

async function payloadRequestContext() {
  return { headers: await headers() };
}

export async function listPublishedPosts(): Promise<readonly PostSummary[]> {
  if (process.env['PAYLOAD_REFERENCE_MODE'] === 'mock') return mockPosts.map(summary);
  const payload = await getPayload({ config });
  const result = await payload.find({
    collection: 'posts',
    depth: 1,
    draft: false,
    limit: 50,
    overrideAccess: false,
    req: await payloadRequestContext(),
    sort: '-updatedAt',
    where: { _status: { equals: 'published' } },
  });
  return result.docs.map((post) => summary(post as Post));
}

export async function findPostBySlug(slug: string): Promise<PostSummary | null> {
  if (process.env['PAYLOAD_REFERENCE_MODE'] === 'mock') {
    const post = mockPosts.find((candidate) => candidate.slug === slug);
    return post ? summary(post) : null;
  }
  const payload = await getPayload({ config });
  const result = await payload.find({
    collection: 'posts',
    depth: 1,
    draft: false,
    limit: 1,
    overrideAccess: false,
    req: await payloadRequestContext(),
    where: { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
  });
  const post = result.docs[0];
  return post ? summary(post as Post) : null;
}
