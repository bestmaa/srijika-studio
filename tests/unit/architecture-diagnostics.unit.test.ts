import { describe, expect, it } from 'vitest';

import {
  analyzeCodeProjectArchitecture,
  analyzeCodeProjectFileMap,
  architectureConfigFromFileMap,
  architectureRootsFromFileMap,
  architectureSourcesFromFileMap,
} from '../../apps/studio/src/lib/architecture-diagnostics';

describe('Studio architecture diagnostics adapter', () => {
  it('projects configured ownership roots for Studio discovery and previews', () => {
    expect(
      architectureRootsFromFileMap({
        'srijika.config.json': JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'application/domain/features/home/Home.ui.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: 'application/domain/features',
            sharedRoot: 'application/domain/shared',
          },
        }),
      }),
    ).toEqual({
      featuresRoot: 'application/domain/features',
      sharedRoot: 'application/domain/shared',
    });
    expect(architectureRootsFromFileMap({})).toEqual({
      featuresRoot: 'src/features',
      sharedRoot: 'src/shared',
    });
  });

  it('projects the complete configured naming contract for native previews', () => {
    expect(
      architectureConfigFromFileMap({
        'srijika.config.json': JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'application/modules/home/Home.view.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: 'application/modules',
            sharedRoot: 'application/common',
            slotsDirectory: 'regions',
            partsDirectory: 'fragments',
            hooksDirectory: 'effects',
            storesDirectory: 'state',
            uiSuffix: '.view.tsx',
            connectorSuffix: '.gateway.tsx',
            storeSuffix: '.state.ts',
            logicSuffix: '.rules.ts',
            apiSuffix: '.transport.ts',
            typesSuffix: '.contract.ts',
          },
        }),
      }),
    ).toEqual({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'application/modules',
      sharedRoot: 'application/common',
      slotsDirectory: 'regions',
      partsDirectory: 'fragments',
      hooksDirectory: 'effects',
      storesDirectory: 'state',
      uiSuffix: '.view.tsx',
      connectorSuffix: '.gateway.tsx',
      storeSuffix: '.state.ts',
      logicSuffix: '.rules.ts',
      apiSuffix: '.transport.ts',
      typesSuffix: '.contract.ts',
    });
  });

  it.each([
    [{ featuresRoot: 'src/features' }, /architecture\.profile is required/],
    [{ profile: 'feature-slot-part-v2' }, /Unsupported Srijika architecture profile/],
  ])(
    'fails closed when a Studio project architecture block has no exact profile',
    (architecture, message) => {
      expect(() =>
        architectureConfigFromFileMap({
          'srijika.config.json': JSON.stringify({
            sourceOfTruth: 'tsx',
            entry: 'src/features/home/Home.ui.tsx',
            architecture,
          }),
        }),
      ).toThrow(message);
      expect(() =>
        analyzeCodeProjectFileMap({
          'srijika.config.json': JSON.stringify({
            sourceOfTruth: 'tsx',
            entry: 'src/features/home/Home.ui.tsx',
            architecture,
          }),
          'src/features/home/Home.ui.tsx': 'export function HomeUI() { return <main />; }',
        }),
      ).toThrow(message);
    },
  );

  it('checks every TypeScript source in a browser project and keeps actionable ownership guidance', () => {
    const files = {
      'srijika.config.json': JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
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
      'src/features/home/ambient.d.ts': 'declare const ignored: true;',
      'src/features/home/ambient.d.tsx': 'export const governedTsx = true;',
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
        sourceOfTruth: 'tsx',
        entry: 'src/modules/home/Home.ui.tsx',
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

  it('uses browser-project tsconfig aliases and fails unresolved aliases closed', () => {
    const baseFiles = {
      'srijika.config.json': JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
      }),
      'tsconfig.json': `{
        // browser projects use the same JSONC aliases as CLI and VS Code
        "compilerOptions": { "paths": { "@app/*": ["src/*"] } }
      }`,
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return <main />; }',
      'src/features/home/Home.connector.tsx':
        "import { loadHome } from '@app/features/home/home.api'; void loadHome;",
    } as const;

    expect(
      analyzeCodeProjectFileMap({
        ...baseFiles,
        'src/features/home/home.api.ts': 'export const loadHome = () => null;',
      }).diagnostics,
    ).toEqual([]);
    expect(analyzeCodeProjectFileMap(baseFiles).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SRIJIKA4120' }),
    );
  });
});
