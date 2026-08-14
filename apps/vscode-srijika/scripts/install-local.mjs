import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { env, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const parsedManifest = /** @type {unknown} */ (
  JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
);
if (!parsedManifest || typeof parsedManifest !== 'object' || Array.isArray(parsedManifest)) {
  throw new Error('The VS Code extension manifest must be an object.');
}
const manifest = /** @type {Record<string, unknown>} */ (parsedManifest);
/** @param {string} fieldName */
const manifestString = (fieldName) => {
  const value = manifest[fieldName];
  if (typeof value !== 'string' || !value) {
    throw new Error(`The VS Code extension manifest needs a string ${fieldName}.`);
  }
  return value;
};
const publisher = manifestString('publisher');
const name = manifestString('name');
const version = manifestString('version');
const displayName = manifestString('displayName');
const extensionId = `${publisher}.${name}-${version}`;

/**
 * @param {string} value
 * @returns {string | null}
 */
const windowsPathToWsl = (value) => {
  const match = /^([A-Za-z]):\\(.*)$/u.exec(value.trim());
  if (!match) return null;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
};

/** @type {Set<string>} */
const extensionRoots = new Set();
if (env.SRIJIKA_VSCODE_EXTENSIONS_DIR) {
  extensionRoots.add(normalize(env.SRIJIKA_VSCODE_EXTENSIONS_DIR));
} else {
  extensionRoots.add(join(homedir(), '.vscode', 'extensions'));
  if (env.WSL_DISTRO_NAME) {
    extensionRoots.add(join(homedir(), '.vscode-server', 'extensions'));
    try {
      const windowsHome = execFileSync(
        '/mnt/c/Windows/System32/cmd.exe',
        ['/d', '/s', '/c', 'echo %USERPROFILE%'],
        { cwd: '/mnt/c/Windows', encoding: 'utf8', windowsHide: true },
      ).trim();
      const wslWindowsHome = windowsPathToWsl(windowsHome);
      if (wslWindowsHome) extensionRoots.add(join(wslWindowsHome, '.vscode', 'extensions'));
    } catch {
      // The Linux and remote-WSL locations above remain valid fallbacks.
    }
  }
}

for (const root of extensionRoots) {
  if (
    !isAbsolute(root) ||
    (!normalize(root).endsWith(join('.vscode', 'extensions')) &&
      !normalize(root).endsWith(join('.vscode-server', 'extensions')))
  ) {
    throw new Error(`Refusing to install outside a VS Code extensions directory: ${root}`);
  }
  const target = join(root, extensionId);
  await rm(target, { recursive: true, force: true });
  await mkdir(join(target, 'dist'), { recursive: true });
  await cp(join(packageRoot, 'dist'), join(target, 'dist'), { recursive: true });
  await cp(join(packageRoot, 'media'), join(target, 'media'), { recursive: true });
  await cp(join(packageRoot, 'README.md'), join(target, 'README.md'));
  await writeFile(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  stdout.write(`Installed ${displayName} in ${target}\n`);
}

stdout.write('Reload VS Code, then open a complete Srijika project folder.\n');
