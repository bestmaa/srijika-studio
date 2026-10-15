import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../src/cli.js';
import {
  checkNativeProject,
  inspectNativeProject,
  parseNativeProjectConfig,
} from '../src/project.js';
import { planNativePreview, startNativePreview } from '../src/runtime.js';
import { createNativeProjectFileMap, writeNativeProject } from '../src/scaffold.js';

const execute = promisify(execFile);
const temporaryRoots: string[] = [];
async function project() {
  const directory = await mkdtemp(join(tmpdir(), 'srijika-native-'));
  temporaryRoots.push(directory);
  const root = join(directory, 'mobile');
  await writeNativeProject(root, { projectName: 'mobile', displayName: 'Mobile Preview' });
  return root;
}
afterEach(async () => {
  for (const directory of temporaryRoots.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('Native scaffold and ownership checks', () => {
  it('creates a self-contained, pinned Expo Go project with a working standalone validator', async () => {
    const root = await project();
    const report = await checkNativeProject(root);
    expect(report.diagnostics).toEqual([]);
    expect(report.ui).toHaveLength(2);
    expect(
      report.ui.every((entry) => entry.result.document?.version === 'srijika-native-ui-v1'),
    ).toBe(true);
    await symlink(
      resolve('../../node_modules'),
      join(root, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const result = await execute(
      process.execPath,
      [join(root, '.srijika/native/check.mjs'), '--json'],
      { cwd: root },
    );
    const parsed = JSON.parse(result.stdout) as { valid: boolean; checkedFiles: number };
    expect(parsed.valid).toBe(true);
    expect(parsed.checkedFiles).toBe(report.checkedFiles);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).not.toHaveProperty('react-dom');
    expect(manifest.dependencies).not.toHaveProperty('react-native-web');
    expect(manifest.scripts['start']).toContain('--go --lan');
    expect(manifest.scripts['start:tunnel']).toContain('--go --tunnel');
    expect(await readFile(join(root, 'pnpm-lock.yaml'), 'utf8')).toContain('lockfileVersion:');
  });

  it('keeps source checks read-only and rejects behavior in UI', async () => {
    const root = await project();
    const file = join(root, 'src/features/home/Home.ui.tsx');
    const source = await readFile(file, 'utf8');
    await writeFile(
      file,
      source.replace('return (', "const state = fetch('https://example.com'); return ("),
    );
    const report = await checkNativeProject(root);
    expect(report.valid).toBe(false);
    expect(
      report.diagnostics.some((diagnostic) => diagnostic.code.startsWith('SRIJIKA-NATIVE')),
    ).toBe(true);
    expect(await readFile(file, 'utf8')).toContain('const state = fetch');
    await expect(startNativePreview(root)).rejects.toThrow(/source diagnostics/);
  });

  it('reuses strict owner boundaries and additionally keeps Logic independent of Native APIs', async () => {
    const root = await project();
    await writeFile(
      join(root, 'src/features/home/home.logic.ts'),
      "import { Platform } from 'react-native'; export function getPlatform() { return Platform.OS; }",
    );
    const report = await checkNativeProject(root);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SRIJIKA-NATIVE2001' }),
    );
    const connector = join(root, 'src/features/home/Home.connector.tsx');
    await writeFile(
      connector,
      "import { CounterUI } from './slots/counter/Counter.ui'; export function HomeConnector() { return <CounterUI count={0} onIncrement={() => {}} onReset={() => {}} />; }",
    );
    expect(
      (await checkNativeProject(root)).diagnostics.some((diagnostic) =>
        diagnostic.code.startsWith('SRIJIKA4'),
      ),
    ).toBe(true);
  });

  it('refuses populated targets, linked roots and linked source files', async () => {
    const root = await project();
    await expect(writeNativeProject(root)).rejects.toThrow(/empty/);
    const alias = join(temporaryRoots[0]!, 'alias');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(inspectNativeProject(alias)).rejects.toThrow(/real directory/);
    await symlink(join(root, 'App.tsx'), join(root, 'src/linked.tsx'));
    await expect(checkNativeProject(root)).rejects.toThrow(/Symbolic links/);
  });

  it('rejects Native/web config confusion and malformed native profiles', async () => {
    for (const config of [
      { version: 2, profile: 'expo-go-v1', platforms: ['android'] },
      { version: 1, profile: 'expo-go-v1', platforms: ['web'] },
      { version: 1, profile: 'expo-go-v1', platforms: ['android', 'android'] },
      { version: 1, profile: 'expo-go-v1', platforms: ['android'], extra: true },
    ])
      expect(() => parseNativeProjectConfig(JSON.stringify(config))).toThrow();
    const root = await project();
    await writeFile(
      join(root, 'srijika.config.json'),
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        framework: { version: 1, profile: 'next-app-router-v1', components: [] },
      }),
    );
    await expect(inspectNativeProject(root)).rejects.toThrow(/web framework/);
  });

  it('rejects source injection through scaffold options', () => {
    expect(() =>
      createNativeProjectFileMap({ projectName: '../escape' }, 'validator', 'lock'),
    ).toThrow();
    const files = createNativeProjectFileMap(
      { displayName: 'Hello " <Text> & world' },
      'validator',
      'lock',
    );
    expect(files['src/features/home/Home.connector.tsx']).toContain(
      'title={"Hello \\" <Text> & world"}',
    );
  });

  it('rejects dynamic Native runtime imports in Logic and arbitrary TypeScript base configs', async () => {
    const root = await project();
    await writeFile(
      join(root, 'src/features/home/home.logic.ts'),
      "export async function platform() { return import('react-native'); }",
    );
    expect(
      (await checkNativeProject(root)).diagnostics.some(
        (diagnostic) => diagnostic.code === 'SRIJIKA-NATIVE2001',
      ),
    ).toBe(true);
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: '../outside.json' }));
    await expect(inspectNativeProject(root)).rejects.toThrow(/expo\/tsconfig.base/);
  });
});

describe('Native preview commands', () => {
  it('uses only the installed Expo CLI and forces Expo Go with LAN/tunnel options', () => {
    const plan = planNativePreview('/mobile', { tunnel: true, port: 8090 });
    expect(plan.executable).toBe(process.execPath);
    expect(plan.args.slice(1)).toEqual(['start', '--go', '--tunnel', '--port', '8090']);
    expect(planNativePreview('/mobile').args).toContain('--lan');
    expect(plan.args).not.toContain('--android');
    expect(plan.args).not.toContain('--web');
    for (const port of [0, 80, 65536, 8081.5, NaN])
      expect(() => planNativePreview('/mobile', { port })).toThrow();
  });

  it('validates command arguments and reports missing installed dependencies', async () => {
    await expect(runNativeCli(['dev', '--web'])).rejects.toThrow(/Unknown/);
    await expect(runNativeCli(['dev', '--port', '8090;echo'])).rejects.toThrow(/integer/);
    await expect(runNativeCli(['create'])).rejects.toThrow(/directory/);
    const root = await project();
    await expect(startNativePreview(root)).rejects.toThrow(/frozen-lockfile/);
  });
});
