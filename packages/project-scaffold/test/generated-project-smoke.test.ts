import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { buildSrijikaTestContract } from '@srijika/architecture-rules';

import {
  applySrijikaNextAppRouterPlan,
  applySrijikaNextTestAdapterPlan,
  applySrijikaViteTestAdapterPlan,
  buildSrijikaNextAppRouterPlan,
  buildSrijikaNextTestAdapterPlan,
  buildSrijikaViteTestAdapterPlan,
  writeSrijikaProject,
} from '../src/index.js';

const execFileAsync = promisify(execFile);
const smoke = process.env['SRIJIKA_RUN_GENERATED_PROJECT_SMOKE'] === '1' ? it : it.skip;

async function runPnpm(cwd: string, ...args: readonly string[]): Promise<string> {
  const pnpmCli = process.env['npm_execpath'];
  const executable = pnpmCli
    ? process.execPath
    : process.platform === 'win32'
      ? 'pnpm.cmd'
      : 'pnpm';
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : [...args];
  try {
    const { stdout, stderr } = await execFileAsync(executable, commandArgs, {
      cwd,
      env: { ...process.env, CI: 'true' },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120_000,
    });
    return `${stdout}${stderr}`;
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`${failure.message}\n${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim(), {
      cause: error,
    });
  }
}

for (const reactQuery of [false, true]) {
  smoke(
    `installs, validates, typechecks, and builds a fresh frozen-lockfile project (${reactQuery ? 'React Query' : 'minimal'})`,
    async () => {
      const parent = await mkdtemp(join(tmpdir(), 'srijika-generated-smoke-'));
      const target = join(parent, 'app');
      try {
        await writeSrijikaProject(target, {
          projectName: reactQuery ? 'srijika-query-smoke-app' : 'srijika-minimal-smoke-app',
          displayName: reactQuery ? 'Srijika Query Smoke App' : 'Srijika Minimal Smoke App',
          reactQuery,
        });

        await runPnpm(target, 'install', '--frozen-lockfile');
        const validation = await runPnpm(target, 'run', 'validate:srijika');
        const typecheck = await runPnpm(target, 'run', 'typecheck');
        const build = await runPnpm(target, 'run', 'build');

        expect(validation).toContain('Srijika architecture check passed');
        expect(typecheck).toContain('validate:srijika');
        expect(build).toContain('built in');
      } finally {
        await rm(parent, { force: true, recursive: true });
      }
    },
    180_000,
  );
}

smoke(
  'generates and executes isolated Vite owner tests with Vitest and Playwright',
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-generated-owner-tests-'));
    const target = join(parent, 'app');
    try {
      await writeSrijikaProject(target, {
        projectName: 'srijika-owner-test-app',
        displayName: 'Srijika Owner Test App',
      });
      const contract = buildSrijikaTestContract([
        {
          fileName: 'src/features/home/Home.ui.tsx',
          source: await readFile(join(target, 'src/features/home/Home.ui.tsx'), 'utf8'),
        },
        {
          fileName: 'src/features/home/Home.connector.tsx',
          source: await readFile(join(target, 'src/features/home/Home.connector.tsx'), 'utf8'),
        },
        {
          fileName: 'src/features/home/home.store.ts',
          source: await readFile(join(target, 'src/features/home/home.store.ts'), 'utf8'),
        },
        {
          fileName: 'src/features/home/useHome.ts',
          source: await readFile(join(target, 'src/features/home/useHome.ts'), 'utf8'),
        },
      ]);
      const plan = buildSrijikaViteTestAdapterPlan(contract);
      await applySrijikaViteTestAdapterPlan(target, plan);

      const packagePath = join(target, 'package.json');
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
        scripts: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      Object.assign(packageJson.scripts, plan.scripts);
      Object.assign(
        packageJson.devDependencies,
        Object.fromEntries(plan.devDependencies.map(({ name, version }) => [name, version])),
      );
      await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

      await runPnpm(target, 'install', '--no-frozen-lockfile');
      const component = await runPnpm(target, 'run', 'test:srijika:component');
      await runPnpm(
        target,
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/srijika/playwright.config.ts',
        '--update-snapshots',
      );
      const browser = await runPnpm(target, 'run', 'test:srijika:browser');

      expect(component).toContain('passed');
      expect(browser).toContain('3 passed');
      expect(await readFile(join(target, plan.evidence.vitestJson), 'utf8')).toContain(
        'numPassedTests',
      );
      expect(await readFile(join(target, plan.evidence.playwrightJson), 'utf8')).toContain(
        'expectedStatus',
      );
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  },
  180_000,
);

smoke(
  'executes an async owner in the real Next App Router with Playwright',
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-generated-next-owner-tests-'));
    const target = join(parent, 'app');
    try {
      await mkdir(join(target, 'src/features/home'), { recursive: true });
      const ownerSource = `export async function HomeUI() {
  await Promise.resolve();
  return <button type="button">Async Next owner</button>;
}
`;
      const connectorSource = `import { HomeUI } from './Home.ui';
export async function HomeConnector() { return <HomeUI />; }
`;
      await writeFile(join(target, 'src/features/home/Home.ui.tsx'), ownerSource, 'utf8');
      await writeFile(
        join(target, 'src/features/home/Home.connector.tsx'),
        connectorSource,
        'utf8',
      );
      const contract = buildSrijikaTestContract([
        { fileName: 'src/features/home/Home.ui.tsx', source: ownerSource },
        { fileName: 'src/features/home/Home.connector.tsx', source: connectorSource },
      ]);
      const plan = buildSrijikaNextTestAdapterPlan(contract);
      await applySrijikaNextTestAdapterPlan(target, plan);
      const routePlan = buildSrijikaNextAppRouterPlan(contract, {
        routes: [{ pathname: '/', ownerId: 'feature:home' }],
        sources: {
          'src/features/home/Home.ui.tsx': ownerSource,
          'src/features/home/Home.connector.tsx': connectorSource,
        },
      });
      await applySrijikaNextAppRouterPlan(target, routePlan);

      await writeFile(
        join(target, 'package.json'),
        `${JSON.stringify(
          {
            name: 'srijika-next-owner-test-app',
            private: true,
            scripts: plan.scripts,
            dependencies: { next: '16.3.2', react: '19.2.8', 'react-dom': '19.2.8' },
            devDependencies: {
              ...Object.fromEntries(
                plan.devDependencies.map(({ name, version }) => [name, version]),
              ),
              '@types/node': '26.1.2',
              '@types/react': '19.2.14',
              '@types/react-dom': '19.2.3',
              typescript: '6.0.3',
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      await runPnpm(target, 'install', '--no-frozen-lockfile');
      const build = await runPnpm(target, 'exec', 'next', 'build');
      await runPnpm(
        target,
        'exec',
        'playwright',
        'test',
        '--config',
        'tests/srijika-next/playwright.config.ts',
        '--update-snapshots',
      );
      const browser = await runPnpm(target, 'run', 'test:srijika:next:browser');
      expect(build).toContain('Compiled successfully');
      expect(browser).toContain('3 passed');
      expect(await readFile(join(target, plan.evidence.playwrightJson), 'utf8')).toContain(
        'expectedStatus',
      );
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  },
  240_000,
);

smoke(
  'honors custom roots, entry, and UI/Connector suffixes in generated runtime modules',
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-generated-custom-preview-'));
    const target = join(parent, 'app');
    try {
      await writeSrijikaProject(target, {
        projectName: 'srijika-custom-preview-app',
        displayName: 'Srijika Custom Preview App',
      });
      await mkdir(join(target, 'application/screens'), { recursive: true });
      await mkdir(join(target, 'application/modules'), { recursive: true });
      await mkdir(join(target, 'application/common'), { recursive: true });
      await writeFile(
        join(target, 'application/screens/Landing.view.tsx'),
        `export interface LandingUIProps { evidence: string; }
export function LandingUI(props: LandingUIProps) {
  return <main data-runtime-evidence={props.evidence}>Custom runtime</main>;
}
`,
        'utf8',
      );
      await writeFile(
        join(target, 'application/screens/Landing.gateway.tsx'),
        `import { LandingUI } from './Landing.view';
export const CUSTOM_RUNTIME_GATEWAY_EVIDENCE = 'custom-config-gateway';
export function LandingConnector() {
  return <LandingUI evidence={CUSTOM_RUNTIME_GATEWAY_EVIDENCE} />;
}
`,
        'utf8',
      );
      await writeFile(
        join(target, 'src/App.tsx'),
        `import { LandingConnector } from '../application/screens/Landing.gateway';
export function App() { return <LandingConnector />; }
`,
        'utf8',
      );
      const configPath = join(target, 'srijika.config.json');
      const config = JSON.parse(await readFile(configPath, 'utf8')) as {
        entry: string;
        architecture: Record<string, unknown>;
        ui: { include: string[]; connectorSuffix: string; sourceExtension: string };
      };
      config.entry = 'application/screens/Landing.view.tsx';
      Object.assign(config.architecture, {
        featuresRoot: 'application/modules',
        sharedRoot: 'application/common',
        uiSuffix: '.view.tsx',
        connectorSuffix: '.gateway.tsx',
      });
      config.ui.include = ['application/**/*.view.tsx'];
      config.ui.connectorSuffix = '.gateway.tsx';
      config.ui.sourceExtension = '.view.tsx';
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      const runtimeEvidence = join(target, 'runtime-evidence.mjs');
      await writeFile(
        runtimeEvidence,
        `import { createServer } from 'vite';
const server = await createServer({ appType: 'custom', server: { middlewareMode: true } });
try {
  const ui = await server.transformRequest('/application/screens/Landing.view.tsx');
  const connector = await server.transformRequest('/application/screens/Landing.gateway.tsx');
  if (
    !ui?.code.includes('data-srijika-source') ||
    !ui.code.includes('application/screens/Landing.view.tsx:')
  ) {
    throw new Error('Custom configured entry was not instrumented.');
  }
  if (!connector?.code.includes('custom-config-gateway')) {
    throw new Error('Custom Connector runtime module was not transformed.');
  }
  console.log('custom-config runtime modules ready');
} finally {
  await Promise.race([
    server.close(),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
}
process.exit(0);
`,
        'utf8',
      );

      await runPnpm(target, 'install', '--frozen-lockfile');
      const validation = await runPnpm(target, 'run', 'validate:srijika');
      const typecheck = await runPnpm(target, 'run', 'typecheck');
      const build = await runPnpm(target, 'run', 'build');
      const runtime = await execFileAsync(process.execPath, [runtimeEvidence], {
        cwd: target,
        env: { ...process.env, CI: 'true' },
        timeout: 120_000,
      });

      expect(validation).toContain('Srijika architecture check passed');
      expect(typecheck).toContain('validate:srijika');
      expect(build).toContain('built in');
      expect(`${runtime.stdout}${runtime.stderr}`).toContain('custom-config runtime modules ready');
    } finally {
      await rm(parent, { force: true, recursive: true });
    }
  },
  180_000,
);
