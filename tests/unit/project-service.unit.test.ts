// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();

import {
  buildCodeProject,
  createCodeProjectUiSource,
  getLaunchProject,
  getProjectRuntimeStatus,
  installProjectDependencies,
  loadCodeProjectArchitectureSources,
  loadCodeProjectPreviewStyles,
  openBrowserPreview,
  openCodeProject,
  openCodeProjectApp,
  openCodeProjectPreview,
  openInVsCode,
  scanCodeProject,
  scaffoldCodeProjectStructure,
  startCodeProject,
  stopCodeProject,
} from '../../apps/studio/src/lib/project-service';
import { projectServiceErrorMessage } from '../../apps/studio/src/lib/error-message';

describe('projectServiceErrorMessage', () => {
  it('renders serialized native command failures without object coercion', () => {
    expect(
      projectServiceErrorMessage({
        code: 'project_app_start_failed',
        message: 'TypeScript build failed in Home.connector.tsx.',
      }),
    ).toBe('TypeScript build failed in Home.connector.tsx. [project_app_start_failed]');
    expect(projectServiceErrorMessage(new Error('normal error'))).toBe('normal error');
    expect(projectServiceErrorMessage({ detail: 'fallback' })).toBe('{"detail":"fallback"}');
  });
});

describe('openBrowserPreview', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('opens and focuses the preview route in a normal browser', async () => {
    const focus = vi.fn();
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus } as unknown as Window);

    await openBrowserPreview();

    expect(open).toHaveBeenCalledWith('http://localhost:3000/preview', 'srijika-preview');
    expect(focus).toHaveBeenCalledOnce();
  });

  it('reports a blocked browser popup', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(openBrowserPreview()).rejects.toThrow('browser blocked the preview window');
  });
});

describe('desktop code project services', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke: invokeMock },
    });
  });

  afterEach(() => Reflect.deleteProperty(window, '__TAURI_INTERNALS__'));

  it('reads the CLI launch project and opens it through the bounded native service', async () => {
    invokeMock.mockResolvedValueOnce('/projects/from-cli');
    await expect(getLaunchProject()).resolves.toBe('/projects/from-cli');
    expect(invokeMock).toHaveBeenLastCalledWith('get_launch_project', {}, undefined);

    invokeMock.mockResolvedValueOnce({
      path: '/projects/from-cli',
      entrySourcePath: '/projects/from-cli/src/features/home/Home.ui.tsx',
      bytes: 48,
      hash: 'fnv1a64:1234567890abcdef',
      source: 'export function HomeUI() { return <main />; }',
    });
    await expect(openCodeProject('/projects/from-cli')).resolves.toMatchObject({
      path: '/projects/from-cli',
      entrySourcePath: '/projects/from-cli/src/features/home/Home.ui.tsx',
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'open_code_project',
      { request: { path: '/projects/from-cli' } },
      undefined,
    );
  });

  it('parses the bounded flat project index and sends root-relative VS Code targets', async () => {
    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo',
      entrySourcePath: '/projects/demo/src/Home.ui.tsx',
      entries: [
        {
          path: '/projects/demo/src',
          relativePath: 'src',
          kind: 'directory',
          bytes: null,
          hash: null,
          isUiSource: false,
        },
        {
          path: '/projects/demo/src/Home.ui.tsx',
          relativePath: 'src/Home.ui.tsx',
          kind: 'file',
          bytes: 80,
          hash: 'fnv1a:home',
          isUiSource: true,
        },
      ],
      truncated: false,
    });

    await expect(scanCodeProject('/projects/demo')).resolves.toMatchObject({
      path: '/projects/demo',
      entries: [
        { relativePath: 'src', kind: 'directory' },
        { relativePath: 'src/Home.ui.tsx', kind: 'file', isUiSource: true },
      ],
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'scan_code_project',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      targetPath: '/projects/demo/src/Home.ui.tsx',
      line: 12,
      column: 7,
    });
    await expect(
      openInVsCode({
        projectPath: '/projects/demo',
        relativePath: 'src/Home.ui.tsx',
        line: 12,
        column: 7,
      }),
    ).resolves.toMatchObject({ line: 12, column: 7 });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'open_in_vscode',
      {
        request: {
          projectPath: '/projects/demo',
          relativePath: 'src/Home.ui.tsx',
          line: 12,
          column: 7,
        },
      },
      undefined,
    );
  });

  it('parses only bounded validated architecture source snapshots', async () => {
    const source = 'export const home = true;\n';
    const configSource = JSON.stringify({
      sourceOfTruth: 'tsx',
      entry: 'src/features/home/Home.ui.tsx',
      architecture: { profile: 'feature-slot-part-v1' },
    });
    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo',
      configSource,
      sources: [
        {
          path: '/projects/demo/src/features/home/Home.ui.tsx',
          relativePath: 'src/features/home/Home.ui.tsx',
          bytes: source.length,
          hash: 'fnv1a64:0123456789abcdef',
          source,
        },
      ],
      truncated: false,
    });

    await expect(loadCodeProjectArchitectureSources('/projects/demo')).resolves.toEqual({
      path: '/projects/demo',
      configSource,
      sources: [
        {
          path: '/projects/demo/src/features/home/Home.ui.tsx',
          relativePath: 'src/features/home/Home.ui.tsx',
          bytes: source.length,
          hash: 'fnv1a64:0123456789abcdef',
          source,
        },
      ],
      truncated: false,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'load_code_project_architecture_sources',
      { request: { path: '/projects/demo' } },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo',
      configSource,
      sources: [
        {
          path: '/projects/outside.ts',
          relativePath: 'src/outside.ts',
          bytes: source.length,
          hash: 'fnv1a64:0123456789abcdef',
          source,
        },
      ],
      truncated: false,
    });
    await expect(loadCodeProjectArchitectureSources('/projects/demo')).rejects.toThrow(
      'invalid architecture source',
    );

    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo',
      configSource: '{not-json',
      sources: [],
      truncated: false,
    });
    await expect(loadCodeProjectArchitectureSources('/projects/demo')).rejects.toThrow(
      'invalid architecture sources',
    );
  });

  it('loads validated project preview stylesheets without exposing an arbitrary file reader', async () => {
    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo',
      designProps: { pageClassName: 'demo-page' },
      assets: [
        {
          path: '/projects/demo/public/mark.svg',
          publicPath: '/mark.svg',
          bytes: 11,
          hash: 'fnv1a64:mark',
          mediaType: 'image/svg+xml',
          source: '<svg></svg>',
        },
      ],
      stylesheets: [
        {
          path: '/projects/demo/src/styles.css',
          relativePath: 'src/styles.css',
          bytes: 31,
          hash: 'fnv1a64:styles',
          source: '.hero { display: grid; }\n',
        },
      ],
    });

    await expect(loadCodeProjectPreviewStyles('/projects/demo')).resolves.toEqual({
      path: '/projects/demo',
      designProps: { pageClassName: 'demo-page' },
      assets: [
        {
          path: '/projects/demo/public/mark.svg',
          publicPath: '/mark.svg',
          bytes: 11,
          hash: 'fnv1a64:mark',
          mediaType: 'image/svg+xml',
          source: '<svg></svg>',
        },
      ],
      stylesheets: [
        {
          path: '/projects/demo/src/styles.css',
          relativePath: 'src/styles.css',
          bytes: 31,
          hash: 'fnv1a64:styles',
          source: '.hero { display: grid; }\n',
        },
      ],
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'load_code_project_preview_styles',
      { request: { path: '/projects/demo' } },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo',
      designProps: {},
      assets: [],
      stylesheets: [{ relativePath: 'src/styles.css', bytes: 7, source: 'body {}' }],
    });
    await expect(loadCodeProjectPreviewStyles('/projects/demo')).rejects.toThrow('invalid path');
  });

  it('creates a typed UI source pair and validates the desktop response', async () => {
    const request = {
      projectPath: '/projects/demo',
      relativePath: 'src/components/ProfileCard.ui.tsx',
      kind: 'component' as const,
      componentName: 'ProfileCard',
      createConnector: true,
    };
    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo/src/components/ProfileCard.ui.tsx',
      relativePath: 'src/components/ProfileCard.ui.tsx',
      connectorPath: '/projects/demo/src/components/ProfileCard.connector.tsx',
      bytes: 280,
      hash: 'fnv1a64:profile',
      source: 'export function ProfileCardUI() { return <section />; }\n',
      kind: 'component',
      componentName: 'ProfileCard',
    });

    await expect(createCodeProjectUiSource(request)).resolves.toMatchObject({
      relativePath: request.relativePath,
      kind: 'component',
      componentName: 'ProfileCard',
      hash: 'fnv1a64:profile',
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'create_code_project_ui_source',
      { request },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo/src/components/Broken.ui.tsx',
      relativePath: 'src/components/Broken.ui.tsx',
      connectorPath: '/projects/demo/src/components/Broken.connector.tsx',
      bytes: 1,
      hash: 'hash',
      source: 'x',
      kind: 'unknown',
      componentName: 'Broken',
    });
    await expect(
      createCodeProjectUiSource({
        ...request,
        relativePath: 'src/components/Broken.ui.tsx',
        componentName: 'Broken',
      }),
    ).rejects.toThrow('invalid created UI source response');

    invokeMock.mockResolvedValueOnce({
      path: '/projects/demo/src/components/StatusBadge.ui.tsx',
      relativePath: 'src/components/StatusBadge.ui.tsx',
      connectorPath: null,
      bytes: 120,
      hash: 'fnv1a64:badge',
      source: 'export function StatusBadgeUI() { return <span />; }\n',
      kind: 'component',
      componentName: 'StatusBadge',
    });
    await expect(
      createCodeProjectUiSource({
        ...request,
        relativePath: 'src/components/StatusBadge.ui.tsx',
        componentName: 'StatusBadge',
        createConnector: false,
      }),
    ).resolves.toMatchObject({ connectorPath: null, componentName: 'StatusBadge' });
  });

  it('scaffolds a canonical feature capability and validates every created file', async () => {
    const request = {
      projectPath: '/projects/demo',
      featureName: 'Home',
      capability: {
        kind: 'slot' as const,
        slotName: 'Navigation',
        createConnector: true,
        createHook: true,
        createStore: true,
        createLogic: true,
        createApi: true,
        createTypes: true,
        hookName: null,
        partName: 'NavItem',
        createPartConnector: true,
      },
    };
    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      featureName: 'Home',
      featurePath: 'src/features/home',
      capability: request.capability,
      files: [
        {
          path: '/projects/demo/src/features/home/slots/navigation/Navigation.ui.tsx',
          relativePath: 'src/features/home/slots/navigation/Navigation.ui.tsx',
          role: 'slotUi',
          bytes: 211,
          hash: 'fnv1a64:navigation',
        },
        {
          path: '/projects/demo/src/features/home/slots/navigation/navigation.store.ts',
          relativePath: 'src/features/home/slots/navigation/navigation.store.ts',
          role: 'slotStore',
          bytes: 220,
          hash: 'fnv1a64:store',
        },
      ],
      bytes: 431,
    });

    await expect(scaffoldCodeProjectStructure(request)).resolves.toMatchObject({
      featurePath: 'src/features/home',
      capability: request.capability,
      files: [
        {
          role: 'slotUi',
          relativePath: 'src/features/home/slots/navigation/Navigation.ui.tsx',
        },
        {
          role: 'slotStore',
          relativePath: 'src/features/home/slots/navigation/navigation.store.ts',
        },
      ],
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'scaffold_code_project_structure',
      { request },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      featureName: 'Home',
      featurePath: 'src/features/home',
      capability: { kind: 'featureStore' },
      files: [
        {
          path: '/projects/demo/src/features/home/home.store.ts',
          relativePath: 'src/features/home/home.store.ts',
          role: 'notARealRole',
          bytes: 10,
          hash: 'fnv1a64:bad',
        },
      ],
      bytes: 10,
    });
    await expect(
      scaffoldCodeProjectStructure({
        projectPath: '/projects/demo',
        featureName: 'Home',
        capability: { kind: 'featureStore' },
      }),
    ).rejects.toThrow('invalid scaffolded file');
  });

  it('parses new feature and standalone owner companion capabilities', async () => {
    const featureRequest = {
      projectPath: '/projects/demo',
      featureName: 'AdminPanel',
      capability: {
        kind: 'feature' as const,
        createConnector: true,
        createHook: true,
        createStore: true,
        createLogic: true,
        createApi: true,
        createTypes: true,
        hookName: null,
      },
    };
    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      featureName: 'AdminPanel',
      featurePath: 'src/features/admin-panel',
      capability: featureRequest.capability,
      files: [
        {
          path: '/projects/demo/src/features/admin-panel/AdminPanel.ui.tsx',
          relativePath: 'src/features/admin-panel/AdminPanel.ui.tsx',
          role: 'featureUi',
          bytes: 120,
          hash: 'fnv1a64:feature',
        },
      ],
      bytes: 120,
    });
    await expect(scaffoldCodeProjectStructure(featureRequest)).resolves.toMatchObject({
      capability: featureRequest.capability,
      files: [{ role: 'featureUi' }],
    });

    const companionRequest = {
      projectPath: '/projects/demo',
      featureName: 'AdminPanel',
      capability: {
        kind: 'partHook' as const,
        slotName: 'UserNavigation',
        partName: 'AccountMenu',
      },
    };
    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      featureName: 'AdminPanel',
      featurePath: 'src/features/admin-panel',
      capability: companionRequest.capability,
      files: [
        {
          path: '/projects/demo/src/features/admin-panel/slots/user-navigation/parts/account-menu/useAccountMenu.ts',
          relativePath:
            'src/features/admin-panel/slots/user-navigation/parts/account-menu/useAccountMenu.ts',
          role: 'partHook',
          bytes: 80,
          hash: 'fnv1a64:part-hook',
        },
      ],
      bytes: 80,
    });
    await expect(scaffoldCodeProjectStructure(companionRequest)).resolves.toMatchObject({
      capability: companionRequest.capability,
      files: [{ role: 'partHook' }],
    });
  });

  it('parses runtime status and invokes install, run, stop, and build at the project root', async () => {
    const stoppedStatus = {
      path: '/projects/demo',
      lockfilePresent: true,
      dependenciesInstalled: true,
      dependenciesReady: true,
      dependencyState: 'ready',
      activeTask: null,
      lastTask: null,
      running: false,
      port: null,
      devServer: {
        state: 'stopped',
        ready: false,
        pid: null,
        port: null,
        url: null,
        exitCode: null,
        stdout: '',
        stderr: '',
        outputTruncated: false,
        startedAtMillis: null,
      },
      message: 'Dependencies ready.',
    };
    const taskResult = {
      projectPath: '/projects/demo',
      kind: 'install',
      success: true,
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      outputTruncated: false,
      durationMillis: 1200,
    };

    invokeMock.mockResolvedValueOnce(stoppedStatus);
    await expect(getProjectRuntimeStatus('/projects/demo')).resolves.toMatchObject({
      dependencyState: 'ready',
      running: false,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'get_project_runtime_status',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce(taskResult);
    await expect(installProjectDependencies('/projects/demo')).resolves.toMatchObject({
      kind: 'install',
      success: true,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'install_project_dependencies',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      ...stoppedStatus,
      running: true,
      port: 5178,
      devServer: {
        ...stoppedStatus.devServer,
        state: 'running',
        ready: true,
        pid: 42,
        port: 5178,
        url: 'http://127.0.0.1:5178',
        startedAtMillis: 1_700_000_000_000,
      },
    });
    await expect(startCodeProject('/projects/demo', 5178)).resolves.toMatchObject({
      running: true,
      port: 5178,
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'start_code_project',
      {
        request: { path: '/projects/demo', port: 5178 },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      ...stoppedStatus,
      running: true,
      port: 5178,
      devServer: {
        ...stoppedStatus.devServer,
        state: 'running',
        ready: true,
        pid: 42,
        port: 5178,
        url: 'https://example.com/',
        startedAtMillis: 1_700_000_000_000,
      },
    });
    await expect(getProjectRuntimeStatus('/projects/demo')).rejects.toThrow(
      'non-loopback application URL',
    );

    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      url: 'http://127.0.0.1:5178',
    });
    await expect(openCodeProjectApp('/projects/demo')).resolves.toEqual({
      projectPath: '/projects/demo',
      url: 'http://127.0.0.1:5178',
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'open_code_project_app',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      url: 'http://127.0.0.1:5178',
    });
    await expect(openCodeProjectPreview('/projects/demo')).resolves.toEqual({
      projectPath: '/projects/demo',
      url: 'http://127.0.0.1:5178',
    });
    expect(invokeMock).toHaveBeenLastCalledWith(
      'open_code_project_preview',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce(stoppedStatus);
    await stopCodeProject('/projects/demo');
    expect(invokeMock).toHaveBeenLastCalledWith(
      'stop_code_project',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );

    invokeMock.mockResolvedValueOnce({ ...taskResult, kind: 'build' });
    await buildCodeProject('/projects/demo');
    expect(invokeMock).toHaveBeenLastCalledWith(
      'build_code_project',
      {
        request: { path: '/projects/demo' },
      },
      undefined,
    );
  });

  it('rejects a non-loopback application URL returned by the desktop boundary', async () => {
    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      url: 'https://example.com/',
    });

    await expect(openCodeProjectApp('/projects/demo')).rejects.toThrow(
      'non-loopback application URL',
    );

    invokeMock.mockResolvedValueOnce({
      projectPath: '/projects/demo',
      url: 'https://example.com/',
    });
    await expect(openCodeProjectPreview('/projects/demo')).rejects.toThrow(
      'non-loopback application URL',
    );
  });
});
