import { describe, expect, it } from 'vitest';

import {
  nextPreviewRoutes,
  resolveNextPreviewRoute,
  sameOriginPreviewUrl,
} from '../../apps/studio/src/lib/next-preview-routes';
import type { CodeProjectEntry } from '../../apps/studio/src/lib/project-service';

const entry = (relativePath: string): CodeProjectEntry => ({
  path: `/project/${relativePath}`,
  relativePath,
  kind: 'file',
  bytes: 1,
  hash: 'hash',
  isUiSource: false,
});

describe('Studio Next preview routes', () => {
  it('models route groups, parameters, and loading/error states', () => {
    const routes = nextPreviewRoutes([
      entry('src/app/loading.tsx'),
      entry('src/app/error.tsx'),
      entry('src/app/(account)/auth/[provider]/page.tsx'),
      entry('src/app/docs/[[...section]]/page.tsx'),
    ]);
    expect(routes[0]).toMatchObject({
      pathname: '/auth/[provider]',
      routeGroups: ['(account)'],
      parameters: [{ name: 'provider', kind: 'single' }],
      states: ['error', 'loading'],
    });
    expect(resolveNextPreviewRoute(routes[0]!, { provider: 'github' })).toBe('/auth/github');
    expect(resolveNextPreviewRoute(routes[1]!, {})).toBe('/docs');
  });

  it('fails closed when both supported app roots contain routes', () => {
    expect(nextPreviewRoutes([entry('app/page.tsx'), entry('src/app/dashboard/page.tsx')])).toEqual(
      [],
    );
  });

  it('keeps preview navigation on the tracked loopback origin', () => {
    expect(sameOriginPreviewUrl('http://127.0.0.1:4318', '/auth/github')).toBe(
      'http://127.0.0.1:4318/auth/github',
    );
    expect(() => sameOriginPreviewUrl('http://127.0.0.1:4318', '//example.com')).toThrow(
      /tracked project origin/,
    );
    expect(() => sameOriginPreviewUrl('https://example.com', '/')).toThrow(/loopback/);
  });
});
