import { createSrijikaArchitectureValidatorScript } from '@srijika/architecture-rules/portable';

import { parseSrijikaArchitectureConfig } from './architecture-adapter';

const MANAGED_VALIDATOR_MARKERS = [
  '#!/usr/bin/env node',
  "import fs from 'node:fs/promises';",
  'const validate = async function portableMain',
  'Srijika architecture check passed',
  'await validate({ fs, path, ts }, process.cwd()',
] as const;

export function upgradedSrijikaPortableValidator(
  configSource: string,
  currentSource: string,
): string | undefined {
  if (!MANAGED_VALIDATOR_MARKERS.every((marker) => currentSource.includes(marker))) {
    return undefined;
  }
  const architecture = parseSrijikaArchitectureConfig(configSource);
  if (!architecture) return undefined;
  const nextSource = createSrijikaArchitectureValidatorScript(architecture);
  return nextSource === currentSource ? undefined : nextSource;
}
