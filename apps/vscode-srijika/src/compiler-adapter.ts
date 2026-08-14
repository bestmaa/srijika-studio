import { compileSrijikaTsx, type CompileSrijikaTsxResult } from '@srijika/tsx-compiler';

export interface SrijikaUiSource {
  fileName: string;
  source: string;
}

/**
 * Keeps the extension isolated from compiler call-site details. Srijika rules and
 * diagnostics remain owned exclusively by @srijika/tsx-compiler.
 */
export function compileUiSource({ fileName, source }: SrijikaUiSource): CompileSrijikaTsxResult {
  return compileSrijikaTsx(fileName, source, { documentKind: 'component' });
}
