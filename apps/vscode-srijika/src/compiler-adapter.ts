import { createHash } from 'node:crypto';
import { dirname, normalize, resolve } from 'node:path';

import {
  compileSrijikaTsx,
  srijikaTypeOnlyModuleSpecifiers,
  type CompileSrijikaTsxResult,
  type SrijikaResolvedTypeModule,
} from '@srijika/tsx-compiler';

export interface SrijikaUiSource {
  fileName: string;
  source: string;
}

export interface SrijikaUiCompileContext {
  uiSuffix?: string;
  typesSuffix?: string;
  sourceByFileName?: ReadonlyMap<string, string>;
}

function normalizedKey(fileName: string): string {
  return normalize(fileName).replaceAll('\\', '/').toLowerCase();
}

export function resolvedUiTypeModules(
  { fileName, source }: SrijikaUiSource,
  {
    uiSuffix = '.ui.tsx',
    typesSuffix = '.types.ts',
    sourceByFileName = new Map(),
  }: SrijikaUiCompileContext = {},
): readonly SrijikaResolvedTypeModule[] {
  if (!fileName.toLowerCase().endsWith(uiSuffix.toLowerCase())) return [];
  const expected = `${fileName.slice(0, -uiSuffix.length)}${typesSuffix}`;
  const sources = new Map(
    [...sourceByFileName.entries()].map(([path, value]) => [normalizedKey(path), value]),
  );
  return srijikaTypeOnlyModuleSpecifiers(source).flatMap((specifier) => {
    const unresolved = resolve(dirname(fileName), specifier);
    const candidate = /\.(?:ts|tsx)$/i.test(unresolved) ? unresolved : `${unresolved}.ts`;
    if (normalizedKey(candidate) !== normalizedKey(expected)) return [];
    const moduleSource = sources.get(normalizedKey(candidate));
    if (moduleSource === undefined) return [];
    return [
      {
        specifier,
        fileName: candidate,
        source: moduleSource,
        hash: createHash('sha256').update(moduleSource).digest('hex'),
      },
    ];
  });
}

/**
 * Keeps the extension isolated from compiler call-site details. Srijika rules and
 * diagnostics remain owned exclusively by @srijika/tsx-compiler.
 */
export function compileUiSource(
  input: SrijikaUiSource,
  context: SrijikaUiCompileContext = {},
): CompileSrijikaTsxResult {
  return compileSrijikaTsx(input.fileName, input.source, {
    documentKind: 'component',
    resolvedTypeModules: resolvedUiTypeModules(input, context),
  });
}
