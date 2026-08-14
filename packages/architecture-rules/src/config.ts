import {
  SRIJIKA_ARCHITECTURE_PROFILE,
  type ResolvedSrijikaArchitectureConfig,
  type SrijikaArchitectureConfig,
} from './types';

export const DEFAULT_SRIJIKA_ARCHITECTURE: ResolvedSrijikaArchitectureConfig = Object.freeze({
  profile: SRIJIKA_ARCHITECTURE_PROFILE,
  featuresRoot: 'src/features',
  slotsDirectory: 'slots',
  partsDirectory: 'parts',
  hooksDirectory: 'hooks',
  uiSuffix: '.ui.tsx',
  connectorSuffix: '.connector.tsx',
  storeSuffix: '.store.ts',
  logicSuffix: '.logic.ts',
  apiSuffix: '.api.ts',
  typesSuffix: '.types.ts',
});

function cleanRelativePath(value: string, fallback: string): string {
  const clean = value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  return clean || fallback;
}

export function resolveSrijikaArchitectureConfig(
  input: Partial<SrijikaArchitectureConfig> = {},
): ResolvedSrijikaArchitectureConfig {
  if (input.profile !== undefined && input.profile !== SRIJIKA_ARCHITECTURE_PROFILE) {
    throw new Error(`Unsupported Srijika architecture profile: ${String(input.profile)}`);
  }

  return {
    profile: SRIJIKA_ARCHITECTURE_PROFILE,
    featuresRoot: cleanRelativePath(
      input.featuresRoot ?? DEFAULT_SRIJIKA_ARCHITECTURE.featuresRoot,
      DEFAULT_SRIJIKA_ARCHITECTURE.featuresRoot,
    ),
    slotsDirectory: cleanRelativePath(
      input.slotsDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.slotsDirectory,
      DEFAULT_SRIJIKA_ARCHITECTURE.slotsDirectory,
    ),
    partsDirectory: cleanRelativePath(
      input.partsDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.partsDirectory,
      DEFAULT_SRIJIKA_ARCHITECTURE.partsDirectory,
    ),
    hooksDirectory: cleanRelativePath(
      input.hooksDirectory ?? DEFAULT_SRIJIKA_ARCHITECTURE.hooksDirectory,
      DEFAULT_SRIJIKA_ARCHITECTURE.hooksDirectory,
    ),
    uiSuffix: input.uiSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.uiSuffix,
    connectorSuffix: input.connectorSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.connectorSuffix,
    storeSuffix: input.storeSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.storeSuffix,
    logicSuffix: input.logicSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.logicSuffix,
    apiSuffix: input.apiSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.apiSuffix,
    typesSuffix: input.typesSuffix ?? DEFAULT_SRIJIKA_ARCHITECTURE.typesSuffix,
  };
}
