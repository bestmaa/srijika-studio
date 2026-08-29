import { describe, expect, it } from 'vitest';

import {
  architectureDiagnosticToEditorDiagnostic,
  checkArchitectureWorkspace,
  parseSrijikaCodeProjectConfig,
  parseSrijikaArchitectureConfig,
  validateArchitectureWorkspace,
} from '../src/architecture-adapter';

describe('VS Code architecture adapter', () => {
  it('uses the resolved adoption plan for strict and report-only files', () => {
    const root = '/project';
    const project = parseSrijikaCodeProjectConfig(
      JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        adoption: {
          ownership: {
            version: 1,
            profile: 'brownfield-ownership-v1',
            managedRoots: ['src/features'],
            include: ['src/features'],
            adoptedOwners: ['src/features/home'],
          },
        },
      }),
    );
    if (!project.adoption) throw new Error('Expected resolved brownfield adoption config.');
    const result = checkArchitectureWorkspace({
      projectRoot: root,
      architecture: project.architecture,
      adoption: project.adoption,
      entry: project.entry,
      files: [
        {
          fileName: `${root}/src/features/home/Home.ui.tsx`,
          source: 'export function HomeUI() { return <main />; }',
        },
        {
          fileName: `${root}/src/features/home/Home.connector.tsx`,
          source: 'export function HomeConnector() { return null; }',
        },
        {
          fileName: `${root}/src/features/catalog/Catalog.ui.tsx`,
          source: "export function CatalogUI() { fetch('/pending'); return <main />; }",
        },
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.adoption).toMatchObject({
      status: 'partial',
      summary: { governed: 2, pending: 1, fullProjectSuccess: false },
    });
  });

  it('passes authoritative project aliases into the shared validator', () => {
    const root = '/project';
    const files = [
      { fileName: `${root}/src/features/home/Home.ui.tsx`, source: 'export {};' },
      {
        fileName: `${root}/src/features/home/Home.connector.tsx`,
        source: "import { loadHome } from '@app/features/home/home.api'; void loadHome;",
      },
      {
        fileName: `${root}/src/features/home/home.api.ts`,
        source: 'export const loadHome = () => null;',
      },
    ];

    expect(
      validateArchitectureWorkspace({
        projectRoot: root,
        files,
        aliases: { '@app/': 'src/' },
      }),
    ).toEqual([]);
    expect(
      validateArchitectureWorkspace({
        projectRoot: root,
        files: files.slice(0, 2),
        aliases: { '@app/': 'src/' },
      }),
    ).toContainEqual(expect.objectContaining({ code: 'SRIJIKA4120' }));
  });

  it('surfaces exact slot-boundary diagnostics from the shared validator', () => {
    const root = '/project';
    const source = "import { useNavStore } from '../navigation/navigation.store';";
    const files = [
      { fileName: `${root}/src/features/home/Home.ui.tsx`, source: 'export {};' },
      { fileName: `${root}/src/features/home/Home.connector.tsx`, source: 'export {};' },
      {
        fileName: `${root}/src/features/home/slots/header/Header.ui.tsx`,
        source: 'export {};',
      },
      {
        fileName: `${root}/src/features/home/slots/header/Header.connector.tsx`,
        source,
      },
      {
        fileName: `${root}/src/features/home/slots/navigation/Navigation.ui.tsx`,
        source: 'export {};',
      },
      {
        fileName: `${root}/src/features/home/slots/navigation/Navigation.connector.tsx`,
        source: "import './navigation.store';",
      },
      {
        fileName: `${root}/src/features/home/slots/navigation/navigation.store.ts`,
        source: 'export {};',
      },
    ];

    const [diagnostic] = validateArchitectureWorkspace({ projectRoot: root, files });

    expect(diagnostic).toMatchObject({ code: 'SRIJIKA4103' });
    if (!diagnostic) throw new Error('Expected an architecture diagnostic');
    const editor = architectureDiagnosticToEditorDiagnostic(source, diagnostic);
    expect(editor.range).toEqual({
      start: { line: 0, character: source.indexOf('../navigation/navigation.store') },
      end: {
        line: 0,
        character:
          source.indexOf('../navigation/navigation.store') +
          '../navigation/navigation.store'.length,
      },
    });
    expect(editor.guidance).toContain('promote');
  });

  it('reads the canonical architecture block and fails closed for invalid profiles', () => {
    expect(
      parseSrijikaCodeProjectConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/product-features/home/Home.ui.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: 'src/product-features',
          },
        }),
      ),
    ).toMatchObject({
      sourceOfTruth: 'tsx',
      entry: 'src/product-features/home/Home.ui.tsx',
    });
    expect(
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/product-features/home/Home.ui.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: 'src/product-features',
            sharedRoot: 'src/common',
            slotsDirectory: 'regions',
          },
        }),
      ),
    ).toMatchObject({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'src/product-features',
      sharedRoot: 'src/common',
      slotsDirectory: 'regions',
    });
    expect(() =>
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture: { profile: 'unknown-profile' },
        }),
      ),
    ).toThrow(/Unsupported Srijika architecture profile/);
    expect(() =>
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture: { featuresRoot: 'src' },
        }),
      ),
    ).toThrow(/architecture\.profile is required/);
    expect(() =>
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: '../outside',
            sharedRoot: 'shared',
          },
        }),
      ),
    ).toThrow(/project-relative|traversal/);
    expect(() =>
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: '',
            sharedRoot: 'shared',
          },
        }),
      ),
    ).toThrow(/featuresRoot/);
    expect(() =>
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          sourceOfTruth: 'tsx',
          entry: 'src/features/home/Home.ui.tsx',
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: ['product', 'features'],
          },
        }),
      ),
    ).toThrow(/architecture\.featuresRoot must be a string/);
  });
});
