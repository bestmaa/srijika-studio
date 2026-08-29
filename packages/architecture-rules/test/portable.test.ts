import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parseSrijikaTypeScriptPathAliases,
  resolveSrijikaArchitectureConfig,
  validateSrijikaArchitecture,
  type SrijikaArchitectureConfig,
} from '../src/index';
import { createSrijikaArchitectureValidatorScript } from '../src/portable';

const temporaryDirectories: string[] = [];

async function portableValidatorSource(
  project: string,
  architecture: Partial<SrijikaArchitectureConfig> = {},
): Promise<string> {
  const configPath = path.join(project, 'srijika.config.json');
  try {
    await stat(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const resolved = resolveSrijikaArchitectureConfig(architecture);
    const entry = `portable-entry${resolved.uiSuffix}`;
    await writeFile(
      path.join(project, entry),
      'export function PortableEntryUI() { return <main />; }\n',
    );
    await writeFile(
      configPath,
      JSON.stringify({ sourceOfTruth: 'tsx', entry, architecture: resolved }),
    );
  }
  return createSrijikaArchitectureValidatorScript(architecture);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('portable architecture validator', () => {
  it('keeps staged brownfield validation strict only for adopted owners', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-brownfield-'));
    temporaryDirectories.push(project);
    const sources = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return <main>Home</main>; }\n',
      'src/features/home/Home.connector.tsx':
        "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }\n",
      'src/features/catalog/Catalog.ui.tsx':
        "export function CatalogUI() { fetch('/pending'); return <main />; }\n",
      'src/features/catalog/server/load.ts': "export const load = () => fetch('/server');\n",
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
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
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const partial = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(partial.status).toBe(0);
    expect(partial.stderr).not.toContain('SRIJIKA4101');
    expect(partial.stdout).toContain('brownfield ownership partial');
    expect(partial.stdout).toContain('2 governed, 1 pending, 1 excluded');

    await writeFile(
      path.join(project, 'src/features/home/Home.ui.tsx'),
      "export function HomeUI() { fetch('/strict'); return <main />; }\n",
    );
    const strict = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain('SRIJIKA4101');
    expect(strict.stdout).toContain('brownfield ownership blocked');
  });

  it('creates a standalone project script that fails on an ownership violation', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await mkdir(path.join(project, 'src/features/dashboard'), { recursive: true });
    await writeFile(
      path.join(project, 'src/features/home/home.store.ts'),
      'export const useHomeStore = 1;\n',
    );
    await writeFile(
      path.join(project, 'src/features/dashboard/Dashboard.connector.tsx'),
      "import { useHomeStore } from '../home/home.store';\nvoid useHomeStore;\n",
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], {
      cwd: project,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SRIJIKA4102');
  });

  it('keeps portable CLI codes in parity with the browser-safe validator', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-parity-'));
    temporaryDirectories.push(project);
    const uiFile = path.join(project, 'src/features/home/Home.ui.tsx');
    const storeFile = path.join(project, 'src/features/home/home.store.tsx');
    await mkdir(path.dirname(uiFile), { recursive: true });
    const uiSource = [
      "import { useState } from 'react';",
      "import { useHomeStore } from './home.store';",
      'export function HomeUI() { const [open] = useState(false); return <main>{String(open || useHomeStore)}</main>; }',
    ].join('\n');
    const storeSource = 'export const useHomeStore = 1;\n';
    await writeFile(uiFile, uiSource);
    await writeFile(storeFile, storeSource);
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      [
        { fileName: uiFile, source: uiSource },
        { fileName: storeFile, source: storeSource },
      ],
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
  });

  it('keeps computed-module and tsconfig-alias failures in canonical parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-alias-parity-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return <main />; }',
      'src/features/home/Home.connector.tsx': [
        "import { loadHome } from '@app/features/home/home.api';",
        "import missing from '#missing';",
        "const requested = './home.api';",
        'void import(requested); void loadHome; void missing;',
      ].join('\n'),
      'src/features/home/home.api.ts': 'export const loadHome = () => null;',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const tsconfigSource = `{
      // JSONC must match the editor contract
      "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] } }
    }`;
    await writeFile(path.join(project, 'tsconfig.json'), tsconfigSource);
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const aliases = parseSrijikaTypeScriptPathAliases(tsconfigSource);
    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project, aliases },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.sort()).toEqual(['SRIJIKA4119', 'SRIJIKA4120']);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual(browserCodes.sort());
    expect(result.stderr).toContain('SRIJIKA-ARCH-UNPROVABLE-DYNAMIC-IMPORT');
    expect(result.stderr).toContain('SRIJIKA-ARCH-UNRESOLVED-PROJECT-ALIAS');
  });

  it('fails closed for absent and outside-root local imports in canonical parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-local-import-parity-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': [
        "import { run } from '../../runtime';",
        "import './home.css';",
        'export function HomeUI() { run(); return <main />; }',
      ].join('\n'),
      'src/features/home/Home.connector.tsx': [
        "import { homeLogic } from 'src/features/home/home.logic';",
        "import missing from './missing.logic';",
        'void homeLogic; void missing;',
      ].join('\n'),
      'src/features/home/home.logic.ts': 'export const homeLogic = () => undefined;',
      'src/runtime.ts': 'export const run = () => undefined;',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.sort()).toEqual(['SRIJIKA4121', 'SRIJIKA4121']);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual(browserCodes.sort());
    expect(result.stderr).toContain('SRIJIKA-ARCH-UNRESOLVED-PROJECT-IMPORT');
  });

  it('rejects drive-relative project and tsconfig paths in portable parity', async () => {
    const cases = [
      {
        name: 'entry',
        config: { sourceOfTruth: 'tsx', entry: 'C:Home.ui.tsx' },
      },
      {
        name: 'base-url',
        config: { sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' },
        tsconfig: {
          compilerOptions: { baseUrl: 'C:project', paths: { '@app/*': ['src/*'] } },
        },
      },
      {
        name: 'alias-target',
        config: { sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' },
        tsconfig: { compilerOptions: { paths: { '@drive/*': ['D:src/*'] } } },
      },
    ] as const;

    for (const testCase of cases) {
      const project = await mkdtemp(
        path.join(tmpdir(), `srijika-portable-drive-${testCase.name}-`),
      );
      temporaryDirectories.push(project);
      await mkdir(path.join(project, 'src/features/home'), { recursive: true });
      await writeFile(
        path.join(project, 'src/features/home/Home.ui.tsx'),
        'export function HomeUI() { return <main />; }',
      );
      await writeFile(path.join(project, 'srijika.config.json'), JSON.stringify(testCase.config));
      if ('tsconfig' in testCase) {
        await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify(testCase.tsconfig));
      }
      const script = path.join(project, 'srijika-validate.mjs');
      await writeFile(script, await portableValidatorSource(project));
      await mkdir(path.join(project, 'node_modules'), { recursive: true });
      await symlink(
        path.resolve('node_modules/typescript'),
        path.join(project, 'node_modules/typescript'),
        'dir',
      );

      const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

      expect(result.status, testCase.name).toBe(1);
      expect(result.stderr, testCase.name).toMatch(/project-relative path|inside the project root/);
    }
  });

  it('rejects ambiguous non-slash TypeScript wildcard aliases in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-wildcard-alias-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await mkdir(path.join(project, 'src/shared'), { recursive: true });
    await writeFile(
      path.join(project, 'src/features/home/Home.ui.tsx'),
      'export function HomeUI() { return <main />; }',
    );
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' }),
    );
    await writeFile(
      path.join(project, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@feature*': ['src/features/*'] } } }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('slash-delimited /* wildcard');
  });

  it('fails closed on nonempty TypeScript project references', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-ts-references-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await writeFile(
      path.join(project, 'src/features/home/Home.ui.tsx'),
      'export function HomeUI() { return <main />; }',
    );
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/features/home/Home.ui.tsx' }),
    );
    await writeFile(
      path.join(project, 'tsconfig.json'),
      JSON.stringify({ references: [{ path: './packages/runtime' }], compilerOptions: {} }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('project references are not supported');
  });

  it('keeps standalone browser globals and Logic transport aliases in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-runtime-reference-parity-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': [
        'type BrowserWindow = typeof window;',
        'interface Labels { window: string; globalThis: string; self: string; performance: string; screen: string; process: string; Deno: string; Bun: string; }',
        "const labels: Labels = { window: 'window', globalThis: 'global', self: 'self', performance: 'performance', screen: 'screen', process: 'process', Deno: 'deno', Bun: 'bun' };",
        'const { window: windowLabel, globalThis: globalLabel, self: selfLabel } = labels;',
        'export function HomeUI(props: { keyName: string }) {',
        '  const values = [window, globalThis, self, window[props.keyName]];',
        '  const environment = [performance.now, screen.width, process.env, Deno.env, Bun.version];',
        '  return <main>{windowLabel}{globalLabel}{selfLabel}{String(values)}{String(environment)}</main>;',
        '}',
      ].join('\n'),
      'src/features/home/Home.connector.tsx': "import './home.logic';",
      'src/features/home/home.logic.ts': [
        'type BrowserWindow = typeof window;',
        'interface Labels { window: string; fetch: string; }',
        "const labels: Labels = { window: 'window', fetch: 'fetch' };",
        'const transport = fetch;',
        'const invoke = fetch.call;',
        'const Constructor = XMLHttpRequest;',
        'const scopedFetch = window.fetch;',
        "const ScopedConstructor = globalThis['XMLHttpRequest'];",
        'const browserLocation = self.location;',
        'export function homeLogic() {',
        '  return [labels, transport, invoke, new Constructor(), scopedFetch, new ScopedConstructor(), browserLocation];',
        '}',
      ].join('\n'),
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.filter((code) => code === 'SRIJIKA4101')).toHaveLength(9);
    expect(browserCodes.filter((code) => code === 'SRIJIKA4118')).toHaveLength(6);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
    expect(result.stderr).toContain('window browser/runtime API');
    expect(result.stderr).toContain('fetch React, state, router, or query lifecycle concern');
    expect(result.stderr).toContain('globalThis.XMLHttpRequest');
  });

  it('strictly validates a configured UI entry outside ownership roots', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-outside-entry-strict-'));
    temporaryDirectories.push(project);
    const entryPath = path.join(project, 'application/App.ui.tsx');
    const source = [
      "import './unscanned-runtime';",
      "import './app.css';",
      "const requested = './runtime';",
      'void import(requested);',
      'export function AppUI() { return <main />; }',
    ].join('\n');
    await mkdir(path.dirname(entryPath), { recursive: true });
    await writeFile(entryPath, source);
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'application/App.ui.tsx' }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const canonicalCodes = validateSrijikaArchitecture([{ fileName: entryPath, source }], {
      projectRoot: project,
    }).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(canonicalCodes.sort()).toEqual(['SRIJIKA4119', 'SRIJIKA4121']);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual(canonicalCodes);
  });

  it('fails closed when the configured entry is missing or unsafe', async () => {
    for (const mode of ['missing', 'symlink', 'oversized', 'invalid-utf8'] as const) {
      const project = await mkdtemp(path.join(tmpdir(), `srijika-portable-entry-${mode}-`));
      temporaryDirectories.push(project);
      const entry = path.join(project, 'application/screens/Landing.ui.tsx');
      await mkdir(path.dirname(entry), { recursive: true });
      await mkdir(path.join(project, 'src/features'), { recursive: true });
      await mkdir(path.join(project, 'src/shared'), { recursive: true });
      if (mode === 'symlink') {
        const outside = path.join(project, 'outside-entry.tsx');
        await writeFile(outside, 'export function LandingUI() { return <main />; }');
        await symlink(outside, entry, 'file');
      } else if (mode === 'oversized') {
        await writeFile(entry, 'x'.repeat(4 * 1024 * 1024 + 1));
      } else if (mode === 'invalid-utf8') {
        await writeFile(entry, Buffer.from([0xff, 0xfe, 0xfd]));
      }
      await writeFile(
        path.join(project, 'srijika.config.json'),
        JSON.stringify({ sourceOfTruth: 'tsx', entry: 'application/screens/Landing.ui.tsx' }),
      );
      const script = path.join(project, 'srijika-validate.mjs');
      await writeFile(script, await portableValidatorSource(project));
      await mkdir(path.join(project, 'node_modules'), { recursive: true });
      await symlink(
        path.resolve('node_modules/typescript'),
        path.join(project, 'node_modules/typescript'),
        'dir',
      );

      const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

      expect(result.status, mode).toBe(1);
      expect(result.stderr, mode).toMatch(
        mode === 'missing'
          ? /ENOENT|not found/i
          : mode === 'symlink'
            ? /symbolic link/
            : mode === 'oversized'
              ? /4194304-byte read limit/
              : /valid UTF-8/,
      );
    }
  });

  it('validates an authoritative UI entry outside the ownership roots', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-outside-entry-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features'), { recursive: true });
    await mkdir(path.join(project, 'src/shared'), { recursive: true });
    await mkdir(path.join(project, 'application/screens'), { recursive: true });
    await writeFile(
      path.join(project, 'application/screens/Landing.ui.tsx'),
      "export function LandingUI() { fetch('/secret'); return <main />; }",
    );
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx', entry: 'application/screens/Landing.ui.tsx' }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SRIJIKA4101');
    expect(result.stderr).toContain('Landing.ui.tsx');
  });

  it('scans JavaScript sources from configured no-src roots in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-custom-roots-'));
    temporaryDirectories.push(project);
    const architecture = {
      profile: 'feature-slot-part-v1' as const,
      featuresRoot: 'product/features',
      sharedRoot: 'common',
    };
    const sources: Readonly<Record<string, string>> = {
      'product/features/home/Home.ui.tsx': 'export function HomeUI() { return <main />; }',
      'product/features/home/Home.connector.tsx':
        "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }",
      'product/features/home/freehand.jsx': 'export const Freehand = () => <aside />;',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project, architecture));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project, architecture },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.length).toBeGreaterThan(0);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
    expect(result.stderr).toContain('freehand.jsx');
  });

  it('reads the current project architecture instead of a generated config snapshot', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-runtime-config-'));
    temporaryDirectories.push(project);
    const architecture = {
      profile: 'feature-slot-part-v1' as const,
      featuresRoot: 'application/modules',
      sharedRoot: 'application/common',
      slotsDirectory: 'regions',
      partsDirectory: 'pieces',
      hooksDirectory: 'behaviors',
      storesDirectory: 'state',
      uiSuffix: '.view.tsx',
      connectorSuffix: '.gateway.tsx',
      storeSuffix: '.state.ts',
      logicSuffix: '.rules.ts',
      apiSuffix: '.transport.ts',
      typesSuffix: '.contracts.ts',
    };
    const sources: Readonly<Record<string, string>> = {
      'application/modules/home/Home.view.tsx': 'export function HomeUI() { return <main />; }',
      'application/modules/home/Home.gateway.tsx':
        "import { HomeUI } from './Home.view'; export function HomeConnector() { return <HomeUI />; }",
      'application/modules/home/freehand.jsx': 'export const Freehand = () => <aside />;',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify(
        {
          sourceOfTruth: 'tsx',
          entry: 'application/modules/home/Home.view.tsx',
          architecture,
        },
        null,
        2,
      ),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    // The emitted script starts with defaults; runtime config must still win.
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project, architecture },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes).toEqual(['SRIJIKA4110']);
    expect(result.status).toBe(1);
    expect(portableCodes).toEqual(browserCodes);
    expect(result.stderr).toContain('freehand.jsx');
  });

  it('uses configured capability suffixes for strict UI dependency checks in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-custom-suffix-ui-'));
    temporaryDirectories.push(project);
    const architecture = {
      profile: 'feature-slot-part-v1' as const,
      featuresRoot: 'application/modules',
      sharedRoot: 'application/common',
      slotsDirectory: 'regions',
      partsDirectory: 'pieces',
      hooksDirectory: 'behaviors',
      storesDirectory: 'state',
      uiSuffix: '.view.tsx',
      connectorSuffix: '.gateway.tsx',
      storeSuffix: '.state.ts',
      logicSuffix: '.rules.ts',
      apiSuffix: '.transport.ts',
      typesSuffix: '.contracts.ts',
    };
    const sources: Readonly<Record<string, string>> = {
      'application/modules/home/Home.view.tsx': [
        "import { HomeConnector } from './Home.gateway';",
        "import { homeState } from './home.state';",
        'export function HomeUI() { return <main>{String(HomeConnector)}{String(homeState)}</main>; }',
      ].join('\n'),
      'application/modules/home/Home.gateway.tsx':
        "import { HomeUI } from './Home.view'; export function HomeConnector() { return <HomeUI />; }",
      'application/modules/home/home.state.ts': 'export const homeState = {};',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'application/modules/home/Home.view.tsx',
        architecture,
      }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const canonicalDiagnostics = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project, architecture },
    ).diagnostics;
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(
      canonicalDiagnostics.filter(
        ({ code, message }) =>
          code === 'SRIJIKA4101' && (message.includes('store') || message.includes('connector')),
      ),
    ).toHaveLength(2);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual(canonicalDiagnostics.map(({ code }) => code).sort());
    expect(result.stderr).toContain('cannot import a connector');
    expect(result.stderr).toContain('cannot import a store');
  });

  it('fails closed when a project architecture block has no supported profile', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-profile-'));
    temporaryDirectories.push(project);
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { featuresRoot: 'application/modules' },
      }),
    );
    const missing = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('architecture.profile');

    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'unsupported-v2' },
      }),
    );
    const unsupported = spawnSync(process.execPath, [script], {
      cwd: project,
      encoding: 'utf8',
    });
    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr).toContain('architecture.profile');
  });

  it('rejects case-insensitive overlapping runtime suffixes', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-overlap-suffix-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await writeFile(
      path.join(project, 'src/features/home/Home.view.tsx'),
      'export function HomeUI() { return <main />; }',
    );
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.view.tsx',
        architecture: {
          ...resolveSrijikaArchitectureConfig({}),
          uiSuffix: '.view.tsx',
          connectorSuffix: '.Connector.view.tsx',
        },
      }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must not overlap by suffix');
  });

  it('rejects a symlinked portable project root before scanning', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-root-'));
    temporaryDirectories.push(project);
    const linkedProject = `${project}-link`;
    temporaryDirectories.push(linkedProject);
    await mkdir(path.join(project, 'src/features'), { recursive: true });
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );
    await symlink(project, linkedProject, 'dir');

    const result = spawnSync(process.execPath, [path.join(linkedProject, 'srijika-validate.mjs')], {
      cwd: linkedProject,
      encoding: 'utf8',
      env: { ...process.env, PWD: linkedProject },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('symbolic link');
  });

  it.each(['root', 'ancestor', 'file'] as const)(
    'rejects a symlinked portable ownership %s without exposing outside source',
    async (scenario) => {
      const project = await mkdtemp(path.join(tmpdir(), `srijika-portable-${scenario}-`));
      const outside = await mkdtemp(path.join(tmpdir(), `srijika-portable-outside-${scenario}-`));
      temporaryDirectories.push(project, outside);
      const featureRoot = path.join(project, 'src/features');
      await mkdir(path.join(featureRoot, 'home'), { recursive: true });
      await writeFile(
        path.join(featureRoot, 'home/Home.ui.tsx'),
        'export function HomeUI() { return null; }\n',
      );
      await writeFile(
        path.join(outside, 'Secret.ui.tsx'),
        'export const secret = "must-not-be-exposed";\n',
      );
      if (scenario === 'root') {
        await rm(featureRoot, { recursive: true });
        await symlink(outside, featureRoot, 'dir');
      } else if (scenario === 'ancestor') {
        await symlink(outside, path.join(featureRoot, 'home/slots'), 'dir');
      } else {
        await rm(path.join(featureRoot, 'home/Home.ui.tsx'));
        await symlink(
          path.join(outside, 'Secret.ui.tsx'),
          path.join(featureRoot, 'home/Home.ui.tsx'),
          'file',
        );
      }
      const script = path.join(project, 'srijika-validate.mjs');
      await writeFile(script, await portableValidatorSource(project));
      await mkdir(path.join(project, 'node_modules'), { recursive: true });
      await symlink(
        path.resolve('node_modules/typescript'),
        path.join(project, 'node_modules/typescript'),
        'dir',
      );

      const result = spawnSync(process.execPath, [script], {
        cwd: project,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('symbolic link');
      expect(result.stderr).not.toContain('must-not-be-exposed');
    },
  );

  it('rejects a symlink before applying an ignored-directory name inside ownership roots', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-ignored-link-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'srijika-portable-ignored-outside-'));
    temporaryDirectories.push(project, outside);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await symlink(outside, path.join(project, 'src/features/home/node_modules'), 'dir');
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/features/home/node_modules must not be a symbolic link');
  });

  it('matches canonical ignored directories, case-insensitive extensions, and fatal UTF-8 reads', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-scan-parity-'));
    temporaryDirectories.push(project);
    const owner = path.join(project, 'src/features/home');
    await mkdir(owner, { recursive: true });
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
      }),
    );
    await writeFile(path.join(owner, 'Home.ui.tsx'), 'export function HomeUI() { return null; }\n');
    await writeFile(
      path.join(owner, 'Home.connector.tsx'),
      "import { HomeUI } from './Home.ui'; export function HomeConnector() { return HomeUI(); }\n",
    );
    await writeFile(path.join(owner, 'Upper.TS'), 'void import(requested);\n');
    await writeFile(path.join(owner, 'Contract.d.TSX'), 'void import(requested);\n');
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
      const ignored = path.join(owner, directory);
      await mkdir(ignored, { recursive: true });
      await writeFile(path.join(ignored, 'Ignored.TSX'), 'void import(requested);\n');
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const scanned = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    expect(scanned.status).toBe(1);
    expect(scanned.stderr).toContain('Upper.TS');
    expect(scanned.stderr).not.toContain('Contract.d.TSX');
    expect(scanned.stderr).not.toContain('Ignored.TSX');

    await rm(path.join(owner, 'Upper.TS'));
    await writeFile(path.join(owner, 'Invalid.ts'), Buffer.from([0xff, 0xfe, 0xfd]));
    const invalidUtf8 = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    expect(invalidUtf8.status).toBe(1);
    expect(invalidUtf8.stderr).toContain('valid UTF-8');
  });

  it('rejects nonregular filesystem entries inside governed roots', async () => {
    if (process.platform === 'win32') return;
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-nonregular-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
      }),
    );
    const fifo = path.join(project, 'src/features/home/runtime.pipe');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime.pipe must be a regular file or directory');
  });

  it('fails closed on an incomplete top-level TSX-first project contract', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-project-config-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features'), { recursive: true });
    await writeFile(
      path.join(project, 'srijika.config.json'),
      JSON.stringify({ sourceOfTruth: 'tsx' }),
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('architecture.entry');
  });

  it('requires the authoritative project config instead of using embedded defaults', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-portable-missing-config-'));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, 'src/features/home'), { recursive: true });
    await writeFile(
      path.join(project, 'src/features/home/Home.ui.tsx'),
      'export function HomeUI() { return <main />; }\n',
    );
    await writeFile(
      path.join(project, 'src/features/home/Home.connector.tsx'),
      "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }\n",
    );
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, createSrijikaArchitectureValidatorScript());
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('srijika.config.json is required');
  });

  it('bounds portable config bytes and recursive directory depth', async () => {
    const oversized = await mkdtemp(path.join(tmpdir(), 'srijika-portable-oversized-'));
    temporaryDirectories.push(oversized);
    await writeFile(path.join(oversized, 'srijika.config.json'), 'x'.repeat(64 * 1024 + 1));
    const oversizedScript = path.join(oversized, 'srijika-validate.mjs');
    await writeFile(oversizedScript, await portableValidatorSource(oversized));
    await mkdir(path.join(oversized, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(oversized, 'node_modules/typescript'),
      'dir',
    );
    const oversizedResult = spawnSync(process.execPath, [oversizedScript], {
      cwd: oversized,
      encoding: 'utf8',
    });
    expect(oversizedResult.status).toBe(1);
    expect(oversizedResult.stderr).toContain('65536-byte read limit');

    const deep = await mkdtemp(path.join(tmpdir(), 'srijika-portable-deep-'));
    temporaryDirectories.push(deep);
    const deepSegments = Array.from({ length: 33 }, (_, index) => `d${index}`);
    await mkdir(path.join(deep, 'src/features', ...deepSegments), { recursive: true });
    const deepScript = path.join(deep, 'srijika-validate.mjs');
    await writeFile(deepScript, await portableValidatorSource(deep));
    await mkdir(path.join(deep, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(deep, 'node_modules/typescript'),
      'dir',
    );
    const deepResult = spawnSync(process.execPath, [deepScript], {
      cwd: deep,
      encoding: 'utf8',
    });
    expect(deepResult.status).toBe(1);
    expect(deepResult.stderr).toContain('directory depth limit');
  });

  it('matches browser ownership checks for nested indexes, import-equals, and ordinary sources', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-acceptance-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/dashboard/Dashboard.ui.tsx': 'export function DashboardUI() { return null; }',
      'src/features/dashboard/Dashboard.connector.tsx': [
        "import privateFeature from '../home/private';",
        "import homeStore = require('../home/home.store');",
        'void privateFeature; void homeStore;',
      ].join('\n'),
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }',
      'src/features/home/Home.connector.tsx':
        "import privateSlot from './slots/navigation/private'; void privateSlot;",
      'src/features/home/home.store.ts': 'export const homeStore = 1;',
      'src/features/home/private/index.ts': 'export default 1;',
      'src/features/home/slots/navigation/Navigation.ui.tsx':
        'export function NavigationUI() { return null; }',
      'src/features/home/slots/navigation/Navigation.connector.tsx': [
        "import { UserMenuUI } from './parts/user-menu/UserMenu.ui';",
        "import { UserMenuConnector } from './parts/user-menu/UserMenu.connector';",
        "import { userMenuStore } from './parts/user-menu/userMenu.store';",
        'void UserMenuUI; void UserMenuConnector; void userMenuStore;',
      ].join('\n'),
      'src/features/home/slots/navigation/private/index.ts': 'export default 1;',
      'src/features/home/slots/navigation/parts/profile/Profile.ui.tsx':
        'export function ProfileUI() { return null; }',
      'src/features/home/slots/navigation/parts/profile/Profile.connector.tsx': [
        "import privatePart from '../user-menu/private';",
        "import { UserMenuUI } from '../user-menu/UserMenu.ui';",
        "import { UserMenuConnector } from '../user-menu/UserMenu.connector';",
        'void privatePart; void UserMenuUI; void UserMenuConnector;',
      ].join('\n'),
      'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx':
        'export function UserMenuUI() { return null; }',
      'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx':
        "import { userMenuStore } from './userMenu.store'; void userMenuStore;",
      'src/features/home/slots/navigation/parts/user-menu/userMenu.store.ts':
        'export const userMenuStore = 1;',
      'src/features/home/slots/navigation/parts/user-menu/private/index.ts': 'export default 1;',
      'src/features/settings/util.ts': 'export const setting = 1;',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.sort()).toEqual([
      'SRIJIKA4102',
      'SRIJIKA4102',
      'SRIJIKA4103',
      'SRIJIKA4104',
      'SRIJIKA4104',
      'SRIJIKA4104',
      'SRIJIKA4106',
      'SRIJIKA4109',
      'SRIJIKA4110',
      'SRIJIKA4110',
      'SRIJIKA4110',
      'SRIJIKA4110',
      'SRIJIKA4116',
      'SRIJIKA4116',
    ]);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual(browserCodes);
    expect(result.stderr).toContain('SRIJIKA-ARCH-MISSING-CONNECTOR');
  });

  it('keeps the progressive capability chain in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-chain-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/dashboard/Dashboard.ui.tsx': 'export function DashboardUI() { return null; }',
      'src/features/dashboard/Dashboard.connector.tsx': "import './dashboard.api';",
      'src/features/dashboard/useDashboard.ts': "import './dashboard.logic';",
      'src/features/dashboard/dashboard.store.ts': "import './dashboard.logic';",
      'src/features/dashboard/dashboard.logic.ts': "import './dashboard.api';",
      'src/features/dashboard/dashboard.api.ts': 'export const dashboardApi = {};',
      'src/features/dashboard/dashboard.types.ts': 'export interface DashboardState {}',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes).toEqual(['SRIJIKA4201', 'SRIJIKA4201']);
    expect(result.status).toBe(1);
    expect(portableCodes).toEqual(browserCodes);
  });

  it('keeps private Store-slice gateway enforcement in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-store-slices-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }',
      'src/features/home/Home.connector.tsx': "import './stores/homeFilters.store';",
      'src/features/home/stores/home.store.ts': "import './homeFilters.store';",
      'src/features/home/stores/homeFilters.store.ts': 'export const homeFiltersSlice = {};',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes).toEqual(['SRIJIKA4201']);
    expect(result.status).toBe(1);
    expect(portableCodes).toEqual(browserCodes);
    expect(result.stderr).toContain('canonical Store gateway');
  });

  it('keeps deterministic recommendation signals and stable IDs in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-architecture-recommend-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/report/Report.ui.tsx': 'export function ReportUI() { return null; }',
      'src/features/report/Report.connector.tsx': [
        "void fetch('/reports');",
        "void fetch('/summary');",
      ].join('\n'),
      'src/features/report/report.api.ts': 'export const reportApi = {} as any;',
      'src/features/grid/Grid.ui.tsx': 'export function GridUI() { return null; }',
      'src/features/grid/Grid.connector.tsx': "import './grid.store';",
      'src/features/grid/grid.store.ts':
        'export const select = (state: any) => [state.a, state.b, state.c, state.d, state.e];',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(0);
    expect(portableCodes.sort()).toEqual(browserCodes.sort());
    expect(result.stderr).toContain('SRIJIKA-ARCH-RECOMMEND-LOGIC');
    expect(result.stderr).toContain('SRIJIKA-ARCH-RECOMMEND-HOOK-ABOVE-STORE');
  });

  it('keeps canonical Shared ownership and public-boundary diagnostics in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-shared-parity-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }',
      'src/features/home/Home.connector.tsx':
        "import '../../shared/widgets/user-menu/useUserMenu';",
      'src/features/home/home.logic.ts': 'export const homeLogic = {};',
      'src/features/home/home.types.ts': 'export interface HomeSecret {}',
      'src/shared/widgets/user-menu/UserMenu.ui.tsx':
        'export function UserMenuUI() { return null; }',
      'src/shared/widgets/user-menu/UserMenu.connector.tsx': "import './useUserMenu';",
      'src/shared/widgets/user-menu/useUserMenu.ts': "import '../../../features/home/home.logic';",
      'src/shared/ui/action-button/ActionButton.ui.tsx':
        "import { format } from 'date-fns'; export function ActionButtonUI() { void format; return null; }",
      'src/shared/ui/action-button/actionButton.store.ts': 'export const store = {};',
      'src/shared/capabilities/auth/auth.api.ts': 'export const authApi = {};',
      'src/shared/capabilities/auth/auth.types.ts':
        "export type AuthSession = import('../../../features/home/home.types').HomeSecret;",
      'src/shared/capabilities/empty/empty.types.ts': 'export interface EmptyContract {}',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
    expect(result.stderr).toContain('SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY');
    expect(result.stderr).toContain('SRIJIKA-ARCH-SHARED-PRIVATE-IMPORT');
    expect(result.stderr).not.toContain('SRIJIKA-ARCH-SHARED-MISSING-RUNTIME-GATEWAY');
  });

  it('keeps promotion, split, Shared-cycle, freehand, and direct-UI rules in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-intelligence-parity-'));
    temporaryDirectories.push(project);
    const contractMembers = Array.from({ length: 17 }, (_, index) => `  value${index}: string;`);
    const sources: Readonly<Record<string, string>> = {
      'src/features/dashboard/Dashboard.ui.tsx': 'export function DashboardUI() { return null; }',
      'src/features/dashboard/Dashboard.connector.tsx': "import '../home/home.store';",
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }',
      'src/features/home/Home.connector.tsx': "import './slots/navigation/Navigation.ui';",
      'src/features/home/home.store.ts': 'export const homeStore = {};',
      'src/features/home/slots/navigation/Navigation.ui.tsx':
        'export function NavigationUI() { return null; }',
      'src/features/home/slots/navigation/Navigation.connector.tsx': 'export {};',
      'src/features/contract-limit/ContractLimit.ui.tsx': [
        'export interface ContractLimitUIProps {',
        ...contractMembers,
        '}',
        'export function ContractLimitUI(_props: ContractLimitUIProps) { return null; }',
      ].join('\n'),
      'src/features/contract-limit/ContractLimit.connector.tsx': 'export {};',
      'src/features/Bad_Name/BadName.ui.tsx': 'export function BadNameUI() { return null; }',
      'src/features/Bad_Name/BadName.connector.tsx': 'export {};',
      'src/shared/freehand.ts': 'export {};',
      'src/shared/ui/StatusPill/StatusPill.ui.tsx':
        'export function StatusPillUI() { return null; }',
      'src/shared/capabilities/alpha/useAlpha.ts':
        "import { useBeta } from '../beta/useBeta'; export function useAlpha() { return useBeta; }",
      'src/shared/capabilities/beta/useBeta.ts':
        "import { useAlpha } from '../alpha/useAlpha'; export function useBeta() { return useAlpha; }",
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
    expect(result.stderr).toContain('SRIJIKA-ARCH-RECOMMEND-PROMOTE-OWNER');
    expect(result.stderr).toContain('SRIJIKA-ARCH-RECOMMEND-SPLIT-OWNER');
    expect(result.stderr).toContain('SRIJIKA-ARCH-SHARED-REVERSE-DEPENDENCY');
    expect(result.stderr).toContain('SRIJIKA-ARCH-STRICT-OWNER-SHAPE');
    expect(result.stderr).toContain('SRIJIKA-ARCH-DIRECT-CHILD-UI');
    expect(result.stderr).toContain('Feature → bad-name');
    expect(result.stderr).toContain('Shared owner → status-pill');
  });

  it('keeps strict UI runtime and passive Types diagnostics in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-ui-types-parity-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': [
        "import * as React from 'react';",
        'function useLocalValue() { return 1; }',
        'export function HomeUI() {',
        '  const local = useLocalValue();',
        "  const [state] = React.useState('ready');",
        "  void fetch('/api/home');",
        '  const request = new XMLHttpRequest();',
        "  const socket = new window.WebSocket('wss://example.test');",
        "  localStorage.setItem('home', state);",
        "  void window.sessionStorage.getItem('home');",
        '  const cookie = document.cookie;',
        '  setTimeout(() => undefined, 0);',
        '  window.setInterval(() => undefined, 1000);',
        '  requestAnimationFrame(() => undefined);',
        '  const observer = new MutationObserver(() => undefined);',
        '  const image = new Image();',
        '  return <main>{local}{cookie}{String(request)}{String(socket)}{String(observer)}{String(image)}</main>;',
        '}',
      ].join('\n'),
      'src/features/home/Home.connector.tsx':
        "import { HomeContract } from './home.types'; void HomeContract;",
      'src/features/home/home.types.ts': [
        "import { ReactNode } from 'react';",
        "export const DEFAULT_HOME = 'home';",
        'export type DefaultHome = typeof DEFAULT_HOME;',
        'export interface HomeContract { [Symbol.iterator](): Iterator<ReactNode>; }',
      ].join('\n'),
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
    expect(result.stderr).toContain('React.useState hook');
    expect(result.stderr).toContain('fetch browser/runtime API');
    expect(result.stderr).toContain('MutationObserver browser/runtime API');
    expect(result.stderr).toContain('SRIJIKA-ARCH-PASSIVE-TYPES');
    expect(result.stderr).toContain('imported or exported as a runtime value');
  });

  it('keeps external UI runtime and Logic framework-concern failures in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-runtime-concern-parity-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/features/home/Home.ui.tsx': [
        "import axios from 'axios';",
        "export function HomeUI() { void axios.get('/home'); return <main />; }",
      ].join('\n'),
      'src/features/home/Home.connector.tsx': "import './home.logic';",
      'src/features/home/home.logic.ts': [
        "import { useQuery } from '@tanstack/react-query';",
        "import axios from 'axios';",
        "import 'node:http';",
        "import 'node:https';",
        "import 'http';",
        "import 'https';",
        "import 'undici';",
        "import 'cross-fetch';",
        "import 'node-fetch';",
        "import 'ofetch';",
        "export function homeLogic() { void fetch('/api/home'); void axios.get('/api/home'); return useQuery({ queryKey: ['home'], queryFn: async () => 'home' }); }",
      ].join('\n'),
      'src/features/dashboard/Dashboard.ui.tsx': [
        "import { create } from 'zustand';",
        'const store = create(() => ({}));',
        'export function DashboardUI() { return <main>{String(store)}</main>; }',
      ].join('\n'),
      'src/features/dashboard/Dashboard.connector.tsx': 'export function DashboardConnector() {}',
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserCodes = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics.map(({ code }) => code);
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });
    const portableCodes = [...result.stderr.matchAll(/SRIJIKA\d{4}/g)].map(([code]) => code);

    expect(browserCodes.filter((code) => code === 'SRIJIKA4101')).toHaveLength(2);
    expect(browserCodes.filter((code) => code === 'SRIJIKA4118')).toHaveLength(12);
    expect(result.status).toBe(1);
    expect(portableCodes.sort()).toEqual([...browserCodes].sort());
    expect(result.stderr).toContain('axios');
    expect(result.stderr).toContain('zustand');
    expect(result.stderr).toContain('@tanstack/react-query');
    expect(result.stderr).toContain('useQuery');
    expect(result.stderr).toContain('SRIJIKA-ARCH-UI-RUNTIME-IMPORT');
    expect(result.stderr).toContain('SRIJIKA-ARCH-LOGIC-RUNTIME-CONCERN');
  });

  it('keeps public Shared UI composition and external presentational JSX valid in portable parity', async () => {
    const project = await mkdtemp(path.join(tmpdir(), 'srijika-shared-ui-compose-'));
    temporaryDirectories.push(project);
    const sources: Readonly<Record<string, string>> = {
      'src/shared/ui/icon/Icon.ui.tsx':
        'export function IconUI() { return <span aria-hidden="true" />; }',
      'src/shared/ui/action-button/ActionButton.ui.tsx': [
        "import { Slot } from '@radix-ui/react-slot';",
        "import { IconUI } from '../icon/Icon.ui';",
        "import './action-button.css';",
        "import './action-button.woff2?url';",
        "import './activate.wav';",
        "import './demo.webm#preview';",
        "import './action-button.ico';",
        'export function ActionButtonUI(props: { label: string; onActivate(): void }) {',
        '  return <Slot><button onClick={props.onActivate}><IconUI />{props.label}</button></Slot>;',
        '}',
      ].join('\n'),
    };
    for (const [relativePath, source] of Object.entries(sources)) {
      const destination = path.join(project, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source);
    }
    const script = path.join(project, 'srijika-validate.mjs');
    await writeFile(script, await portableValidatorSource(project));
    await mkdir(path.join(project, 'node_modules'), { recursive: true });
    await symlink(
      path.resolve('node_modules/typescript'),
      path.join(project, 'node_modules/typescript'),
      'dir',
    );

    const browserDiagnostics = validateSrijikaArchitecture(
      Object.entries(sources).map(([relativePath, source]) => ({
        fileName: path.join(project, relativePath),
        source,
      })),
      { projectRoot: project },
    ).diagnostics;
    const result = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8' });

    expect(browserDiagnostics).toEqual([]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
