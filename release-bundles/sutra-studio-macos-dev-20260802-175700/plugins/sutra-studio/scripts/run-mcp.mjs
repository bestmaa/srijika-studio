import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverEntryPoint = join(scriptDirectory, '..', 'mcp-server', 'sutra-mcp.mjs');
const distribution = process.env['SUTRA_STUDIO_WSL_DISTRO'] ?? 'Ubuntu';
const windowsUser = process.env['SUTRA_STUDIO_WSL_USER'] ?? win32.basename(homedir());

function toWslPath(value) {
  if (value.startsWith('/')) return value;

  const uncMatch = value.match(/^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\(.*)$/i);
  if (uncMatch) {
    if (uncMatch[1].toLowerCase() !== distribution.toLowerCase()) {
      throw new Error(
        `Path belongs to WSL distribution ${uncMatch[1]}, but ${distribution} is configured.`,
      );
    }
    return `/${uncMatch[2].replaceAll('\\', '/')}`;
  }

  const driveMatch = value.match(/^([a-z]):\\(.*)$/i);
  if (driveMatch) {
    return `/mnt/${driveMatch[1].toLowerCase()}/${driveMatch[2].replaceAll('\\', '/')}`;
  }

  throw new Error(`Cannot map Windows path into WSL: ${value}`);
}

const explicitDescriptor = process.env['SUTRA_STUDIO_BRIDGE_DESCRIPTOR'];
const nativeDescriptor = process.env['LOCALAPPDATA']
  ? win32.join(process.env['LOCALAPPDATA'], 'studio.sutra.desktop', 'codex-bridge-v1.json')
  : undefined;
const wslDataHome =
  process.env['SUTRA_STUDIO_WSL_DATA_HOME'] ??
  win32.join(`\\\\wsl.localhost\\${distribution}`, 'home', windowsUser, '.local', 'share');
const wslDescriptor = win32.join(wslDataHome, 'studio.sutra.desktop', 'codex-bridge-v1.json');
const explicitIsWsl =
  explicitDescriptor !== undefined && /^\\\\wsl(?:\.localhost|\$)\\/i.test(explicitDescriptor);

function nativeDescriptorProcessMayBeAlive(path) {
  if (!path || !existsSync(path)) return false;
  try {
    const descriptor = JSON.parse(readFileSync(path, 'utf8'));
    if (!Number.isInteger(descriptor.pid) || descriptor.pid <= 0) return true;
    process.kill(descriptor.pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ESRCH') return false;
    // Keep malformed or access-denied native descriptors on the native path so
    // the bridge client can report the security/format error instead of hiding it.
    return true;
  }
}

const nativeDescriptorMayBeLive = nativeDescriptorProcessMayBeAlive(nativeDescriptor);
const shouldUseWsl =
  process.platform === 'win32' &&
  (explicitIsWsl ||
    (!explicitDescriptor && !nativeDescriptorMayBeLive && existsSync(wslDescriptor)));

if (shouldUseWsl) {
  const descriptor = explicitDescriptor ? toWslPath(explicitDescriptor) : undefined;
  const wslServerEntryPoint =
    process.env['SUTRA_STUDIO_WSL_PLUGIN_ENTRY'] ?? toWslPath(serverEntryPoint);
  const argumentsForWsl = [
    '-d',
    distribution,
    '--',
    '/usr/bin/env',
    ...(descriptor ? [`SUTRA_STUDIO_BRIDGE_DESCRIPTOR=${descriptor}`] : []),
    'node',
    wslServerEntryPoint,
  ];
  const child = spawnSync('wsl.exe', argumentsForWsl, { stdio: 'inherit' });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

await import(pathToFileURL(serverEntryPoint).href);
