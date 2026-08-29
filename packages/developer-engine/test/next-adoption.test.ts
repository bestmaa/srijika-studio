import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  adoptSrijikaNextProject,
  planSrijikaNextAdoption,
  resolveSrijikaNextAdoptionProcess,
} from '../src/next-adoption.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function nextProject(
  options: { failingTypecheck?: boolean; packageManager?: string } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-next-adoption-'));
  roots.push(root);
  await mkdir(join(root, 'src/app/api/items'), { recursive: true });
  await mkdir(join(root, 'src/features/catalog'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'existing-next-app',
        private: true,
        packageManager: options.packageManager ?? 'npm@11.0.0',
        scripts: {
          dev: 'next dev',
          build: 'node -e "process.exit(0)"',
          typecheck: `node -e "process.exit(${options.failingTypecheck ? '1' : '0'})"`,
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
    `${JSON.stringify(
      {
        compilerOptions: {
          jsx: 'preserve',
          plugins: [{ name: 'next' }],
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(root, 'src/features/catalog/Catalog.ui.tsx'),
    'export function CatalogUI() { return <main><h1>Catalog</h1></main>; }\n',
  );
  await writeFile(
    join(root, 'src/features/catalog/Catalog.connector.tsx'),
    "import { CatalogUI } from './Catalog.ui';\nexport function CatalogConnector() { return <CatalogUI />; }\n",
  );
  await writeFile(
    join(root, 'src/app/page.tsx'),
    "import { CatalogConnector } from '../features/catalog/Catalog.connector';\nexport default function Page() { return <CatalogConnector />; }\n",
  );
  await writeFile(
    join(root, 'src/app/layout.tsx'),
    "import type { ReactNode } from 'react';\nexport default function Layout({ children }: { children: ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  await writeFile(
    join(root, 'src/app/api/items/route.ts'),
    "import 'server-only';\nexport function GET() { return Response.json([]); }\n",
  );
  return root;
}

describe('Next.js App Router brownfield adoption', () => {
  it('invokes Windows package-manager shims through a validated command shell', () => {
    const command = {
      name: 'typecheck' as const,
      executable: 'npm.cmd',
      args: ['run', 'typecheck'],
      cwd: 'C:\\project',
      timeoutMillis: 120_000,
    };

    expect(resolveSrijikaNextAdoptionProcess(command, 'win32', 'cmd.exe')).toEqual({
      executable: 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd run typecheck'],
    });
    expect(() =>
      resolveSrijikaNextAdoptionProcess(
        { ...command, args: ['run', 'typecheck&unexpected'] },
        'win32',
        'cmd.exe',
      ),
    ).toThrow(/unsafe token/);
  });

  it('produces a deterministic no-write plan with framework and server boundaries', async () => {
    const root = await nextProject();
    const beforePackage = await readFile(join(root, 'package.json'), 'utf8');

    const plan = await planSrijikaNextAdoption({ project: root, dryRun: true });

    expect(plan).toMatchObject({
      framework: 'next-app-router',
      packageManager: 'npm',
      lockfile: 'package-lock.json',
      nextVersion: '16.3.2',
      appRoot: 'src/app',
      entry: 'src/features/catalog/Catalog.ui.tsx',
      nextTypeScriptPlugin: true,
      aliases: { '@/': 'src' },
    });
    expect(plan.routes).toEqual([
      expect.objectContaining({ relativePath: 'src/app/api/items/route.ts', kind: 'route' }),
      expect.objectContaining({ relativePath: 'src/app/layout.tsx', kind: 'layout' }),
      expect.objectContaining({ relativePath: 'src/app/page.tsx', kind: 'page' }),
    ]);
    expect(plan.protectedServerFiles).toEqual(['src/app/api/items/route.ts']);
    expect(plan.files.map(({ relativePath }) => relativePath)).toContain(
      'tests/srijika-next/contract.generated.json',
    );
    expect(plan.mergeInstructions).toEqual([
      expect.objectContaining({ relativePath: 'package.json' }),
    ]);
    await expect(access(join(root, 'srijika.config.json'))).rejects.toThrow();
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(beforePackage);
  });

  it('runs authoritative gates, adds only missing contracts, and preserves populated source', async () => {
    const root = await nextProject();
    const protectedFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'src/app/page.tsx',
      'src/app/layout.tsx',
      'src/app/api/items/route.ts',
      'src/features/catalog/Catalog.ui.tsx',
      'src/features/catalog/Catalog.connector.tsx',
    ];
    const before: Record<string, string> = Object.fromEntries(
      await Promise.all(
        protectedFiles.map(
          async (relativePath) =>
            [relativePath, await readFile(join(root, relativePath), 'utf8')] as const,
        ),
      ),
    );

    const result = await adoptSrijikaNextProject({ project: root });

    expect(result.dryRun).toBe(false);
    expect(result.verification).toEqual([
      expect.objectContaining({ name: 'typecheck', status: 'passed' }),
      expect.objectContaining({ name: 'build', status: 'passed' }),
    ]);
    expect(result.created).toContain('srijika.config.json');
    expect(result.created).toContain('.mcp.json');
    expect(result.created).toContain('.srijika/adoption/next-app-router.json');
    expect(result.created).toContain('tests/srijika-next/contract.generated.json');
    if (result.reportOnly === null) {
      throw new Error('Expected report-only diagnostics after applying adoption');
    }
    expect(typeof result.reportOnly.architectureErrors).toBe('number');
    expect(result.reportOnly.uiDiagnostics).toBe(0);
    for (const relativePath of protectedFiles) {
      expect(await readFile(join(root, relativePath), 'utf8')).toBe(before[relativePath]);
    }
    expect(await readFile(join(root, 'srijika.config.json'), 'utf8')).toContain(
      '"enforcement": "report-only"',
    );
  });

  it('preserves existing editor and MCP files and emits reviewed merge instructions', async () => {
    const root = await nextProject();
    await mkdir(join(root, '.vscode'), { recursive: true });
    await writeFile(join(root, '.mcp.json'), '{"mcpServers":{"company":{}}}\n');
    await writeFile(join(root, '.vscode/settings.json'), '{"editor.formatOnSave":true}\n');

    const plan = await planSrijikaNextAdoption({ project: root });

    expect(plan.preserved).toEqual(['.mcp.json', '.vscode/settings.json']);
    expect(plan.files.map(({ relativePath }) => relativePath)).not.toContain('.mcp.json');
    expect(plan.mergeInstructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: '.mcp.json' }),
        expect.objectContaining({ relativePath: '.vscode/settings.json' }),
      ]),
    );
    expect(await readFile(join(root, '.mcp.json'), 'utf8')).toContain('company');
  });

  it('detects npm, pnpm, yarn, and Bun root lockfiles deterministically', async () => {
    const cases = [
      { declaration: 'npm@11.0.0', manager: 'npm', lockfile: 'package-lock.json', source: '{}' },
      {
        declaration: 'pnpm@11.18.0',
        manager: 'pnpm',
        lockfile: 'pnpm-lock.yaml',
        source: "lockfileVersion: '9.0'\n",
      },
      { declaration: 'yarn@4.9.2', manager: 'yarn', lockfile: 'yarn.lock', source: '# yarn\n' },
      { declaration: 'bun@1.2.22', manager: 'bun', lockfile: 'bun.lock', source: '{}\n' },
    ] as const;
    for (const testCase of cases) {
      const root = await nextProject({ packageManager: testCase.declaration });
      if (testCase.lockfile !== 'package-lock.json') {
        await rm(join(root, 'package-lock.json'));
        await writeFile(join(root, testCase.lockfile), testCase.source);
      }
      await expect(planSrijikaNextAdoption({ project: root, dryRun: true })).resolves.toMatchObject(
        {
          packageManager: testCase.manager,
          lockfile: testCase.lockfile,
        },
      );
    }
  });

  it('fails closed for ambiguous lockfiles and missing explicit UI ownership', async () => {
    const ambiguous = await nextProject({ packageManager: 'npm@11.0.0' });
    await writeFile(join(ambiguous, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const ambiguousPackage = JSON.parse(
      await readFile(join(ambiguous, 'package.json'), 'utf8'),
    ) as {
      packageManager?: string;
    };
    delete ambiguousPackage.packageManager;
    await writeFile(
      join(ambiguous, 'package.json'),
      `${JSON.stringify(ambiguousPackage, null, 2)}\n`,
    );
    await expect(planSrijikaNextAdoption({ project: ambiguous })).rejects.toThrow(
      /Multiple package-manager lockfiles/,
    );

    const withoutUi = await nextProject();
    await rm(join(withoutUi, 'src/features/catalog/Catalog.ui.tsx'));
    await expect(planSrijikaNextAdoption({ project: withoutUi })).rejects.toThrow(
      /explicit \.ui\.tsx presentation source/,
    );
  });

  it('writes no metadata when the existing project fails typecheck', async () => {
    const root = await nextProject({ failingTypecheck: true });

    await expect(adoptSrijikaNextProject({ project: root })).rejects.toThrow(
      /typecheck verification failed before any metadata was written/,
    );
    await expect(access(join(root, 'srijika.config.json'))).rejects.toThrow();
    await expect(access(join(root, '.mcp.json'))).rejects.toThrow();
  });
});
