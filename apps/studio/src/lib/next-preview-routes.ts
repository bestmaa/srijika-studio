import type { CodeProjectEntry } from './project-service';

const PAGE_FILE = /\/page\.(?:[cm]?[jt]sx?)$/iu;
const PARAMETER = /^\[([A-Za-z][A-Za-z0-9_]*)\]$/u;
const CATCH_ALL = /^\[\.\.\.([A-Za-z][A-Za-z0-9_]*)\]$/u;
const OPTIONAL_CATCH_ALL = /^\[\[\.\.\.([A-Za-z][A-Za-z0-9_]*)\]\]$/u;
const SAFE_VALUE = /^[A-Za-z0-9._~-]{1,128}$/u;

export interface NextPreviewRouteParameter {
  name: string;
  kind: 'single' | 'catch-all' | 'optional-catch-all';
}

export interface NextPreviewRoute {
  id: string;
  pathname: string;
  parameters: readonly NextPreviewRouteParameter[];
  routeGroups: readonly string[];
  states: readonly ('loading' | 'error')[];
}

function parameterFor(segment: string): NextPreviewRouteParameter | null {
  const optional = OPTIONAL_CATCH_ALL.exec(segment);
  if (optional) return { name: optional[1]!, kind: 'optional-catch-all' };
  const catchAll = CATCH_ALL.exec(segment);
  if (catchAll) return { name: catchAll[1]!, kind: 'catch-all' };
  const single = PARAMETER.exec(segment);
  return single ? { name: single[1]!, kind: 'single' } : null;
}

export function nextPreviewRoutes(
  entries: readonly CodeProjectEntry[],
): readonly NextPreviewRoute[] {
  const files = new Set(
    entries.filter(({ kind }) => kind === 'file').map(({ relativePath }) => relativePath),
  );
  const hasRootApp = [...files].some((path) => path.startsWith('app/'));
  const hasSourceApp = [...files].some((path) => path.startsWith('src/app/'));
  if (hasRootApp === hasSourceApp) return [];
  const appRoot = hasRootApp ? 'app' : 'src/app';
  return [...files]
    .filter((file) => file.startsWith(`${appRoot}/`) && PAGE_FILE.test(file))
    .map((file): NextPreviewRoute => {
      const relativePage = file.slice(appRoot.length + 1);
      const directory = relativePage.includes('/')
        ? relativePage.slice(0, relativePage.lastIndexOf('/'))
        : '';
      const segments = directory ? directory.split('/') : [];
      const publicSegments = segments.filter(
        (segment) => !/^\([^/]+\)$/u.test(segment) && !segment.startsWith('@'),
      );
      const states = new Set<'loading' | 'error'>();
      let owner = file.slice(0, file.lastIndexOf('/'));
      while (owner === appRoot || owner.startsWith(`${appRoot}/`)) {
        for (const state of ['loading', 'error'] as const) {
          if ([...files].some((candidate) => candidate.startsWith(`${owner}/${state}.`))) {
            states.add(state);
          }
        }
        if (owner === appRoot) break;
        owner = owner.slice(0, owner.lastIndexOf('/'));
      }
      return {
        id: file,
        pathname: publicSegments.length === 0 ? '/' : `/${publicSegments.join('/')}`,
        parameters: publicSegments.flatMap((segment) => {
          const parameter = parameterFor(segment);
          return parameter ? [parameter] : [];
        }),
        routeGroups: segments.filter((segment) => /^\([^/]+\)$/u.test(segment)),
        states: [...states].sort(),
      };
    })
    .sort(
      (left, right) =>
        left.pathname.localeCompare(right.pathname) || left.id.localeCompare(right.id),
    );
}

export function resolveNextPreviewRoute(
  route: NextPreviewRoute,
  values: Readonly<Record<string, string>>,
): string {
  const parameters = new Map(route.parameters.map((parameter) => [parameter.name, parameter]));
  const segments = route.pathname === '/' ? [] : route.pathname.slice(1).split('/');
  const resolved = segments.flatMap((segment) => {
    const parameter = parameterFor(segment);
    if (!parameter) return [segment];
    const definition = parameters.get(parameter.name)!;
    const value = values[parameter.name]?.trim() ?? '';
    if (!value && definition.kind === 'optional-catch-all') return [];
    const parts = definition.kind === 'single' ? [value] : value.split('/');
    if (
      !value ||
      parts.length > 16 ||
      parts.some((part) => part === '.' || part === '..' || !SAFE_VALUE.test(part))
    ) {
      throw new Error(`Enter a safe ${parameter.name} route value.`);
    }
    return parts.map(encodeURIComponent);
  });
  return resolved.length === 0 ? '/' : `/${resolved.join('/')}`;
}

export function sameOriginPreviewUrl(baseUrl: string, route: string): string {
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') {
    throw new Error('Managed preview requires a tracked loopback origin.');
  }
  const target = new URL(route, base);
  if (target.origin !== base.origin || target.search || target.hash) {
    throw new Error('Managed preview route must stay on the tracked project origin.');
  }
  return target.href;
}
