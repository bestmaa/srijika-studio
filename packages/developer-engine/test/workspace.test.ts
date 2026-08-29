import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeSrijikaProject } from '@srijika/project-scaffold';

import {
  checkSrijikaWorkspace,
  initializeSrijikaWorkspace,
  inspectSrijikaWorkspace,
  parseSrijikaWorkspaceManifest,
  synchronizeSrijikaWorkspaceTests,
} from '../src/workspace.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function monorepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-workspace-'));
  roots.push(root);
  await mkdir(join(root, 'apps'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'company-products', private: true, packageManager: 'pnpm@11.0.0' }, null, 2)}\n`,
  );
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await writeSrijikaProject(join(root, 'apps', 'storefront'), {
    projectName: 'storefront',
    displayName: 'Storefront',
  });
  const storefrontPackagePath = join(root, 'apps', 'storefront', 'package.json');
  const storefrontPackage = JSON.parse(await readFile(storefrontPackagePath, 'utf8')) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  storefrontPackage.scripts['dev'] = 'next dev';
  storefrontPackage.dependencies['next'] = '16.3.2';
  delete storefrontPackage.devDependencies['vite'];
  await writeFile(storefrontPackagePath, `${JSON.stringify(storefrontPackage, null, 2)}\n`);
  await writeSrijikaProject(join(root, 'apps', 'admin'), {
    projectName: 'admin',
    displayName: 'Admin',
  });
  return root;
}

describe('Srijika workspace contract', () => {
  it('rejects overlapping projects, duplicate ports, traversal, and unsupported fields', () => {
    const base = {
      version: 1,
      packageManager: 'pnpm',
      projects: [
        { id: 'web', root: 'apps/web', framework: 'vite', testPort: 4174 },
        { id: 'admin', root: 'apps/admin', framework: 'next', testPort: 4175 },
      ],
      sharedPackages: ['packages/design-system'],
    };
    expect(parseSrijikaWorkspaceManifest(JSON.stringify(base))).toMatchObject({
      version: 1,
      packageManager: 'pnpm',
      projects: [{ id: 'web' }, { id: 'admin' }],
    });
    expect(() =>
      parseSrijikaWorkspaceManifest(
        JSON.stringify({
          ...base,
          projects: [base.projects[0], { ...base.projects[1], root: 'apps/web/admin' }],
        }),
      ),
    ).toThrow(/must not overlap/);
    expect(() =>
      parseSrijikaWorkspaceManifest(
        JSON.stringify({
          ...base,
          projects: [base.projects[0], { ...base.projects[1], testPort: 4174 }],
        }),
      ),
    ).toThrow(/Duplicate Srijika workspace test port/);
    expect(() =>
      parseSrijikaWorkspaceManifest(JSON.stringify({ ...base, sharedPackages: ['../outside'] })),
    ).toThrow(/normalized project-relative path/);
    expect(() =>
      parseSrijikaWorkspaceManifest(JSON.stringify({ ...base, experimental: true })),
    ).toThrow(/experimental is not supported/);
  });

  it('discovers projects and generates portable VS Code and MCP workspace setup', async () => {
    const root = await monorepo();
    const initialized = await initializeSrijikaWorkspace({ workspace: root });

    expect(initialized.created).toEqual([
      'srijika.workspace.json',
      'srijika.code-workspace',
      '.mcp.json',
    ]);
    expect(initialized.manifest.projects).toEqual([
      { id: 'admin', root: 'apps/admin', framework: 'vite', testPort: 4174 },
      { id: 'storefront', root: 'apps/storefront', framework: 'next', testPort: 4175 },
    ]);
    expect(await readFile(join(root, 'srijika.code-workspace'), 'utf8')).toContain(
      'srijika.srijika-language-support',
    );
    const mcp = await readFile(join(root, '.mcp.json'), 'utf8');
    expect(mcp).toContain('srijika-admin');
    expect(mcp).toContain('apps/storefront');

    const inspected = await inspectSrijikaWorkspace(join(root, 'apps', 'admin'));
    expect(inspected).toMatchObject({
      root,
      packageManager: 'pnpm',
      lockfile: 'pnpm-lock.yaml',
    });
    expect(inspected.projects.map(({ id }) => id)).toEqual(['admin', 'storefront']);
  });

  it('preserves an existing MCP configuration and validates every project', async () => {
    const root = await monorepo();
    await writeFile(join(root, '.mcp.json'), '{"mcpServers":{"custom":{}}}\n');

    const initialized = await initializeSrijikaWorkspace({ workspace: root });
    expect(initialized.preserved).toEqual(['.mcp.json']);
    await expect(readFile(join(root, '.mcp.json'), 'utf8')).resolves.toContain('custom');

    await expect(checkSrijikaWorkspace({ workspace: root })).resolves.toMatchObject({
      status: 'passed',
      projects: [
        { id: 'admin', errors: 0 },
        { id: 'storefront', errors: 0 },
      ],
    });
    await expect(
      synchronizeSrijikaWorkspaceTests({ workspace: root, projectId: 'admin', dryRun: true }),
    ).resolves.toMatchObject({
      dryRun: true,
      projects: [{ id: 'admin', framework: 'vite', created: [] }],
    });
  });

  it('reports partial brownfield adoption without claiming workspace success', async () => {
    const root = await monorepo();
    await initializeSrijikaWorkspace({ workspace: root });
    const projectRoot = join(root, 'apps', 'admin');
    const configPath = join(projectRoot, 'srijika.config.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    config['adoption'] = {
      ownership: {
        version: 1,
        profile: 'brownfield-ownership-v1',
        managedRoots: ['src/features'],
        include: ['src/features'],
        adoptedOwners: ['src/features/home'],
      },
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await mkdir(join(projectRoot, 'src/features/catalog'), { recursive: true });
    await writeFile(
      join(projectRoot, 'src/features/catalog/Catalog.ui.tsx'),
      "export function CatalogUI() { fetch('/pending'); return <main />; }\n",
    );

    await expect(
      checkSrijikaWorkspace({ workspace: root, projectId: 'admin' }),
    ).resolves.toMatchObject({
      status: 'partial',
      projects: [
        {
          id: 'admin',
          status: 'partial',
          errors: 0,
          adoption: { status: 'partial', summary: { fullProjectSuccess: false } },
        },
      ],
    });
  });
});
