import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  parseSrijikaProjectConfig,
  parseSrijikaTypeScriptPathAliases,
  type SrijikaProjectConfig,
} from '@srijika/architecture-rules';
import {
  assertNativePackage,
  parseNativeProjectConfig,
  parseNativeTypeScriptPathAliases,
  type NativeProjectConfig,
} from '@srijika/native/editor';

import type { openSafeSrijikaWorkspace } from './safe-workspace-files';

export interface SrijikaEditorProject {
  kind: 'web' | 'native';
  config: SrijikaProjectConfig;
  aliases: Readonly<Record<string, string>>;
  native?: NativeProjectConfig;
}

export function parseSrijikaEditorProject(
  configSource: string,
  nativeSource?: string,
  tsconfigSource?: string,
  packageSource?: string,
): SrijikaEditorProject {
  const config = parseSrijikaProjectConfig(configSource);
  if (nativeSource === undefined)
    return {
      kind: 'web',
      config,
      aliases:
        tsconfigSource === undefined ? {} : parseSrijikaTypeScriptPathAliases(tsconfigSource),
    };
  const native = parseNativeProjectConfig(nativeSource);
  if (config.framework || config.adoption)
    throw new Error('Native projects cannot select web framework or adoption profiles.');
  if (packageSource !== undefined) assertNativePackage(packageSource);
  return {
    kind: 'native',
    config,
    native,
    aliases: tsconfigSource === undefined ? {} : parseNativeTypeScriptPathAliases(tsconfigSource),
  };
}

export async function readSrijikaEditorProject(
  fileSystem: Awaited<ReturnType<typeof openSafeSrijikaWorkspace>>,
): Promise<SrijikaEditorProject> {
  const configSource = (await fileSystem.readText('srijika.config.json', 64 * 1024)).source;
  const nativeSource = (await fileSystem.isRegularFile('srijika.native.json'))
    ? (await fileSystem.readText('srijika.native.json', 64 * 1024)).source
    : undefined;
  const tsconfigSource = (await fileSystem.isRegularFile('tsconfig.json'))
    ? (await fileSystem.readText('tsconfig.json', 1024 * 1024)).source
    : undefined;
  const packageSource =
    nativeSource === undefined
      ? undefined
      : (await fileSystem.readText('package.json', 1024 * 1024)).source;
  return parseSrijikaEditorProject(configSource, nativeSource, tsconfigSource, packageSource);
}

export function projectContainsFile(root: string, fileName: string): boolean {
  const path = relative(resolve(root), resolve(fileName));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

/** The nearest configured project wins, including web packages inside Native workspaces. */
export function nearestEditorProjectRoot(
  roots: readonly string[],
  fileName: string,
): string | undefined {
  return roots
    .filter((root) => projectContainsFile(root, fileName))
    .sort((left, right) => right.length - left.length)[0];
}
