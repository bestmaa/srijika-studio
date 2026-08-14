import { describe, expect, it } from 'vitest';

import {
  architectureDiagnosticToEditorDiagnostic,
  parseSrijikaArchitectureConfig,
  validateArchitectureWorkspace,
} from '../src/architecture-adapter';

describe('VS Code architecture adapter', () => {
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

  it('reads the canonical architecture block and ignores unsupported profiles', () => {
    expect(
      parseSrijikaArchitectureConfig(
        JSON.stringify({
          architecture: {
            profile: 'feature-slot-part-v1',
            featuresRoot: 'src/product-features',
            slotsDirectory: 'regions',
          },
        }),
      ),
    ).toEqual({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'src/product-features',
      slotsDirectory: 'regions',
    });
    expect(
      parseSrijikaArchitectureConfig(
        JSON.stringify({ architecture: { profile: 'unknown-profile' } }),
      ),
    ).toBeUndefined();
    expect(
      parseSrijikaArchitectureConfig(JSON.stringify({ architecture: { featuresRoot: 'src' } })),
    ).toBeUndefined();
  });
});
