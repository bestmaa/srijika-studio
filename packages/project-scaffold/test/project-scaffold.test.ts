import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import * as ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSrijikaProjectFileMap,
  createSrijikaUiSourcePair,
  writeSrijikaProject,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'srijika-project-scaffold-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe('createSrijikaProjectFileMap', () => {
  it('returns one deterministic, polished code-first Home experience', () => {
    const first = createSrijikaProjectFileMap();
    const second = createSrijikaProjectFileMap();

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.keys(first)).toEqual([...Object.keys(first)].sort());
    expect(Object.keys(first).filter((path) => path.endsWith('.ui.tsx'))).toEqual([
      'src/features/home/Home.ui.tsx',
      'src/features/home/slots/navigation/Navigation.ui.tsx',
    ]);
    expect(first['src/App.tsx']).toContain('<HomeConnector />');
    expect(first['src/main.tsx']).toContain('<App />');
    expect(first['src/main.tsx']).not.toContain('AppProviders');
    expect(first['src/app/AppProviders.tsx']).toBeUndefined();
    expect(first['src/app/query-client.ts']).toBeUndefined();
    expect(first['src/shared/.gitkeep']).toBe('');
    expect(first['src/features/home/Home.ui.tsx']).toContain(
      'Build React interfaces with a clear thread',
    );
    expect(first['src/features/home/Home.ui.tsx']).toContain('className="studio-window"');
    expect(first['src/styles.css']).toContain('@media (max-width: 680px)');
    expect(first['src/styles.css']).toContain('@media (prefers-reduced-motion: reduce)');
    expect(first['public/srijika-mark.svg']).toContain('linearGradient');
  });

  it('adds TanStack React Query only when explicitly requested', () => {
    const files = createSrijikaProjectFileMap({ reactQuery: true });
    const packageMetadata = JSON.parse(files['package.json'] ?? '{}') as {
      dependencies: Record<string, string>;
    };

    expect(packageMetadata.dependencies['@tanstack/react-query']).toBe('5.101.4');
    expect(files['src/main.tsx']).toContain("import { AppProviders } from './app/AppProviders';");
    expect(files['src/main.tsx']).toContain('<AppProviders>');
    expect(files['src/app/AppProviders.tsx']).toContain('QueryClientProvider');
    expect(files['src/app/query-client.ts']).toContain('new QueryClient');
    expect(files['pnpm-lock.yaml']).toContain("'@tanstack/react-query':");
  });

  it('pins a portable toolchain and frozen pnpm lockfile without version ranges', () => {
    const files = createSrijikaProjectFileMap();
    const packageMetadata = JSON.parse(files['package.json'] ?? '{}') as {
      packageManager: string;
      engines: { node: string };
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      srijika: Record<string, string>;
    };
    const toolchain = JSON.parse(files['srijika.toolchain.json'] ?? '{}') as {
      packageManager: string;
      profile: string;
      install: { command: string; lockfile: string; strategy: string };
      runtime: { react: string; reactDom: string };
      execution: {
        defaultRuntime: string;
        optionalRuntimes: string[];
        runtimeSelection: string;
        devServer: string;
        hmr: boolean;
      };
      ai: { mcpConfig: string; instructions: string; desktopRequired: boolean };
    };
    const lockfile = files['pnpm-lock.yaml'] ?? '';

    expect(packageMetadata).toMatchObject({
      packageManager: 'pnpm@11.18.0',
      engines: { node: '>=22.18.0' },
      srijika: {
        sourceOfTruth: 'tsx',
        config: 'srijika.config.json',
        toolchain: 'srijika.toolchain.json',
      },
    });
    expect(
      Object.values({ ...packageMetadata.dependencies, ...packageMetadata.devDependencies }),
    ).not.toContainEqual(expect.stringMatching(/^[*~^]|^(?:file|link|workspace):/));
    expect(packageMetadata.dependencies).toEqual({
      react: '19.2.8',
      'react-dom': '19.2.8',
      zustand: '5.0.14',
    });
    expect(packageMetadata.scripts['validate:srijika']).toBe('node scripts/srijika-validate.mjs');
    expect(packageMetadata.scripts['mcp:srijika']).toBe(
      'npx -y @srijika/mcp-server@0.4.1 --project .',
    );
    expect(packageMetadata.scripts['typecheck']).toContain('validate:srijika');
    expect(packageMetadata.scripts['build']).toContain('validate:srijika');
    expect(files['scripts/srijika-validate.mjs']).toContain('Srijika architecture check passed');
    expect(files['pnpm-workspace.yaml']).toBe('nodeLinker: hoisted\n');
    expect(packageMetadata.devDependencies).toMatchObject({
      '@babel/core': '8.0.1',
      '@rolldown/plugin-babel': '0.2.3',
      '@vitejs/plugin-react': '6.0.5',
      'babel-plugin-react-compiler': '1.0.0',
      typescript: '6.0.3',
      vite: '8.2.0',
    });
    expect(toolchain).toEqual(
      expect.objectContaining({
        packageManager: packageMetadata.packageManager,
        profile: 'react-web-v1',
        install: {
          command: 'pnpm install --frozen-lockfile',
          lockfile: 'pnpm-lock.yaml',
          strategy: 'frozen-lockfile',
        },
        runtime: { react: '19.2.8', reactDom: '19.2.8' },
        execution: {
          defaultRuntime: 'node',
          optionalRuntimes: ['bun'],
          runtimeSelection: 'explicit',
          devServer: 'vite',
          hmr: true,
        },
        validation: {
          architecture: 'feature-slot-part-v1',
          command: 'pnpm run validate:srijika',
        },
        ai: {
          mcpConfig: '.mcp.json',
          instructions: 'AGENTS.md',
          desktopRequired: false,
        },
      }),
    );
    expect(files['.mcp.json']).toContain('@srijika/mcp-server@0.4.1');
    expect(files['.vscode/mcp.json']).toContain('${workspaceFolder}');
    expect(files['.vscode/tasks.json']).toContain('Srijika: Run App');
    expect(files['AGENTS.md']).toContain('srijika_plan_code_structure');
    expect(files['AGENTS.md']).toContain('`src/shared` has exactly three owner shapes');
    expect(files['AGENTS.md']).toContain('Shared never imports `src/features`');
    expect(files['AGENTS.md']).toContain('explicit `--react-query`');
    expect(files['README.md']).toContain('srijika add shared-ui ActionButton');
    expect(files['README.md']).toContain('srijika add shared-widget UserMenu');
    expect(files['README.md']).toContain('srijika add shared-capability Auth');
    expect(files['README.md']).toContain('React Query is intentionally absent');
    expect(lockfile.startsWith("lockfileVersion: '9.0'\n")).toBe(true);
    expect(lockfile).not.toContain('@tanstack/react-query');
    expect(lockfile).not.toContain('@tanstack/query-core');
    expect(lockfile).toContain('specifier: 19.2.8');
    expect(lockfile).toContain("'@babel/core@8.0.1':");
    expect(lockfile).not.toMatch(
      /(?:specifier|version|resolution):\s*(?:file|link|workspace):|\/home\/|[A-Z]:\\/,
    );
  });

  it('enables React Compiler through the plugin-react Rolldown preset', () => {
    const files = createSrijikaProjectFileMap();

    expect(files['vite.config.ts']).toContain(
      "import react, { reactCompilerPreset } from '@vitejs/plugin-react';",
    );
    expect(files['vite.config.ts']).toContain('babel({ presets: [reactCompilerPreset()] })');
  });

  it('adds a development-only live Connector runtime bridge', () => {
    const files = createSrijikaProjectFileMap();

    expect(files['vite.config.ts']).toContain("apply: 'serve'");
    expect(files['vite.config.ts']).toContain(
      "import projectConfig from './srijika.config.json' with { type: 'json' }",
    );
    expect(files['vite.config.ts']).toContain('relativePath.endsWith(architecture.uiSuffix)');
    expect(files['vite.config.ts']).toContain('relativePath !== architecture.entrySource');
    expect(files['vite.config.ts']).toContain('architecture.sourceRoots.some');
    expect(files['vite.config.ts']).toContain('data-srijika-source');
    expect(files['src/main.tsx']).toContain("import './srijika/preview-bridge';");
    expect(files['src/srijika/preview-bridge.ts']).toContain('srijika:preview-select');
    expect(files['src/srijika/preview-bridge.ts']).toContain('srijika:preview-runtime-state');
    expect(files['src/srijika/preview-bridge.ts']).toContain('@srijika-config-driven-preview-v2');
    expect(files['src/srijika/preview-bridge.ts']).toContain(
      "import projectConfig from '../../srijika.config.json' with { type: 'json' }",
    );
    expect(files['src/srijika/preview-bridge.ts']).toContain('PREVIEW_ARCHITECTURE.uiSuffix');
    expect(files['src/srijika/preview-bridge.ts']).toContain(
      'value === PREVIEW_ARCHITECTURE.entrySource',
    );
    expect(files['src/srijika/preview-bridge.ts']).toContain(
      'PREVIEW_ARCHITECTURE.connectorSuffix',
    );
    expect(files['src/srijika/preview-bridge.ts']).toContain(
      'import(/* @vite-ignore */ connectorModuleUrl(uiSource))',
    );
    expect(files['src/srijika/preview-bridge.ts']).toContain('if (!import.meta.env.DEV');
  });

  it('keeps new projects aligned with the native legacy-project bridge upgrade', async () => {
    const files = createSrijikaProjectFileMap();
    const nativeBridge = await readFile(
      new URL('../../../crates/studio-core/assets/live-preview-bridge.ts', import.meta.url),
      'utf8',
    );

    const normalizeFormatting = (source: string): string => source.replace(/\s+/g, ' ').trim();
    expect(normalizeFormatting(files['src/srijika/preview-bridge.ts'] ?? '')).toBe(
      normalizeFormatting(nativeBridge),
    );
  });

  it('keeps the UI pure while its Connector owns hooks, interactions, and slots', () => {
    const files = createSrijikaProjectFileMap({ displayName: 'Acme Portal' });
    const uiSource = files['src/features/home/Home.ui.tsx'] ?? '';
    const connectorSource = files['src/features/home/Home.connector.tsx'] ?? '';
    const storeSource = files['src/features/home/home.store.ts'] ?? '';
    const hookSource = files['src/features/home/useHome.ts'] ?? '';
    const navigationUiSource = files['src/features/home/slots/navigation/Navigation.ui.tsx'] ?? '';
    const navigationConnectorSource =
      files['src/features/home/slots/navigation/Navigation.connector.tsx'] ?? '';

    expect(uiSource).toMatch(/export interface HomeUIProps/);
    expect(uiSource).toContain('onCreateSpark: () => void;');
    expect(uiSource).toContain('onClick={props.onCreateSpark}');
    expect(uiSource).toContain('navigationSlot: ReactNode;');
    expect(uiSource).not.toMatch(/\buse[A-Z]\w*\s*\(/);
    expect(uiSource).not.toContain('fetch(');
    expect(connectorSource).toContain("import { useHome } from './useHome';");
    expect(hookSource).toContain("import { useHomeStore } from './home.store';");
    expect(connectorSource).toContain('navigationSlot={<NavigationConnector />}');
    expect(storeSource).toContain("import { create } from 'zustand';");
    expect(storeSource).toContain('export const useHomeStore');
    expect(navigationUiSource).toContain('export function NavigationUI');
    expect(navigationUiSource).not.toMatch(/\buse[A-Z]\w*\s*\(/);
    expect(navigationConnectorSource).toContain("import { useHome } from '../../useHome';");
    expect(uiSource).toContain('<span>{"Acme Portal"}</span>');
  });

  it('emits syntactically valid TypeScript and TSX source files', () => {
    const files = createSrijikaProjectFileMap();
    const sourceEntries = Object.entries(files).filter(
      ([path]) => /\.tsx?$/.test(path) && !path.endsWith('.d.ts'),
    );

    expect(sourceEntries.length).toBeGreaterThan(0);
    for (const [path, source] of sourceEntries) {
      const result = ts.transpileModule(source, {
        fileName: path,
        reportDiagnostics: true,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      const syntaxDiagnostics = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );
      expect(syntaxDiagnostics, `Syntax diagnostics in ${path}`).toEqual([]);
    }
  });

  it('declares component discovery rules and external-editor policy', () => {
    const files = createSrijikaProjectFileMap({
      projectName: 'srijika-dashboard',
      displayName: 'Srijika Dashboard',
    });
    const config = JSON.parse(files['srijika.config.json'] ?? '{}') as Record<string, unknown>;

    expect(config).toMatchObject({
      sourceOfTruth: 'tsx',
      entry: 'src/features/home/Home.ui.tsx',
      architecture: {
        profile: 'feature-slot-part-v1',
        featuresRoot: 'src/features',
        sharedRoot: 'src/shared',
        slotsDirectory: 'slots',
        partsDirectory: 'parts',
        hooksDirectory: 'hooks',
        storesDirectory: 'stores',
      },
      project: {
        name: 'srijika-dashboard',
        displayName: 'Srijika Dashboard',
        profile: 'react-web-v1',
      },
      ui: {
        include: ['src/**/*.ui.tsx'],
        exclude: ['src/**/*.test.*', 'src/**/*.spec.*'],
        connectorSuffix: '.connector.tsx',
        sourceExtension: '.ui.tsx',
      },
      preview: { styles: ['src/styles.css'] },
      editor: { manualCodeEditing: 'external', preferredEditor: 'vscode' },
      react: { compiler: true },
      toolchain: 'srijika.toolchain.json',
    });
    expect(files['.vscode/extensions.json']).toContain('srijika.srijika-language-support');
    expect(files['.vscode/settings.json']).not.toContain('typescript.tsdk');
    expect(files['.vscode/settings.json']).toContain('typescript.validate.enable');
    expect(files['.vscode/settings.json']).toContain('editor.quickSuggestions');
    expect(files['README.md']).toContain('## VS Code setup');
  });

  it('escapes user-facing metadata in generated code and HTML', () => {
    const files = createSrijikaProjectFileMap({ displayName: 'A&B </script> "Portal"' });

    expect(files['src/features/home/Home.ui.tsx']).toContain(
      '<span>{"A&B </script> \\"Portal\\""}</span>',
    );
    expect(files['index.html']).toContain(
      '<title>A&amp;B &lt;/script&gt; &quot;Portal&quot;</title>',
    );
  });

  it('rejects invalid project metadata', () => {
    expect(() => createSrijikaProjectFileMap({ projectName: 'Invalid Name' })).toThrow(
      /projectName/,
    );
    expect(() => createSrijikaProjectFileMap({ vscodeExtensionId: 'missing-publisher' })).toThrow(
      /vscodeExtensionId/,
    );
    expect(() => createSrijikaProjectFileMap({ reactQuery: 'yes' as unknown as boolean })).toThrow(
      /reactQuery/,
    );
  });
});

describe('createSrijikaUiSourcePair', () => {
  it.each([
    ['page', 'PricingPage', '<main className="srijika-page">', 'title="PricingPage"'],
    ['component', 'UserCard', '<section className="srijika-component">', 'label="UserCard"'],
  ] as const)(
    'creates a deterministic, syntactically valid %s UI and connector pair',
    (kind, componentName, uiMarker, connectorMarker) => {
      const pair = createSrijikaUiSourcePair({ kind, componentName });

      expect(pair).toEqual(createSrijikaUiSourcePair({ kind, componentName }));
      expect(Object.isFrozen(pair)).toBe(true);
      expect(pair.uiFileName).toBe(`${componentName}.ui.tsx`);
      expect(pair.connectorFileName).toBe(`${componentName}.connector.tsx`);
      expect(pair.uiSource).toContain(uiMarker);
      expect(pair.uiSource).not.toMatch(/\buse[A-Z]\w*\s*\(/);
      expect(pair.connectorSource).toContain(connectorMarker);

      for (const [fileName, source] of [
        [pair.uiFileName, pair.uiSource],
        [pair.connectorFileName, pair.connectorSource],
      ] as const) {
        const result = ts.transpileModule(source, {
          fileName,
          reportDiagnostics: true,
          compilerOptions: {
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        });
        expect(
          (result.diagnostics ?? []).filter(
            (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
          ),
          `Syntax diagnostics in ${fileName}`,
        ).toEqual([]);
      }
    },
  );

  it.each(['userCard', 'User-Card', '1Card', '', 'A'.repeat(65)])(
    'rejects an invalid component name: %s',
    (componentName) => {
      expect(() => createSrijikaUiSourcePair({ kind: 'component', componentName })).toThrow(
        /componentName/,
      );
    },
  );
});

describe('writeSrijikaProject', () => {
  it('writes every generated file to a new explicit target', async () => {
    const parent = await createTemporaryDirectory();
    const target = join(parent, 'generated-app');
    const result = await writeSrijikaProject(target, {
      projectName: 'generated-app',
      displayName: 'Generated App',
    });

    expect(result.absoluteTarget).toBe(target);
    expect(result.files).toContain('src/features/home/Home.ui.tsx');
    expect(result.files).toContain('src/shared/.gitkeep');
    expect(result.files).toContain('pnpm-lock.yaml');
    await expect(readFile(join(target, 'src/shared/.gitkeep'), 'utf8')).resolves.toBe('');
    await expect(readFile(join(target, 'srijika.config.json'), 'utf8')).resolves.toContain(
      '"sourceOfTruth": "tsx"',
    );
    await expect(readFile(join(target, 'pnpm-lock.yaml'), 'utf8')).resolves.toMatch(
      /^lockfileVersion: '9\.0'/,
    );
  });

  it('refuses relative, root, and non-empty targets without overwriting user files', async () => {
    await expect(writeSrijikaProject('relative-project')).rejects.toThrow(/absolute path/);
    await expect(writeSrijikaProject(parse(tmpdir()).root)).rejects.toThrow(/filesystem root/);

    const target = await createTemporaryDirectory();
    const existingPath = join(target, 'existing.txt');
    await writeFile(existingPath, 'owned by the user', 'utf8');
    await expect(writeSrijikaProject(target)).rejects.toThrow(/must be empty/);
    await expect(readFile(existingPath, 'utf8')).resolves.toBe('owned by the user');
  });
});
