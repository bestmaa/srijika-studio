import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSrijikaProjectFileMap, writeSrijikaProject } from '@srijika/project-scaffold';
import { checkSrijikaArchitecture } from '@srijika/developer-engine';

import { addSrijikaStructure } from '../src/add.js';
import { parseSrijikaArguments } from '../src/arguments.js';
import {
  isSrijikaArchitectureWatchPath,
  resolveCreationDirectory,
  resolveSrijikaWatchRoots,
  runSrijikaCli,
} from '../src/cli.js';
import { findSrijikaStudioExecutable, resolveSrijikaStudioExecutable } from '../src/studio.js';
import { resolveVSCodeLaunch } from '../src/vscode.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'srijika-cli-'));
  roots.push(parent);
  const root = join(parent, 'app');
  await writeSrijikaProject(root, { projectName: 'cli-test', displayName: 'CLI Test' });
  return root;
}

async function reactSource(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-cli-react-source-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'old-react-app', dependencies: { react: '^19.0.0', vite: '^8.0.0' } }),
  );
  await writeFile(
    join(root, 'src/App.jsx'),
    'export function App() { return <main>Old app</main>; }\n',
  );
  return root;
}

async function nextAdoptionProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-cli-next-adoption-'));
  roots.push(root);
  await mkdir(join(root, 'src/app'), { recursive: true });
  await mkdir(join(root, 'src/features/home'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'existing-next-app',
        private: true,
        packageManager: 'npm@11.0.0',
        scripts: {
          dev: 'next dev',
          build: 'node -e "process.exit(0)"',
          typecheck: 'node -e "process.exit(0)"',
        },
        dependencies: { next: '16.3.2', react: '19.2.0', 'react-dom': '19.2.0' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, 'package-lock.json'),
    `${JSON.stringify({ name: 'existing-next-app', lockfileVersion: 3, packages: {} }, null, 2)}\n`,
  );
  await writeFile(
    join(root, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { jsx: 'preserve', plugins: [{ name: 'next' }] } }, null, 2)}\n`,
  );
  await writeFile(
    join(root, 'src/features/home/Home.ui.tsx'),
    'export function HomeUI() { return <main>Home</main>; }\n',
  );
  await writeFile(
    join(root, 'src/features/home/Home.connector.tsx'),
    "import { HomeUI } from './Home.ui';\nexport function HomeConnector() { return <HomeUI />; }\n",
  );
  await writeFile(
    join(root, 'src/app/page.tsx'),
    "import { HomeConnector } from '../features/home/Home.connector';\nexport default function Page() { return <HomeConnector />; }\n",
  );
  return root;
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-cli-workspace-'));
  roots.push(root);
  await mkdir(join(root, 'apps'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'cli-monorepo', private: true, packageManager: 'pnpm@11.0.0' }, null, 2)}\n`,
  );
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await writeSrijikaProject(join(root, 'apps', 'web'), {
    projectName: 'web',
    displayName: 'Web',
  });
  const webPackagePath = join(root, 'apps', 'web', 'package.json');
  const webPackage = JSON.parse(await readFile(webPackagePath, 'utf8')) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  webPackage.scripts['dev'] = 'next dev';
  webPackage.dependencies['next'] = '16.3.2';
  delete webPackage.devDependencies['vite'];
  await writeFile(webPackagePath, `${JSON.stringify(webPackage, null, 2)}\n`);
  await writeSrijikaProject(join(root, 'apps', 'admin'), {
    projectName: 'admin',
    displayName: 'Admin',
  });
  return root;
}

describe('argument parsing', () => {
  it('parses positional targets, valued options, and capability flags', () => {
    const parsed = parseSrijikaArguments([
      'slot',
      'Summary',
      '--in',
      'src/features/home',
      '--hook',
      '--logic',
    ]);

    expect(parsed.positionals).toEqual(['slot', 'Summary']);
    expect(parsed.options.get('in')).toBe('src/features/home');
    expect(parsed.options.get('hook')).toBe(true);
    expect(parsed.options.get('logic')).toBe(true);
  });
});

describe('architecture watch roots', () => {
  it('watches the configured Feature and Shared roots instead of hardcoded src', () => {
    expect(
      resolveSrijikaWatchRoots('/workspace/app', {
        profile: 'feature-slot-part-v1',
        featuresRoot: 'application/modules',
        sharedRoot: 'application/common',
      }),
    ).toEqual([
      resolve('/workspace/app/application/modules'),
      resolve('/workspace/app/application/common'),
    ]);
  });

  it('reacts to authoritative inputs and future configured-root ancestors', () => {
    const architecture = {
      profile: 'feature-slot-part-v1' as const,
      featuresRoot: 'application/modules',
      sharedRoot: 'application/common',
    };
    expect(
      isSrijikaArchitectureWatchPath('srijika.config.json', architecture, 'screens/App.ui.tsx'),
    ).toBe(true);
    expect(
      isSrijikaArchitectureWatchPath('tsconfig.json', architecture, 'screens/App.ui.tsx'),
    ).toBe(true);
    expect(
      isSrijikaArchitectureWatchPath('screens/App.ui.tsx', architecture, 'screens/App.ui.tsx'),
    ).toBe(true);
    expect(isSrijikaArchitectureWatchPath('application', architecture, 'screens/App.ui.tsx')).toBe(
      true,
    );
    expect(
      isSrijikaArchitectureWatchPath(
        'application/modules/home/Home.ui.tsx',
        architecture,
        'screens/App.ui.tsx',
      ),
    ).toBe(true);
    expect(
      isSrijikaArchitectureWatchPath(
        'application/modules/node_modules/pkg/index.ts',
        architecture,
        'screens/App.ui.tsx',
      ),
    ).toBe(false);
    expect(isSrijikaArchitectureWatchPath('README.md', architecture, 'screens/App.ui.tsx')).toBe(
      false,
    );
  });

  it('watches brownfield managed roots instead of canonical defaults', () => {
    const adoption = {
      version: 1 as const,
      profile: 'brownfield-ownership-v1' as const,
      managedRoots: ['application/features'],
      include: ['application/features'],
      exclude: [],
      adoptedOwners: ['application/features/auth'],
      directories: { ui: ['ui'], connectors: ['connectors'], hooks: ['hooks'] },
    };
    expect(resolveSrijikaWatchRoots('/workspace/app', {}, adoption)).toEqual([
      resolve('/workspace/app/application/features'),
    ]);
    expect(
      isSrijikaArchitectureWatchPath(
        'application/features/auth/Auth.ui.tsx',
        {},
        'app/App.ui.tsx',
        adoption,
      ),
    ).toBe(true);
    expect(
      isSrijikaArchitectureWatchPath(
        'src/features/home/Home.ui.tsx',
        {},
        'app/App.ui.tsx',
        adoption,
      ),
    ).toBe(false);
  });
});

describe('brownfield adoption commands', () => {
  it('reports partial coverage without failing strict adopted-owner checks', async () => {
    const root = await project();
    const configPath = join(root, 'srijika.config.json');
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
    await mkdir(join(root, 'src/features/catalog'), { recursive: true });
    await writeFile(
      join(root, 'src/features/catalog/Catalog.ui.tsx'),
      "export function CatalogUI() { fetch('/pending'); return <main />; }\n",
    );
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(runSrijikaCli(['check', root, '--json'])).resolves.toBe(0);
      const checked = JSON.parse(logs.join('\n')) as {
        architecture: { adoption: { status: string; summary: { pending: number } } };
        ui: { checkedFiles: number };
      };
      expect(checked.architecture.adoption).toMatchObject({
        status: 'partial',
        summary: { pending: 1 },
      });
      expect(checked.ui.checkedFiles).toBe(2);

      logs.length = 0;
      await expect(runSrijikaCli(['adoption', 'plan', root, '--json'])).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({
        status: 'partial',
        summary: { fullProjectSuccess: false },
      });
    } finally {
      console.log = originalLog;
    }
  });
});

describe('Desktop handoff', () => {
  it('honors the explicit installed Studio path without guessing platform locations', async () => {
    await expect(
      resolveSrijikaStudioExecutable({ SRIJIKA_STUDIO_PATH: '/opt/srijika/srijika-studio' }),
    ).resolves.toBe('/opt/srijika/srijika-studio');
  });

  it('treats missing optional Studio as unavailable instead of failing setup', async () => {
    const home = await mkdtemp(join(tmpdir(), 'srijika-no-studio-'));
    roots.push(home);
    await expect(
      findSrijikaStudioExecutable({ HOME: home, PATH: '' }, 'linux'),
    ).resolves.toBeNull();
  });
});

describe('VS Code handoff', () => {
  it('uses the adjacent Windows GUI from WSL with the exact remote authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'srijika-vscode-'));
    roots.push(root);
    const bin = join(root, 'Microsoft VS Code', 'bin');
    await mkdir(bin, { recursive: true });
    const gui = join(root, 'Microsoft VS Code', 'Code.exe');
    await writeFile(gui, 'test');

    await expect(
      resolveVSCodeLaunch({ PATH: bin, WSL_DISTRO_NAME: 'Ubuntu' }, 'linux'),
    ).resolves.toEqual({
      executable: gui,
      prefixArguments: ['--remote', 'wsl+Ubuntu'],
    });
  });
});

describe('create command', () => {
  it('uses a supplied project directory without prompting', async () => {
    let prompted = false;
    const directory = await resolveCreationDirectory(parseSrijikaArguments(['named-app']), () => {
      prompted = true;
      return Promise.resolve('prompted-app');
    });

    expect(directory).toBe('named-app');
    expect(prompted).toBe(false);
  });

  it('asks for a project name when the directory is omitted', async () => {
    await expect(
      resolveCreationDirectory(parseSrijikaArguments([]), () => Promise.resolve('prompted-app')),
    ).resolves.toBe('prompted-app');
  });

  it('requires an explicit project name for machine-readable creation', async () => {
    await expect(
      resolveCreationDirectory(parseSrijikaArguments(['--json']), () =>
        Promise.resolve('ignored-app'),
      ),
    ).rejects.toThrow(/required with --json/);
  });

  it('creates a complete CLI-first project without requiring VS Code or Studio', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-create-'));
    roots.push(parent);
    const root = join(parent, 'portable-app');
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(
        runSrijikaCli(['create', root, '--no-install', '--no-open', '--json']),
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(logs.join('\n')) as { statuses: Record<string, string> };
    expect(payload.statuses).toMatchObject({
      dependencies: 'skipped',
      vscode: 'skipped',
      studio: 'skipped',
    });
    await expect(readFile(join(root, 'srijika.config.json'), 'utf8')).resolves.toContain(
      'feature-slot-part-v1',
    );
    await expect(readFile(join(root, '.vscode/extensions.json'), 'utf8')).resolves.toContain(
      'srijika.srijika-language-support',
    );
    await expect(readFile(join(root, '.vscode/tasks.json'), 'utf8')).resolves.toContain(
      'Srijika: Run App',
    );
  });

  it('keeps React Query opt-in for CLI-created projects', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-create-query-'));
    roots.push(parent);
    const minimal = join(parent, 'minimal-app');
    const query = join(parent, 'query-app');
    await expect(runSrijikaCli(['init', minimal, '--json'])).resolves.toBe(0);
    await expect(runSrijikaCli(['init', query, '--react-query', '--json'])).resolves.toBe(0);

    const minimalPackage = JSON.parse(await readFile(join(minimal, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const queryPackage = JSON.parse(await readFile(join(query, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(minimalPackage.dependencies).not.toHaveProperty('@tanstack/react-query');
    expect(queryPackage.dependencies).toHaveProperty('@tanstack/react-query');
  });
});

describe('workspace commands', () => {
  it('initializes, inspects, checks, and plans tests across a monorepo', async () => {
    const root = await workspace();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(runSrijikaCli(['workspace', 'init', root, '--json'])).resolves.toBe(0);
      const initialized = JSON.parse(logs.join('\n')) as {
        manifest: { projects: Array<{ id: string }> };
      };
      expect(initialized.manifest.projects.map(({ id }) => id)).toEqual(['admin', 'web']);

      logs.length = 0;
      await expect(runSrijikaCli(['workspace', 'inspect', root, '--json'])).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({
        packageManager: 'pnpm',
        projects: [{ id: 'admin' }, { id: 'web' }],
      });

      logs.length = 0;
      await expect(
        runSrijikaCli(['workspace', 'check', root, '--project-id', 'web', '--json']),
      ).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({
        status: 'passed',
        projects: [{ id: 'web', errors: 0 }],
      });

      logs.length = 0;
      await expect(
        runSrijikaCli([
          'workspace',
          'tests',
          'sync',
          root,
          '--project-id',
          'admin',
          '--dry-run',
          '--json',
        ]),
      ).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({
        dryRun: true,
        projects: [{ id: 'admin', framework: 'vite' }],
      });
    } finally {
      console.log = originalLog;
    }
  });
});

describe('Next.js adoption command', () => {
  it('previews without writes, then verifies and adopts without changing existing source', async () => {
    const root = await nextAdoptionProject();
    const beforePackage = await readFile(join(root, 'package.json'), 'utf8');
    const beforePage = await readFile(join(root, 'src/app/page.tsx'), 'utf8');
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(
        runSrijikaCli(['adopt', root, '--framework', 'next', '--dry-run', '--json']),
      ).resolves.toBe(0);
      const preview = JSON.parse(logs.join('\n')) as {
        dryRun: boolean;
        plan: { files: Array<{ relativePath: string }> };
      };
      expect(preview.dryRun).toBe(true);
      expect(preview.plan.files).toContainEqual(
        expect.objectContaining({ relativePath: 'srijika.config.json' }),
      );
      await expect(access(join(root, 'srijika.config.json'))).rejects.toThrow();

      logs.length = 0;
      await expect(runSrijikaCli(['adopt', root, '--framework', 'next', '--json'])).resolves.toBe(
        0,
      );
      const adopted = JSON.parse(logs.join('\n')) as {
        dryRun: boolean;
        verification: Array<{ name: string; status: string }>;
      };
      expect(adopted.dryRun).toBe(false);
      expect(adopted.verification).toEqual([
        expect.objectContaining({ name: 'typecheck', status: 'passed' }),
        expect.objectContaining({ name: 'build', status: 'passed' }),
      ]);
    } finally {
      console.log = originalLog;
    }
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(beforePackage);
    expect(await readFile(join(root, 'src/app/page.tsx'), 'utf8')).toBe(beforePage);
    await expect(readFile(join(root, 'srijika.config.json'), 'utf8')).resolves.toContain(
      'report-only',
    );
  });
});

describe('React migration command', () => {
  it('uses the dedicated Next App Router adapter and creates a real Next target', async () => {
    const source = await nextAdoptionProject();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-cli-next-migration-target-'));
    roots.push(parent);
    const target = join(parent, 'new-next-app');
    const before = await readFile(join(source, 'src/app/page.tsx'), 'utf8');
    const originalLog = console.log;
    console.log = () => undefined;
    try {
      await expect(
        runSrijikaCli(['migrate', 'next', '--source', source, '--target', target, '--json']),
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }
    const packageMetadata = JSON.parse(await readFile(join(target, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(packageMetadata.dependencies['next']).toBe('16.3.2');
    expect(packageMetadata.scripts['build']).toContain('next build');
    await expect(access(join(target, 'pnpm-lock.yaml'))).rejects.toThrow();
    expect(await readFile(join(source, 'src/app/page.tsx'), 'utf8')).toBe(before);
  }, 120_000);

  it('creates a separate resumable target and reports status without changing source', async () => {
    const source = await reactSource();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-cli-react-target-'));
    roots.push(parent);
    const target = join(parent, 'new-srijika-app');
    const before = await readFile(join(source, 'src/App.jsx'), 'utf8');
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(
        runSrijikaCli([
          'migrate',
          'react',
          '--source',
          source,
          '--target',
          target,
          '--no-install',
          '--json',
        ]),
      ).resolves.toBe(0);
      const started = JSON.parse(logs.join('\n')) as { phase: string; sourceRoot: string };
      expect(started).toMatchObject({ phase: 'scaffolded', sourceRoot: await realpath(source) });
      logs.length = 0;
      await expect(
        runSrijikaCli(['migrate', 'status', '--target', target, '--json']),
      ).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({ phase: 'scaffolded' });
    } finally {
      console.log = originalLog;
    }
    expect(await readFile(join(source, 'src/App.jsx'), 'utf8')).toBe(before);
  });

  it('supports npm-create style --from while keeping the source separate', async () => {
    const source = await reactSource();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-cli-create-from-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(
        runSrijikaCli(['create', target, '--from', source, '--no-install', '--no-open', '--json']),
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }
    const payload = JSON.parse(logs.join('\n')) as { migration: { phase: string } };
    expect(payload.migration.phase).toBe('scaffolded');
  });
});

describe('add command', () => {
  it('creates a strict Slot batch through the shared planner and writer', async () => {
    const root = await project();
    const parsed = parseSrijikaArguments([
      'slot',
      'Summary',
      '--project',
      root,
      '--in',
      'src/features/home',
      '--hook',
      '--logic',
    ]);

    const result = await addSrijikaStructure(parsed);

    expect(result.plan.files.map((file) => file.relativePath)).toEqual([
      'src/features/home/slots/summary/Summary.ui.tsx',
      'src/features/home/slots/summary/summary.logic.ts',
      'src/features/home/slots/summary/useSummary.ts',
      'src/features/home/slots/summary/Summary.connector.tsx',
    ]);
    await expect(
      readFile(join(root, 'src/features/home/slots/summary/Summary.connector.tsx'), 'utf8'),
    ).resolves.toContain("import { useSummary } from './useSummary';");
  });

  it('supports a no-write dry run and rejects noncanonical folders', async () => {
    const root = await project();
    const parsed = parseSrijikaArguments([
      'slot',
      'Audit',
      '--project',
      root,
      '--in',
      'src/features/home',
      '--dry-run',
    ]);

    const result = await addSrijikaStructure(parsed);
    expect(result.dryRun).toBe(true);
    await expect(access(join(root, 'src/features/home/slots/audit'))).rejects.toThrow();

    await expect(
      addSrijikaStructure(
        parseSrijikaArguments(['slot', 'Wrong', '--project', root, '--in', 'src/components']),
      ),
    ).rejects.toThrow(/canonical/);
  });

  it('expands Hook and Store gateways atomically with owner-derived names', async () => {
    const root = await project();
    const ownerArguments = ['--project', root, '--in', 'src/features/home'];

    const hook = await addSrijikaStructure(
      parseSrijikaArguments(['behavior-hook', 'Keyboard', ...ownerArguments]),
    );
    expect(hook.plan.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'src/features/home/useHome.ts',
        toRelativePath: 'src/features/home/hooks/useHome.ts',
      }),
    ]);
    const store = await addSrijikaStructure(
      parseSrijikaArguments(['store-slice', 'Filters', ...ownerArguments]),
    );
    expect(store.plan.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'src/features/home/home.store.ts',
        toRelativePath: 'src/features/home/stores/home.store.ts',
      }),
    ]);

    await expect(access(join(root, 'src/features/home/useHome.ts'))).rejects.toThrow();
    await expect(access(join(root, 'src/features/home/home.store.ts'))).rejects.toThrow();
    await expect(
      readFile(join(root, 'src/features/home/hooks/useHome.ts'), 'utf8'),
    ).resolves.toContain("export { useHomeKeyboard } from './useHomeKeyboard';");
    await expect(
      readFile(join(root, 'src/features/home/stores/home.store.ts'), 'utf8'),
    ).resolves.toContain("export { useHomeFiltersStore } from './homeFilters.store';");
    await expect(checkSrijikaArchitecture(root)).resolves.toMatchObject({ diagnostics: [] });
  });

  it('keeps generated starter metadata available to the standalone CLI bundle', () => {
    const files = createSrijikaProjectFileMap();
    expect(files['srijika.toolchain.json']).toContain('react-web-v1');
  });

  it('creates all three canonical Shared owner kinds from src/shared', async () => {
    const root = await project();
    const projectArguments = ['--project', root];

    const primitive = await addSrijikaStructure(
      parseSrijikaArguments(['shared-ui', 'ActionButton', ...projectArguments, '--types']),
    );
    expect(primitive.plan.files.map((file) => file.relativePath)).toEqual([
      'src/shared/ui/action-button/ActionButton.ui.tsx',
      'src/shared/ui/action-button/actionButton.types.ts',
    ]);

    const widget = await addSrijikaStructure(
      parseSrijikaArguments([
        'shared-widget',
        'UserMenu',
        ...projectArguments,
        '--hook',
        '--store',
        '--logic',
        '--api',
        '--types',
      ]),
    );
    expect(widget.plan.files.map((file) => file.relativePath)).toContain(
      'src/shared/widgets/user-menu/UserMenu.connector.tsx',
    );

    await expect(
      addSrijikaStructure(
        parseSrijikaArguments(['shared-capability', 'InvalidAuth', ...projectArguments, '--types']),
      ),
    ).rejects.toThrow(/at least one runtime layer/);
    const capability = await addSrijikaStructure(
      parseSrijikaArguments([
        'shared-capability',
        'Auth',
        ...projectArguments,
        '--hook',
        '--logic',
        '--api',
        '--types',
      ]),
    );
    expect(capability.plan.files.map((file) => file.relativePath)).not.toContain(
      expect.stringContaining('.ui.tsx'),
    );
    await expect(checkSrijikaArchitecture(root)).resolves.toMatchObject({ diagnostics: [] });
  });

  it('expands a Shared Widget Hook and rewrites Feature consumers atomically', async () => {
    const root = await project();
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@shared/*': ['src/shared/*'] } } }),
      'utf8',
    );
    await addSrijikaStructure(
      parseSrijikaArguments(['shared-widget', 'UserMenu', '--project', root, '--hook']),
    );
    const consumer = join(root, 'src/features/home/Home.connector.tsx');
    const appConsumer = join(root, 'src/app/user-menu-runtime.ts');
    const source = await readFile(consumer, 'utf8');
    await writeFile(
      consumer,
      `import { useUserMenu } from '../../shared/widgets/user-menu/useUserMenu';\nimport '@shared/widgets/user-menu/useUserMenu';\n${source}`,
      'utf8',
    );
    await mkdir(join(root, 'src/app'), { recursive: true });
    await writeFile(
      appConsumer,
      "import { useUserMenu } from '../shared/widgets/user-menu/useUserMenu';\nimport '@shared/widgets/user-menu/useUserMenu';\nvoid useUserMenu;\n",
      'utf8',
    );

    const expanded = await addSrijikaStructure(
      parseSrijikaArguments([
        'behavior-hook',
        'Keyboard',
        '--project',
        root,
        '--in',
        'src/shared/widgets/user-menu',
      ]),
    );
    expect(expanded.plan.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'src/shared/widgets/user-menu/useUserMenu.ts',
        toRelativePath: 'src/shared/widgets/user-menu/hooks/useUserMenu.ts',
      }),
    ]);
    await expect(readFile(consumer, 'utf8')).resolves.toContain(
      "from '../../shared/widgets/user-menu/hooks/useUserMenu'",
    );
    await expect(readFile(consumer, 'utf8')).resolves.toContain(
      "'@shared/widgets/user-menu/hooks/useUserMenu'",
    );
    await expect(readFile(appConsumer, 'utf8')).resolves.toContain(
      "from '../shared/widgets/user-menu/hooks/useUserMenu'",
    );
    await expect(readFile(appConsumer, 'utf8')).resolves.toContain(
      "'@shared/widgets/user-menu/hooks/useUserMenu'",
    );
  });
});

describe('owner test commands', () => {
  it('syncs framework tests and reports fail-closed evidence without executed reports', async () => {
    const root = await project();
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(runSrijikaCli(['tests', 'sync', root, '--json'])).resolves.toBe(0);
      expect(await readFile(join(root, 'tests/srijika/contract.generated.json'), 'utf8')).toContain(
        'srijika-test-contract-v1',
      );
      logs.length = 0;
      await expect(runSrijikaCli(['tests', 'evidence', root, '--json'])).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({
        manifest: { framework: 'vite', status: 'not-run' },
      });
    } finally {
      console.log = originalLog;
    }
  });

  it('allows an explicit framework when synchronizing a hybrid Vite and Next.js project', async () => {
    const root = await project();
    const packagePath = join(root, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    packageJson.dependencies['next'] = '16.3.2';
    await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...values: unknown[]) => logs.push(values.map(String).join(' '));
    try {
      await expect(
        runSrijikaCli(['tests', 'sync', root, '--framework', 'vite', '--dry-run', '--json']),
      ).resolves.toBe(0);
      expect(JSON.parse(logs.join('\n'))).toMatchObject({
        adapter: { framework: 'vite' },
        write: null,
      });
    } finally {
      console.log = originalLog;
    }
  });
});
