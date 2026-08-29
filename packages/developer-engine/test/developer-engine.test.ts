import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  SrijikaArchitectureIndex,
  SrijikaProjectFileSystem,
  collectSrijikaTestEvidence,
  checkSrijikaUiDiagnostics,
  findSrijikaProjectRoot,
  formatSrijikaCommand,
  inspectSrijikaProject,
  inspectSrijikaTestContract,
  planSrijikaNextApp,
  planSrijikaNextTests,
  planSrijikaProjectCommand,
  planSrijikaTestVerificationCommands,
  planSrijikaViteTests,
  scaffoldSrijikaStructure,
  selectSrijikaRuntime,
  synchronizeSrijikaViteTests,
  synchronizeSrijikaNextApp,
  synchronizeSrijikaNextTests,
} from '../src/index.js';

const temporaryRoots: string[] = [];

async function createProject(
  options: { packageManager?: string; dev?: string; framework?: 'vite' | 'next' } = {},
) {
  const framework = options.framework ?? 'vite';
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
        dev: options.dev ?? framework,
        build: framework === 'next' ? 'next build' : 'vite build',
        'validate:srijika': 'node scripts/srijika-validate.mjs',
      },
      devDependencies: framework === 'next' ? { next: '16.1.6' } : { vite: '8.2.0' },
      srijika: { sourceOfTruth: 'tsx' },
    }),
    'utf8',
  );
  await writeFile(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf8');
  await writeFile(
    join(root, 'srijika.config.json'),
    JSON.stringify({
      sourceOfTruth: 'tsx',
      entry: 'src/features/home/Home.ui.tsx',
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

async function createCustomRootProject() {
  const root = await mkdtemp(join(tmpdir(), 'srijika-developer-engine-custom-'));
  temporaryRoots.push(root);
  await mkdir(join(root, 'product/features/home'), { recursive: true });
  await mkdir(join(root, 'common'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'custom-root-engine-test',
      private: true,
      packageManager: 'pnpm@11.18.0',
      scripts: { dev: 'vite' },
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
      entry: 'product/features/home/Home.view.tsx',
      architecture: {
        profile: 'feature-slot-part-v1',
        featuresRoot: 'product/features',
        sharedRoot: 'common',
        slotsDirectory: 'regions',
        partsDirectory: 'pieces',
        hooksDirectory: 'behaviors',
        storesDirectory: 'state',
        uiSuffix: '.view.tsx',
        connectorSuffix: '.bridge.tsx',
        storeSuffix: '.state.ts',
        logicSuffix: '.rules.ts',
        apiSuffix: '.http.ts',
        typesSuffix: '.contracts.ts',
      },
    }),
    'utf8',
  );
  await writeFile(
    join(root, 'product/features/home/Home.view.tsx'),
    'export function HomeUI() { return <main>Home</main>; }\n',
    'utf8',
  );
  await writeFile(
    join(root, 'product/features/home/Home.bridge.tsx'),
    "import { HomeUI } from './Home.view';\nexport function HomeConnector() { return <HomeUI />; }\n",
    'utf8',
  );
  await writeFile(
    join(root, 'product/features/home/freehand.jsx'),
    'export const Freehand = () => <aside />;\n',
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
      entry: 'src/features/home/Home.ui.tsx',
      projectName: 'engine-test',
      packageManager: 'pnpm',
      packageManagerVersion: '11.18.0',
      lockfile: 'pnpm-lock.yaml',
      viteProject: true,
      nextProject: false,
    });
  });

  it('reports a lockfile mismatch without silently changing the declared manager', async () => {
    const root = await createProject({ packageManager: 'npm@11.0.0' });
    const project = await inspectSrijikaProject(root);

    expect(project.packageManager).toBe('npm');
    expect(project.warnings).toContainEqual(expect.stringMatching(/belongs to pnpm/));
    expect(() => planSrijikaProjectCommand(project, 'install')).toThrow(/does not match/);
  });

  it('rejects an unsafe configured root instead of exposing files outside the project', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: {
          profile: 'feature-slot-part-v1',
          featuresRoot: '../outside',
          sharedRoot: 'common',
        },
      }),
      'utf8',
    );

    await expect(inspectSrijikaProject(root)).rejects.toThrow(/project-relative|traversal/);
  });

  it.each([
    [{ featuresRoot: 'src/features' }, /architecture\.profile is required/],
    [
      { profile: 'feature-slot-part-v2', featuresRoot: 'src/features' },
      /Unsupported Srijika architecture profile/,
    ],
  ] as const)(
    'fails closed for an architecture block without the exact profile',
    async (architecture, message) => {
      const root = await createProject();
      await writeFile(
        join(root, 'srijika.config.json'),
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture,
        }),
        'utf8',
      );

      await expect(inspectSrijikaProject(root)).rejects.toThrow(message);
    },
  );

  it('returns the exact-profile custom architecture contract', async () => {
    const project = await inspectSrijikaProject(await createCustomRootProject());

    expect(project.architecture).toMatchObject({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'product/features',
      sharedRoot: 'common',
      slotsDirectory: 'regions',
      partsDirectory: 'pieces',
    });
  });

  it('returns the resolved brownfield ownership contract', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
        adoption: {
          ownership: {
            version: 1,
            profile: 'brownfield-ownership-v1',
            managedRoots: ['src/features'],
            include: ['src/features'],
            adoptedOwners: ['src/features/home'],
          },
        },
      }),
    );

    await expect(inspectSrijikaProject(root)).resolves.toMatchObject({
      adoption: {
        version: 1,
        profile: 'brownfield-ownership-v1',
        adoptedOwners: ['src/features/home'],
      },
    });
  });

  it('fails closed when the authoritative entry is missing, unsafe, oversized, or non-UTF-8', async () => {
    const missing = await createProject();
    await rm(join(missing, 'src/features/home/Home.ui.tsx'));
    await expect(inspectSrijikaProject(missing)).rejects.toThrow(/ENOENT|not found/i);

    const linked = await createProject();
    const outside = await mkdtemp(join(tmpdir(), 'srijika-entry-outside-'));
    temporaryRoots.push(outside);
    await rename(join(linked, 'src/features/home/Home.ui.tsx'), join(outside, 'Home.ui.tsx'));
    await symlink(
      join(outside, 'Home.ui.tsx'),
      join(linked, 'src/features/home/Home.ui.tsx'),
      'file',
    );
    await expect(inspectSrijikaProject(linked)).rejects.toThrow(/symbolic link/);

    const oversized = await createProject();
    await writeFile(
      join(oversized, 'src/features/home/Home.ui.tsx'),
      'x'.repeat(4 * 1024 * 1024 + 1),
    );
    await expect(inspectSrijikaProject(oversized)).rejects.toThrow(/4194304-byte read limit/);

    const invalidUtf8 = await createProject();
    await writeFile(
      join(invalidUtf8, 'src/features/home/Home.ui.tsx'),
      Buffer.from([0xff, 0xfe, 0xfd]),
    );
    await expect(inspectSrijikaProject(invalidUtf8)).rejects.toThrow(/valid UTF-8/);
  });

  it.each(['srijika.config.json', 'package.json'])(
    'rejects a symlinked %s metadata file before reading it',
    async (fileName) => {
      const root = await createProject();
      const outside = await mkdtemp(join(tmpdir(), 'srijika-metadata-outside-'));
      temporaryRoots.push(outside);
      await rename(join(root, fileName), join(outside, fileName));
      await symlink(join(outside, fileName), join(root, fileName), 'file');

      await expect(inspectSrijikaProject(root)).rejects.toThrow(/symbolic link/);
    },
  );

  it('rejects a project root reached through a symbolic link', async () => {
    const root = await createProject();
    const linkedRoot = `${root}-link`;
    temporaryRoots.push(linkedRoot);
    await symlink(root, linkedRoot, 'dir');

    await expect(inspectSrijikaProject(linkedRoot)).rejects.toThrow(/symbolic link/);
  });

  it.each([
    ['package.json', 1024 * 1024],
    ['srijika.config.json', 64 * 1024],
  ] as const)(
    'rejects oversized %s before an unbounded metadata read',
    async (fileName, maximumBytes) => {
      const root = await createProject();
      await writeFile(join(root, fileName), 'x'.repeat(maximumBytes + 1), 'utf8');

      await expect(inspectSrijikaProject(root)).rejects.toThrow(
        new RegExp(`${maximumBytes}-byte read limit`),
      );
    },
  );
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
  it('strictly checks adopted owners while reporting pending and excluded coverage', async () => {
    const root = await createProject();
    await mkdir(join(root, 'src/features/catalog/server'), { recursive: true });
    await writeFile(
      join(root, 'src/features/catalog/Catalog.ui.tsx'),
      "export function CatalogUI() { fetch('/pending'); return <main />; }\n",
    );
    await writeFile(
      join(root, 'src/features/catalog/server/load.ts'),
      "export const load = () => fetch('/server');\n",
    );
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
        adoption: {
          ownership: {
            version: 1,
            profile: 'brownfield-ownership-v1',
            managedRoots: ['src/features'],
            include: ['src/features'],
            exclude: [{ path: 'src/features/catalog/server', category: 'server' }],
            adoptedOwners: ['src/features/home'],
          },
        },
      }),
    );

    const result = await new SrijikaArchitectureIndex().check(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.adoption).toMatchObject({
      status: 'partial',
      summary: { governed: 2, pending: 1, excluded: 1, fullProjectSuccess: false },
      strictFiles: ['src/features/home/Home.connector.tsx', 'src/features/home/Home.ui.tsx'],
    });
  });

  it('fails strict validation and plans canonical moves for an adopted owner', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'src/features/home/Home.ui.tsx'),
      "export function HomeUI() { fetch('/strict'); return <main />; }\n",
    );
    await mkdir(join(root, 'src/features/home/ui'), { recursive: true });
    await writeFile(
      join(root, 'src/features/home/ui/Hero.ui.tsx'),
      'export function HeroUI() { return <aside />; }\n',
    );
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
        adoption: {
          ownership: {
            version: 1,
            profile: 'brownfield-ownership-v1',
            managedRoots: ['src/features'],
            include: ['src/features'],
            adoptedOwners: ['src/features/home'],
            directories: { ui: ['ui'] },
          },
        },
      }),
    );

    const result = await new SrijikaArchitectureIndex().check(root);

    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SRIJIKA4101' }));
    expect(result.adoption).toMatchObject({ status: 'blocked', summary: { blocked: 1 } });
    expect(result.adoption?.moves).toContainEqual(
      expect.objectContaining({
        fromRelativePath: 'src/features/home/ui/Hero.ui.tsx',
        toRelativePath: 'src/features/home/slots/hero/Hero.ui.tsx',
        status: 'ready',
      }),
    );
  });

  it('counts an outside-root authoritative entry inside the source-file safety limit', async () => {
    const root = await createProject();
    await mkdir(join(root, 'application'), { recursive: true });
    await writeFile(
      join(root, 'application/App.ui.tsx'),
      'export function AppUI() { return <main />; }\n',
    );
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'application/App.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
      }),
    );
    const extraFiles = Array.from({ length: 4_094 }, (_, index) =>
      join(root, 'src/features/home', `generated-${String(index).padStart(4, '0')}.ts`),
    );
    for (let index = 0; index < extraFiles.length; index += 128) {
      await Promise.all(extraFiles.slice(index, index + 128).map((file) => writeFile(file, '')));
    }

    await expect(new SrijikaArchitectureIndex().check(root)).rejects.toThrow(
      /4096-source-file safety limit/,
    );
  });

  it('validates a safe authoritative UI entry even when it is outside ownership roots', async () => {
    const root = await createProject();
    await mkdir(join(root, 'application/screens'), { recursive: true });
    await writeFile(
      join(root, 'application/screens/Landing.ui.tsx'),
      "export function LandingUI() { fetch('/secret'); return <main />; }\n",
    );
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'application/screens/Landing.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
      }),
    );

    const result = await new SrijikaArchitectureIndex().check(root);

    expect(result.checkedFiles).toBe(3);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'SRIJIKA4101',
        fileName: join(root, 'application/screens/Landing.ui.tsx'),
      }),
    );
  });

  it('loads project aliases from tsconfig.json before validating ownership', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'tsconfig.json'),
      `{
        // authoritative project alias
        "compilerOptions": { "paths": { "@app/*": ["src/*"] } }
      }`,
    );
    await writeFile(
      join(root, 'src/features/home/home.api.ts'),
      'export const loadHome = () => null;\n',
    );
    await writeFile(
      join(root, 'src/features/home/Home.connector.tsx'),
      "import { loadHome } from '@app/features/home/home.api'; void loadHome;\n",
    );

    const project = await inspectSrijikaProject(root);
    const result = await new SrijikaArchitectureIndex().check(root);

    expect(project.aliases).toEqual({ '@app/': 'src' });
    expect(result.diagnostics).toEqual([]);
  });

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

  it('does not reuse a same-size replacement whose mtime was restored', async () => {
    const root = await createProject();
    const index = new SrijikaArchitectureIndex();
    const uiPath = join(root, 'src/features/home/Home.ui.tsx');
    const original = await readFile(uiPath, 'utf8');
    const originalMetadata = await stat(uiPath);
    await index.check(root);
    const invalid = "fetch('x');".padEnd(Buffer.byteLength(original), ' ');
    const replacement = join(root, 'src/features/home/Home.replacement');
    await writeFile(replacement, invalid, 'utf8');
    await rename(replacement, uiPath);
    await utimes(uiPath, originalMetadata.atime, originalMetadata.mtime);

    const result = await index.check(root);

    expect(result.reusedFiles).toBe(1);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SRIJIKA4101' }));
  });

  it('indexes Shared owners alongside Features', async () => {
    const root = await createProject();
    const shared = join(root, 'src/shared/capabilities/auth');
    await mkdir(shared, { recursive: true });
    await writeFile(join(shared, 'auth.types.ts'), 'export interface AuthSession {}\n', 'utf8');

    const result = await new SrijikaArchitectureIndex().check(root);

    expect(result.checkedFiles).toBe(3);
    expect(result.diagnostics).toEqual([]);
  });

  it('indexes configured no-src roots and JavaScript source files incrementally', async () => {
    const root = await createCustomRootProject();
    const index = new SrijikaArchitectureIndex();

    const first = await index.check(root);
    const second = await index.check(root);

    expect(first.checkedFiles).toBe(3);
    expect(
      first.diagnostics.some(({ fileName }) =>
        /product\/features\/home\/freehand\.jsx$/.test(fileName),
      ),
    ).toBe(true);
    expect(second.reusedFiles).toBe(3);
  });

  it('uses the canonical ignored-directory set and case-insensitive source extensions', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'src/features/home/Upper.TS'),
      'export const upper = true;\n',
      'utf8',
    );
    await writeFile(
      join(root, 'src/features/home/Contract.d.tsx'),
      'export interface IgnoredDeclaration {}\n',
      'utf8',
    );
    for (const directory of [
      '.git',
      '.next',
      '.srijika',
      '.turbo',
      'build',
      'coverage',
      'dist',
      'node_modules',
      'out',
      'target',
    ]) {
      const ignored = join(root, 'src/features/home', directory);
      await mkdir(ignored, { recursive: true });
      await writeFile(join(ignored, 'Ignored.TSX'), 'export const ignored = true;\n', 'utf8');
    }

    const result = await new SrijikaArchitectureIndex().check(root);

    expect(result.checkedFiles).toBe(3);
  });

  it('rejects non-UTF-8 architecture source instead of replacing invalid bytes', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src/features/home/Invalid.ts'), Buffer.from([0xff, 0xfe, 0xfd]));

    await expect(new SrijikaArchitectureIndex().check(root)).rejects.toThrow(/valid UTF-8/);
  });

  it('plans new owners inside configured no-src roots', async () => {
    const root = await createCustomRootProject();

    const feature = await scaffoldSrijikaStructure({
      project: root,
      kind: 'feature',
      name: 'Billing',
      dryRun: true,
    });
    const shared = await scaffoldSrijikaStructure({
      project: root,
      kind: 'shared-capability',
      name: 'Session',
      optionalCapabilities: ['logic'],
      dryRun: true,
    });

    expect(feature.plan.ownerFolder).toBe('product/features/billing');
    expect(feature.plan.files.map(({ relativePath }) => relativePath)).toEqual(
      expect.arrayContaining([
        'product/features/billing/Billing.view.tsx',
        'product/features/billing/Billing.bridge.tsx',
      ]),
    );
    expect(shared.plan.ownerFolder).toBe('common/capabilities/session');
    expect(shared.plan.files.map(({ relativePath }) => relativePath)).toEqual(
      expect.arrayContaining(['common/capabilities/session/session.rules.ts']),
    );
  });

  it('rewrites Hook migration consumers outside ownership roots', async () => {
    const root = await createProject();
    const ignoredDependencyTree = await mkdtemp(join(tmpdir(), 'srijika-ignored-dependencies-'));
    temporaryRoots.push(ignoredDependencyTree);
    await writeFile(join(ignoredDependencyTree, 'outside.ts'), 'export const outside = true;\n');
    await symlink(ignoredDependencyTree, join(root, 'node_modules'), 'dir');
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(
      join(root, 'src/features/home/useHome.ts'),
      'export function useHome() { return { ready: true }; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'src/features/home/Home.connector.tsx'),
      "import { useHome } from './useHome';\nexport function HomeConnector() { return String(useHome().ready); }\n",
      'utf8',
    );
    await writeFile(
      join(root, 'src/app/home-runtime.ts'),
      "import { useHome } from '../features/home/useHome';\nvoid useHome;\n",
      'utf8',
    );
    await writeFile(
      join(root, 'src/app/home-dynamic.ts'),
      'void import(`../features/home/useHome`);\n',
      'utf8',
    );
    await writeFile(
      join(root, 'src/app/home-alias.ts'),
      "void import('@app/features/home/useHome.js');\n",
      'utf8',
    );
    await writeFile(
      join(root, 'src/app/home-root-alias.ts'),
      "void import('@root/src/features/home/useHome.mts');\n",
      'utf8',
    );
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { paths: { '@app/*': ['src/*'], '@root/*': ['./*'] } },
      }),
      'utf8',
    );

    const result = await scaffoldSrijikaStructure({
      project: root,
      kind: 'behavior-hook',
      name: 'Keyboard',
      ownerFolder: 'src/features/home',
    });

    expect(result.plan.updates).toContainEqual(
      expect.objectContaining({ relativePath: 'src/app/home-runtime.ts' }),
    );
    await expect(readFile(join(root, 'src/app/home-runtime.ts'), 'utf8')).resolves.toContain(
      "from '../features/home/hooks/useHome'",
    );
    await expect(readFile(join(root, 'src/app/home-dynamic.ts'), 'utf8')).resolves.toContain(
      'import(`../features/home/hooks/useHome`)',
    );
    await expect(readFile(join(root, 'src/app/home-alias.ts'), 'utf8')).resolves.toContain(
      "import('@app/features/home/hooks/useHome.js')",
    );
    await expect(readFile(join(root, 'src/app/home-root-alias.ts'), 'utf8')).resolves.toContain(
      "import('@root/src/features/home/hooks/useHome.mts')",
    );
  });

  it('does not rewrite consumers inside an independently configured nested project', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'src/features/home/useHome.ts'),
      'export function useHome() { return { ready: true }; }\n',
      'utf8',
    );
    const nested = join(root, 'examples/nested-app');
    await mkdir(join(nested, 'src'), { recursive: true });
    await writeFile(
      join(nested, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/Nested.ui.tsx' }),
      'utf8',
    );
    const nestedConsumer = "void import('../../../src/features/home/useHome');\n";
    await writeFile(join(nested, 'src/consumer.ts'), nestedConsumer, 'utf8');

    const result = await scaffoldSrijikaStructure({
      project: root,
      kind: 'behavior-hook',
      name: 'Keyboard',
      ownerFolder: 'src/features/home',
    });

    expect(result.plan.updates.map(({ relativePath }) => relativePath)).not.toContain(
      'examples/nested-app/src/consumer.ts',
    );
    await expect(readFile(join(nested, 'src/consumer.ts'), 'utf8')).resolves.toBe(nestedConsumer);
  });

  it('rejects an exact gateway alias before the developer engine mutates any project file', async () => {
    const root = await createProject();
    const flatGateway = join(root, 'src/features/home/useHome.ts');
    const connector = join(root, 'src/features/home/Home.connector.tsx');
    const originalGateway = 'export function useHome() { return { ready: true }; }\n';
    const originalConnector =
      "import { useHome } from '#home';\nexport function HomeConnector() { return String(useHome().ready); }\n";
    await writeFile(flatGateway, originalGateway, 'utf8');
    await writeFile(connector, originalConnector, 'utf8');
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { paths: { '#home': ['src/features/home/useHome.ts'] } },
      }),
      'utf8',
    );

    await expect(
      scaffoldSrijikaStructure({
        project: root,
        kind: 'behavior-hook',
        name: 'Keyboard',
        ownerFolder: 'src/features/home',
      }),
    ).rejects.toThrow(/exact tsconfig alias #home/);

    await expect(readFile(flatGateway, 'utf8')).resolves.toBe(originalGateway);
    await expect(readFile(connector, 'utf8')).resolves.toBe(originalConnector);
    await expect(stat(join(root, 'src/features/home/hooks/useHome.ts'))).rejects.toThrow();
    await expect(stat(join(root, 'src/features/home/hooks/useHomeKeyboard.ts'))).rejects.toThrow();
  });

  it('rejects a symlinked ownership root without reading outside source', async () => {
    const root = await createProject();
    const outside = await mkdtemp(join(tmpdir(), 'srijika-source-outside-'));
    temporaryRoots.push(outside);
    await writeFile(join(outside, 'Secret.ui.tsx'), 'export const secret = "not-exposed";\n');
    await rm(join(root, 'src/features'), { recursive: true });
    await symlink(outside, join(root, 'src/features'), 'dir');

    await expect(new SrijikaArchitectureIndex().check(root)).rejects.toThrow(/symbolic link/);
    await expect(
      scaffoldSrijikaStructure({ project: root, kind: 'feature', name: 'Safe', dryRun: true }),
    ).rejects.toThrow(/symbolic link/);
  });

  it('rejects nested symlink ancestors and source-file symlinks', async () => {
    const ancestorRoot = await createProject();
    const outsideDirectory = await mkdtemp(join(tmpdir(), 'srijika-nested-outside-'));
    temporaryRoots.push(outsideDirectory);
    await symlink(outsideDirectory, join(ancestorRoot, 'src/features/home/slots'), 'dir');
    await expect(new SrijikaArchitectureIndex().check(ancestorRoot)).rejects.toThrow(
      /symbolic link/,
    );

    const fileRoot = await createProject();
    const outsideFile = join(outsideDirectory, 'Outside.ui.tsx');
    await writeFile(outsideFile, 'export function OutsideUI() { return null; }\n');
    await rm(join(fileRoot, 'src/features/home/Home.ui.tsx'));
    await symlink(outsideFile, join(fileRoot, 'src/features/home/Home.ui.tsx'), 'file');
    await expect(new SrijikaArchitectureIndex().check(fileRoot)).rejects.toThrow(/symbolic link/);
  });

  it('inspects owner test requirements and expands an unowned file change to its consumers', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src/theme.ts'), 'export const accent = "violet";\n', 'utf8');
    await writeFile(
      join(root, 'src/features/home/Home.ui.tsx'),
      "import { accent } from '../../theme';\nexport function HomeUI() { return <main data-accent={accent}>Home</main>; }\n",
      'utf8',
    );

    const inspected = await inspectSrijikaTestContract({
      project: root,
      changedFiles: ['src/theme.ts'],
    });
    expect(inspected.contract.owners).toHaveLength(1);
    expect(inspected.contract.owners[0]).toMatchObject({
      id: 'feature:home',
      capabilities: ['connector', 'ui'],
    });
    expect(inspected.contract.owners[0]?.requirements.map(({ layer }) => layer)).toContain(
      'browser',
    );
    expect(inspected.affected).toMatchObject({
      directOwnerIds: [],
      affectedOwnerIds: ['feature:home'],
    });
    const vitePlan = await planSrijikaViteTests({ project: root, port: 4_321 });
    expect(vitePlan.adapter.files.map(({ relativePath }) => relativePath)).toContain(
      'tests/srijika/owners/feature--home.spec.ts',
    );
    expect(vitePlan.adapter.uncoveredRequirementIds).toEqual([]);
    expect(
      vitePlan.adapter.files.find(({ relativePath }) =>
        relativePath.endsWith('playwright.config.ts'),
      )?.source,
    ).toContain('?? 4321');
    const synchronized = await synchronizeSrijikaViteTests({ project: root });
    expect(synchronized.write?.created).toContain('tests/srijika/owners/feature--home.spec.ts');
    expect(await readFile(join(root, 'tests/srijika/contract.generated.json'), 'utf8')).toContain(
      'srijika-test-contract-v1',
    );
    expect(synchronized.packageWrite?.addedScripts).toContain('test:srijika:browser');
    const synchronizedPackageJson = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    ) as unknown;
    expect(synchronizedPackageJson).toMatchObject({
      scripts: {
        'test:srijika:browser': 'playwright test --config tests/srijika/playwright.config.ts',
      },
      devDependencies: {
        '@axe-core/playwright': '4.12.1',
        '@playwright/test': '1.62.1',
        vitest: '4.1.10',
      },
    });
    await expect(
      inspectSrijikaTestContract({ project: root, changedFiles: ['../outside.ts'] }),
    ).rejects.toThrow(/inside the Srijika project/);
  });

  it('detects Next.js and safely plans and synchronizes its real App Router tests', async () => {
    const root = await createProject({ framework: 'next' });
    const project = await inspectSrijikaProject(root);
    expect(project).toMatchObject({ viteProject: false, nextProject: true });
    await expect(planSrijikaViteTests({ project: root })).rejects.toThrow(
      /requires a Vite project/,
    );

    const nextPlan = await planSrijikaNextTests({ project: root, port: 4_322 });
    expect(nextPlan.adapter.framework).toBe('next-app-router');
    expect(nextPlan.adapter.files.map(({ relativePath }) => relativePath)).toContain(
      'tests/srijika-next/owners/feature--home.spec.ts',
    );
    expect(
      nextPlan.adapter.files.find(({ relativePath }) =>
        relativePath.endsWith('playwright.config.ts'),
      )?.source,
    ).toContain('?? 4322');

    const synchronized = await synchronizeSrijikaNextTests({ project: root });
    expect(synchronized.write?.created).toContain(
      'tests/srijika-next/owners/feature--home.spec.ts',
    );
    expect(
      await readFile(join(root, 'tests/srijika-next/contract.generated.json'), 'utf8'),
    ).toContain('srijika-test-contract-v1');
    expect(synchronized.packageWrite?.addedScripts).toContain('test:srijika:next:browser');
    await mkdir(join(root, 'test-results/srijika-next'), { recursive: true });
    await writeFile(
      join(root, nextPlan.adapter.evidence.playwrightJson),
      JSON.stringify({
        suites: [
          {
            specs: [
              {
                file: 'tests/srijika-next/owners/feature--home.spec.ts',
                tests: [{ results: [{ status: 'passed' }] }],
              },
            ],
          },
        ],
      }),
      'utf8',
    );
    const evidence = await collectSrijikaTestEvidence({
      project: root,
      architecturePassed: true,
      typecheckPassed: true,
    });
    expect(evidence.manifest).toMatchObject({
      framework: 'next-app-router',
      status: 'passed',
      owners: [{ ownerId: 'feature:home', status: 'passed' }],
    });
    const oldReportTime = new Date(Date.now() - 60_000);
    await utimes(
      join(root, nextPlan.adapter.evidence.playwrightJson),
      oldReportTime,
      oldReportTime,
    );
    const freshOnlyEvidence = await collectSrijikaTestEvidence({
      project: root,
      architecturePassed: true,
      typecheckPassed: true,
      minimumReportModifiedMillis: Date.now() - 1_000,
    });
    expect(freshOnlyEvidence.manifest.status).toBe('not-run');

    const routePlan = await planSrijikaNextApp({
      project: root,
      routes: [{ pathname: '/', ownerId: 'feature:home' }],
    });
    expect(routePlan.adapter).toMatchObject({ ready: true, appRoot: 'src/app' });
    const routeSync = await synchronizeSrijikaNextApp({
      project: root,
      routes: [{ pathname: '/', ownerId: 'feature:home' }],
    });
    expect(routeSync.write?.created).toContain('src/app/page.tsx');

    await writeFile(
      join(root, 'src/features/home/Home.connector.tsx'),
      "import { useState } from 'react'; export function HomeConnector() { useState(0); return null; }\n",
      'utf8',
    );
    const invalidRoute = await planSrijikaNextApp({
      project: root,
      routes: [{ pathname: '/', ownerId: 'feature:home' }],
    });
    expect(invalidRoute.adapter.ready).toBe(false);
    await expect(
      synchronizeSrijikaNextApp({
        project: root,
        routes: [{ pathname: '/', ownerId: 'feature:home' }],
      }),
    ).rejects.toThrow(/diagnostics/);
  });

  it('returns shared Next primitive and server boundary diagnostics from project checks', async () => {
    const root = await createProject({ framework: 'next' });
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(
      join(root, 'src/features/home/Home.ui.tsx'),
      `import Link from 'next/link';
interface HomeProps { title: string; }
export function HomeUI(props: HomeProps) {
  return <main><Link href="/docs">{props.title}</Link></main>;
}
`,
      'utf8',
    );
    await writeFile(
      join(root, 'src/app/page.tsx'),
      `import { useState } from 'react';
import { HomeUI } from '../features/home/Home.ui';
export default function Page() {
  useState(false);
  return <HomeUI title="Home" />;
}
`,
      'utf8',
    );

    const invalid = await checkSrijikaUiDiagnostics(root);
    expect(invalid.checkedFiles).toBe(2);
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'SRIJIKA5004',
        fileName: 'src/app/page.tsx',
      }),
    );
    expect(invalid.diagnostics.some(({ code }) => code === 'SRIJIKA2001')).toBe(false);

    await writeFile(
      join(root, 'src/app/page.tsx'),
      `import { HomeUI } from '@/features/home/Home.ui';
export default function Page() { return <HomeUI title="Home" unknown={() => undefined} />; }
`,
      'utf8',
    );
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }),
      'utf8',
    );
    await expect(checkSrijikaUiDiagnostics(root)).resolves.toMatchObject({
      checkedFiles: 2,
      diagnostics: [expect.objectContaining({ code: 'SRIJIKA5005' })],
    });
    await writeFile(
      join(root, 'src/app/page.tsx'),
      `import { HomeUI } from '@/features/home/Home.ui';
export default function Page() { return <HomeUI title="Home" />; }
`,
      'utf8',
    );
    await expect(checkSrijikaUiDiagnostics(root)).resolves.toMatchObject({
      checkedFiles: 2,
      diagnostics: [],
    });

    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1', featuresRoot: 'src/features' },
        framework: {
          version: 1,
          profile: 'next-app-router-v1',
          components: [
            {
              id: 'project.shared.card',
              version: 1,
              moduleSpecifier: './Card',
              exportName: 'Card',
              displayName: 'Shared Card',
              props: { title: { type: 'string', required: true, previewProp: 'ariaLabel' } },
              children: 'optional',
              preview: { kind: 'container', element: 'section' },
            },
          ],
        },
      }),
      'utf8',
    );
    await writeFile(
      join(root, 'src/features/home/Home.ui.tsx'),
      `import { Card } from './Card';
interface HomeProps { title: string; }
export function HomeUI(props: HomeProps) { return <Card title={props.title}>Home</Card>; }
`,
      'utf8',
    );
    await expect(checkSrijikaUiDiagnostics(root)).resolves.toMatchObject({ diagnostics: [] });
  });

  it('plans shell-free owner verification commands from project metadata', async () => {
    const root = await createProject();
    const project = await inspectSrijikaProject(root);
    const commands = planSrijikaTestVerificationCommands(project, 'vite');

    expect(commands.map(({ gate }) => gate)).toEqual([
      'install',
      'typecheck',
      'vitest',
      'playwright-browser',
      'playwright',
    ]);
    expect(commands.find(({ gate }) => gate === 'vitest')).toMatchObject({
      executable: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['exec', 'vitest', 'run', '--config', 'tests/srijika/vitest.config.ts'],
      cwd: root,
    });
    expect(commands.find(({ gate }) => gate === 'playwright')).toMatchObject({
      args: [
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/srijika/playwright.config.ts',
        '--update-snapshots=missing',
      ],
    });
  });

  it('fails architecture checks and planning closed before oversized source reads', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src/features/home/Home.ui.tsx'), 'x'.repeat(4 * 1024 * 1024 + 1));

    await expect(new SrijikaArchitectureIndex().check(root)).rejects.toThrow(/4 MiB|4194304/);
    await expect(
      scaffoldSrijikaStructure({ project: root, kind: 'feature', name: 'Safe', dryRun: true }),
    ).rejects.toThrow(/4194304-byte read limit/);
  });

  it('bounds directory depth and aggregate directory discovery', async () => {
    const root = await createProject();
    const fileSystem = await SrijikaProjectFileSystem.open(root);
    await mkdir(join(root, 'src/features/one/two/three'), { recursive: true });
    await mkdir(join(root, 'bounded-directory'), { recursive: true });
    await Promise.all(
      ['one.ts', 'two.ts', 'three.ts'].map((fileName) =>
        writeFile(join(root, 'bounded-directory', fileName), ''),
      ),
    );

    await expect(
      fileSystem.walkFiles(['bounded-directory'], {
        maximumFiles: 2,
        maximumEntries: 2,
        maximumDirectories: 16,
        maximumDepth: 8,
      }),
    ).rejects.toThrow(/entry safety limit/);

    await expect(
      fileSystem.walkFiles(['src/features'], {
        maximumFiles: 16,
        maximumEntries: 32,
        maximumDirectories: 2,
        maximumDepth: 8,
      }),
    ).rejects.toThrow(/directory safety limit/);
    await expect(
      fileSystem.walkFiles(['src/features'], {
        maximumFiles: 16,
        maximumEntries: 32,
        maximumDirectories: 16,
        maximumDepth: 2,
      }),
    ).rejects.toThrow(/depth safety limit/);

    const deepSegments = Array.from({ length: 33 }, (_, index) => `deep${index}`);
    await mkdir(join(root, 'src/features', ...deepSegments), { recursive: true });
    await expect(new SrijikaArchitectureIndex().check(root)).rejects.toThrow(/depth safety limit/);
  });
});
