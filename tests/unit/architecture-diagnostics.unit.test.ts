import { describe, expect, it } from 'vitest';

import {
  analyzeCodeProjectArchitecture,
  analyzeCodeProjectFileMap,
  architectureSourcesFromFileMap,
} from '../../apps/studio/src/lib/architecture-diagnostics';

describe('Studio architecture diagnostics adapter', () => {
  it('checks every TypeScript source in a browser project and keeps actionable ownership guidance', () => {
    const files = {
      'srijika.config.json': JSON.stringify({
        architecture: { profile: 'feature-slot-part-v1' },
      }),
      'src/features/home/Home.ui.tsx':
        "import { useHomeStore } from './home.store'; export function Home(){ useHomeStore(); return <main />; }",
      'src/features/home/home.store.ts': 'export const home = 1;',
      'src/features/home/Home.connector.tsx':
        "import { navigationState } from './slots/navigation/navigation.store'; export const value = navigationState;",
      'src/features/home/slots/navigation/navigation.store.ts': 'export const navigationState = 1;',
      'src/features/home/slots/sidebar/sidebar.store.ts': 'export const sidebarState = 1;',
      'src/features/home/slots/navigation/Navigation.connector.tsx':
        "import { sidebarState } from '../sidebar/sidebar.store'; export const value = sidebarState;",
      'src/features/profile/Profile.connector.tsx':
        "import { home } from '../home/home.store'; export const value = home;",
    } as const;

    const result = analyzeCodeProjectFileMap(files);

    expect(result.checkedFileCount).toBe(7);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['SRIJIKA4101', 'SRIJIKA4102', 'SRIJIKA4103']),
    );
    expect(result.diagnostics.every((diagnostic) => diagnostic.origin === 'architecture')).toBe(
      true,
    );
    expect(result.diagnostics.every((diagnostic) => diagnostic.guidance.length > 20)).toBe(true);
  });

  it('uses the architecture profile from srijika.config.json and ignores non-source files', () => {
    const files = {
      'srijika.config.json': JSON.stringify({
        architecture: {
          profile: 'feature-slot-part-v1',
          featuresRoot: 'src/modules',
          slotsDirectory: 'regions',
        },
      }),
      'README.md': 'not TypeScript',
      'src/modules/home/Home.ui.tsx':
        "import { state } from './regions/nav/nav.store'; export function Home(){ return <main>{state}</main>; }",
      'src/modules/home/regions/nav/nav.store.ts': 'export const state = 1;',
    } as const;

    const result = analyzeCodeProjectFileMap(files, '/projects/demo');

    expect(result.checkedFileCount).toBe(2);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SRIJIKA4101',
          fileName: '/projects/demo/src/modules/home/Home.ui.tsx',
        }),
      ]),
    );
  });

  it('accepts bounded desktop sources through the same pure analysis boundary', () => {
    const sources = architectureSourcesFromFileMap(
      {
        'src/features/home/Home.connector.tsx':
          "import { privateValue } from '../profile/profile.store'; export const value = privateValue;",
        'src/features/profile/profile.store.ts': 'export const privateValue = 1;',
      },
      '/projects/demo',
    );

    const result = analyzeCodeProjectArchitecture(sources, { projectRoot: '/projects/demo' });

    expect(result.checkedFileCount).toBe(2);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: 'architecture',
          fileName: '/projects/demo/src/features/home/Home.connector.tsx',
        }),
      ]),
    );
    expect(result.diagnostics.every((diagnostic) => diagnostic.code.startsWith('SRIJIKA41'))).toBe(
      true,
    );
  });
});
