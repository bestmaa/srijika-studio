import { create } from 'zustand';

import type { CodeProjectEntry } from '../lib/project-service';

export type ProjectIndexStatus = 'detached' | 'loading' | 'ready' | 'error';

export interface AttachCodeProjectInput {
  rootPath: string | null;
  displayName: string;
  entries?: readonly CodeProjectEntry[];
  activeUiSourcePath?: string | null;
  truncated?: boolean;
}

export interface ReplaceCodeProjectIndexInput {
  entries: readonly CodeProjectEntry[];
  truncated?: boolean;
}

export interface ProjectSessionRecovery {
  rootPath: string;
  displayName: string;
  activeUiSourcePath: string | null;
}

interface ProjectSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const PROJECT_SESSION_RECOVERY_KEY = 'srijika.project-session.v1';

function browserStorage(): ProjectSessionStorage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function loadProjectSessionRecovery(
  storage: ProjectSessionStorage | null = browserStorage(),
): ProjectSessionRecovery | null {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(PROJECT_SESSION_RECOVERY_KEY) ?? 'null') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    if (
      typeof value['rootPath'] !== 'string' ||
      !value['rootPath'].trim() ||
      typeof value['displayName'] !== 'string' ||
      !value['displayName'].trim() ||
      (value['activeUiSourcePath'] !== null && typeof value['activeUiSourcePath'] !== 'string')
    ) {
      return null;
    }
    return {
      rootPath: value['rootPath'],
      displayName: value['displayName'],
      activeUiSourcePath: value['activeUiSourcePath'],
    };
  } catch {
    return null;
  }
}

function persistProjectSessionRecovery(
  recovery: ProjectSessionRecovery | null,
  storage: ProjectSessionStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    if (recovery) storage.setItem(PROJECT_SESSION_RECOVERY_KEY, JSON.stringify(recovery));
    else storage.removeItem(PROJECT_SESSION_RECOVERY_KEY);
  } catch {
    // Recovery is best-effort; project access must continue when storage is unavailable.
  }
}

export interface ProjectSessionState {
  rootPath: string | null;
  displayName: string | null;
  entries: readonly CodeProjectEntry[];
  externallyChangedUiSourcePaths: readonly string[];
  selectedPath: string | null;
  activeUiSourcePath: string | null;
  indexStatus: ProjectIndexStatus;
  indexError: string | null;
  truncated: boolean;
  lastIndexedAt: number | null;
  attachProject: (input: AttachCodeProjectInput) => void;
  replaceIndex: (input: ReplaceCodeProjectIndexInput) => void;
  setIndexLoading: () => void;
  setIndexError: (message: string) => void;
  selectPath: (path: string | null) => void;
  activateUiSource: (path: string) => void;
  resetSession: () => void;
}

function normalizedEntries(entries: readonly CodeProjectEntry[]): readonly CodeProjectEntry[] {
  const unique = new Map<string, CodeProjectEntry>();
  for (const entry of entries) unique.set(entry.relativePath, entry);
  return [...unique.values()].sort((left, right) => {
    const leftParts = left.relativePath.split('/');
    const rightParts = right.relativePath.split('/');
    const sharedLength = Math.min(leftParts.length, rightParts.length);
    for (let index = 0; index < sharedLength; index += 1) {
      const leftPart = leftParts[index] ?? '';
      const rightPart = rightParts[index] ?? '';
      if (leftPart === rightPart) continue;
      return leftPart.localeCompare(rightPart, undefined, { sensitivity: 'base' });
    }
    if (leftParts.length !== rightParts.length) return leftParts.length - rightParts.length;
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return left.relativePath.localeCompare(right.relativePath);
  });
}

const INITIAL_STATE = {
  rootPath: null,
  displayName: null,
  entries: [] as readonly CodeProjectEntry[],
  externallyChangedUiSourcePaths: [] as readonly string[],
  selectedPath: null,
  activeUiSourcePath: null,
  indexStatus: 'detached' as const,
  indexError: null,
  truncated: false,
  lastIndexedAt: null,
};

export const useProjectSessionStore = create<ProjectSessionState>((set) => ({
  ...INITIAL_STATE,

  attachProject: (input) => {
    const entries = normalizedEntries(input.entries ?? []);
    persistProjectSessionRecovery(
      input.rootPath
        ? {
            rootPath: input.rootPath,
            displayName: input.displayName,
            activeUiSourcePath: input.activeUiSourcePath ?? null,
          }
        : null,
    );
    set({
      rootPath: input.rootPath,
      displayName: input.displayName,
      entries,
      externallyChangedUiSourcePaths: [],
      selectedPath: input.activeUiSourcePath ?? null,
      activeUiSourcePath: input.activeUiSourcePath ?? null,
      indexStatus: entries.length > 0 ? 'ready' : input.rootPath ? 'loading' : 'detached',
      indexError: null,
      truncated: input.truncated ?? false,
      lastIndexedAt: entries.length > 0 ? Date.now() : null,
    });
  },

  replaceIndex: (input) =>
    set((state) => {
      const entries = normalizedEntries(input.entries);
      const entryPaths = new Set(entries.map((entry) => entry.path));
      const previousEntries = new Map(state.entries.map((entry) => [entry.path, entry]));
      const changedUiSources = new Set(
        state.externallyChangedUiSourcePaths.filter((path) => entryPaths.has(path)),
      );
      for (const entry of entries) {
        const previous = previousEntries.get(entry.path);
        if (
          entry.isUiSource &&
          entry.path !== state.activeUiSourcePath &&
          previous?.hash &&
          entry.hash &&
          previous.hash !== entry.hash
        ) {
          changedUiSources.add(entry.path);
        }
      }
      const activeUiSourceStillExists =
        state.activeUiSourcePath !== null && entryPaths.has(state.activeUiSourcePath);
      return {
        entries,
        externallyChangedUiSourcePaths: [...changedUiSources],
        selectedPath: activeUiSourceStillExists
          ? state.selectedPath && entryPaths.has(state.selectedPath)
            ? state.selectedPath
            : null
          : null,
        activeUiSourcePath: activeUiSourceStillExists ? state.activeUiSourcePath : null,
        indexStatus: 'ready',
        indexError: null,
        truncated: input.truncated ?? false,
        lastIndexedAt: Date.now(),
      };
    }),

  setIndexLoading: () => set({ indexStatus: 'loading', indexError: null }),
  setIndexError: (message) => set({ indexStatus: 'error', indexError: message }),
  selectPath: (path) => set({ selectedPath: path }),
  activateUiSource: (path) =>
    set((state) => {
      if (state.rootPath && state.displayName) {
        persistProjectSessionRecovery({
          rootPath: state.rootPath,
          displayName: state.displayName,
          activeUiSourcePath: path,
        });
      }
      return {
        selectedPath: path,
        activeUiSourcePath: path,
        externallyChangedUiSourcePaths: state.externallyChangedUiSourcePaths.filter(
          (changedPath) => changedPath !== path,
        ),
      };
    }),
  resetSession: () => {
    persistProjectSessionRecovery(null);
    set(INITIAL_STATE);
  },
}));

export function projectDisplayName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).at(-1) || path;
}

export function projectEntryForPath(
  entries: readonly CodeProjectEntry[],
  path: string | null,
): CodeProjectEntry | null {
  if (!path) return null;
  return entries.find((entry) => entry.path === path) ?? null;
}
