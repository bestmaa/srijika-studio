import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  captureReactMigrationBrowserParity,
  loadReactMigrationBrowserParity,
  startReactMigration,
} from '../src/index.js';

const roots: string[] = [];
const servers: Server[] = [];

async function sourceFixture(): Promise<string> {
  const source = await mkdtemp(join(tmpdir(), 'srijika-parity-source-'));
  roots.push(source);
  await mkdir(join(source, 'src'), { recursive: true });
  await writeFile(
    join(source, 'package.json'),
    `${JSON.stringify({
      name: 'parity-source',
      private: true,
      packageManager: 'pnpm@11.18.0',
      scripts: { build: 'vite build', test: 'vitest run' },
      dependencies: { react: '19.2.8', 'react-dom': '19.2.8' },
      devDependencies: { vite: '8.2.0' },
    })}\n`,
  );
  await writeFile(
    join(source, 'index.html'),
    '<!doctype html><html><head><title>Srijika parity</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
  );
  await writeFile(
    join(source, 'src/routes.tsx'),
    "export const routes = [{ path: '/' }, { path: '/dashboard' }];\n",
  );
  await writeFile(
    join(source, 'src/App.tsx'),
    "import './styles.css';\nexport function App() { const dashboard = window.location.pathname.includes('dashboard'); return <div id=\"app\"><header>Wovvmap</header><main><h1>{dashboard ? 'Dashboard' : 'Home'}</h1><button>Open</button></main></div>; }\n",
  );
  await writeFile(
    join(source, 'src/main.tsx'),
    "import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './App'; createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);\n",
  );
  await writeFile(
    join(source, 'src/styles.css'),
    'body { font: 16px sans-serif; margin: 24px; } main { padding: 8px; }\n',
  );
  return source;
}

async function aliasServer(onRequest: () => void): Promise<string> {
  const server = createServer((_request, response) => {
    onRequest();
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<h1>caller alias</h1>');
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address.');
  return `http://127.0.0.1:${address.port}/`;
}

async function makeTargetMatchSource(source: string, target: string, suffix = ''): Promise<void> {
  for (const relativePath of ['index.html', 'src/main.tsx', 'src/styles.css']) {
    await writeFile(join(target, relativePath), await readFile(join(source, relativePath)));
  }
  const app = await readFile(join(source, 'src/App.tsx'), 'utf8');
  await writeFile(
    join(target, 'src/App.tsx'),
    suffix ? app.replace("'Dashboard' : 'Home'", `'Dashboard${suffix}' : 'Home${suffix}'`) : app,
  );
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('engine-owned React browser parity', () => {
  it('launches root-bound servers, ignores caller URL aliases, and revalidates evidence', async () => {
    const source = await sourceFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-parity-target-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    await startReactMigration({ source, target });
    await makeTargetMatchSource(source, target);
    const sourcePackageBefore = await readFile(join(source, 'package.json'));
    let aliasRequests = 0;
    const callerAlias = await aliasServer(() => {
      aliasRequests += 1;
    });

    const manifest = await captureReactMigrationBrowserParity({
      target,
      includeInstall: true,
      sourceBaseUrl: callerAlias,
      targetBaseUrl: callerAlias,
    } as unknown as Parameters<typeof captureReactMigrationBrowserParity>[0]);

    expect(manifest.routes).toEqual(['/', '/dashboard']);
    expect(manifest.cases).toHaveLength(6);
    expect(manifest.passed).toBe(true);
    expect(aliasRequests).toBe(0);
    expect(manifest.servers.source.port).not.toBe(manifest.servers.target.port);
    expect(manifest.servers.source.cwdKind).toBe('temporary-source-copy');
    expect(manifest.servers.target.cwdKind).toBe('target-root');
    expect(await readFile(join(source, 'package.json'))).toEqual(sourcePackageBefore);
    expect(manifest.cases.every((entry) => entry.domEqual && entry.passed)).toBe(true);
    expect(manifest.manifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(loadReactMigrationBrowserParity(target)).resolves.toMatchObject({
      manifestSha256: manifest.manifestSha256,
      passed: true,
    });

    const screenshot = manifest.cases[0]!.source.screenshotPath;
    await writeFile(join(target, screenshot), Buffer.from('tampered'));
    await expect(loadReactMigrationBrowserParity(target)).rejects.toThrow(
      /integrity verification/u,
    );
  }, 120_000);

  it('returns failed engine evidence for semantic and visual mismatch', async () => {
    const source = await sourceFixture();
    const parent = await mkdtemp(join(tmpdir(), 'srijika-parity-mismatch-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    await startReactMigration({ source, target });
    await makeTargetMatchSource(source, target, ' changed');

    const manifest = await captureReactMigrationBrowserParity({ target, includeInstall: true });

    expect(manifest.passed).toBe(false);
    expect(manifest.cases.every((entry) => !entry.passed)).toBe(true);
    expect(manifest.cases[0]?.errors.join(' ')).toMatch(/semantic DOM|Pixel mismatch/u);
    expect(await readFile(join(source, 'src/routes.tsx'), 'utf8')).toContain('/dashboard');
  }, 120_000);

  it('rejects unsafe local dependencies before launching a source runtime', async () => {
    const source = await sourceFixture();
    const packagePath = join(source, 'package.json');
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
    packageJson['dependencies'] = { react: 'file:../outside-react' };
    await writeFile(packagePath, `${JSON.stringify(packageJson)}\n`);
    const parent = await mkdtemp(join(tmpdir(), 'srijika-parity-security-'));
    roots.push(parent);
    const target = join(parent, 'converted');
    await startReactMigration({ source, target });
    await expect(captureReactMigrationBrowserParity({ target })).rejects.toThrow(
      /unsafe local or workspace/u,
    );
  });
});
