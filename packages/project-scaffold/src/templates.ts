import { createSrijikaArchitectureValidatorScript } from '@srijika/architecture-rules/portable';

import type {
  SrijikaProjectFileMap,
  SrijikaProjectScaffoldOptions,
  SrijikaUiSourcePair,
  SrijikaUiSourcePairOptions,
} from './types.js';
import { GENERATED_PNPM_LOCKFILE } from './generated-pnpm-lockfile.js';

const DEFAULT_PROJECT_NAME = 'srijika-app';
const DEFAULT_DISPLAY_NAME = 'Srijika App';
const DEFAULT_VSCODE_EXTENSION_ID = 'srijika.srijika-language-support';

const PACKAGE_MANAGER = 'pnpm@11.18.0';
const NODE_ENGINE = '>=22.18.0';
const TOOLCHAIN_PROFILE = 'react-web-v1';
const TOOLCHAIN_VERSION = '1';

const SRIJIKA_ARCHITECTURE = Object.freeze({
  profile: 'feature-slot-part-v1' as const,
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

const versions = Object.freeze({
  babelCore: '8.0.1',
  babelCoreTypes: '7.20.5',
  pluginBabel: '0.2.3',
  pluginReact: '6.0.5',
  react: '19.2.8',
  reactCompiler: '1.0.0',
  reactDomTypes: '19.2.4',
  reactTypes: '19.2.18',
  tanstackReactQuery: '5.101.4',
  typescript: '6.0.3',
  vite: '8.2.0',
  zustand: '5.0.14',
});

const NPM_PACKAGE_NAME_PATTERN = /^(?![._-])[a-z0-9][a-z0-9._-]*$/;
const VSCODE_EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
const PASCAL_CASE_COMPONENT_PATTERN = /^[A-Z][A-Za-z0-9]{0,63}$/;

const sourceFile = (source: string): string => `${source.trim()}\n`;

const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const requireText = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }

  return trimmed;
};

/**
 * Produces the canonical pure UI + Connector pair used by both Studio creation
 * flows and generated projects. It never accepts caller-provided source text.
 */
export const createSrijikaUiSourcePair = (
  options: SrijikaUiSourcePairOptions,
): SrijikaUiSourcePair => {
  const componentName = requireText(options.componentName, 'componentName');
  if (!PASCAL_CASE_COMPONENT_PATTERN.test(componentName)) {
    throw new TypeError(
      'componentName must be a PascalCase TypeScript identifier with at most 64 characters.',
    );
  }

  const page = options.kind === 'page';
  if (!page && options.kind !== 'component') {
    throw new TypeError('kind must be either "page" or "component".');
  }

  const uiSource = page
    ? sourceFile(`
export interface ${componentName}UIProps {
  title: string;
  description: string;
}

export function ${componentName}UI(props: ${componentName}UIProps) {
  return (
    <main className="srijika-page">
      <section>
        <p>New Srijika page</p>
        <h1>{props.title}</h1>
        <p>{props.description}</p>
      </section>
    </main>
  );
}
`)
    : sourceFile(`
export interface ${componentName}UIProps {
  label: string;
  supportingText: string;
}

export function ${componentName}UI(props: ${componentName}UIProps) {
  return (
    <section className="srijika-component">
      <h2>{props.label}</h2>
      <p>{props.supportingText}</p>
    </section>
  );
}
`);

  const connectorSource = page
    ? sourceFile(`
import { ${componentName}UI } from './${componentName}.ui';

export function ${componentName}Connector() {
  return (
    <${componentName}UI
      title="${componentName}"
      description="Start building this page in ${componentName}.ui.tsx."
    />
  );
}
`)
    : sourceFile(`
import { ${componentName}UI } from './${componentName}.ui';

export function ${componentName}Connector() {
  return (
    <${componentName}UI
      label="${componentName}"
      supportingText="Connect data and behavior in ${componentName}.connector.tsx."
    />
  );
}
`);

  return Object.freeze({
    kind: options.kind,
    componentName,
    uiFileName: `${componentName}.ui.tsx`,
    connectorFileName: `${componentName}.connector.tsx`,
    uiSource,
    connectorSource,
  });
};

const resolveOptions = (
  options: SrijikaProjectScaffoldOptions,
): Required<SrijikaProjectScaffoldOptions> => {
  const projectName = requireText(options.projectName ?? DEFAULT_PROJECT_NAME, 'projectName');
  if (!NPM_PACKAGE_NAME_PATTERN.test(projectName)) {
    throw new TypeError(
      'projectName must be a lowercase, unscoped npm package name using letters, numbers, dots, hyphens, or underscores.',
    );
  }

  const displayName = requireText(options.displayName ?? DEFAULT_DISPLAY_NAME, 'displayName');
  const vscodeExtensionId = requireText(
    options.vscodeExtensionId ?? DEFAULT_VSCODE_EXTENSION_ID,
    'vscodeExtensionId',
  );
  if (!VSCODE_EXTENSION_ID_PATTERN.test(vscodeExtensionId)) {
    throw new TypeError('vscodeExtensionId must use the "publisher.extension" format.');
  }

  return { projectName, displayName, vscodeExtensionId };
};

/**
 * Produces the canonical starter project without touching the filesystem.
 * Paths always use forward slashes so callers receive the same result on every OS.
 */
export const createSrijikaProjectFileMap = (
  options: SrijikaProjectScaffoldOptions = {},
): SrijikaProjectFileMap => {
  const { displayName, projectName, vscodeExtensionId } = resolveOptions(options);
  const displayNameExpression = JSON.stringify(displayName);

  const files: Record<string, string> = {
    '.gitignore': sourceFile(`
node_modules
dist
.DS_Store
*.local
`),
    '.vscode/extensions.json': jsonFile({
      recommendations: [vscodeExtensionId],
    }),
    '.vscode/settings.json': jsonFile({
      'editor.codeActionsOnSave': {
        'source.fixAll.srijika': 'explicit',
      },
      'files.associations': {
        '*.ui.tsx': 'typescriptreact',
      },
      'typescript.validate.enable': true,
      'typescript.suggest.enabled': true,
      'typescript.suggest.completeFunctionCalls': true,
      'typescript.preferences.includePackageJsonAutoImports': 'on',
      'editor.suggestOnTriggerCharacters': true,
      'emmet.includeLanguages': {
        typescriptreact: 'html',
      },
      'emmet.showExpandedAbbreviation': 'always',
      '[typescriptreact]': {
        'editor.quickSuggestions': {
          other: true,
          comments: false,
          strings: true,
        },
        'editor.suggest.showSnippets': true,
        'editor.snippetSuggestions': 'top',
        'editor.suggestOnTriggerCharacters': true,
      },
    }),
    'README.md': sourceFile(`
# ${displayName}

This is a code-first Srijika project. The starter is intentionally a real one-page app,
not a throwaway placeholder: open it in Srijika Studio to inspect its UI tree, or open
the same folder in VS Code to edit its source.

## Source rules

- \`src/features/home/Home.ui.tsx\` is the typed visual source of truth.
- \`Home.connector.tsx\` composes named slots and calls the highest available owner capability.
- \`useHome.ts\` is the feature Hook gateway for React lifecycle, queries, cache, and Store access.
- \`home.store.ts\` owns shared Home client state; slot-private state stays inside
  that slot's folder and never leaks to a parent or sibling.
- Srijika Studio derives hierarchy, Inspector, and diagnostics from the UI source;
  generated IR is never a second persisted source. In an attached desktop project,
  Start App runs this real Vite application and UI Source selection renders the
  matching Connector in that runtime.
- React Compiler is enabled. Keep components pure and add manual memoization only
  after measuring a real need.
- Srijika allows at most 200 meaningful lines in one UI function, 300 meaningful
  lines in one UI source file, and 16 top-level props/events/slots in its contract.
  Blank lines and comments do not count; the VS Code extension reports the same
  compiler diagnostics as Studio.

## Create more UI

- Open **Structure** in Srijika Studio to see the Feature → Slot → Part ownership
  model and its allowed import directions.
- Select a feature to add an optional Connector, Store, Hook, or named Slot.
- Select a slot to add its optional Connector, Store, Hook, or private Part.
- Srijika creates canonical typed files without overwriting existing source, then
  refreshes the project tree. Manual coding remains in VS Code and Studio watches
  the same project folder for changes.
- Move deliberately cross-feature code to \`src/shared\`; never import a slot's
  private store, hook, or part from its parent, sibling, or another feature.

## VS Code setup

1. Open this project **folder** in VS Code, not only one loose \`.ui.tsx\` file.
2. Run \`pnpm install --frozen-lockfile\` once so React and \`@types/react\`
   IntelliSense are available. VS Code's built-in TypeScript/TSX engine remains the
   language engine; Srijika only layers its additional contract rules on top.
3. Accept the workspace recommendation for **Srijika Language Support**. During local
   Srijika Studio development, install it from the Studio repository with
   \`pnpm --filter srijika-language-support install:local\`, then reload VS Code.
4. Type \`<\` for supported HTML elements. Inside an opening tag, type a space or press
   \`Ctrl+Space\` to see React/Srijika JSX props and event-to-\`props\` bindings. Emmet
   is enabled for TSX, while normal CSS files use VS Code's built-in CSS suggestions.
   Srijika diagnostics and safe Quick Fixes appear in the normal Problems panel.

## Commands

Browser demos and detached source inspection do not require a local install. The
desktop center preview deliberately runs this independent React application through
the pinned toolchain:

\`pnpm install --frozen-lockfile\`
\`pnpm dev\`

\`pnpm typecheck\` checks TypeScript and \`pnpm build\` creates a production build.
`),
    'index.html': sourceFile(`
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      name="description"
      content="A code-first React experience created with Srijika Studio."
    />
    <meta name="theme-color" content="#070b17" />
    <title>${escapeHtml(displayName)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`),
    'package.json': jsonFile({
      name: projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      packageManager: PACKAGE_MANAGER,
      engines: {
        node: NODE_ENGINE,
      },
      scripts: {
        dev: 'vite',
        'validate:srijika': 'node scripts/srijika-validate.mjs',
        build: 'pnpm run validate:srijika && tsc -p tsconfig.json && vite build',
        preview: 'vite preview',
        typecheck: 'pnpm run validate:srijika && tsc -p tsconfig.json',
      },
      dependencies: {
        '@tanstack/react-query': versions.tanstackReactQuery,
        react: versions.react,
        'react-dom': versions.react,
        zustand: versions.zustand,
      },
      devDependencies: {
        '@babel/core': versions.babelCore,
        '@rolldown/plugin-babel': versions.pluginBabel,
        '@types/babel__core': versions.babelCoreTypes,
        '@types/react': versions.reactTypes,
        '@types/react-dom': versions.reactDomTypes,
        '@vitejs/plugin-react': versions.pluginReact,
        'babel-plugin-react-compiler': versions.reactCompiler,
        typescript: versions.typescript,
        vite: versions.vite,
      },
      srijika: {
        sourceOfTruth: 'tsx',
        config: 'srijika.config.json',
        toolchain: 'srijika.toolchain.json',
      },
    }),
    'pnpm-lock.yaml': GENERATED_PNPM_LOCKFILE,
    // pnpm 11 reads installation settings from pnpm-workspace.yaml. Hoisted
    // packages are real directories rather than a top-level symlink graph,
    // which keeps React types visible to VS Code across Windows/WSL mounts.
    'pnpm-workspace.yaml': sourceFile(`
nodeLinker: hoisted
`),
    'public/srijika-mark.svg': sourceFile(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" role="img" aria-label="Srijika mark">
  <defs>
    <linearGradient id="orbit" x1="8" y1="64" x2="64" y2="8" gradientUnits="userSpaceOnUse">
      <stop stop-color="#6EE7F9" />
      <stop offset="0.48" stop-color="#8B5CF6" />
      <stop offset="1" stop-color="#F472B6" />
    </linearGradient>
  </defs>
  <rect width="72" height="72" rx="20" fill="#11182D" />
  <path d="M20 25.5c0-7 5.7-12.5 12.7-12.5H51L42.5 22H32.7a3.5 3.5 0 0 0 0 7h6.6a12.5 12.5 0 1 1 0 25H21l8.5-9h9.8a3.5 3.5 0 1 0 0-7h-6.6C25.7 38 20 32.5 20 25.5Z" fill="url(#orbit)" />
</svg>
`),
    'src/App.tsx': sourceFile(`
import { HomeConnector } from './features/home/Home.connector';

export function App() {
  return <HomeConnector />;
}
`),
    'src/app/AppProviders.tsx': sourceFile(`
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { queryClient } from './query-client';

export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
`),
    'src/app/query-client.ts': sourceFile(`
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
`),
    'src/features/home/Home.connector.tsx': sourceFile(`
import { HomeUI } from './Home.ui';
import { NavigationConnector } from './slots/navigation/Navigation.connector';
import { useHome } from './useHome';

export function HomeConnector() {
  const home = useHome();

  return (
    <HomeUI
      pageClassName={home.isNightMode ? 'srijika-home srijika-home--night' : 'srijika-home'}
      sparkLabel={home.sparkCount === 1 ? '1 source update' : \`${'${home.sparkCount}'} source updates\`}
      themeLabel={home.isNightMode ? 'Switch to daylight' : 'Switch to night'}
      isReady={true}
      isGuideOpen={home.isGuideOpen}
      onCreateSpark={home.createSpark}
      onToggleTheme={home.toggleTheme}
      onToggleGuide={home.toggleGuide}
      navigationSlot={<NavigationConnector />}
    />
  );
}
`),
    'src/features/home/home.store.ts': sourceFile(`
import { create } from 'zustand';

interface HomeState {
  isNightMode: boolean;
  sparkCount: number;
  isGuideOpen: boolean;
  createSpark: () => void;
  toggleTheme: () => void;
  openGuide: () => void;
  toggleGuide: () => void;
}

export const useHomeStore = create<HomeState>()((set) => ({
  isNightMode: true,
  sparkCount: 1,
  isGuideOpen: false,
  createSpark: () => set((state) => ({ sparkCount: state.sparkCount + 1 })),
  toggleTheme: () => set((state) => ({ isNightMode: !state.isNightMode })),
  openGuide: () => set({ isGuideOpen: true }),
  toggleGuide: () => set((state) => ({ isGuideOpen: !state.isGuideOpen })),
}));
`),
    'src/features/home/useHome.ts': sourceFile(`
import { useHomeStore } from './home.store';

export function useHome() {
  const isNightMode = useHomeStore((state) => state.isNightMode);
  const sparkCount = useHomeStore((state) => state.sparkCount);
  const isGuideOpen = useHomeStore((state) => state.isGuideOpen);
  const createSpark = useHomeStore((state) => state.createSpark);
  const toggleTheme = useHomeStore((state) => state.toggleTheme);
  const openGuide = useHomeStore((state) => state.openGuide);
  const toggleGuide = useHomeStore((state) => state.toggleGuide);

  return {
    isNightMode,
    sparkCount,
    isGuideOpen,
    createSpark,
    toggleTheme,
    openGuide,
    toggleGuide,
  };
}
`),
    'src/features/home/slots/navigation/Navigation.ui.tsx': sourceFile(`
export interface NavigationUIProps {
  onOpenWorkflow: () => void;
  onOpenPlayground: () => void;
  onOpenGuide: () => void;
}

export function NavigationUI(props: NavigationUIProps) {
  return (
    <div className="starter-nav">
      <button type="button" onClick={props.onOpenWorkflow}>Workflow</button>
      <button type="button" onClick={props.onOpenPlayground}>Playground</button>
      <button type="button" onClick={props.onOpenGuide}>Quick guide</button>
    </div>
  );
}
`),
    'src/features/home/slots/navigation/Navigation.connector.tsx': sourceFile(`
import { useHome } from '../../useHome';
import { NavigationUI } from './Navigation.ui';

function revealSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

export function NavigationConnector() {
  const { openGuide } = useHome();

  return (
    <NavigationUI
      onOpenWorkflow={() => revealSection('workflow')}
      onOpenPlayground={() => revealSection('playground')}
      onOpenGuide={openGuide}
    />
  );
}
`),
    'src/features/home/Home.ui.tsx': sourceFile(`
import type { ReactNode } from 'react';

export interface HomeUIProps {
  pageClassName: string;
  sparkLabel: string;
  themeLabel: string;
  isReady: boolean;
  isGuideOpen: boolean;
  onCreateSpark: () => void;
  onToggleTheme: () => void;
  onToggleGuide: () => void;
  navigationSlot: ReactNode;
}

export function HomeUI(props: HomeUIProps) {
  return (
    <main className={props.pageClassName}>
      <header className="site-header">
        <div className="brand-lockup">
          <img className="brand-mark" src="/srijika-mark.svg" alt="Srijika Studio" loading="eager" />
          <span>{${displayNameExpression}}</span>
        </div>
        <nav className="site-header__nav" aria-label="Primary navigation">
          {props.navigationSlot}
        </nav>
      </header>

      <section className="hero" aria-label="Srijika starter introduction">
        <div className="hero__copy">
          <p className="eyebrow">CODE FIRST · VISUALLY CONNECTED</p>
          <h1>Build React interfaces with a clear thread from code to canvas.</h1>
          <p className="hero__description">
            Your TSX stays authoritative while Srijika Studio turns it into a navigable UI tree, live preview, and inspectable contract.
          </p>
          {props.isReady && (
            <div className="ready-status">
              <span className="ready-status__dot" aria-hidden="true" />
              <span>Srijika compiler ready</span>
            </div>
          )}
          <div className="hero__actions">
            <button className="button button--primary" type="button" onClick={props.onCreateSpark}>
              Create a source spark
            </button>
            <button className="button button--quiet" type="button" onClick={props.onToggleTheme}>
              {props.themeLabel}
            </button>
          </div>
          <p className="source-counter">{props.sparkLabel}</p>
        </div>
        <div className="hero__visual">
          <div className="studio-window" aria-label="Interactive Srijika Studio preview">
            <div className="studio-window__bar">
              <span />
              <span />
              <span />
              <p>Home.ui.tsx</p>
            </div>
            <div className="studio-window__body">
              <div className="studio-tree" aria-label="UI node illustration">
                <p>UI NODES</p>
                <span>⌄ Home</span>
                <span className="studio-tree__child">⌄ Hero</span>
                <span className="studio-tree__leaf">Headline</span>
                <span className="studio-tree__leaf">Actions</span>
                <span className="studio-tree__child">Playground</span>
              </div>
              <div className="studio-canvas">
                <div className="studio-canvas__glow" />
                <div className="studio-canvas__card">
                  <span className="studio-canvas__badge">LIVE SOURCE</span>
                  <h2>One file. Every view.</h2>
                  <p>{props.sparkLabel} compiled safely.</p>
                </div>
                {props.isGuideOpen ? (
                  <div className="studio-tip" role="status">
                    Edit Home.ui.tsx in VS Code. Srijika keeps the hierarchy and preview in sync.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="workflow" className="workflow" aria-label="Code-first workflow">
        <div className="section-heading">
          <p className="eyebrow">ONE SOURCE · THREE CLEAR VIEWS</p>
          <h2>Keep the code you trust. Gain the visual context you need.</h2>
        </div>
        <div className="workflow-grid">
          <section className="workflow-card">
            <span className="workflow-card__number">01</span>
            <h3>Write in VS Code</h3>
            <p>Author pure, typed UI in Home.ui.tsx and keep React behavior behind useHome.ts.</p>
          </section>
          <section className="workflow-card workflow-card--featured">
            <span className="workflow-card__number">02</span>
            <h3>See the thread</h3>
            <p>Srijika derives hierarchy, props, slots, diagnostics, and preview from that same file.</p>
          </section>
          <section className="workflow-card">
            <span className="workflow-card__number">03</span>
            <h3>Ship normal React</h3>
            <p>Run an independent Vite application with React Compiler already configured.</p>
          </section>
        </div>
      </section>

      <section id="playground" className="playground" aria-label="Starter playground">
        <div>
          <p className="eyebrow">YOUR FIRST LIVE COMPONENT</p>
          <h2>The starter is already interactive.</h2>
          <p>Use these controls, then inspect how Connector → Hook → Store keeps the visual contract pure.</p>
        </div>
        <div className="playground__actions">
          <button className="button button--primary" type="button" onClick={props.onToggleGuide}>
            {props.isGuideOpen ? 'Hide the guide' : 'Show the guide'}
          </button>
          <button className="button button--quiet" type="button" onClick={props.onCreateSpark}>
            Compile another update
          </button>
        </div>
      </section>

      <footer className="site-footer">
        <div className="brand-lockup brand-lockup--small">
          <img className="brand-mark" src="/srijika-mark.svg" alt="" />
          <span>{${displayNameExpression}}</span>
        </div>
        <p>TSX is the source. Srijika keeps the thread visible.</p>
      </footer>
    </main>
  );
}
`),
    'src/main.tsx': sourceFile(`
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AppProviders } from './app/AppProviders';
import './srijika/preview-bridge';
import './styles.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('The root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
`),
    'src/srijika/preview-bridge.ts': sourceFile(`
// @generated by Srijika Studio. The desktop runtime may replace this infrastructure file.
import { createElement, StrictMode, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const LIVE_PREVIEW_VERSION = 1;
const SELECT_MESSAGE = 'srijika:preview-select';
const SELECTED_MESSAGE = 'srijika:preview-selected-source';
const RUNTIME_STATE_MESSAGE = 'srijika:preview-runtime-state';
const HIT_TEST_MESSAGE = 'srijika:preview-hit-test';
const DROP_TARGET_MESSAGE = 'srijika:preview-drop-target';
const SOURCE_ATTRIBUTE = 'data-srijika-source';
const UI_SOURCE_PATTERN = /^src\\/[A-Za-z0-9_./ -]+\\.ui\\.tsx$/;
const SOURCE_LOCATION_PATTERN = /^(src\\/[A-Za-z0-9_./ -]+\\.ui\\.tsx):\\d+:\\d+$/;

type RuntimeState = 'loading' | 'ready' | 'error';
type RuntimeModule = Record<string, unknown>;

interface SelectedSourceMessage {
  type: typeof SELECTED_MESSAGE;
  version: 1;
  source: string | null;
  uiSource?: string | null;
}

interface HitTestMessage {
  type: typeof HIT_TEST_MESSAGE;
  version: 1;
  x: number;
  y: number;
}

const connectorModules = import.meta.glob<RuntimeModule>('../**/*.connector.tsx');
const providerModules = import.meta.glob<RuntimeModule>('../**/AppProviders.{ts,tsx}');
let runtimeHost: HTMLDivElement | null = null;
let runtimeRoot: Root | null = null;
let activeUiSource: string | null = null;
let selectionGeneration = 0;

function isSelectedSourceMessage(value: unknown): value is SelectedSourceMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<SelectedSourceMessage>;
  return (
    message.type === SELECTED_MESSAGE &&
    message.version === LIVE_PREVIEW_VERSION &&
    (typeof message.source === 'string' || message.source === null) &&
    (message.uiSource === undefined ||
      typeof message.uiSource === 'string' ||
      message.uiSource === null)
  );
}

function isHitTestMessage(value: unknown): value is HitTestMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<HitTestMessage>;
  return (
    message.type === HIT_TEST_MESSAGE &&
    message.version === LIVE_PREVIEW_VERSION &&
    typeof message.x === 'number' &&
    Number.isFinite(message.x) &&
    typeof message.y === 'number' &&
    Number.isFinite(message.y)
  );
}

function selectedUiSource(message: SelectedSourceMessage): string | null {
  if (typeof message.uiSource === 'string' && UI_SOURCE_PATTERN.test(message.uiSource)) {
    return message.uiSource;
  }
  if (typeof message.source !== 'string') return null;
  return SOURCE_LOCATION_PATTERN.exec(message.source)?.[1] ?? null;
}

function publishRuntimeState(state: RuntimeState, uiSource: string, error?: string): void {
  window.parent.postMessage(
    {
      type: RUNTIME_STATE_MESSAGE,
      version: LIVE_PREVIEW_VERSION,
      state,
      uiSource,
      ...(error ? { error } : {}),
    },
    '*',
  );
}

function connectorModuleKey(uiSource: string): string {
  return '../' + uiSource.slice('src/'.length).replace(/\\.ui\\.tsx$/, '.connector.tsx');
}

function connectorExportName(uiSource: string): string {
  const fileName = uiSource.split('/').at(-1) ?? '';
  return fileName.replace(/\\.ui\\.tsx$/, '') + 'Connector';
}

function componentExport(module: RuntimeModule, preferredName: string): ComponentType | null {
  const preferred = module[preferredName];
  if (typeof preferred === 'function') return preferred as ComponentType;
  const fallback = Object.entries(module).find(
    ([name, value]) => name.endsWith('Connector') && typeof value === 'function',
  )?.[1];
  if (typeof fallback === 'function') return fallback as ComponentType;
  return typeof module['default'] === 'function' ? (module['default'] as ComponentType) : null;
}

async function providerComponent(): Promise<ComponentType<{ children: ReactNode }> | null> {
  const providerEntry =
    Object.entries(providerModules).find(([path]) => path.endsWith('/app/AppProviders.tsx')) ??
    Object.entries(providerModules)[0];
  if (!providerEntry) return null;
  const module = await providerEntry[1]();
  const provider = module['AppProviders'] ?? module['default'];
  return typeof provider === 'function'
    ? (provider as ComponentType<{ children: ReactNode }>)
    : null;
}

function ensureRuntimeRoot(uiSource: string): Root {
  if (runtimeRoot && runtimeHost) {
    runtimeHost.setAttribute('aria-label', 'Live runtime preview for ' + uiSource);
    return runtimeRoot;
  }
  runtimeHost = document.createElement('div');
  runtimeHost.id = 'srijika-live-runtime-preview';
  runtimeHost.dataset.srijikaLiveRuntimePreview = 'true';
  runtimeHost.setAttribute('aria-label', 'Live runtime preview for ' + uiSource);
  Object.assign(runtimeHost.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    overflow: 'auto',
    background: 'var(--srijika-preview-background, Canvas)',
  });
  document.body.append(runtimeHost);
  runtimeRoot = createRoot(runtimeHost);
  return runtimeRoot;
}

function removeRuntimeRoot(): void {
  runtimeRoot?.unmount();
  runtimeRoot = null;
  runtimeHost?.remove();
  runtimeHost = null;
}

function runtimeErrorView(uiSource: string, message: string) {
  return createElement(
    'main',
    {
      role: 'alert',
      style: {
        minHeight: '100vh',
        padding: '32px',
        color: '#fecaca',
        background: '#190f16',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      },
    },
    createElement('p', null, 'Srijika live runtime error'),
    createElement('h1', null, 'Could not render ' + uiSource),
    createElement('pre', { style: { whiteSpace: 'pre-wrap' } }, message),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function renderSelectedConnector(uiSource: string): Promise<void> {
  const generation = ++selectionGeneration;
  if (activeUiSource === uiSource && runtimeRoot) {
    publishRuntimeState('ready', uiSource);
    return;
  }
  activeUiSource = uiSource;
  publishRuntimeState('loading', uiSource);
  const root = ensureRuntimeRoot(uiSource);
  try {
    const key = connectorModuleKey(uiSource);
    const loader = connectorModules[key];
    if (!loader) {
      throw new Error('Required Connector module was not found at ' + key.slice(3) + '.');
    }
    const [module, Provider] = await Promise.all([loader(), providerComponent()]);
    if (generation !== selectionGeneration || activeUiSource !== uiSource) return;
    const Connector = componentExport(module, connectorExportName(uiSource));
    if (!Connector) {
      throw new Error('The matching module does not export ' + connectorExportName(uiSource) + '.');
    }
    const connector = createElement(Connector);
    root.render(
      createElement(
        StrictMode,
        null,
        Provider ? createElement(Provider, null, connector) : connector,
      ),
    );
    publishRuntimeState('ready', uiSource);
  } catch (error) {
    if (generation !== selectionGeneration || activeUiSource !== uiSource) return;
    const message = errorMessage(error);
    root.render(runtimeErrorView(uiSource, message));
    publishRuntimeState('error', uiSource, message);
  }
}

function updateSelectionHighlight(source: string | null): void {
  for (const element of document.querySelectorAll<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']')) {
    if (source !== null && element.getAttribute(SOURCE_ATTRIBUTE) === source) {
      element.dataset.srijikaStudioSelected = 'true';
    } else {
      delete element.dataset.srijikaStudioSelected;
    }
  }
}

function installPreviewSelectionBridge(): void {
  if (!import.meta.env.DEV || window.parent === window) return;

  const style = document.createElement('style');
  style.textContent =
    '[' +
    SOURCE_ATTRIBUTE +
    "][data-srijika-studio-selected='true'] {\\n" +
    '  outline: 2px solid #7c83ff !important;\\n' +
    '  outline-offset: 2px !important;\\n' +
    '}';
  document.head.append(style);

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target.closest<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']');
      const source = element?.getAttribute(SOURCE_ATTRIBUTE);
      if (!source) return;
      window.parent.postMessage(
        { type: SELECT_MESSAGE, version: LIVE_PREVIEW_VERSION, source },
        '*',
      );
    },
    true,
  );

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (isHitTestMessage(event.data)) {
      const element = document
        .elementFromPoint(event.data.x, event.data.y)
        ?.closest<HTMLElement>('[' + SOURCE_ATTRIBUTE + ']');
      window.parent.postMessage(
        {
          type: DROP_TARGET_MESSAGE,
          version: LIVE_PREVIEW_VERSION,
          source: element?.getAttribute(SOURCE_ATTRIBUTE) ?? null,
        },
        '*',
      );
      return;
    }
    if (!isSelectedSourceMessage(event.data)) return;
    updateSelectionHighlight(event.data.source);
    const uiSource = selectedUiSource(event.data);
    if (uiSource) {
      void renderSelectedConnector(uiSource);
    } else {
      selectionGeneration += 1;
      activeUiSource = null;
      removeRuntimeRoot();
    }
  });

  window.addEventListener('error', (event) => {
    if (activeUiSource) publishRuntimeState('error', activeUiSource, event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (activeUiSource) {
      publishRuntimeState('error', activeUiSource, errorMessage(event.reason));
    }
  });
}

installPreviewSelectionBridge();
`),
    'scripts/srijika-validate.mjs': createSrijikaArchitectureValidatorScript(SRIJIKA_ARCHITECTURE),
    'src/styles.css': sourceFile(`
:root {
  color: #10152a;
  background: #eef2ff;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  min-width: 320px;
  margin: 0;
}

button,
a {
  font: inherit;
}

.srijika-container {
  width: 100%;
}

.srijika-flex-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.srijika-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  gap: 1rem;
}

button:focus-visible,
a:focus-visible {
  outline: 3px solid #67e8f9;
  outline-offset: 3px;
}

.srijika-home {
  --background: #f7f8ff;
  --surface: rgba(255, 255, 255, 0.82);
  --surface-solid: #ffffff;
  --border: rgba(48, 61, 117, 0.14);
  --text: #11162b;
  --muted: #5a627e;
  --accent: #6d4aff;
  --accent-soft: rgba(109, 74, 255, 0.12);
  min-height: 100vh;
  overflow: hidden;
  color: var(--text);
  background:
    radial-gradient(circle at 12% 4%, rgba(92, 225, 230, 0.2), transparent 28rem),
    radial-gradient(circle at 88% 12%, rgba(139, 92, 246, 0.18), transparent 30rem),
    var(--background);
  transition: color 220ms ease, background-color 220ms ease;
}

.srijika-home--night {
  --background: #070b17;
  --surface: rgba(17, 24, 45, 0.78);
  --surface-solid: #11182d;
  --border: rgba(167, 180, 230, 0.16);
  --text: #f7f8ff;
  --muted: #aab3d1;
  --accent: #8b7cff;
  --accent-soft: rgba(139, 124, 255, 0.16);
}

.site-header,
.hero,
.workflow,
.playground,
.site-footer {
  width: min(1180px, calc(100% - 40px));
  margin-inline: auto;
}

.site-header {
  min-height: 88px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  border-bottom: 1px solid var(--border);
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text);
  font-weight: 760;
  letter-spacing: -0.02em;
}

.brand-mark {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  box-shadow: 0 12px 38px rgba(86, 66, 210, 0.3);
}

.starter-nav {
  display: flex;
  align-items: center;
  gap: 24px;
}

.starter-nav a,
.starter-nav button {
  padding: 8px 0;
  color: var(--muted);
  background: transparent;
  border: 0;
  text-decoration: none;
  cursor: pointer;
}

.starter-nav a:hover,
.starter-nav button:hover {
  color: var(--text);
}

.hero {
  min-height: 660px;
  display: grid;
  grid-template-columns: minmax(0, 0.86fr) minmax(520px, 1.14fr);
  align-items: center;
  gap: clamp(44px, 7vw, 92px);
  padding-block: 72px 92px;
}

.hero__copy h1 {
  max-width: 760px;
  margin: 18px 0 24px;
  font-size: clamp(3rem, 5.5vw, 5.4rem);
  line-height: 0.98;
  letter-spacing: -0.065em;
  background: linear-gradient(125deg, var(--text) 18%, #8b7cff 64%, #f472b6 110%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
}

.eyebrow {
  margin: 0;
  color: #6ee7f9;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.17em;
}

.hero__description,
.playground > div > p:last-child {
  max-width: 660px;
  margin: 0;
  color: var(--muted);
  font-size: clamp(1rem, 1.5vw, 1.18rem);
  line-height: 1.75;
}

.ready-status {
  width: fit-content;
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 28px;
  padding: 9px 13px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.8rem;
  box-shadow: 0 16px 50px rgba(1, 5, 18, 0.08);
}

.ready-status__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 0 5px rgba(52, 211, 153, 0.14);
}

.hero__actions,
.playground__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 30px;
}

.button {
  min-height: 48px;
  padding: 0 20px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  font-weight: 720;
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.button:hover {
  transform: translateY(-2px);
  border-color: rgba(139, 124, 255, 0.62);
  box-shadow: 0 14px 34px rgba(73, 54, 181, 0.16);
}

.button--primary {
  color: white;
  background: linear-gradient(135deg, #6d4aff, #9f67ff 58%, #dc5ca6);
  border-color: transparent;
  box-shadow: 0 14px 38px rgba(109, 74, 255, 0.32);
}

.button--quiet {
  backdrop-filter: blur(12px);
}

.source-counter {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
}

.studio-window {
  overflow: hidden;
  color: #eef2ff;
  background: rgba(7, 11, 23, 0.94);
  border: 1px solid rgba(168, 180, 231, 0.2);
  border-radius: 24px;
  box-shadow: 0 48px 120px rgba(3, 7, 22, 0.44);
  transform: perspective(1200px) rotateY(-4deg) rotateX(2deg);
}

.studio-window__bar {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 16px;
  background: #11182d;
  border-bottom: 1px solid rgba(168, 180, 231, 0.12);
}

.studio-window__bar span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #f472b6;
}

.studio-window__bar span:nth-child(2) {
  background: #fbbf24;
}

.studio-window__bar span:nth-child(3) {
  background: #34d399;
}

.studio-window__bar p {
  margin: 0 0 0 8px;
  color: #8993b5;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.73rem;
}

.studio-window__body {
  min-height: 380px;
  display: grid;
  grid-template-columns: 148px 1fr;
}

.studio-tree {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 22px 16px;
  color: #aab3d1;
  background: #0c1223;
  border-right: 1px solid rgba(168, 180, 231, 0.1);
  font-size: 0.72rem;
}

.studio-tree p {
  margin: 0 0 8px;
  color: #687495;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.studio-tree__child {
  padding-left: 13px;
}

.studio-tree__leaf {
  padding-left: 28px;
  color: #7e88a8;
}

.studio-canvas {
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 42px 28px;
  background:
    linear-gradient(rgba(139, 124, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(139, 124, 255, 0.04) 1px, transparent 1px),
    #090e1d;
  background-size: 24px 24px;
}

.studio-canvas__glow {
  position: absolute;
  width: 260px;
  height: 260px;
  border-radius: 50%;
  background: rgba(109, 74, 255, 0.24);
  filter: blur(70px);
}

.studio-canvas__card {
  position: relative;
  width: min(100%, 310px);
  padding: 30px;
  background: linear-gradient(145deg, rgba(25, 34, 64, 0.94), rgba(15, 21, 41, 0.98));
  border: 1px solid rgba(139, 124, 255, 0.32);
  border-radius: 20px;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.35);
}

.studio-canvas__badge {
  display: inline-flex;
  padding: 6px 9px;
  color: #6ee7f9;
  background: rgba(110, 231, 249, 0.08);
  border: 1px solid rgba(110, 231, 249, 0.2);
  border-radius: 999px;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.studio-canvas__card h2 {
  margin: 22px 0 10px;
  font-size: 1.55rem;
  letter-spacing: -0.04em;
}

.studio-canvas__card p {
  margin: 0;
  color: #98a3c7;
  font-size: 0.84rem;
  line-height: 1.6;
}

.studio-tip {
  position: absolute;
  right: 18px;
  bottom: 18px;
  left: 18px;
  padding: 12px 14px;
  color: #cad2ef;
  background: rgba(20, 29, 57, 0.94);
  border: 1px solid rgba(110, 231, 249, 0.22);
  border-radius: 12px;
  font-size: 0.72rem;
  line-height: 1.5;
}

.workflow {
  padding-block: 100px;
  border-top: 1px solid var(--border);
}

.section-heading {
  max-width: 760px;
}

.section-heading h2,
.playground h2 {
  margin: 16px 0 0;
  font-size: clamp(2rem, 4vw, 3.6rem);
  line-height: 1.08;
  letter-spacing: -0.05em;
}

.workflow-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 50px;
}

.workflow-card {
  min-height: 260px;
  padding: 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: 0 22px 70px rgba(2, 7, 27, 0.07);
}

.workflow-card--featured {
  background: linear-gradient(145deg, var(--surface), var(--accent-soft));
  border-color: rgba(139, 124, 255, 0.42);
  transform: translateY(-12px);
}

.workflow-card__number {
  color: #8b7cff;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.75rem;
}

.workflow-card h3 {
  margin: 52px 0 14px;
  font-size: 1.25rem;
}

.workflow-card p {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}

.playground {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: 52px;
  margin-bottom: 100px;
  padding: 44px;
  background: linear-gradient(135deg, var(--surface), var(--accent-soft));
  border: 1px solid var(--border);
  border-radius: 28px;
  box-shadow: 0 30px 100px rgba(2, 7, 27, 0.1);
}

.playground__actions {
  justify-content: flex-end;
  margin: 0;
}

.site-footer {
  min-height: 100px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  font-size: 0.82rem;
}

.brand-lockup--small {
  color: var(--text);
}

.brand-lockup--small .brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 9px;
}

@media (max-width: 980px) {
  .hero {
    grid-template-columns: 1fr;
    padding-top: 58px;
  }

  .hero__copy {
    max-width: 760px;
  }

  .studio-window {
    max-width: 720px;
    transform: none;
  }

  .workflow-grid {
    grid-template-columns: 1fr;
  }

  .workflow-card {
    min-height: 0;
  }

  .workflow-card--featured {
    transform: none;
  }

  .workflow-card h3 {
    margin-top: 30px;
  }

  .playground {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .playground__actions {
    justify-content: flex-start;
  }
}

@media (max-width: 680px) {
  .site-header,
  .hero,
  .workflow,
  .playground,
  .site-footer {
    width: min(100% - 28px, 1180px);
  }

  .site-header {
    min-height: 76px;
  }

  .site-header__nav {
    display: none;
  }

  .hero {
    min-height: auto;
    padding-block: 48px 70px;
  }

  .hero__copy h1 {
    font-size: clamp(2.75rem, 15vw, 4.2rem);
  }

  .studio-window__body {
    min-height: 330px;
    grid-template-columns: 1fr;
  }

  .studio-tree {
    display: none;
  }

  .studio-canvas {
    padding: 28px 18px 72px;
  }

  .workflow {
    padding-block: 76px;
  }

  .workflow-card,
  .playground {
    padding: 24px;
    border-radius: 20px;
  }

  .playground {
    margin-bottom: 72px;
  }

  .site-footer {
    min-height: 130px;
    align-items: flex-start;
    justify-content: center;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }

  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
  }
}
`),
    'src/vite-env.d.ts': sourceFile(`
/// <reference types="vite/client" />
`),
    'srijika.config.json': jsonFile({
      version: 1,
      sourceOfTruth: 'tsx',
      entry: 'src/features/home/Home.ui.tsx',
      architecture: SRIJIKA_ARCHITECTURE,
      project: {
        name: projectName,
        displayName,
        profile: TOOLCHAIN_PROFILE,
      },
      ui: {
        include: ['src/**/*.ui.tsx'],
        exclude: ['src/**/*.test.*', 'src/**/*.spec.*'],
        connectorSuffix: '.connector.tsx',
        sourceExtension: '.ui.tsx',
      },
      diagnostics: {
        showInStudio: true,
        keepLastValidPreview: true,
      },
      preview: {
        styles: ['src/styles.css'],
        assets: ['public/srijika-mark.svg'],
        props: {
          pageClassName: 'srijika-home srijika-home--night',
          sparkLabel: '1 source update',
          themeLabel: 'Switch to daylight',
          isReady: true,
          isGuideOpen: false,
        },
      },
      editor: {
        manualCodeEditing: 'external',
        preferredEditor: 'vscode',
      },
      react: {
        compiler: true,
      },
      toolchain: 'srijika.toolchain.json',
    }),
    'srijika.toolchain.json': jsonFile({
      version: Number(TOOLCHAIN_VERSION),
      profile: TOOLCHAIN_PROFILE,
      srijikaStudio: '0.1.0',
      packageManager: PACKAGE_MANAGER,
      node: NODE_ENGINE,
      install: {
        strategy: 'frozen-lockfile',
        lockfile: 'pnpm-lock.yaml',
        command: 'pnpm install --frozen-lockfile',
      },
      runtime: {
        react: versions.react,
        reactDom: versions.react,
      },
      execution: {
        defaultRuntime: 'node',
        optionalRuntimes: ['bun'],
        runtimeSelection: 'explicit',
        devServer: 'vite',
        hmr: true,
      },
      compiler: {
        reactCompiler: versions.reactCompiler,
        typescript: versions.typescript,
        vite: versions.vite,
      },
      validation: {
        architecture: SRIJIKA_ARCHITECTURE.profile,
        command: 'pnpm run validate:srijika',
      },
    }),
    'tsconfig.json': jsonFile({
      compilerOptions: {
        target: 'ES2022',
        useDefineForClassFields: true,
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        module: 'ESNext',
        moduleResolution: 'Bundler',
        allowImportingTsExtensions: false,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: 'react-jsx',
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        types: ['vite/client'],
      },
      include: ['src', 'vite.config.ts'],
    }),
    'vite.config.ts': sourceFile(`
import babel from '@rolldown/plugin-babel';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import * as ts from 'typescript';
import { defineConfig, type Plugin } from 'vite';

function srijikaPreviewSourcePlugin(): Plugin {
  return {
    name: 'srijika-preview-source-locations',
    apply: 'serve',
    enforce: 'pre',
    transform(source, id) {
      const cleanId = id.split('?', 1)[0]?.replaceAll('\\\\', '/');
      if (!cleanId?.endsWith('.ui.tsx')) return null;
      const sourceIndex = cleanId.lastIndexOf('/src/');
      if (sourceIndex < 0) return null;
      const relativePath = cleanId.slice(sourceIndex + 1);
      const sourceFile = ts.createSourceFile(
        cleanId,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const insertions: Array<{ offset: number; text: string }> = [];
      const visit = (node: ts.Node): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const alreadyInstrumented = node.attributes.properties.some(
            (attribute) =>
              ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'data-srijika-source',
          );
          if (!alreadyInstrumented) {
            const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            insertions.push({
              offset: node.tagName.end,
              text:
                ' data-srijika-source="' +
                relativePath +
                ':' +
                (location.line + 1) +
                ':' +
                (location.character + 1) +
                '"',
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      let transformed = source;
      for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
        transformed =
          transformed.slice(0, insertion.offset) + insertion.text + transformed.slice(insertion.offset);
      }
      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [srijikaPreviewSourcePlugin(), react(), babel({ presets: [reactCompilerPreset()] })],
});
`),
  };

  return Object.freeze(
    Object.fromEntries(
      Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  );
};
