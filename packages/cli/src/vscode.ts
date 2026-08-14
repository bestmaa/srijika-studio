import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';

export const SRIJIKA_VSCODE_EXTENSION_ID = 'srijika.srijika-language-support';

export interface VSCodeLaunch {
  executable: string;
  prefixArguments: readonly string[];
}

async function firstExisting(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through deterministic candidates.
    }
  }
  return null;
}

function pathDirectories(environment: NodeJS.ProcessEnv): readonly string[] {
  return (environment['PATH'] ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function resolveVSCodeLaunch(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<VSCodeLaunch | null> {
  const explicit = environment['SRIJIKA_VSCODE_PATH'];
  const distribution = environment['WSL_DISTRO_NAME'];
  const prefixArguments = distribution ? ['--remote', `wsl+${distribution}`] : [];
  if (explicit) return { executable: explicit, prefixArguments };

  const directories = pathDirectories(environment);
  if (platform === 'linux' && distribution) {
    const windowsGui = await firstExisting(
      directories.flatMap((directory) => [
        join(directory, 'Code.exe'),
        join(dirname(directory), 'Code.exe'),
      ]),
    );
    if (windowsGui) return { executable: windowsGui, prefixArguments };
  }

  const pathCandidates = directories.flatMap((directory) =>
    platform === 'win32'
      ? [join(directory, 'Code.exe'), join(directory, 'code.cmd')]
      : [join(directory, 'code')],
  );
  const platformCandidates =
    platform === 'win32'
      ? [
          join(environment['LOCALAPPDATA'] ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
          join(environment['ProgramFiles'] ?? '', 'Microsoft VS Code', 'Code.exe'),
        ]
      : platform === 'darwin'
        ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
        : ['/usr/local/bin/code', '/usr/bin/code'];
  const executable = await firstExisting(
    [...pathCandidates, ...platformCandidates].filter(Boolean),
  );
  return executable ? { executable, prefixArguments } : null;
}

function runVSCodeAndWait(
  launch: VSCodeLaunch,
  arguments_: readonly string[],
  timeoutMillis = 20_000,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.executable, [...launch.prefixArguments, ...arguments_], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      detached: true,
    });
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.unref();
      resolve(code);
    };
    const timer = setTimeout(() => finish(null), timeoutMillis);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => finish(code ?? 1));
  });
}

function launchVSCode(launch: VSCodeLaunch, arguments_: readonly string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.executable, [...launch.prefixArguments, ...arguments_], {
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      detached: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

export async function installSrijikaVSCodeExtension(
  launch: VSCodeLaunch,
  extension = SRIJIKA_VSCODE_EXTENSION_ID,
): Promise<boolean> {
  return (await runVSCodeAndWait(launch, ['--install-extension', extension, '--force'])) === 0;
}

export async function openProjectInVSCode(
  launch: VSCodeLaunch,
  projectRoot: string,
): Promise<boolean> {
  return launchVSCode(launch, ['--new-window', projectRoot]);
}
