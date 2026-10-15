import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { env, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { createNativeProjectFileMap } from '../../../packages/native/dist/index.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const nativeRoot = join(packageRoot, '../../packages/native');
/** @param {unknown} value */
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const wsl = Boolean(env.WSL_DISTRO_NAME);
let temporaryParent = tmpdir();
if (wsl) {
  const windowsTemp = execFileSync(
    '/mnt/c/Windows/System32/cmd.exe',
    ['/d', '/s', '/c', 'echo %TEMP%'],
    { cwd: '/mnt/c/Windows', encoding: 'utf8', windowsHide: true },
  ).trim();
  const match = /^([A-Za-z]):\\(.*)$/u.exec(windowsTemp);
  if (!match)
    throw new Error('A local Windows temporary directory is required for this host test.');
  temporaryParent = `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}
const root = await mkdtemp(join(temporaryParent, 'srijika-native-host-'));
const fixtures = join(root, 'fixtures');

/** @param {string} target @param {Record<string, string>} files */
async function writeTree(target, files) {
  for (const [name, source] of Object.entries(files)) {
    const file = join(target, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source, { flag: 'wx' });
  }
}
await writeTree(
  join(fixtures, 'native'),
  createNativeProjectFileMap(
    { projectName: 'host-native', displayName: 'Native Host Check' },
    await readFile(join(nativeRoot, 'dist/check.mjs'), 'utf8'),
    await readFile(join(nativeRoot, 'templates/pnpm-lock.yaml'), 'utf8'),
  ),
);
const web = {
  'srijika.config.json': json({
    sourceOfTruth: 'tsx',
    entry: 'src/features/home/Home.ui.tsx',
    architecture: { profile: 'feature-slot-part-v1' },
  }),
  'package.json': json({
    name: 'host-web',
    private: true,
    packageManager: 'pnpm@11.18.0',
    srijika: { sourceOfTruth: 'tsx' },
    scripts: { dev: 'vite', build: 'vite build' },
    dependencies: { react: '19.2.8' },
    devDependencies: { vite: '8.2.0' },
  }),
  'tsconfig.json': json({ compilerOptions: { jsx: 'react-jsx', strict: true }, include: ['src'] }),
  'src/features/home/Home.ui.tsx':
    'export function HomeUI() { return <main><p>Web project</p></main>; }\n',
  'src/features/home/Home.connector.tsx':
    "import { HomeUI } from './Home.ui'; export function HomeConnector() { return <HomeUI />; }\n",
};
await writeTree(join(fixtures, 'web'), web);
await writeTree(join(fixtures, 'next'), {
  ...web,
  'package.json': json({
    ...JSON.parse(web['package.json']),
    name: 'host-next',
    scripts: { dev: 'next dev', build: 'next build' },
    dependencies: { next: '16.3.3', react: '19.2.8' },
  }),
  'app/page.tsx':
    "import { useState } from 'react'; export default function Page() { useState(false); return <main>Next</main>; }\n",
});
const workspace = join(fixtures, 'fixtures.code-workspace');
await writeFile(
  workspace,
  json({
    folders: ['native', 'web', 'next'].map((name) => ({ name, path: `./${name}` })),
    settings: { 'workbench.startupEditor': 'none', 'extensions.ignoreRecommendations': true },
  }),
);
await build({
  entryPoints: [join(packageRoot, 'test/native-host-smoke.ts')],
  outfile: join(fixtures, 'smoke.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
});
const extension = join(root, 'extension');
await mkdir(extension);
for (const name of ['dist', 'media', 'README.md', 'package.json'])
  await cp(join(packageRoot, name), join(extension, name), { recursive: true });
/** @param {string} path */
const hostPath = (path) => {
  if (!wsl) return path.replaceAll('\\', '/');
  const match = /^\/mnt\/([a-z])\/(.*)$/u.exec(path);
  if (!match) throw new Error('Host test files must be on a local Windows drive.');
  return `${match[1].toUpperCase()}:/${match[2]}`;
};
const argumentsList = [
  '--new-window',
  '--skip-welcome',
  '--skip-release-notes',
  `--user-data-dir=${hostPath(join(root, 'profile'))}`,
  `--extensions-dir=${hostPath(join(root, 'extensions'))}`,
  `--extensionDevelopmentPath=${hostPath(extension)}`,
  `--extensionTestsPath=${hostPath(join(fixtures, 'smoke.cjs'))}`,
  hostPath(workspace),
];
stdout.write(
  json({
    root: hostPath(root),
    report: hostPath(join(fixtures, 'host-report.json')),
    launch: `code ${argumentsList.map((value) => JSON.stringify(value)).join(' ')}`,
    note: wsl ? 'Run the launch command in Windows PowerShell.' : 'Run the launch command locally.',
  }),
);
