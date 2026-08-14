import { beforeEach, describe, expect, it } from 'vitest';

import { codeProjectEntriesFromFileMap } from '../../apps/studio/src/components/code-first/ProjectExplorer';
import type { CodeProjectEntry } from '../../apps/studio/src/lib/project-service';
import { useProjectSessionStore } from '../../apps/studio/src/store/project-session-store';

function uiEntry(relativePath: string, hash: string): CodeProjectEntry {
  return {
    path: `/projects/demo/${relativePath}`,
    relativePath,
    kind: 'file',
    bytes: 120,
    hash,
    isUiSource: true,
  };
}

describe('project session store', () => {
  beforeEach(() => useProjectSessionStore.getState().resetSession());

  it('tracks the real project root, active UI source, and refreshed flat index', () => {
    const header = uiEntry('src/components/Header.ui.tsx', 'header-v1');
    const profile = uiEntry('src/components/Profile.ui.tsx', 'profile-v1');
    useProjectSessionStore.getState().attachProject({
      rootPath: '/projects/demo',
      displayName: 'demo',
      entries: [profile, header],
      activeUiSourcePath: header.path,
    });

    expect(useProjectSessionStore.getState()).toMatchObject({
      rootPath: '/projects/demo',
      displayName: 'demo',
      activeUiSourcePath: header.path,
      selectedPath: header.path,
      indexStatus: 'ready',
      truncated: false,
    });
    expect(useProjectSessionStore.getState().entries.map((entry) => entry.relativePath)).toEqual([
      'src/components/Header.ui.tsx',
      'src/components/Profile.ui.tsx',
    ]);
  });

  it('marks inactive UI hashes changed by VS Code and clears the marker when selected', () => {
    const header = uiEntry('src/Header.ui.tsx', 'header-v1');
    const profile = uiEntry('src/Profile.ui.tsx', 'profile-v1');
    useProjectSessionStore.getState().attachProject({
      rootPath: '/projects/demo',
      displayName: 'demo',
      entries: [header, profile],
      activeUiSourcePath: header.path,
    });

    useProjectSessionStore.getState().replaceIndex({
      entries: [header, { ...profile, hash: 'profile-v2' }],
    });
    expect(useProjectSessionStore.getState().externallyChangedUiSourcePaths).toEqual([
      profile.path,
    ]);

    useProjectSessionStore.getState().activateUiSource(profile.path);
    expect(useProjectSessionStore.getState().externallyChangedUiSourcePaths).toEqual([]);
  });

  it('clears the active UI source and selection when the active file disappears from the index', () => {
    const header = uiEntry('src/Header.ui.tsx', 'header-v1');
    const profile = uiEntry('src/Profile.ui.tsx', 'profile-v1');
    useProjectSessionStore.getState().attachProject({
      rootPath: '/projects/demo',
      displayName: 'demo',
      entries: [header, profile],
      activeUiSourcePath: header.path,
    });
    useProjectSessionStore.getState().selectPath(profile.path);

    useProjectSessionStore.getState().replaceIndex({ entries: [profile] });

    expect(useProjectSessionStore.getState()).toMatchObject({
      activeUiSourcePath: null,
      selectedPath: null,
    });
  });

  it('builds a complete in-memory explorer with synthesized directories and UI flags', () => {
    const entries = codeProjectEntriesFromFileMap({
      'package.json': '{}',
      'src/components/Home.ui.tsx': 'export function Home() { return <main />; }',
      'src/components/Home.connector.tsx': 'export function HomeConnector() { return null; }',
    });

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'src', kind: 'directory' }),
        expect.objectContaining({ relativePath: 'src/components', kind: 'directory' }),
        expect.objectContaining({
          relativePath: 'src/components/Home.ui.tsx',
          kind: 'file',
          isUiSource: true,
        }),
        expect.objectContaining({
          relativePath: 'src/components/Home.connector.tsx',
          isUiSource: false,
        }),
      ]),
    );
  });
});
