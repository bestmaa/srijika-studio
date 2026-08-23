import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    ).toEqual(['/workspace/app/application/modules', '/workspace/app/application/common']);
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

describe('React migration command', () => {
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
      expect(started).toMatchObject({ phase: 'scaffolded', sourceRoot: source });
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
