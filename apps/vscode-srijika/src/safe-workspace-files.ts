import type {
  ResolvedSrijikaArchitectureConfig,
  ResolvedSrijikaBrownfieldAdoptionConfig,
} from '@srijika/architecture-rules';
import {
  SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
  SrijikaProjectFileSystem,
  type SrijikaSafeProjectFile,
} from '@srijika/developer-engine';

import { isSrijikaArchitectureSourcePath } from './architecture-discovery';

export const SRIJIKA_WORKSPACE_DISCOVERY_LIMITS = Object.freeze({
  maximumFiles: 4_096,
  maximumEntries: 32_768,
  maximumDirectories: 4_096,
  maximumDepth: 32,
});

export async function openSafeSrijikaWorkspace(
  projectRoot: string,
): Promise<SrijikaProjectFileSystem> {
  return SrijikaProjectFileSystem.open(projectRoot);
}

export async function discoverSafeSrijikaSources(
  fileSystem: SrijikaProjectFileSystem,
  architecture: ResolvedSrijikaArchitectureConfig,
  adoption?: ResolvedSrijikaBrownfieldAdoptionConfig,
): Promise<readonly SrijikaSafeProjectFile[]> {
  return fileSystem.walkFiles(
    adoption?.managedRoots ?? [architecture.featuresRoot, architecture.sharedRoot],
    {
      ...SRIJIKA_WORKSPACE_DISCOVERY_LIMITS,
      ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
      acceptFile: isSrijikaArchitectureSourcePath,
    },
  );
}

/**
 * Discovers only bounded TS/JS project source that can legally contain imports
 * rewritten by an atomic flat-to-folder Hook or Store migration. Architecture
 * validation deliberately continues to use discoverSafeSrijikaSources above.
 */
export async function discoverSafeSrijikaMigrationSources(
  fileSystem: SrijikaProjectFileSystem,
): Promise<readonly SrijikaSafeProjectFile[]> {
  return fileSystem.walkFiles([''], {
    ...SRIJIKA_WORKSPACE_DISCOVERY_LIMITS,
    ignoredDirectoryNames: SRIJIKA_IGNORED_PROJECT_DIRECTORIES,
    allowIgnoredDirectorySymlinks: true,
    stopAtNestedProjectRoots: true,
    acceptFile: isSrijikaArchitectureSourcePath,
  });
}
