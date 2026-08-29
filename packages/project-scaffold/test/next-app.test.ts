import { buildSrijikaTestContract } from '@srijika/architecture-rules';
import { describe, expect, it } from 'vitest';

import { buildSrijikaNextAppRouterPlan } from '../src';

describe('Srijika Next App Router ownership adapter', () => {
  it('generates thin dynamic routes for valid server owners', () => {
    const sources = {
      'src/features/product/Product.ui.tsx':
        'export async function ProductUI() { return <main>Product</main>; }',
      'src/features/product/Product.connector.tsx':
        "import { ProductUI } from './Product.ui'; export async function ProductConnector() { return <ProductUI />; }",
    };
    const plan = buildSrijikaNextAppRouterPlan(
      buildSrijikaTestContract(
        Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
      ),
      { routes: [{ pathname: '/products/[productId]', ownerId: 'feature:product' }], sources },
    );
    expect(plan.ready).toBe(true);
    expect(plan.boundaries).toMatchObject([{ ownerId: 'feature:product', kind: 'server' }]);
    expect(plan.files).toContainEqual(
      expect.objectContaining({ relativePath: 'src/app/products/[productId]/page.tsx' }),
    );
    expect(
      plan.files.find(({ relativePath }) => relativePath.endsWith('/page.tsx'))?.source,
    ).toContain('ProductConnector');
  });

  it('fails closed for missing client directives and mixed async client owners', () => {
    const missingSources = {
      'src/features/search/Search.ui.tsx': 'export function SearchUI() { return <main />; }',
      'src/features/search/Search.connector.tsx':
        "import { useState } from 'react'; import { SearchUI } from './Search.ui'; export function SearchConnector() { useState(0); return <SearchUI />; }",
    };
    const contract = buildSrijikaTestContract(
      Object.entries(missingSources).map(([fileName, source]) => ({ fileName, source })),
    );
    const missing = buildSrijikaNextAppRouterPlan(contract, {
      routes: [{ pathname: '/', ownerId: 'feature:search' }],
      sources: missingSources,
    });
    expect(missing.ready).toBe(false);
    expect(missing.diagnostics[0]?.code).toBe('SRIJIKA-NEXT-MISSING-CLIENT-DIRECTIVE');

    const mixedSources = {
      ...missingSources,
      'src/features/search/Search.connector.tsx':
        "'use client'; import { SearchUI } from './Search.ui'; export function SearchConnector() { return <SearchUI />; }",
      'src/features/search/Search.ui.tsx':
        'export async function SearchUI() { return <main>Async</main>; }',
    };
    const mixed = buildSrijikaNextAppRouterPlan(contract, {
      routes: [{ pathname: '/', ownerId: 'feature:search' }],
      sources: mixedSources,
    });
    expect(mixed.ready).toBe(false);
    expect(mixed.diagnostics.map(({ code }) => code)).toContain(
      'SRIJIKA-NEXT-MIXED-SERVER-CLIENT-BOUNDARY',
    );
  });

  it('rejects unsafe, parallel-slot, and duplicate route paths', () => {
    const contract = buildSrijikaTestContract([]);
    expect(() =>
      buildSrijikaNextAppRouterPlan(contract, {
        routes: [{ pathname: '/@modal', ownerId: 'feature:missing' }],
        sources: {},
      }),
    ).toThrow(/unsupported/);
    expect(() =>
      buildSrijikaNextAppRouterPlan(contract, {
        routes: [
          { pathname: '/', ownerId: 'feature:missing' },
          { pathname: '/', ownerId: 'feature:missing' },
        ],
        sources: {},
      }),
    ).toThrow(/unique/);
  });

  it('keeps Payload Local API behind a server owner boundary', () => {
    const sources = {
      'src/features/posts/Posts.ui.tsx': 'export function PostsUI() { return <main>Posts</main>; }',
      'src/features/posts/Posts.connector.tsx':
        "'use client'; import { getPayload } from 'payload'; import { PostsUI } from './Posts.ui'; export function PostsConnector() { void getPayload; return <PostsUI />; }",
    };
    const contract = buildSrijikaTestContract(
      Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
    );
    const plan = buildSrijikaNextAppRouterPlan(contract, {
      routes: [{ pathname: '/posts', ownerId: 'feature:posts' }],
      sources,
    });

    expect(plan.ready).toBe(false);
    expect(plan.boundaries[0]?.serverEvidence).toContain(
      'src/features/posts/Posts.connector.tsx:import:payload',
    );
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SRIJIKA-NEXT-MIXED-SERVER-CLIENT-BOUNDARY' }),
    );
  });
});
