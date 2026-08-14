import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

smoke(
  'installs, validates, typechecks, and builds a fresh frozen-lockfile project',
  async () => {
    const parent = await mkdtemp(join(tmpdir(), 'srijika-generated-smoke-'));
    const target = join(parent, 'app');
    try {
      await writeSrijikaProject(target, {
        projectName: 'srijika-smoke-app',
        displayName: 'Srijika Smoke App',
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
