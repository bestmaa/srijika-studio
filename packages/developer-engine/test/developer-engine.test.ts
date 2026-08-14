import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SrijikaArchitectureIndex,
  findSrijikaProjectRoot,
  formatSrijikaCommand,
  inspectSrijikaProject,
  planSrijikaProjectCommand,
  selectSrijikaRuntime,
} from '../src/index.js';

const temporaryRoots: string[] = [];

async function createProject(options: { packageManager?: string; dev?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'srijika-developer-engine-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'src/features/home'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'engine-test',
      private: true,
      packageManager: options.packageManager ?? 'pnpm@11.18.0',
      scripts: {
        dev: options.dev ?? 'vite',
        build: 'vite build',
        'validate:srijika': 'node scripts/srijika-validate.mjs',
      },
      devDependencies: { vite: '8.2.0' },
      srijika: { sourceOfTruth: 'tsx' },
    }),
    'utf8',
  );
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');
  await writeFile(
    join(root, 'srijika.config.json'),
    JSON.stringify({
      sourceOfTruth: 'tsx',
      architecture: { profile: 'feature-slot-part-v1', featuresRoot: 'src/features' },
    }),
    'utf8',
  );
  await writeFile(
    join(root, 'src/features/home/Home.ui.tsx'),
    'export function HomeUI() { return <main>Home</main>; }\n',
    'utf8',
  );
  await writeFile(
    join(root, 'src/features/home/Home.connector.tsx'),
    "import { HomeUI } from './Home.ui';\nexport function HomeConnector() { return <HomeUI />; }\n",
    'utf8',
  );
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('project inspection', () => {
  it('finds the project from a descendant and reads the pinned package manager', async () => {
    const root = await createProject();
    const descendant = join(root, 'src/features/home');

    await expect(findSrijikaProjectRoot(descendant)).resolves.toBe(root);
    await expect(inspectSrijikaProject(descendant)).resolves.toMatchObject({
      root,
      projectName: 'engine-test',
      packageManager: 'pnpm',
      packageManagerVersion: '11.18.0',
      lockfile: 'pnpm-lock.yaml',
      viteProject: true,
    });
  });

  it('reports a lockfile mismatch without silently changing the declared manager', async () => {
    const root = await createProject({ packageManager: 'npm@11.0.0' });
    const project = await inspectSrijikaProject(root);

    expect(project.packageManager).toBe('npm');
    expect(project.warnings).toContainEqual(expect.stringMatching(/belongs to pnpm/));
    expect(() => planSrijikaProjectCommand(project, 'install')).toThrow(/does not match/);
  });
});

describe('runtime planning', () => {
  it('uses reproducible pnpm commands and strict Vite ports in Node mode', async () => {
    const project = await inspectSrijikaProject(await createProject());
    const install = planSrijikaProjectCommand(project, 'install');
    const dev = planSrijikaProjectCommand(project, 'dev', {
      runtime: 'node',
      port: 4317,
    });

    expect(install.args).toEqual(['install', '--frozen-lockfile']);
    expect(dev).toMatchObject({ runtime: 'node', packageManager: 'pnpm' });
    expect(dev.args).toEqual([
      'run',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      '4317',
      '--strictPort',
    ]);
    expect(formatSrijikaCommand(dev)).toContain('pnpm run dev');
  });

  it('keeps Node as automatic compatibility mode', async () => {
    const project = await inspectSrijikaProject(await createProject());

    expect(selectSrijikaRuntime(project, 'auto', {})).toEqual(
      expect.objectContaining({ runtime: 'node' }),
    );
  });
});

describe('incremental architecture index', () => {
  it('reuses unchanged source text while preserving diagnostics', async () => {
    const root = await createProject();
    const index = new SrijikaArchitectureIndex();

    const first = await index.check(root);
    const second = await index.check(root);

    expect(first.checkedFiles).toBe(2);
    expect(first.reusedFiles).toBe(0);
    expect(first.diagnostics).toEqual([]);
    expect(second.reusedFiles).toBe(2);
    expect(second.diagnostics).toEqual([]);
  });
});
