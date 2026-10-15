import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { checkNativeProject } from './project.js';

export function planNativePreview(root: string, options: { tunnel?: boolean; port?: number } = {}) {
  const port = options.port ?? 8081;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535)
    throw new Error('Native preview ports must be between 1024 and 65535.');
  return Object.freeze({
    cwd: root,
    executable: process.execPath,
    args: Object.freeze([
      join(root, 'node_modules', 'expo', 'bin', 'cli'),
      'start',
      '--go',
      options.tunnel ? '--tunnel' : '--lan',
      '--port',
      String(port),
    ]),
    target: 'expo-go' as const,
    connection: options.tunnel ? ('tunnel' as const) : ('lan' as const),
  });
}

export async function startNativePreview(
  directory: string,
  options: { tunnel?: boolean; port?: number } = {},
): Promise<number> {
  const report = await checkNativeProject(directory);
  if (!report.valid)
    throw new Error(
      `Native preview blocked by ${report.diagnostics.length} source diagnostics. Run srijika-native check first.`,
    );
  const plan = planNativePreview(report.root, options);
  try {
    if (!(await stat(plan.args[0]!)).isFile()) throw new Error('Missing Expo CLI.');
  } catch {
    throw new Error('Install this Native project first with pnpm install --frozen-lockfile.');
  }
  console.log(
    `Starting Expo Go over ${plan.connection}. Scan the terminal QR code on your phone. Ctrl+C stops Metro.`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(plan.executable, [...plan.args], {
      cwd: plan.cwd,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, EXPO_NO_WEB_SETUP: '1' },
    });
    const stop = (): void => {
      child.kill('SIGINT');
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    const cleanup = (): void => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolve(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1));
    });
  });
}
