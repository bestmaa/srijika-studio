import { validateUiDocument } from '@srijika/contracts';
import { describe, expect, it } from 'vitest';

import { createSrijikaProjectFileMap } from '@srijika/project-scaffold/templates';
import { compileSrijikaTsx } from '@srijika/tsx-compiler';

describe('code-first project scaffold contract', () => {
  it('compiles every canonical starter UI, including nested slots', () => {
    const files = createSrijikaProjectFileMap();
    const uiSources = Object.entries(files).filter(([path]) => path.endsWith('.ui.tsx'));

    expect(uiSources.map(([path]) => path)).toEqual([
      'src/features/home/Home.ui.tsx',
      'src/features/home/slots/navigation/Navigation.ui.tsx',
    ]);
    for (const [path, source] of uiSources) {
      const result = compileSrijikaTsx(path, source, { documentKind: 'component' });
      expect(result.diagnostics, path).toEqual([]);
      expect(validateUiDocument(result.document).valid, path).toBe(true);
    }
  });

  it('opens its configured Home entry as valid restricted TSX with events and slots', () => {
    const files = createSrijikaProjectFileMap();
    const configSource = files['srijika.config.json'];
    if (!configSource) throw new Error('Scaffold config is missing');
    const config = JSON.parse(configSource) as {
      entry?: unknown;
      sourceOfTruth?: unknown;
      preview?: unknown;
    };
    expect(config).toMatchObject({
      sourceOfTruth: 'tsx',
      preview: { styles: ['src/styles.css'] },
    });
    expect(typeof config.entry).toBe('string');

    const entry = String(config.entry);
    const source = files[entry];
    if (!source) throw new Error(`Scaffold entry ${entry} is missing`);
    const result = compileSrijikaTsx(entry, source, { documentKind: 'page' });

    expect(result.diagnostics).toEqual([]);
    expect(result.document).not.toBeNull();
    expect(validateUiDocument(result.document).valid).toBe(true);
    const slots = Object.values(result.document?.nodes ?? {}).filter(
      (node) => node.kind === 'slot',
    );
    expect(slots).toEqual([expect.objectContaining({ kind: 'slot', slotName: 'navigationSlot' })]);
    expect(result.document?.publicProps['pageClassName']).toMatchObject({
      valueType: 'string',
    });
    expect(result.document?.publicProps['onCreateSpark']).toMatchObject({
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(result.document?.publicProps).not.toHaveProperty('navigationSlot');

    const buttonEvents = Object.values(result.document?.nodes ?? {})
      .filter((node) => node.kind === 'element' && node.componentId === 'srijika.button')
      .flatMap((node) => (node.kind === 'element' ? Object.values(node.events) : []));
    expect(buttonEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbolId: 'event_onCreateSpark' }),
        expect.objectContaining({ symbolId: 'event_onToggleTheme' }),
        expect.objectContaining({ symbolId: 'event_onToggleGuide' }),
      ]),
    );
  });

  it('pins Connector/UI separation, React Compiler, and portable project metadata', () => {
    const files = createSrijikaProjectFileMap();

    expect(files['src/features/home/Home.connector.tsx']).toContain('useHome');
    expect(files['src/features/home/useHome.ts']).toContain('useHomeStore');
    expect(files['src/features/home/Home.connector.tsx']).toContain(
      'navigationSlot={<NavigationConnector />}',
    );
    expect(files['src/features/home/home.store.ts']).toContain("from 'zustand'");
    expect(files['src/features/home/Home.ui.tsx']).not.toContain('useHomeStore');
    expect(files['src/features/home/slots/navigation/Navigation.ui.tsx']).not.toContain(
      'useHomeStore',
    );
    expect(files['vite.config.ts']).toContain('reactCompilerPreset()');
    expect(files['.vscode/extensions.json']).toContain('srijika.srijika-language-support');
    expect(files['.vscode/settings.json']).not.toContain('typescript.tsdk');
    expect(files['.vscode/settings.json']).toContain('editor.quickSuggestions');
    expect(files['README.md']).toContain('## VS Code setup');
    expect(files['README.md']).toContain('Ctrl+Space');
    expect(files['package.json']).toContain('"packageManager": "pnpm@11.18.0"');
    expect(files['package.json']).toContain('"validate:srijika"');
    expect(files['scripts/srijika-validate.mjs']).toContain('SRIJIKA4101');
    expect(files['srijika.toolchain.json']).toContain('"strategy": "frozen-lockfile"');
    expect(files['pnpm-lock.yaml']).toMatch(/^lockfileVersion: '9\.0'/);
  });
});
