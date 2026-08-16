import {
  resolveSrijikaArchitectureConfig,
  type SrijikaArchitectureConfig,
} from '@srijika/architecture-rules';

export const SRIJIKA_ARCHITECTURE_SOURCE_GLOB = '**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';

export function srijikaArchitectureSourcePatterns(
  input: Partial<SrijikaArchitectureConfig> = {},
): readonly string[] {
  const architecture = resolveSrijikaArchitectureConfig(input);
  return [...new Set([architecture.featuresRoot, architecture.sharedRoot])].map(
    (root) => root + '/' + SRIJIKA_ARCHITECTURE_SOURCE_GLOB,
  );
}

export function srijikaArchitectureWatchPatterns(
  input: Partial<SrijikaArchitectureConfig>,
  entry: string,
): readonly string[] {
  return [...new Set([...srijikaArchitectureSourcePatterns(input), entry.replaceAll('\\', '/')])];
}

export function isSrijikaArchitectureSourcePath(fileName: string): boolean {
  const normalized = fileName.replaceAll('\\', '/').toLowerCase();
  return (
    /\.(?:[cm]?[jt]s|[jt]sx)$/.test(normalized) && !/\.d\.(?:ts|tsx|mts|cts)$/.test(normalized)
  );
}

export function isSrijikaUiSourcePath(fileName: string, uiSuffix: string): boolean {
  return fileName.replaceAll('\\', '/').toLowerCase().endsWith(uiSuffix.toLowerCase());
}
