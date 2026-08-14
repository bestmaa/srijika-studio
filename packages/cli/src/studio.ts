import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const WINDOWS_EXECUTABLE = 'Srijika Studio.exe';

async function firstExisting(candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next explicit candidate.
    }
  }
  return null;
}

export async function resolveSrijikaStudioExecutable(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (environment['SRIJIKA_STUDIO_PATH']) return environment['SRIJIKA_STUDIO_PATH'];
  const candidates =
    process.platform === 'win32'
      ? [
          join(environment['LOCALAPPDATA'] ?? '', 'Programs', 'Srijika Studio', WINDOWS_EXECUTABLE),
          join(environment['ProgramFiles'] ?? '', 'Srijika Studio', WINDOWS_EXECUTABLE),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Srijika Studio.app/Contents/MacOS/srijika-studio']
        : [
            '/usr/local/bin/srijika-studio',
            '/usr/bin/srijika-studio',
            join(environment['HOME'] ?? '', '.local/bin/srijika-studio'),
          ];
  return (
    (await firstExisting(candidates.filter((candidate) => candidate.length > 0))) ??
    'srijika-studio'
  );
}

export async function openSrijikaStudio(projectRoot: string): Promise<void> {
  const executable = await resolveSrijikaStudioExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--project', projectRoot], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
