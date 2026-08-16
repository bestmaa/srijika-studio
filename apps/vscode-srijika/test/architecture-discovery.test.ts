import { describe, expect, it } from 'vitest';

import {
  isSrijikaArchitectureSourcePath,
  isSrijikaUiSourcePath,
  srijikaArchitectureSourcePatterns,
  srijikaArchitectureWatchPatterns,
} from '../src/architecture-discovery';

describe('VS Code architecture discovery', () => {
  it('targets configured no-src Features and Shared roots', () => {
    expect(
      srijikaArchitectureSourcePatterns({
        profile: 'feature-slot-part-v1',
        featuresRoot: 'product/features',
        sharedRoot: 'common',
      }),
    ).toEqual([
      'product/features/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'common/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    ]);
  });

  it('includes JavaScript families and excludes declaration files', () => {
    for (const fileName of [
      'product/features/home/helper.js',
      'product/features/home/view.jsx',
      'common/runtime.mjs',
      'common/runtime.cjs',
      'product/features/home/Home.ui.tsx',
    ]) {
      expect(isSrijikaArchitectureSourcePath(fileName)).toBe(true);
    }
    expect(isSrijikaArchitectureSourcePath('product/features/home/types.d.ts')).toBe(false);
    expect(isSrijikaArchitectureSourcePath('product/features/home/styles.css')).toBe(false);
  });

  it('rejects unsafe configured roots through the central resolver', () => {
    expect(() =>
      srijikaArchitectureSourcePatterns({
        profile: 'feature-slot-part-v1',
        featuresRoot: '../outside',
      }),
    ).toThrow(/project-relative|traversal/);
  });

  it('recognizes a configured UI suffix instead of assuming .ui.tsx', () => {
    expect(isSrijikaUiSourcePath('product/features/home/Home.view.tsx', '.view.tsx')).toBe(true);
    expect(isSrijikaUiSourcePath('product/features/home/Home.ui.tsx', '.view.tsx')).toBe(false);
  });

  it('watches the authoritative entry even when it is outside ownership roots', () => {
    expect(
      srijikaArchitectureWatchPatterns(
        {
          profile: 'feature-slot-part-v1',
          featuresRoot: 'product/features',
          sharedRoot: 'common',
        },
        'application/screens/App.ui.tsx',
      ),
    ).toEqual([
      'product/features/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'common/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
      'application/screens/App.ui.tsx',
    ]);
  });
});
