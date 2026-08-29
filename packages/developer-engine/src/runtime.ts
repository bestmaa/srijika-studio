import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';

import type {
  SrijikaCommandPlan,
  SrijikaJavaScriptRuntime,
  SrijikaPackageManager,
  SrijikaProjectCommandKind,
  SrijikaProjectMetadata,
  SrijikaRuntimePreference,
  SrijikaToolAvailability,
} from './types.js';

const WINDOWS = process.platform === 'win32';

function executableFor(manager: SrijikaPackageManager): string {
  return WINDOWS ? `${manager}.cmd` : manager;
}

export function inspectSrijikaTool(name: SrijikaToolAvailability['name']): SrijikaToolAvailability {
  const executable = WINDOWS ? `${name}.cmd` : name;
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3_000,
  });
  const version = result.status === 0 ? (result.stdout.trim().split(/\s+/, 1)[0] ?? null) : null;
  return Object.freeze({ name, available: result.status === 0, version });
}

export function selectSrijikaRuntime(
  project: SrijikaProjectMetadata,
  preference: SrijikaRuntimePreference = 'auto',
  environment: NodeJS.ProcessEnv = process.env,
): { runtime: SrijikaJavaScriptRuntime; reason: string } {
  const requested =
    preference === 'auto' &&
    (environment['SRIJIKA_RUNTIME'] === 'node' || environment['SRIJIKA_RUNTIME'] === 'bun')
      ? environment['SRIJIKA_RUNTIME']
      : preference;
  if (requested === 'bun') {
    if (!project.viteProject) {
      return { runtime: 'node', reason: 'Bun turbo mode is limited to detected Vite projects.' };
    }
    if (!inspectSrijikaTool('bun').available) {
      return {
        runtime: 'node',
        reason: 'Bun was requested but is not installed; Node fallback selected.',
      };
    }
    return {
      runtime: 'bun',
      reason: 'Bun turbo mode was explicitly selected for this Vite project.',
    };
  }
  return {
    runtime: 'node',
    reason:
      requested === 'node'
        ? 'Node compatibility mode was explicitly selected.'
        : 'Node compatibility mode is the safe default; use --runtime bun for optional turbo mode.',
  };
}

function managerRunArgs(manager: SrijikaPackageManager, script: string): string[] {
  if (manager === 'npm') return ['run', script];
  return ['run', script];
}

function viteArgs(host: string, port: number): readonly string[] {
  return ['--host', host, '--port', String(port), '--strictPort'];
}

export function planSrijikaProjectCommand(
  project: SrijikaProjectMetadata,
  kind: SrijikaProjectCommandKind,
  options: {
    runtime?: SrijikaRuntimePreference;
    host?: string;
    port?: number;
    /** Migration targets may install without creating package-manager state. */
    allowMissingLockfile?: boolean;
  } = {},
): SrijikaCommandPlan {
  const selection = selectSrijikaRuntime(project, options.runtime ?? 'auto');
  const manager = project.packageManager;
  if (kind === 'install') {
    const compatibleLockfiles: Readonly<Record<SrijikaPackageManager, readonly string[]>> = {
      pnpm: ['pnpm-lock.yaml'],
      npm: ['package-lock.json'],
      yarn: ['yarn.lock'],
      bun: ['bun.lock', 'bun.lockb'],
    };
    if (!project.lockfile) {
      if (options.allowMissingLockfile && manager === 'pnpm') {
        return Object.freeze({
          kind,
          cwd: project.root,
          executable: executableFor(manager),
          args: Object.freeze(['install', '--lockfile=false']),
          runtime: selection.runtime,
          packageManager: manager,
          description: `Install ${project.projectName} dependencies without mutating migration state.`,
        });
      }
      throw new Error('A supported lockfile is required before Srijika can install dependencies.');
    }
    if (!compatibleLockfiles[manager].includes(project.lockfile)) {
      throw new Error(
        `${project.lockfile} does not match the declared ${manager} package manager; resolve the toolchain mismatch first.`,
      );
    }
    const frozenArgs =
      manager === 'pnpm'
        ? ['install', '--frozen-lockfile']
        : manager === 'npm'
          ? ['ci']
          : manager === 'yarn'
            ? ['install', '--immutable']
            : ['install', '--frozen-lockfile'];
    return Object.freeze({
      kind,
      cwd: project.root,
      executable: executableFor(manager),
      args: Object.freeze(frozenArgs),
      runtime: selection.runtime,
      packageManager: manager,
      description: `Install the ${project.projectName} lockfile exactly with ${manager}.`,
      ...(selection.runtime === 'node' && options.runtime === 'bun'
        ? { fallbackReason: selection.reason }
        : {}),
    });
  }

  const script = kind === 'validate' ? 'validate:srijika' : kind;
  if (!project.scripts[script]) {
    throw new Error(`package.json does not define the ${script} script.`);
  }
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? (kind === 'preview' ? 4173 : 5173);
  if (kind === 'dev' && selection.runtime === 'bun' && project.viteProject) {
    return Object.freeze({
      kind,
      cwd: project.root,
      executable: executableFor('bun'),
      args: Object.freeze(['run', '--bun', 'vite', ...viteArgs(host, port)]),
      runtime: 'bun',
      packageManager: manager,
      description: `Start Vite HMR for ${project.projectName} through Bun turbo mode.`,
    });
  }

  const args = managerRunArgs(manager, script);
  if (kind === 'dev' || kind === 'preview') {
    if (manager === 'npm') args.push('--');
    args.push(...viteArgs(host, port));
  }
  return Object.freeze({
    kind,
    cwd: project.root,
    executable: executableFor(manager),
    args: Object.freeze(args),
    runtime: 'node',
    packageManager: manager,
    description: `${kind === 'dev' ? 'Start Vite HMR' : `Run ${script}`} for ${project.projectName}.`,
    ...(selection.runtime === 'node' && options.runtime === 'bun'
      ? { fallbackReason: selection.reason }
      : {}),
  });
}

export function formatSrijikaCommand(plan: SrijikaCommandPlan): string {
  const quote = (value: string): string =>
    /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
  return [plan.executable, ...plan.args].map(quote).join(' ');
}

export function runSrijikaCommand(
  plan: SrijikaCommandPlan,
  options: Pick<SpawnOptions, 'stdio' | 'env'> = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(plan.executable, [...plan.args], {
      cwd: plan.cwd,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
      windowsHide: true,
    });
    const forwardSignal = (signal: NodeJS.Signals): void => {
      if (!child.killed) child.kill(signal);
    };
    const onSigint = (): void => forwardSignal('SIGINT');
    const onSigterm = (): void => forwardSignal('SIGTERM');
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    child.once('error', (error) => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      reject(error);
    });
    child.once('exit', (code) => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      resolve(code ?? 1);
    });
  });
}
