import { posix } from 'node:path';

import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
} from './project-filesystem.js';

const NEXT_ROUTE_FILE = /^(?:page|loading|error|not-found)\.(?:[cm]?[jt]sx?)$/iu;
const DYNAMIC_SEGMENT = /^\[([A-Za-z][A-Za-z0-9_]*)\]$/u;
const CATCH_ALL_SEGMENT = /^\[\.\.\.([A-Za-z][A-Za-z0-9_]*)\]$/u;
const OPTIONAL_CATCH_ALL_SEGMENT = /^\[\[\.\.\.([A-Za-z][A-Za-z0-9_]*)\]\]$/u;
const SAFE_ROUTE_VALUE = /^[A-Za-z0-9._~-]{1,128}$/u;

export type SrijikaNextPreviewBoundaryKind = 'loading' | 'error' | 'not-found';

export interface SrijikaNextPreviewParameter {
  name: string;
  kind: 'single' | 'catch-all' | 'optional-catch-all';
}

export interface SrijikaNextPreviewRoute {
  id: string;
  pathname: string;
  pageFile: string;
  routeGroups: readonly string[];
  parameters: readonly SrijikaNextPreviewParameter[];
  boundaries: Readonly<Partial<Record<SrijikaNextPreviewBoundaryKind, string>>>;
}

export interface SrijikaNextLivePreviewManifest {
  version: 'srijika-next-live-preview-v1';
  framework: 'next-app-router';
  appRoot: 'app' | 'src/app';
  routes: readonly SrijikaNextPreviewRoute[];
}

function routeSegments(appRoot: string, pageFile: string): string[] {
  const directory = posix.dirname(pageFile).slice(appRoot.length).replace(/^\/+/, '');
  return directory ? directory.split('/') : [];
}

function routeParameter(segment: string): SrijikaNextPreviewParameter | null {
  const optional = OPTIONAL_CATCH_ALL_SEGMENT.exec(segment);
  if (optional) return { name: optional[1]!, kind: 'optional-catch-all' };
  const catchAll = CATCH_ALL_SEGMENT.exec(segment);
  if (catchAll) return { name: catchAll[1]!, kind: 'catch-all' };
  const dynamic = DYNAMIC_SEGMENT.exec(segment);
  return dynamic ? { name: dynamic[1]!, kind: 'single' } : null;
}

function publicSegments(segments: readonly string[]): string[] {
  return segments.filter((segment) => !/^\([^/]+\)$/u.test(segment) && !segment.startsWith('@'));
}

function pathnameFor(segments: readonly string[]): string {
  const publicRoute = publicSegments(segments);
  return publicRoute.length === 0 ? '/' : `/${publicRoute.join('/')}`;
}

function inheritedBoundary(
  files: ReadonlySet<string>,
  appRoot: string,
  pageFile: string,
  kind: SrijikaNextPreviewBoundaryKind,
): string | undefined {
  let directory = posix.dirname(pageFile);
  while (directory === appRoot || directory.startsWith(`${appRoot}/`)) {
    for (const extension of ['tsx', 'ts', 'jsx', 'js', 'mts', 'mjs', 'cts', 'cjs']) {
      const candidate = `${directory}/${kind}.${extension}`;
      if (files.has(candidate)) return candidate;
    }
    if (directory === appRoot) break;
    directory = posix.dirname(directory);
  }
  return undefined;
}

/** Discovers a bounded, symlink-free App Router route manifest for managed Studio preview. */
export async function inspectSrijikaNextLivePreview(
  projectRoot: string,
): Promise<SrijikaNextLivePreviewManifest> {
  const fileSystem = await SrijikaProjectFileSystem.open(projectRoot);
  const appRoots = (
    await Promise.all(
      (['app', 'src/app'] as const).map(async (root) => {
        try {
          await fileSystem.inspectDirectory(root);
          return root;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw error;
        }
      }),
    )
  ).filter((root): root is 'app' | 'src/app' => root !== null);
  if (appRoots.length !== 1) {
    throw new Error('A managed Next project must contain exactly one app or src/app directory.');
  }
  const appRoot = appRoots[0]!;
  const walked = await fileSystem.walkFiles([appRoot], {
    maximumFiles: 2_048,
    maximumEntries: 8_192,
    maximumDirectories: 1_024,
    maximumDepth: 32,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    acceptFile: (fileName) => NEXT_ROUTE_FILE.test(fileName),
  });
  const files = new Set(walked.map(({ relativePath }) => relativePath));
  const routes = walked
    .filter(({ relativePath }) => /\/page\.(?:[cm]?[jt]sx?)$/iu.test(relativePath))
    .map(({ relativePath: pageFile }): SrijikaNextPreviewRoute => {
      const segments = routeSegments(appRoot, pageFile);
      if (segments.some((segment) => segment.startsWith('.') || segment.includes('\\'))) {
        throw new Error(`${pageFile} contains an unsupported Next route segment.`);
      }
      const parameters = publicSegments(segments).flatMap((segment) => {
        const parameter = routeParameter(segment);
        return parameter ? [parameter] : [];
      });
      const boundaries = Object.fromEntries(
        (['loading', 'error', 'not-found'] as const).flatMap((kind) => {
          const file = inheritedBoundary(files, appRoot, pageFile, kind);
          return file ? [[kind, file]] : [];
        }),
      );
      return Object.freeze({
        id: pageFile,
        pathname: pathnameFor(segments),
        pageFile,
        routeGroups: Object.freeze(segments.filter((segment) => /^\([^/]+\)$/u.test(segment))),
        parameters: Object.freeze(parameters),
        boundaries: Object.freeze(boundaries),
      });
    })
    .sort(
      (left, right) =>
        left.pathname.localeCompare(right.pathname) || left.pageFile.localeCompare(right.pageFile),
    );
  return Object.freeze({
    version: 'srijika-next-live-preview-v1',
    framework: 'next-app-router',
    appRoot,
    routes: Object.freeze(routes),
  });
}

function parameterParts(
  parameter: SrijikaNextPreviewParameter,
  value: string | readonly string[] | undefined,
): string[] {
  if (value === undefined || value === '') {
    if (parameter.kind === 'optional-catch-all') return [];
    throw new Error(`Next preview route requires the ${parameter.name} parameter.`);
  }
  const parts: string[] =
    typeof value === 'string'
      ? parameter.kind === 'single'
        ? [value]
        : value.split('/')
      : [...value];
  if (parameter.kind === 'single' && parts.length !== 1) {
    throw new Error(`${parameter.name} accepts exactly one route segment.`);
  }
  if (
    parts.length === 0 ||
    parts.length > 16 ||
    parts.some((part) => part === '.' || part === '..' || !SAFE_ROUTE_VALUE.test(part))
  ) {
    throw new Error(`${parameter.name} contains an unsafe or unsupported route value.`);
  }
  return parts;
}

/** Resolves only a discovered route pattern; caller values cannot add an origin, query, or traversal. */
export function resolveSrijikaNextPreviewPath(
  route: SrijikaNextPreviewRoute,
  parameters: Readonly<Record<string, string | readonly string[] | undefined>> = {},
): string {
  const declared = new Set(route.parameters.map(({ name }) => name));
  if (Object.keys(parameters).some((name) => !declared.has(name))) {
    throw new Error('Next preview parameters must belong to the selected discovered route.');
  }
  const definitions = new Map(route.parameters.map((parameter) => [parameter.name, parameter]));
  const segments = route.pathname === '/' ? [] : route.pathname.slice(1).split('/');
  const resolved = segments.flatMap((segment) => {
    const parameter = routeParameter(segment);
    if (!parameter) return [segment];
    const definition = definitions.get(parameter.name);
    if (!definition) throw new Error(`Missing discovered parameter ${parameter.name}.`);
    return parameterParts(definition, parameters[parameter.name]).map(encodeURIComponent);
  });
  return resolved.length === 0 ? '/' : `/${resolved.join('/')}`;
}
