import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, it } from 'vitest';

import { writeSrijikaProject } from '../src/index.js';

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
