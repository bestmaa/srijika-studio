import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CodeProjectEntry,
  OpenInVsCodeRequest,
  ProjectDependencyState,
} from '../../apps/studio/src/lib/project-service';

const serviceMocks = vi.hoisted(() => ({
  isTauriDesktop: vi.fn(() => true),
  buildCodeProject: vi.fn(),
  createCodeProjectUiSource: vi.fn(),
  getProjectRuntimeStatus: vi.fn(),
  installProjectDependencies: vi.fn(),
  loadCodeProjectArchitectureSources: vi.fn(),
  loadTsxSource: vi.fn(),
  openCodeProjectApp: vi.fn(),
  openCodeProjectPreview: vi.fn(),
  openInVsCode: vi.fn(),
  scaffoldCodeProjectStructure: vi.fn(),
  scanCodeProject: vi.fn(),
  startCodeProject: vi.fn(),
  stopCodeProject: vi.fn(),
}));

vi.mock('../../apps/studio/src/lib/project-service', () => {
  return {
    buildCodeProject: serviceMocks.buildCodeProject,
    chooseAndCreateCodeProject: vi.fn(),
    chooseAndLoadTsxSource: vi.fn(),
    chooseAndOpenCodeProject: vi.fn(),
    createCodeProjectUiSource: serviceMocks.createCodeProjectUiSource,
    getProjectRuntimeStatus: serviceMocks.getProjectRuntimeStatus,
    installProjectDependencies: serviceMocks.installProjectDependencies,
    isTauriDesktop: serviceMocks.isTauriDesktop,
    loadCodeProjectArchitectureSources: serviceMocks.loadCodeProjectArchitectureSources,
    loadTsxSource: serviceMocks.loadTsxSource,
    openCodeProjectApp: serviceMocks.openCodeProjectApp,
    openCodeProjectPreview: serviceMocks.openCodeProjectPreview,
    openInVsCode: serviceMocks.openInVsCode,
    openBrowserPreview: vi.fn(),
    saveTsxSource: vi.fn(),
    scaffoldCodeProjectStructure: serviceMocks.scaffoldCodeProjectStructure,
    scanCodeProject: serviceMocks.scanCodeProject,
    startCodeProject: serviceMocks.startCodeProject,
    stopCodeProject: serviceMocks.stopCodeProject,
  };
});

import { CodeFirstStudio } from '../../apps/studio/src/components/code-first/CodeFirstStudio';
import { useCodeProjectStore } from '../../apps/studio/src/store/code-project-store';
import {
  PROJECT_SESSION_RECOVERY_KEY,
  useProjectSessionStore,
} from '../../apps/studio/src/store/project-session-store';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

const PROJECT_ROOT = '/projects/srijika-demo';
const SOURCE_PATH = `${PROJECT_ROOT}/src/Home.ui.tsx`;
const SOURCE = `export function HomeUI() {
  return (
    <main>
      <h1>Open from Srijika</h1>
    </main>
  );
}
`;

const UI_ENTRY: CodeProjectEntry = {
  path: SOURCE_PATH,
  relativePath: 'src/Home.ui.tsx',
  kind: 'file',
  bytes: SOURCE.length,
  hash: 'home-v1',
  isUiSource: true,
};

function entryForProject(relativePath: string, kind: 'directory' | 'file'): CodeProjectEntry {
  return {
    path: `${PROJECT_ROOT}/${relativePath}`,
    relativePath,
    kind,
    bytes: kind === 'file' ? 0 : null,
    hash: kind === 'file' ? `${relativePath}-hash` : null,
    isUiSource: relativePath.endsWith('.ui.tsx'),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function runtimeStatus(
  running = false,
  dependencyState: ProjectDependencyState = 'ready',
  framework: 'vite' | 'next-app-router' = 'vite',
) {
  return {
    path: PROJECT_ROOT,
    framework,
    packageManager: 'pnpm' as const,
    lockfileRoot: PROJECT_ROOT,
    lockfilePresent: dependencyState !== 'missingLockfile',
    dependenciesInstalled: dependencyState === 'ready' || dependencyState === 'outdated',
    dependenciesReady: dependencyState === 'ready',
    dependencyState,
    activeTask: null,
    lastTask: null,
    running,
    port: running ? 5173 : null,
    devServer: {
      state: running ? ('running' as const) : ('stopped' as const),
      ready: running,
      pid: running ? 9001 : null,
      port: running ? 5173 : null,
      url: running ? 'http://127.0.0.1:5173' : null,
      exitCode: null,
      stdout: '',
      stderr: '',
      outputTruncated: false,
      startedAtMillis: running ? 1_700_000_000_000 : null,
    },
    message: running
      ? 'Application is running at http://127.0.0.1:5173.'
      : dependencyState === 'ready'
        ? 'Dependencies ready.'
        : 'Dependencies are not installed.',
  };
}

function successfulTask(kind: 'install' | 'build') {
  return {
    projectPath: PROJECT_ROOT,
    kind,
    success: true,
    exitCode: 0,
    stdout: `${kind} complete`,
    stderr: '',
    outputTruncated: false,
    durationMillis: 500,
  };
}

describe('code-first project navigation', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    serviceMocks.isTauriDesktop.mockReturnValue(true);
    serviceMocks.loadTsxSource.mockReset();
    serviceMocks.loadTsxSource.mockResolvedValue({
      path: SOURCE_PATH,
      bytes: SOURCE.length,
      hash: 'home-v1',
      source: SOURCE,
    });
    serviceMocks.loadCodeProjectArchitectureSources.mockReset();
    serviceMocks.loadCodeProjectArchitectureSources.mockResolvedValue({
      path: PROJECT_ROOT,
      configSource: JSON.stringify({ sourceOfTruth: 'tsx', entry: 'src/Home.ui.tsx' }),
      sources: [],
      truncated: false,
    });
    serviceMocks.openInVsCode.mockReset();
    serviceMocks.openInVsCode.mockImplementation((request: OpenInVsCodeRequest) =>
      Promise.resolve({
        projectPath: request.projectPath,
        targetPath: request.relativePath
          ? `${request.projectPath}/${request.relativePath}`
          : request.projectPath,
        line: request.line ?? null,
        column: request.column ?? null,
      }),
    );
    serviceMocks.openCodeProjectApp.mockReset();
    serviceMocks.openCodeProjectApp.mockResolvedValue({
      projectPath: PROJECT_ROOT,
      url: 'http://127.0.0.1:5173',
    });
    serviceMocks.openCodeProjectPreview.mockReset();
    serviceMocks.openCodeProjectPreview.mockResolvedValue({
      projectPath: PROJECT_ROOT,
      url: 'http://127.0.0.1:5173',
    });
    serviceMocks.scanCodeProject.mockReset();
    serviceMocks.scaffoldCodeProjectStructure.mockReset();
    serviceMocks.createCodeProjectUiSource.mockReset();
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [
        {
          path: `${PROJECT_ROOT}/src`,
          relativePath: 'src',
          kind: 'directory',
          bytes: null,
          hash: null,
          isUiSource: false,
        },
        UI_ENTRY,
      ],
      truncated: false,
    });
    serviceMocks.getProjectRuntimeStatus.mockReset();
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(runtimeStatus());
    serviceMocks.installProjectDependencies.mockReset();
    serviceMocks.installProjectDependencies.mockResolvedValue(successfulTask('install'));
    serviceMocks.buildCodeProject.mockReset();
    serviceMocks.buildCodeProject.mockResolvedValue(successfulTask('build'));
    serviceMocks.startCodeProject.mockReset();
    serviceMocks.startCodeProject.mockResolvedValue(runtimeStatus(true));
    serviceMocks.stopCodeProject.mockReset();
    serviceMocks.stopCodeProject.mockResolvedValue(runtimeStatus(false));

    useStudioStore.getState().resetProject();
    useProjectSessionStore.getState().resetSession();
    act(() => {
      useCodeProjectStore.getState().loadSource({
        fileName: SOURCE_PATH,
        sourcePath: SOURCE_PATH,
        source: SOURCE,
        diskHash: 'home-v1',
      });
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: [UI_ENTRY],
        activeUiSourcePath: SOURCE_PATH,
      });
    });
  });

  it('offers the last project on startup and resumes it only after explicit confirmation', async () => {
    useProjectSessionStore.getState().resetSession();
    useCodeProjectStore.getState().clearSource();
    localStorage.setItem(
      PROJECT_SESSION_RECOVERY_KEY,
      JSON.stringify({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        activeUiSourcePath: SOURCE_PATH,
      }),
    );

    render(<CodeFirstStudio />);

    expect(screen.getByRole('heading', { name: 'Start with a real project.' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Resume Last Project/ })).toBeEnabled();
    expect(serviceMocks.scanCodeProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Resume Last Project/ }));

    await waitFor(() => expect(serviceMocks.scanCodeProject).toHaveBeenCalledWith(PROJECT_ROOT));
    expect(useProjectSessionStore.getState()).toMatchObject({
      rootPath: PROJECT_ROOT,
      displayName: 'srijika-demo',
      activeUiSourcePath: SOURCE_PATH,
    });
    expect(screen.getByRole('status')).toHaveTextContent(/Resumed srijika-demo/);
  });

  it('returns to explicit project choices from an already open desktop project', () => {
    render(<CodeFirstStudio />);

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('heading', { name: 'Start with a real project.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create New Project' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open Existing Project' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to current project' }));
    expect(screen.getByRole('textbox', { name: 'Srijika TSX source' })).toBeVisible();
  });

  it('propagates configured ownership roots from the native project read into discovery and previews', async () => {
    const featuresRoot = 'application/domain/features';
    const sharedRoot = 'application/domain/shared';
    const configuredEntryPath = `${PROJECT_ROOT}/${featuresRoot}/home/Home.view.tsx`;
    const configuredEntry: CodeProjectEntry = {
      path: configuredEntryPath,
      relativePath: `${featuresRoot}/home/Home.view.tsx`,
      kind: 'file',
      bytes: SOURCE.length,
      hash: 'configured-home-v1',
      isUiSource: true,
    };
    const entries = [
      entryForProject('application', 'directory'),
      entryForProject('application/domain', 'directory'),
      entryForProject(featuresRoot, 'directory'),
      entryForProject(sharedRoot, 'directory'),
      entryForProject(`${featuresRoot}/home`, 'directory'),
      configuredEntry,
    ];
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: configuredEntryPath,
      entries,
      truncated: false,
    });
    serviceMocks.loadTsxSource.mockResolvedValue({
      path: configuredEntryPath,
      bytes: SOURCE.length,
      hash: 'configured-home-v1',
      source: SOURCE,
    });
    serviceMocks.loadCodeProjectArchitectureSources.mockResolvedValue({
      path: PROJECT_ROOT,
      tsconfigSource: JSON.stringify({
        compilerOptions: {
          paths: { '@features/*': [`${featuresRoot}/*`] },
        },
      }),
      configSource: JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: `${featuresRoot}/home/Home.view.tsx`,
        architecture: {
          profile: 'feature-slot-part-v1',
          featuresRoot,
          sharedRoot,
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
      sources: [
        {
          path: configuredEntryPath,
          relativePath: `${featuresRoot}/home/Home.view.tsx`,
          bytes: SOURCE.length,
          hash: 'fnv1a64:0123456789abcdef',
          source: SOURCE,
        },
        {
          path: `${PROJECT_ROOT}/${featuresRoot}/home/Home.gateway.tsx`,
          relativePath: `${featuresRoot}/home/Home.gateway.tsx`,
          bytes: 118,
          hash: 'fnv1a64:fedcba9876543210',
          source:
            "import { HomeUI } from '@features/home/Home.view';\n\nexport function HomeConnector() { return <HomeUI />; }\n",
        },
      ],
      truncated: false,
    });
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(runtimeStatus(true));

    render(<CodeFirstStudio />);

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    await waitFor(() =>
      expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(configuredEntryPath),
    );
    await waitFor(() =>
      expect(useCodeProjectStore.getState().architectureCheckedFileCount).toBe(2),
    );
    expect(
      useCodeProjectStore
        .getState()
        .architectureDiagnostics.some((diagnostic) => diagnostic.code === 4120),
    ).toBe(false);
    const livePreview = await screen.findByTitle<HTMLIFrameElement>('Live Srijika project preview');
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:5173',
        source: livePreview.contentWindow,
        data: {
          type: 'srijika:preview-select',
          version: 1,
          source: `${featuresRoot}/home/Home.view.tsx:4:7`,
        },
      }),
    );
    expect(
      await screen.findByText(
        `Selected the live element from ${featuresRoot}/home/Home.view.tsx:4.`,
      ),
    ).toBeVisible();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:5173',
        source: livePreview.contentWindow,
        data: {
          type: 'srijika:preview-runtime-state',
          version: 1,
          state: 'ready',
          uiSource: `${featuresRoot}/home/Home.view.tsx`,
        },
      }),
    );
    expect(await screen.findByText('live Home.view.tsx')).toBeVisible();
    expect(within(explorer).getByTitle(`${featuresRoot}/home/Home.view.tsx`)).toBeVisible();
    await waitFor(() =>
      expect(within(explorer).getByTitle(`New feature in ${featuresRoot}`)).toBeVisible(),
    );
    fireEvent.click(within(explorer).getByRole('button', { name: 'New UI' }));
    let dialog = screen.getByRole('dialog', { name: 'Create UI page' });
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Reports' },
    });
    expect(within(dialog).getByText('src/pages/Reports.view.tsx')).toBeVisible();
    expect(within(dialog).getByText('src/pages/Reports.gateway.tsx')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      within(explorer).getByRole('button', {
        name: `Add capability inside ${featuresRoot}`,
      }),
    );
    dialog = screen.getByRole('dialog', { name: 'Add to Features' });
    fireEvent.change(within(dialog).getByLabelText('New Feature name'), {
      target: { value: 'Dashboard' },
    });
    expect(within(dialog).getByText(`${featuresRoot}/dashboard/Dashboard.view.tsx`)).toBeVisible();
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close structure creation dialog' }),
    );

    fireEvent.click(
      within(explorer).getByRole('button', {
        name: `Add capability inside ${sharedRoot}`,
      }),
    );
    dialog = screen.getByRole('dialog', { name: 'Add to Shared' });
    fireEvent.change(within(dialog).getByLabelText('Shared UI Primitive name'), {
      target: { value: 'StatusBadge' },
    });
    expect(
      within(dialog).getByText(`${sharedRoot}/ui/status-badge/StatusBadge.view.tsx`),
    ).toBeVisible();
  });

  it('creates a feature from the Structure guide and opens its required UI source', async () => {
    const featureUiPath = `${PROJECT_ROOT}/src/features/dashboard/Dashboard.ui.tsx`;
    const featureSource = `export function DashboardUI() {
  return <main>Dashboard</main>;
}
`;
    const baseEntries: CodeProjectEntry[] = [
      {
        path: `${PROJECT_ROOT}/src`,
        relativePath: 'src',
        kind: 'directory',
        bytes: null,
        hash: null,
        isUiSource: false,
      },
      {
        path: `${PROJECT_ROOT}/src/features`,
        relativePath: 'src/features',
        kind: 'directory',
        bytes: null,
        hash: null,
        isUiSource: false,
      },
      UI_ENTRY,
    ];
    const createdEntry: CodeProjectEntry = {
      path: featureUiPath,
      relativePath: 'src/features/dashboard/Dashboard.ui.tsx',
      kind: 'file',
      bytes: featureSource.length,
      hash: 'dashboard-v1',
      isUiSource: true,
    };

    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: baseEntries,
        activeUiSourcePath: SOURCE_PATH,
      });
    });
    serviceMocks.scaffoldCodeProjectStructure.mockResolvedValue({
      projectPath: PROJECT_ROOT,
      featureName: 'Dashboard',
      featurePath: `${PROJECT_ROOT}/src/features/dashboard`,
      capability: {
        kind: 'feature',
        createConnector: true,
        createHook: false,
        createStore: false,
        createLogic: false,
        createApi: false,
        createTypes: false,
        hookName: null,
      },
      files: [
        {
          path: featureUiPath,
          relativePath: createdEntry.relativePath,
          role: 'featureUi',
          bytes: featureSource.length,
          hash: 'dashboard-v1',
        },
        {
          path: `${PROJECT_ROOT}/src/features/dashboard/Dashboard.connector.tsx`,
          relativePath: 'src/features/dashboard/Dashboard.connector.tsx',
          role: 'featureConnector',
          bytes: 120,
          hash: 'dashboard-connector-v1',
        },
      ],
      bytes: featureSource.length + 120,
    });
    serviceMocks.loadTsxSource.mockImplementation((path: string) =>
      Promise.resolve(
        path === featureUiPath
          ? {
              path: featureUiPath,
              bytes: featureSource.length,
              hash: 'dashboard-v1',
              source: featureSource,
            }
          : {
              path: SOURCE_PATH,
              bytes: SOURCE.length,
              hash: 'home-v1',
              source: SOURCE,
            },
      ),
    );
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [...baseEntries, createdEntry],
      truncated: false,
    });

    render(<CodeFirstStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Open structure guide' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create a new feature' }));

    const dialog = screen.getByRole('dialog', { name: 'Add to Features' });
    fireEvent.change(within(dialog).getByLabelText('New Feature name'), {
      target: { value: 'Dashboard' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create New Feature' }));

    await waitFor(() =>
      expect(serviceMocks.scaffoldCodeProjectStructure).toHaveBeenCalledWith({
        projectPath: PROJECT_ROOT,
        featureName: 'Dashboard',
        capability: {
          kind: 'feature',
          createConnector: true,
          createHook: false,
          createStore: false,
          createLogic: false,
          createApi: false,
          createTypes: false,
          hookName: null,
        },
      }),
    );
    await waitFor(() => expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(featureUiPath));
    await waitFor(() => {
      expect(useCodeProjectStore.getState().sourcePath).toBe(featureUiPath);
      expect(useProjectSessionStore.getState().selectedPath).toBe(featureUiPath);
    });
  });

  it('creates a Shared UI Primitive from the project tree and opens its source', async () => {
    const sharedUiPath = `${PROJECT_ROOT}/src/shared/ui/status-badge/StatusBadge.ui.tsx`;
    const sharedSource = `export function StatusBadgeUI() {
  return <span>Status</span>;
}
`;
    const baseEntries: CodeProjectEntry[] = [
      entryForProject('src', 'directory'),
      entryForProject('src/shared', 'directory'),
      entryForProject('src/shared/.gitkeep', 'file'),
      UI_ENTRY,
    ];
    const createdEntry: CodeProjectEntry = {
      path: sharedUiPath,
      relativePath: 'src/shared/ui/status-badge/StatusBadge.ui.tsx',
      kind: 'file',
      bytes: sharedSource.length,
      hash: 'status-badge-v1',
      isUiSource: true,
    };

    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: baseEntries,
        activeUiSourcePath: SOURCE_PATH,
      });
    });
    serviceMocks.scaffoldCodeProjectStructure.mockResolvedValue({
      projectPath: PROJECT_ROOT,
      featureName: 'StatusBadge',
      featurePath: 'src/shared/ui/status-badge',
      capability: { kind: 'sharedUi', createTypes: false },
      files: [
        {
          path: sharedUiPath,
          relativePath: createdEntry.relativePath,
          role: 'sharedUi',
          bytes: sharedSource.length,
          hash: 'status-badge-v1',
        },
      ],
      bytes: sharedSource.length,
    });
    serviceMocks.loadTsxSource.mockImplementation((path: string) =>
      Promise.resolve(
        path === sharedUiPath
          ? {
              path: sharedUiPath,
              bytes: sharedSource.length,
              hash: 'status-badge-v1',
              source: sharedSource,
            }
          : {
              path: SOURCE_PATH,
              bytes: SOURCE.length,
              hash: 'home-v1',
              source: SOURCE,
            },
      ),
    );
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [...baseEntries, createdEntry],
      truncated: false,
    });

    render(<CodeFirstStudio />);
    fireEvent.click(screen.getByRole('button', { name: 'Add capability inside src/shared' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to Shared' });
    fireEvent.change(within(dialog).getByLabelText('Shared UI Primitive name'), {
      target: { value: 'StatusBadge' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Shared UI Primitive' }));

    await waitFor(() =>
      expect(serviceMocks.scaffoldCodeProjectStructure).toHaveBeenCalledWith({
        projectPath: PROJECT_ROOT,
        featureName: 'StatusBadge',
        capability: { kind: 'sharedUi', createTypes: false },
      }),
    );
    await waitFor(() => expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(sharedUiPath));
    await waitFor(() => {
      expect(useCodeProjectStore.getState().sourcePath).toBe(sharedUiPath);
      expect(useProjectSessionStore.getState().selectedPath).toBe(sharedUiPath);
    });
  });

  it('refreshes desktop architecture diagnostics and validates the active in-memory UI source', async () => {
    const canonicalPath = `${PROJECT_ROOT}/src/features/home/Home.ui.tsx`;
    const diskSource = 'export function HomeUI() { return <main />; }\n';
    const dirtySource = [
      "import { useHomeStore } from './home.store';",
      'export function HomeUI() { return <main />; }',
      '',
    ].join('\n');
    const canonicalEntry: CodeProjectEntry = {
      path: canonicalPath,
      relativePath: 'src/features/home/Home.ui.tsx',
      kind: 'file',
      bytes: diskSource.length,
      hash: 'canonical-v1',
      isUiSource: true,
    };
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: canonicalPath,
      entries: [canonicalEntry],
      truncated: false,
    });
    serviceMocks.loadCodeProjectArchitectureSources.mockResolvedValue({
      path: PROJECT_ROOT,
      configSource: JSON.stringify({
        sourceOfTruth: 'tsx',
        entry: 'src/features/home/Home.ui.tsx',
        architecture: { profile: 'feature-slot-part-v1' },
      }),
      sources: [
        {
          path: canonicalPath,
          relativePath: 'src/features/home/Home.ui.tsx',
          bytes: diskSource.length,
          hash: 'fnv1a64:0000000000000001',
          source: diskSource,
        },
        {
          path: `${PROJECT_ROOT}/src/features/home/home.store.ts`,
          relativePath: 'src/features/home/home.store.ts',
          bytes: 24,
          hash: 'fnv1a64:0000000000000002',
          source: 'export const value = 1;\n',
        },
      ],
      truncated: false,
    });
    act(() => {
      useCodeProjectStore.getState().loadSource({
        fileName: canonicalPath,
        sourcePath: canonicalPath,
        source: diskSource,
        diskHash: 'canonical-v1',
      });
      useCodeProjectStore.getState().updateSource(dirtySource);
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: [canonicalEntry],
        activeUiSourcePath: canonicalPath,
      });
    });

    render(<CodeFirstStudio />);

    await waitFor(() => {
      expect(serviceMocks.loadCodeProjectArchitectureSources).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(useCodeProjectStore.getState().architectureCheckedFileCount).toBe(2);
      expect(
        useCodeProjectStore
          .getState()
          .architectureDiagnostics.some((diagnostic) => diagnostic.code === 'SRIJIKA4101'),
      ).toBe(true);
    });
  });

  it('opens project files and UI nodes in VS Code at exact safe locations', async () => {
    render(<CodeFirstStudio />);

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    const uiSources = within(explorer).getByRole('region', { name: 'UI Sources' });
    fireEvent.doubleClick(within(uiSources).getByRole('button', { name: /Home.ui.tsx/ }));
    await waitFor(() => {
      expect(serviceMocks.openInVsCode).toHaveBeenCalledWith({
        projectPath: PROJECT_ROOT,
        relativePath: 'src/Home.ui.tsx',
        line: 1,
        column: 1,
      });
    });

    const heading = Object.values(
      useCodeProjectStore.getState().lastValidDocument?.nodes ?? {},
    ).find((node) => node.kind === 'element' && node.componentId === 'srijika.heading');
    if (!heading) throw new Error('Expected the derived heading node');
    const span = useCodeProjectStore.getState().sourceMap?.nodes[heading.id];
    if (!span) throw new Error('Expected the heading source span');

    const nodes = screen.getByRole('region', { name: 'UI Nodes' });
    fireEvent.doubleClick(within(nodes).getByRole('button', { name: /Heading 1/ }));
    await waitFor(() => {
      expect(serviceMocks.openInVsCode).toHaveBeenLastCalledWith({
        projectPath: PROJECT_ROOT,
        relativePath: 'src/Home.ui.tsx',
        line: span.line,
        column: span.column,
      });
    });
  });

  it('opens the real project root when its Explorer row is double-clicked', async () => {
    render(<CodeFirstStudio />);

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    fireEvent.doubleClick(within(explorer).getByRole('button', { name: 'SRIJIKA-DEMO' }));

    await waitFor(() => {
      expect(serviceMocks.openInVsCode).toHaveBeenCalledWith({ projectPath: PROJECT_ROOT });
    });
  });

  it('opens project directories without an invalid file source location', async () => {
    render(<CodeFirstStudio />);

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    const sourceDirectory = await within(explorer).findByRole('button', { name: 'src' });
    fireEvent.doubleClick(sourceDirectory);

    await waitFor(() => {
      expect(serviceMocks.openInVsCode).toHaveBeenCalledWith({
        projectPath: PROJECT_ROOT,
        relativePath: 'src',
      });
    });
  });

  it('creates a desktop UI + Connector pair, refreshes the index, and opens the new UI', async () => {
    const pricingPath = `${PROJECT_ROOT}/src/pages/PricingPage.ui.tsx`;
    const connectorPath = `${PROJECT_ROOT}/src/pages/PricingPage.connector.tsx`;
    const pricingSource = `export interface PricingPageUIProps { title: string; }
export function PricingPageUI(props: PricingPageUIProps) {
  return <main><h1>{props.title}</h1></main>;
}`;
    const pricingEntry: CodeProjectEntry = {
      path: pricingPath,
      relativePath: 'src/pages/PricingPage.ui.tsx',
      kind: 'file',
      bytes: pricingSource.length,
      hash: 'pricing-v1',
      isUiSource: true,
    };
    const connectorEntry: CodeProjectEntry = {
      path: connectorPath,
      relativePath: 'src/pages/PricingPage.connector.tsx',
      kind: 'file',
      bytes: 120,
      hash: 'connector-v1',
      isUiSource: false,
    };
    serviceMocks.createCodeProjectUiSource.mockImplementation(() => {
      serviceMocks.scanCodeProject.mockResolvedValue({
        path: PROJECT_ROOT,
        entrySourcePath: SOURCE_PATH,
        entries: [UI_ENTRY, pricingEntry, connectorEntry],
        truncated: false,
      });
      return Promise.resolve({
        path: pricingPath,
        relativePath: pricingEntry.relativePath,
        connectorPath,
        bytes: pricingSource.length,
        hash: 'pricing-v1',
        source: pricingSource,
        kind: 'page',
        componentName: 'PricingPage',
      });
    });

    render(<CodeFirstStudio />);
    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    fireEvent.click(within(explorer).getByRole('button', { name: 'New UI' }));
    const dialog = screen.getByRole('dialog', { name: 'Create UI page' });
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'PricingPage' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create UI page' }));

    await waitFor(() => {
      expect(serviceMocks.createCodeProjectUiSource).toHaveBeenCalledWith({
        projectPath: PROJECT_ROOT,
        relativePath: 'src/pages/PricingPage.ui.tsx',
        kind: 'page',
        componentName: 'PricingPage',
        createConnector: true,
      });
      expect(useProjectSessionStore.getState().activeUiSourcePath).toBe(pricingPath);
      expect(useCodeProjectStore.getState()).toMatchObject({
        sourcePath: pricingPath,
        source: pricingSource,
        diskHash: 'pricing-v1',
      });
    });
    expect(
      useProjectSessionStore
        .getState()
        .entries.some((entry) => entry.relativePath === connectorEntry.relativePath),
    ).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Create UI page' })).not.toBeInTheDocument();
  });

  it('keeps the latest rapidly selected UI source when older loads resolve later', async () => {
    const profilePath = `${PROJECT_ROOT}/src/Profile.ui.tsx`;
    const settingsPath = `${PROJECT_ROOT}/src/Settings.ui.tsx`;
    const profileSource = `export function ProfileUI() { return <main><h1>Profile UI</h1></main>; }`;
    const settingsSource = `export function SettingsUI() { return <main><h1>Settings UI</h1></main>; }`;
    const profileEntry: CodeProjectEntry = {
      ...UI_ENTRY,
      path: profilePath,
      relativePath: 'src/Profile.ui.tsx',
      bytes: profileSource.length,
      hash: 'profile-v1',
    };
    const settingsEntry: CodeProjectEntry = {
      ...UI_ENTRY,
      path: settingsPath,
      relativePath: 'src/Settings.ui.tsx',
      bytes: settingsSource.length,
      hash: 'settings-v1',
    };
    const profileLoad = deferred<{
      path: string;
      bytes: number;
      hash: string;
      source: string;
    }>();
    const settingsLoad = deferred<{
      path: string;
      bytes: number;
      hash: string;
      source: string;
    }>();
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [UI_ENTRY, profileEntry, settingsEntry],
      truncated: false,
    });
    serviceMocks.loadTsxSource.mockImplementation((path: string) => {
      if (path === profilePath) return profileLoad.promise;
      if (path === settingsPath) return settingsLoad.promise;
      return Promise.resolve({
        path: SOURCE_PATH,
        bytes: SOURCE.length,
        hash: 'home-v1',
        source: SOURCE,
      });
    });
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(runtimeStatus(true));
    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: [UI_ENTRY, profileEntry, settingsEntry],
        activeUiSourcePath: SOURCE_PATH,
      });
    });
    render(<CodeFirstStudio />);

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Project runtime' })).toHaveTextContent(
        'Running on port 5173',
      ),
    );
    expect(screen.getByRole('region', { name: 'Live application preview' })).toBeVisible();
    const livePreview = screen.getByTitle<HTMLIFrameElement>('Live Srijika project preview');
    const publishSelection = vi.spyOn(livePreview.contentWindow!, 'postMessage');

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    const uiSources = within(explorer).getByRole('region', { name: 'UI Sources' });
    fireEvent.click(within(uiSources).getByRole('button', { name: /Profile\.ui\.tsx/ }));
    fireEvent.click(within(uiSources).getByRole('button', { name: /Settings\.ui\.tsx/ }));
    await waitFor(() => {
      expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(profilePath);
      expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(settingsPath);
    });

    await act(async () => {
      settingsLoad.resolve({
        path: settingsPath,
        bytes: settingsSource.length,
        hash: 'settings-v1',
        source: settingsSource,
      });
      await settingsLoad.promise;
    });
    await waitFor(() => {
      expect(useProjectSessionStore.getState().activeUiSourcePath).toBe(settingsPath);
      expect(useCodeProjectStore.getState().source).toBe(settingsSource);
      expect(publishSelection).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'srijika:preview-selected-source',
          version: 1,
          uiSource: 'src/Settings.ui.tsx',
        }),
        'http://127.0.0.1:5173',
      );
    });

    await act(async () => {
      profileLoad.resolve({
        path: profilePath,
        bytes: profileSource.length,
        hash: 'profile-v1',
        source: profileSource,
      });
      await profileLoad.promise;
    });
    expect(useProjectSessionStore.getState().activeUiSourcePath).toBe(settingsPath);
    expect(useCodeProjectStore.getState().source).toBe(settingsSource);
  });

  it('does not let a background Home refresh cancel a newly selected UI source', async () => {
    const dashboardPath = `${PROJECT_ROOT}/src/features/dashboard/Dashboard.ui.tsx`;
    const dashboardSource = `export function DashboardUI() { return <main>Dashboard</main>; }`;
    const dashboardEntry: CodeProjectEntry = {
      ...UI_ENTRY,
      path: dashboardPath,
      relativePath: 'src/features/dashboard/Dashboard.ui.tsx',
      bytes: dashboardSource.length,
      hash: 'dashboard-v1',
    };
    const dashboardLoad = deferred<{
      path: string;
      bytes: number;
      hash: string;
      source: string;
    }>();
    const refreshedHomeLoad = deferred<{
      path: string;
      bytes: number;
      hash: string;
      source: string;
    }>();

    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [{ ...UI_ENTRY, hash: 'home-v2' }, dashboardEntry],
      truncated: false,
    });
    serviceMocks.loadTsxSource.mockImplementation((path: string) => {
      if (path === dashboardPath) return dashboardLoad.promise;
      if (path === SOURCE_PATH) return refreshedHomeLoad.promise;
      throw new Error(`Unexpected source path ${path}`);
    });
    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: [UI_ENTRY, dashboardEntry],
        activeUiSourcePath: SOURCE_PATH,
      });
    });
    render(<CodeFirstStudio />);

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    const uiSources = within(explorer).getByRole('region', { name: 'UI Sources' });
    fireEvent.click(within(uiSources).getByRole('button', { name: /Dashboard\.ui\.tsx/ }));
    await waitFor(() => expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(dashboardPath));

    await act(async () => {
      dashboardLoad.resolve({
        path: dashboardPath,
        bytes: dashboardSource.length,
        hash: 'dashboard-v1',
        source: dashboardSource,
      });
      await dashboardLoad.promise;
    });

    expect(useProjectSessionStore.getState().activeUiSourcePath).toBe(dashboardPath);
    expect(useCodeProjectStore.getState().source).toBe(dashboardSource);
    expect(serviceMocks.loadTsxSource).not.toHaveBeenCalledWith(SOURCE_PATH);
  });

  it('ignores a stale project scan after the active project root changes', async () => {
    const oldScan = deferred<{
      path: string;
      entrySourcePath: string;
      entries: readonly CodeProjectEntry[];
      truncated: boolean;
    }>();
    const nextRoot = '/projects/next-srijika-app';
    const nextPath = `${nextRoot}/src/Home.ui.tsx`;
    const nextSource = `export function NextHome() { return <main><h1>Next project</h1></main>; }`;
    const nextEntry: CodeProjectEntry = {
      ...UI_ENTRY,
      path: nextPath,
      bytes: nextSource.length,
      hash: 'next-v1',
    };
    serviceMocks.scanCodeProject.mockImplementation((path: string) => {
      if (path === PROJECT_ROOT) return oldScan.promise;
      return Promise.resolve({
        path: nextRoot,
        entrySourcePath: nextPath,
        entries: [nextEntry],
        truncated: false,
      });
    });
    render(<CodeFirstStudio />);
    await waitFor(() => expect(serviceMocks.scanCodeProject).toHaveBeenCalledWith(PROJECT_ROOT));

    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: nextRoot,
        displayName: 'next-srijika-app',
        entries: [nextEntry],
        activeUiSourcePath: nextPath,
      });
      useCodeProjectStore.getState().loadSource({
        fileName: nextPath,
        sourcePath: nextPath,
        source: nextSource,
        diskHash: 'next-v1',
      });
    });
    await waitFor(() => expect(serviceMocks.scanCodeProject).toHaveBeenCalledWith(nextRoot));

    await act(async () => {
      oldScan.resolve({
        path: PROJECT_ROOT,
        entrySourcePath: SOURCE_PATH,
        entries: [UI_ENTRY],
        truncated: false,
      });
      await oldScan.promise;
    });
    expect(useProjectSessionStore.getState()).toMatchObject({
      rootPath: nextRoot,
      displayName: 'next-srijika-app',
      activeUiSourcePath: nextPath,
    });
    expect(useProjectSessionStore.getState().entries).toEqual([nextEntry]);
    expect(useCodeProjectStore.getState().source).toBe(nextSource);
  });

  it('shows a clear conflict action and reloads a newer VS Code save over protected visual edits', async () => {
    vi.useFakeTimers();
    const externalSource = SOURCE.replace(
      'export function HomeUI() {',
      'export interface HomeUIProps { title: string; }\nexport function HomeUI(props: HomeUIProps) {',
    ).replace('Open from Srijika', '{props.title}');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CodeFirstStudio />);

    act(() => {
      useCodeProjectStore
        .getState()
        .updateSource(SOURCE.replace('Open from Srijika', 'Unsaved Studio heading'));
    });
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [{ ...UI_ENTRY, bytes: externalSource.length, hash: 'home-v2' }],
      truncated: false,
    });
    serviceMocks.loadTsxSource.mockResolvedValue({
      path: SOURCE_PATH,
      bytes: externalSource.length,
      hash: 'home-v2',
      source: externalSource,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    const conflict = screen
      .getByText('VS Code has a newer saved version')
      .closest<HTMLElement>('[role="alert"]');
    expect(conflict).not.toBeNull();
    if (!conflict) {
      throw new Error('Expected the source-conflict alert to be rendered.');
    }
    expect(within(conflict).getByText('VS Code has a newer saved version')).toBeVisible();
    expect(useCodeProjectStore.getState().source).toContain('Unsaved Studio heading');

    fireEvent.click(within(conflict).getByRole('button', { name: 'Load VS Code changes' }));
    await act(async () => Promise.resolve());

    expect(confirm).toHaveBeenCalledWith(
      'Discard unsaved Studio-generated visual edits and reload from VS Code?',
    );
    expect(useCodeProjectStore.getState()).toMatchObject({
      source: externalSource,
      diskHash: 'home-v2',
      dirty: false,
    });
    expect(screen.queryByText('VS Code has a newer saved version')).not.toBeInTheDocument();
  });

  it('ignores a detached watcher result after a different source is opened', async () => {
    vi.useFakeTimers();
    const firstPath = '/projects/detached/First.ui.tsx';
    const secondPath = '/projects/detached/Second.ui.tsx';
    const firstSource = `export function FirstUI() { return <main><h1>First</h1></main>; }`;
    const secondSource = `export function SecondUI() { return <main><h1>Second</h1></main>; }`;
    const watchedLoad = deferred<{
      path: string;
      bytes: number;
      hash: string;
      source: string;
    }>();
    serviceMocks.loadTsxSource.mockReset();
    serviceMocks.loadTsxSource.mockReturnValue(watchedLoad.promise);
    act(() => {
      useProjectSessionStore.getState().resetSession();
      useCodeProjectStore.getState().loadSource({
        fileName: firstPath,
        sourcePath: firstPath,
        source: firstSource,
        diskHash: 'first-v1',
      });
    });
    const rendered = render(<CodeFirstStudio />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(serviceMocks.loadTsxSource).toHaveBeenCalledWith(firstPath);

    act(() => {
      useCodeProjectStore.getState().loadSource({
        fileName: secondPath,
        sourcePath: secondPath,
        source: secondSource,
        diskHash: 'second-v1',
      });
    });
    await act(async () => {
      watchedLoad.resolve({
        path: firstPath,
        bytes: firstSource.length,
        hash: 'first-v2',
        source: firstSource.replace('First</h1>', 'Stale first</h1>'),
      });
      await watchedLoad.promise;
    });

    expect(useCodeProjectStore.getState()).toMatchObject({
      sourcePath: secondPath,
      source: secondSource,
      diskHash: 'second-v1',
    });
    rendered.unmount();
    vi.useRealTimers();
  });

  it('falls back to the configured entry when the active UI file is deleted in VS Code', async () => {
    const profilePath = `${PROJECT_ROOT}/src/Profile.ui.tsx`;
    const profileSource = `export function ProfileUI() { return <main><h1>Deleted profile</h1></main>; }`;
    const profileEntry: CodeProjectEntry = {
      ...UI_ENTRY,
      path: profilePath,
      relativePath: 'src/Profile.ui.tsx',
      bytes: profileSource.length,
      hash: 'profile-v1',
    };
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: [UI_ENTRY],
      truncated: false,
    });
    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: [UI_ENTRY, profileEntry],
        activeUiSourcePath: profilePath,
      });
      useCodeProjectStore.getState().loadSource({
        fileName: profilePath,
        sourcePath: profilePath,
        source: profileSource,
        diskHash: 'profile-v1',
      });
    });

    render(<CodeFirstStudio />);
    await waitFor(() => {
      expect(useProjectSessionStore.getState().activeUiSourcePath).toBe(SOURCE_PATH);
      expect(useCodeProjectStore.getState().sourcePath).toBe(SOURCE_PATH);
      expect(useCodeProjectStore.getState().source).toBe(SOURCE);
    });
  });

  it('opens a selected Srijika diagnostic in VS Code at its exact source span', async () => {
    const missingPropSource = `export interface HomeProps {}
export function Home(props: HomeProps) {
  return <main><h1>{props.title}</h1></main>;
}`;
    act(() => {
      useCodeProjectStore.getState().loadSource({
        fileName: SOURCE_PATH,
        sourcePath: SOURCE_PATH,
        source: missingPropSource,
        diskHash: 'home-v1',
      });
    });
    const diagnostic = useCodeProjectStore
      .getState()
      .diagnostics.find((candidate) => candidate.code === 'SRIJIKA1004');
    if (!diagnostic) throw new Error('Expected a missing-prop diagnostic');

    render(<CodeFirstStudio />);
    fireEvent.click(screen.getByText('SRIJIKA1004').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Open exact line in VS Code' }));

    await waitFor(() => {
      expect(serviceMocks.openInVsCode).toHaveBeenLastCalledWith({
        projectPath: PROJECT_ROOT,
        relativePath: 'src/Home.ui.tsx',
        line: diagnostic.span.line,
        column: diagnostic.span.column,
      });
    });
  });

  it('starts the real app, connects UI Sources to its runtime, then stops and builds it', async () => {
    let projectRunning = false;
    serviceMocks.getProjectRuntimeStatus.mockImplementation(() =>
      Promise.resolve(runtimeStatus(projectRunning)),
    );
    serviceMocks.startCodeProject.mockImplementation(() => {
      projectRunning = true;
      return Promise.resolve(runtimeStatus(true));
    });
    serviceMocks.stopCodeProject.mockImplementation(() => {
      projectRunning = false;
      return Promise.resolve(runtimeStatus(false));
    });

    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });

    expect(within(runtime).getByText(/Home\.ui\.tsx.*Connector target/)).toBeInTheDocument();
    expect(await within(runtime).findByText('Ready to run')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Live application preview' })).toBeVisible();
    expect(screen.queryByTitle('Live Srijika project preview')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full App' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start App' })).toBeEnabled();
    expect(screen.queryByTitle('Live Srijika project preview')).not.toBeInTheDocument();
    expect(within(runtime).getByRole('button', { name: 'Open App' })).toBeDisabled();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Run App' }));
    await waitFor(() => {
      expect(serviceMocks.startCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(within(runtime).getByText('Running on port 5173')).toBeInTheDocument();
    });
    const livePreview = screen.getByTitle('Live Srijika project preview');
    expect(livePreview).toHaveAttribute('src', 'http://127.0.0.1:5173');
    expect(livePreview).toHaveAttribute(
      'sandbox',
      'allow-forms allow-modals allow-popups allow-same-origin allow-scripts',
    );
    expect(screen.getByText('HMR')).toBeVisible();

    const headingNodeId = Object.entries(
      useCodeProjectStore.getState().sourceMap?.nodes ?? {},
    ).find(([, span]) => span.line === 4)?.[0];
    expect(headingNodeId).toBeDefined();
    const previouslySelectedNodeId = useStudioStore.getState().selectedNodeId;
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://example.com',
        source: (livePreview as HTMLIFrameElement).contentWindow,
        data: {
          type: 'srijika:preview-select',
          version: 1,
          source: 'src/Home.ui.tsx:4:7',
        },
      }),
    );
    expect(useStudioStore.getState().selectedNodeId).toBe(previouslySelectedNodeId);
    const postSelection = vi.spyOn(
      (livePreview as HTMLIFrameElement).contentWindow!,
      'postMessage',
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:5173',
        source: (livePreview as HTMLIFrameElement).contentWindow,
        data: {
          type: 'srijika:preview-select',
          version: 1,
          source: 'src/Home.ui.tsx:4:7',
        },
      }),
    );
    await waitFor(() => expect(useStudioStore.getState().selectedNodeId).toBe(headingNodeId));
    await waitFor(() =>
      expect(postSelection).toHaveBeenCalledWith(
        {
          type: 'srijika:preview-selected-source',
          version: 1,
          source: 'src/Home.ui.tsx:4:7',
          uiSource: 'src/Home.ui.tsx',
        },
        'http://127.0.0.1:5173',
      ),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:5173',
        source: (livePreview as HTMLIFrameElement).contentWindow,
        data: {
          type: 'srijika:preview-runtime-state',
          version: 1,
          state: 'ready',
          uiSource: 'src/Home.ui.tsx',
        },
      }),
    );
    expect(await screen.findByText('live Home.ui.tsx')).toBeVisible();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:5173',
        source: (livePreview as HTMLIFrameElement).contentWindow,
        data: {
          type: 'srijika:preview-runtime-state',
          version: 1,
          state: 'error',
          uiSource: 'src/Home.ui.tsx',
          error: 'Home Connector failed in the real runtime',
        },
      }),
    );
    expect(await screen.findByText('UI runtime failed')).toHaveAttribute(
      'title',
      'Home Connector failed in the real runtime',
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:5173',
        source: (livePreview as HTMLIFrameElement).contentWindow,
        data: {
          type: 'srijika:preview-runtime-state',
          version: 1,
          state: 'ready',
          uiSource: 'src/Home.ui.tsx',
        },
      }),
    );
    expect(await screen.findByText('live Home.ui.tsx')).toBeVisible();
    expect(screen.getByText('Selected the live element from src/Home.ui.tsx:4.')).toBeVisible();
    const paragraph = within(screen.getByRole('region', { name: 'UI Components' })).getByRole(
      'button',
      { name: 'Paragraph' },
    );
    const componentTransfer = {
      types: ['application/x-srijika-component'],
      effectAllowed: 'copy',
      dropEffect: 'copy',
      setData: vi.fn(),
      getData: vi.fn(() => 'paragraph'),
    };
    fireEvent.dragStart(paragraph, { dataTransfer: componentTransfer });
    const liveDrop = screen.getByRole('region', { name: 'Drop component into live preview' });
    fireEvent.dragOver(liveDrop, { dataTransfer: componentTransfer, clientX: 20, clientY: 20 });
    fireEvent.drop(liveDrop, { dataTransfer: componentTransfer });
    await waitFor(() =>
      expect(useCodeProjectStore.getState().source).toContain('Write your content here.'),
    );
    expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeEnabled();
    expect(
      within(screen.getByRole('region', { name: 'Project Explorer' })).getByRole('button', {
        name: 'New UI',
      }),
    ).toBeEnabled();
    const openApp = within(runtime).getByRole('button', { name: 'Open App' });
    await waitFor(() => expect(openApp).toBeEnabled());
    fireEvent.click(openApp);
    await waitFor(() => expect(serviceMocks.openCodeProjectApp).toHaveBeenCalledWith(PROJECT_ROOT));

    fireEvent.click(within(runtime).getByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(serviceMocks.stopCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(within(runtime).getByText('Ready to run')).toBeInTheDocument();
    });
    expect(screen.queryByTitle('Live Srijika project preview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start App' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeEnabled();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Build App' }));
    await waitFor(() => expect(serviceMocks.buildCodeProject).toHaveBeenCalledWith(PROJECT_ROOT));
  });

  it('selects bounded Next routes and resolves dynamic preview parameters on the tracked origin', async () => {
    const nextEntries = [
      UI_ENTRY,
      entryForProject('src/app/page.tsx', 'file'),
      entryForProject('src/app/loading.tsx', 'file'),
      entryForProject('src/app/error.tsx', 'file'),
      entryForProject('src/app/(account)/auth/[provider]/page.tsx', 'file'),
    ];
    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: PROJECT_ROOT,
        displayName: 'srijika-demo',
        entries: nextEntries,
        activeUiSourcePath: SOURCE_PATH,
      });
    });
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(
      runtimeStatus(true, 'ready', 'next-app-router'),
    );
    serviceMocks.scanCodeProject.mockResolvedValue({
      path: PROJECT_ROOT,
      entrySourcePath: SOURCE_PATH,
      entries: nextEntries,
      truncated: false,
    });

    render(<CodeFirstStudio />);

    const route = await screen.findByRole('combobox', { name: 'Next preview route' });
    expect(
      within(route).getByRole('option', { name: /auth\/\[provider\].*error\/loading/ }),
    ).toBeVisible();
    fireEvent.change(route, {
      target: { value: 'src/app/(account)/auth/[provider]/page.tsx' },
    });
    const parameter = screen.getByRole('textbox', { name: 'Next route parameter provider' });
    expect(screen.getByText('Complete the selected Next route')).toBeVisible();
    fireEvent.change(parameter, { target: { value: 'github' } });

    await waitFor(() =>
      expect(screen.getByTitle('Live Srijika project preview')).toHaveAttribute(
        'src',
        'http://127.0.0.1:5173/auth/github',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open App' }));
    await waitFor(() =>
      expect(serviceMocks.openCodeProjectApp).toHaveBeenCalledWith(PROJECT_ROOT, '/auth/github'),
    );
  });

  it('keeps project choices usable by stopping a running Full App before transition', async () => {
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(runtimeStatus(true));
    render(<CodeFirstStudio />);

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Project runtime' })).toHaveTextContent(
        'Running on port 5173',
      ),
    );
    const toolbar = document.querySelector<HTMLElement>('.code-first-toolbar');
    if (!toolbar) throw new Error('Expected the Studio toolbar');
    const openProject = within(toolbar).getByRole('button', { name: 'Open project' });
    expect(openProject).toBeEnabled();
    fireEvent.click(openProject);

    await waitFor(() => expect(serviceMocks.stopCodeProject).toHaveBeenCalledWith(PROJECT_ROOT));
  });

  it('keeps Run App in the starting state until compilation and HTTP readiness finish', async () => {
    const launch = deferred<ReturnType<typeof runtimeStatus>>();
    serviceMocks.startCodeProject.mockImplementation(() => launch.promise);
    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(await within(runtime).findByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Run App' }));
    expect(await within(runtime).findByText('Starting application…')).toBeInTheDocument();
    expect(within(runtime).getByRole('button', { name: 'Open App' })).toBeDisabled();

    launch.resolve(runtimeStatus(true));
    await waitFor(() => {
      expect(within(runtime).getByText('Running on port 5173')).toBeInTheDocument();
      expect(within(runtime).getByRole('button', { name: 'Open App' })).toBeEnabled();
    });
  });

  it('shows serialized native start failures instead of object coercion', async () => {
    serviceMocks.startCodeProject.mockRejectedValue({
      code: 'project_compile_failed',
      message: 'Home.connector.tsx is missing a required UI prop.',
    });
    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(await within(runtime).findByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Run App' }));

    expect(
      await within(runtime).findByText(
        'Home.connector.tsx is missing a required UI prop. [project_compile_failed]',
      ),
    ).toHaveClass('is-error');
    expect(within(runtime).queryByText('[object Object]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-preview-runtime="last-good-derived"]')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Showing the last valid derived UI: Home.connector.tsx is missing a required UI prop.',
    );
  });

  it('starts the managed project and waits for readiness before opening Browser preview', async () => {
    const launch = deferred<ReturnType<typeof runtimeStatus>>();
    serviceMocks.startCodeProject.mockImplementation(() => launch.promise);
    render(<CodeFirstStudio />);
    expect(await screen.findByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Browser preview' }));
    expect(await screen.findByRole('button', { name: 'Opening live preview…' })).toBeDisabled();
    expect(serviceMocks.openCodeProjectPreview).not.toHaveBeenCalled();

    launch.resolve(runtimeStatus(true));
    await waitFor(() => {
      expect(serviceMocks.startCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(serviceMocks.openCodeProjectPreview).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    expect(screen.getByText('Live project preview opened at http://127.0.0.1:5173')).toBeVisible();
  });

  it('reuses an already-ready managed project for Browser preview', async () => {
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(runtimeStatus(true));
    render(<CodeFirstStudio />);
    expect(await screen.findByText('Running on port 5173')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Browser preview' }));
    await waitFor(() =>
      expect(serviceMocks.openCodeProjectPreview).toHaveBeenCalledWith(PROJECT_ROOT),
    );
    expect(serviceMocks.installProjectDependencies).not.toHaveBeenCalled();
    expect(serviceMocks.startCodeProject).not.toHaveBeenCalled();
  });

  it('synchronizes the project lockfile before starting Browser preview', async () => {
    serviceMocks.getProjectRuntimeStatus
      .mockResolvedValueOnce(runtimeStatus())
      .mockResolvedValueOnce(runtimeStatus(false, 'notInstalled'))
      .mockResolvedValueOnce(runtimeStatus());
    render(<CodeFirstStudio />);
    expect(await screen.findByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Browser preview' }));
    await waitFor(() => {
      expect(serviceMocks.installProjectDependencies).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(serviceMocks.startCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(serviceMocks.openCodeProjectPreview).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    expect(serviceMocks.installProjectDependencies.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.startCodeProject.mock.invocationCallOrder[0]!,
    );
    expect(serviceMocks.startCodeProject.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.openCodeProjectPreview.mock.invocationCallOrder[0]!,
    );
  });

  it('automatically installs missing dependencies before Run App', async () => {
    serviceMocks.getProjectRuntimeStatus.mockReset();
    serviceMocks.getProjectRuntimeStatus
      .mockResolvedValueOnce(runtimeStatus(false, 'notInstalled'))
      .mockResolvedValueOnce(runtimeStatus(false, 'notInstalled'))
      .mockResolvedValue(runtimeStatus());
    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(await within(runtime).findByText('Dependencies not installed')).toBeInTheDocument();
    expect(within(runtime).getByRole('button', { name: 'Run App' })).toBeEnabled();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Run App' }));
    await waitFor(() => {
      expect(serviceMocks.installProjectDependencies).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(serviceMocks.startCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    expect(serviceMocks.installProjectDependencies.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.startCodeProject.mock.invocationCallOrder[0]!,
    );
  });

  it('automatically installs outdated dependencies before Build App', async () => {
    serviceMocks.getProjectRuntimeStatus.mockReset();
    serviceMocks.getProjectRuntimeStatus
      .mockResolvedValueOnce(runtimeStatus(false, 'outdated'))
      .mockResolvedValueOnce(runtimeStatus(false, 'outdated'))
      .mockResolvedValue(runtimeStatus());
    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(await within(runtime).findByText('Dependencies need sync')).toBeInTheDocument();
    expect(within(runtime).getByRole('button', { name: 'Build App' })).toBeEnabled();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Build App' }));
    await waitFor(() => {
      expect(serviceMocks.installProjectDependencies).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(serviceMocks.buildCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    expect(serviceMocks.installProjectDependencies.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.buildCodeProject.mock.invocationCallOrder[0]!,
    );
  });

  it('rechecks dependency state at click time instead of trusting the cached poll', async () => {
    serviceMocks.getProjectRuntimeStatus.mockReset();
    serviceMocks.getProjectRuntimeStatus
      .mockResolvedValueOnce(runtimeStatus())
      .mockResolvedValueOnce(runtimeStatus(false, 'outdated'))
      .mockResolvedValue(runtimeStatus());
    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(await within(runtime).findByText('Ready to run')).toBeInTheDocument();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Run App' }));
    await waitFor(() => {
      expect(serviceMocks.installProjectDependencies).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(serviceMocks.startCodeProject).toHaveBeenCalledWith(PROJECT_ROOT);
    });
    expect(serviceMocks.installProjectDependencies.mock.invocationCallOrder[0]).toBeLessThan(
      serviceMocks.startCodeProject.mock.invocationCallOrder[0]!,
    );
  });

  it('stops Run App when automatic dependency installation fails', async () => {
    serviceMocks.getProjectRuntimeStatus.mockReset();
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue(runtimeStatus(false, 'notInstalled'));
    serviceMocks.installProjectDependencies.mockResolvedValue({
      ...successfulTask('install'),
      success: false,
      exitCode: 1,
      stderr: 'registry unavailable',
    });
    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(await within(runtime).findByText('Dependencies not installed')).toBeInTheDocument();

    fireEvent.click(within(runtime).getByRole('button', { name: 'Run App' }));
    await waitFor(() => {
      expect(serviceMocks.installProjectDependencies).toHaveBeenCalledWith(PROJECT_ROOT);
      expect(within(runtime).getByText('registry unavailable')).toBeInTheDocument();
    });
    expect(serviceMocks.startCodeProject).not.toHaveBeenCalled();
  });

  it('surfaces a managed dev-server exit instead of reporting the project ready', async () => {
    serviceMocks.getProjectRuntimeStatus.mockReset();
    serviceMocks.getProjectRuntimeStatus.mockResolvedValue({
      ...runtimeStatus(false),
      devServer: {
        ...runtimeStatus(false).devServer,
        state: 'exited',
        exitCode: 1,
        stderr: 'Generated project dev server failed to bind its port',
      },
    });

    render(<CodeFirstStudio />);
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(
      await within(runtime).findByText(
        'App exited (code 1) — Generated project dev server failed to bind its port',
      ),
    ).toHaveClass('is-error');
    expect(within(runtime).queryByText('Ready to run')).not.toBeInTheDocument();
  });
});
