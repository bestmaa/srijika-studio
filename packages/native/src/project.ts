import { relative, resolve } from 'node:path';

import {
  parseSrijikaProjectConfig,
  validateSrijikaArchitecture,
} from '@srijika/architecture-rules';

import { compileSrijikaNativeTsx } from './compiler.js';
import { nativeProjectRoot, readNativeFile, scanNativeSources } from './filesystem.js';
import {
  assertNativePackage,
  nativeRuntimeDiagnostics,
  parseNativeProjectConfig,
  parseNativeTypeScriptPathAliases,
} from './profile.js';
import type { NativeCompileResult } from './types.js';
export { parseNativeProjectConfig } from './profile.js';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export async function inspectNativeProject(directory: string) {
  const root = await nativeProjectRoot(directory);
  const native = parseNativeProjectConfig(
    await readNativeFile(root, 'srijika.native.json', 64 * 1024),
  );
  const config = parseSrijikaProjectConfig(
    await readNativeFile(root, 'srijika.config.json', 64 * 1024),
  );
  if (config.framework || config.adoption)
    throw new Error('Native projects cannot select web framework or adoption profiles.');
  await readNativeFile(root, config.entry);
  const packageSource = await readNativeFile(root, 'package.json', 1024 * 1024);
  assertNativePackage(packageSource);
  const packageJson = record(JSON.parse(packageSource), 'package.json');
  const aliases = parseNativeTypeScriptPathAliases(
    await readNativeFile(root, 'tsconfig.json', 1024 * 1024),
  );
  return { root, native, config, aliases, packageJson };
}

export interface NativeCheckReport {
  root: string;
  checkedFiles: number;
  diagnostics: readonly {
    code: string;
    fileName: string;
    message: string;
    line: number;
    column: number;
    severity: 'error';
  }[];
  ui: readonly { fileName: string; result: NativeCompileResult }[];
  valid: boolean;
}

export async function checkNativeProject(directory: string): Promise<NativeCheckReport> {
  const project = await inspectNativeProject(directory);
  const files = await scanNativeSources(project.root);
  if (!files.some((file) => resolve(file.fileName) === resolve(project.root, project.config.entry)))
    throw new Error('The authoritative Native UI entry must be included in the source scan.');
  const architecture = validateSrijikaArchitecture(files, {
    projectRoot: project.root,
    architecture: project.config.architecture,
    aliases: project.aliases,
  });
  const diagnostics: NativeCheckReport['diagnostics'][number][] = architecture.diagnostics.map(
    (diagnostic) => ({
      code: diagnostic.code,
      fileName: relative(project.root, diagnostic.fileName),
      message: diagnostic.message,
      line: diagnostic.span.line,
      column: diagnostic.span.column,
      severity: 'error',
    }),
  );
  const ui: { fileName: string; result: NativeCompileResult }[] = [];
  for (const file of files) {
    const name = relative(project.root, file.fileName).replaceAll('\\', '/');
    if (name.endsWith(project.config.architecture.uiSuffix)) {
      const result = compileSrijikaNativeTsx(file.source, name);
      ui.push({ fileName: name, result });
      diagnostics.push(...result.diagnostics);
    }
  }
  diagnostics.push(
    ...nativeRuntimeDiagnostics(files, project.config.architecture).map((diagnostic) => ({
      ...diagnostic,
      fileName: relative(project.root, diagnostic.fileName).replaceAll('\\', '/'),
    })),
  );
  return {
    root: project.root,
    checkedFiles: files.length,
    diagnostics,
    ui,
    valid: diagnostics.length === 0,
  };
}

export async function printNativeCheck(directory: string, json = false): Promise<number> {
  const report = await checkNativeProject(directory);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const diagnostic of report.diagnostics)
      console.error(
        `${diagnostic.fileName}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code} ${diagnostic.message}`,
      );
    console.log(
      `Native check: ${report.valid ? 'passed' : 'failed'} (${report.checkedFiles} files, ${report.ui.length} UI sources).`,
    );
  }
  return report.valid ? 0 : 1;
}
