import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../../', import.meta.url);
const oldBrand = ['su', 'tra'].join('');
const ignoredDirectories = new Set(['dist', 'node_modules', 'target']);
const allowedLegacyCompatibilityFiles = new Set([
  'apps/portal/scripts/sync-docs.mjs',
  'apps/studio/src/lib/codex-bridge.ts',
  'tests/integration/codex-bridge.integration.test.ts',
]);
const textExtensions = new Set([
  '.cmd',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

function collectFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        return ignoredDirectories.has(entry) ? [] : collectFiles(path);
      }
      return stats.isFile() && textExtensions.has(extname(entry)) ? [path] : [];
    })
    .sort();
}

describe('Srijika branding boundary', () => {
  it('keeps active product paths and text on the Srijika namespace', () => {
    const roots = ['apps', 'crates', 'docs', 'packages', 'plugins', 'tests'].map((directory) =>
      join(repositoryRoot.pathname, directory),
    );
    const files = roots.flatMap(collectFiles);
    const oldBrandPaths = files
      .map((path) => relative(repositoryRoot.pathname, path))
      .filter((path) => path.toLowerCase().includes(oldBrand));
    const oldBrandContents = files
      .filter((path) => basename(path) !== 'srijika-branding.unit.test.ts')
      .filter((path) => readFileSync(path, 'utf8').toLowerCase().includes(oldBrand))
      .map((path) => relative(repositoryRoot.pathname, path).replaceAll('\\', '/'))
      .filter((path) => !allowedLegacyCompatibilityFiles.has(path));

    expect(oldBrandPaths).toEqual([]);
    expect(oldBrandContents).toEqual([]);
  });

  it('publishes the expected app, extension, and plugin identities', () => {
    const workspace = JSON.parse(
      readFileSync(join(repositoryRoot.pathname, 'package.json'), 'utf8'),
    ) as { name: string };
    const extension = JSON.parse(
      readFileSync(join(repositoryRoot.pathname, 'apps/vscode-srijika/package.json'), 'utf8'),
    ) as { displayName: string; name: string; publisher: string };
    const plugin = JSON.parse(
      readFileSync(
        join(repositoryRoot.pathname, 'plugins/srijika-studio/.codex-plugin/plugin.json'),
        'utf8',
      ),
    ) as { name: string; interface: { displayName: string } };

    expect(workspace.name).toBe('srijika-studio-workspace');
    expect(extension).toMatchObject({
      name: 'srijika-language-support',
      displayName: 'Srijika Language Support',
      publisher: 'srijika',
    });
    expect(plugin).toMatchObject({
      name: 'srijika-studio',
      interface: { displayName: 'Srijika Studio' },
    });
  });
});
