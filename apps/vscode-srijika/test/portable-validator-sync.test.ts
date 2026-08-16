import { describe, expect, it } from 'vitest';

import { upgradedSrijikaPortableValidator } from '../src/portable-validator-sync';

const config = JSON.stringify({
  sourceOfTruth: 'tsx',
  entry: 'src/features/home/Home.ui.tsx',
  architecture: {
    profile: 'feature-slot-part-v1',
    featuresRoot: 'src/features',
    slotsDirectory: 'slots',
    partsDirectory: 'parts',
    hooksDirectory: 'hooks',
    storeSuffix: '.store.ts',
  },
});

describe('portable validator synchronization', () => {
  it('upgrades an older generated validator to understand strict expanded layouts', () => {
    const oldGenerated = [
      '#!/usr/bin/env node',
      "import fs from 'node:fs/promises';",
      'const validate = async function portableMain2() {};',
      "process.stdout.write('Srijika architecture check passed');",
      'await validate({ fs, path, ts }, process.cwd(), {});',
    ].join('\n');
    const upgraded = upgradedSrijikaPortableValidator(config, oldGenerated);
    expect(upgraded).toContain('storesDirectory');
    expect(upgraded).toContain('SRIJIKA4110');
    expect(upgraded).toContain('SRIJIKA4111');
  });

  it('never replaces an unknown custom validation script', () => {
    expect(upgradedSrijikaPortableValidator(config, "console.log('custom validator');\n")).toBe(
      undefined,
    );
  });
});
