import { create } from 'zustand';

import type { UiDocument } from '@srijika/contracts';
import {
  compileSrijikaTsx,
  type SrijikaDiagnostic,
  type SrijikaComponentContractEntry,
  type SrijikaQuickFix,
  type SrijikaSourceEdit,
  type SrijikaSourceMap,
} from '@srijika/tsx-compiler';

import type { CodeProjectArchitectureAnalysis } from '../lib/architecture-diagnostics';
import { useStudioStore } from './studio-store';

export type CodeProjectCompileStatus = 'valid' | 'invalid';

export interface LoadCodeProjectSourceInput {
  fileName: string;
  source: string;
  sourcePath?: string | null;
  diskHash?: string | null;
}

export interface MarkCodeProjectSourceSavedInput {
  sourcePath?: string | null;
  diskHash?: string | null;
}

export interface CompileCodeProjectSourceInput {
  fileName: string;
  source: string;
  sourcePath?: string | null;
  lastValidDocument?: UiDocument | null;
  lastValidComponentContract?: readonly SrijikaComponentContractEntry[];
}

export interface CompileCodeProjectSourceResult {
  compileStatus: CodeProjectCompileStatus;
  diagnostics: readonly SrijikaDiagnostic[];
  sourceMap: SrijikaSourceMap;
  lastValidDocument: UiDocument | null;
  componentContract: readonly SrijikaComponentContractEntry[];
  previewStale: boolean;
}

export interface CodeProjectState {
  hasLoadedSource: boolean;
  fileName: string;
  sourcePath: string | null;
  source: string;
  diskHash: string | null;
  dirty: boolean;
  compileStatus: CodeProjectCompileStatus;
  diagnostics: readonly SrijikaDiagnostic[];
  sourceMap: SrijikaSourceMap | null;
  lastValidDocument: UiDocument | null;
  componentContract: readonly SrijikaComponentContractEntry[];
  previewStale: boolean;
  selectedDiagnosticIndex: number | null;
  architectureDiagnostics: CodeProjectArchitectureAnalysis['diagnostics'];
  architectureRecommendations: CodeProjectArchitectureAnalysis['recommendations'];
  architectureCheckedFileCount: number;
  selectedArchitectureDiagnosticIndex: number | null;
  loadSource: (input: LoadCodeProjectSourceInput) => void;
  clearSource: () => void;
  updateSource: (source: string) => void;
  markSaved: (input?: MarkCodeProjectSourceSavedInput) => void;
  selectDiagnostic: (index: number | null) => void;
  setArchitectureAnalysis: (analysis: CodeProjectArchitectureAnalysis) => void;
  clearArchitectureAnalysis: () => void;
  selectArchitectureDiagnostic: (index: number | null) => void;
  applyQuickFix: (fix: SrijikaQuickFix) => boolean;
}

export const DEFAULT_CODE_PROJECT_FILE_NAME = 'Welcome.ui.tsx';

export const DEFAULT_CODE_PROJECT_SOURCE = `export function Welcome() {
  return (
    <main className="srijika-welcome">
      <section>
        <p>Srijika Studio</p>
        <h1>Start with a Srijika project</h1>
        <p>Create a project folder or open an existing project to build and switch UI sources.</p>
      </section>
    </main>
  );
}
`;

function compilerFileName(fileName: string, sourcePath: string | null | undefined): string {
  return sourcePath?.trim() || fileName;
}

function sourceIdentity(fileName: string, sourcePath: string | null | undefined): string {
  const normalizedPath = sourcePath?.trim();
  return normalizedPath ? `path:${normalizedPath}` : `file:${fileName.trim()}`;
}

function hasErrors(diagnostics: readonly SrijikaDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/**
 * Compile the mutable TSX source and, only when it is valid, publish its
 * derived UiDocument through the existing Studio loading boundary.
 */
export function compileCodeProjectSource(
  input: CompileCodeProjectSourceInput,
): CompileCodeProjectSourceResult {
  const studio = useStudioStore.getState();
  const previouslySelectedNodeId = studio.selectedNodeId;
  const result = compileSrijikaTsx(
    compilerFileName(input.fileName, input.sourcePath),
    input.source,
    {
      documentId: studio.selectedPageId,
      documentKind: 'page',
      revision: studio.document.revision + 1,
    },
  );
  const previousDocument = input.lastValidDocument ?? null;
  const previousContract = input.lastValidComponentContract ?? [];

  if (!result.document || hasErrors(result.diagnostics)) {
    return {
      compileStatus: 'invalid',
      diagnostics: result.diagnostics,
      sourceMap: result.sourceMap,
      lastValidDocument: previousDocument,
      componentContract: previousContract,
      previewStale: true,
    };
  }

  if (!studio.loadDocument(result.document)) {
    const notice = useStudioStore.getState().notice;
    const publishDiagnostic: SrijikaDiagnostic = {
      code: 'SRIJIKA2004',
      severity: 'error',
      message:
        notice?.kind === 'error'
          ? notice.message
          : 'The compiled TSX could not be published to the Srijika preview.',
      fileName: compilerFileName(input.fileName, input.sourcePath),
      span: result.sourceMap.component ?? { start: 0, end: 0, line: 1, column: 1 },
    };
    return {
      compileStatus: 'invalid',
      diagnostics: [...result.diagnostics, publishDiagnostic],
      sourceMap: result.sourceMap,
      lastValidDocument: previousDocument,
      componentContract: previousContract,
      previewStale: true,
    };
  }

  if (
    input.lastValidDocument?.nodes[previouslySelectedNodeId] &&
    useStudioStore.getState().document.nodes[previouslySelectedNodeId]
  ) {
    useStudioStore.getState().selectNode(previouslySelectedNodeId);
  }

  return {
    compileStatus: 'valid',
    diagnostics: result.diagnostics,
    sourceMap: result.sourceMap,
    lastValidDocument: useStudioStore.getState().document,
    componentContract: result.componentContract,
    previewStale: false,
  };
}

function applySourceEdits(source: string, edits: readonly SrijikaSourceEdit[]): string | null {
  if (edits.length === 0) return null;

  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort(
      (left, right) =>
        right.edit.start - left.edit.start ||
        right.edit.end - left.edit.end ||
        right.index - left.index,
    );

  let nextBoundary = source.length;
  let previousStart: number | null = null;
  for (const { edit } of ordered) {
    if (
      !Number.isSafeInteger(edit.start) ||
      !Number.isSafeInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      edit.end > nextBoundary ||
      edit.start === previousStart
    ) {
      return null;
    }
    nextBoundary = edit.start;
    previousStart = edit.start;
  }

  let updated = source;
  for (const { edit } of ordered) {
    updated = `${updated.slice(0, edit.start)}${edit.newText}${updated.slice(edit.end)}`;
  }
  return updated;
}

export const useCodeProjectStore = create<CodeProjectState>((set, get) => ({
  hasLoadedSource: false,
  fileName: DEFAULT_CODE_PROJECT_FILE_NAME,
  sourcePath: null,
  source: DEFAULT_CODE_PROJECT_SOURCE,
  diskHash: null,
  dirty: false,
  compileStatus: 'invalid',
  diagnostics: [],
  sourceMap: null,
  lastValidDocument: null,
  componentContract: [],
  previewStale: false,
  selectedDiagnosticIndex: null,
  architectureDiagnostics: [],
  architectureRecommendations: [],
  architectureCheckedFileCount: 0,
  selectedArchitectureDiagnosticIndex: null,

  loadSource: (input) => {
    const current = get();
    const sourcePath = input.sourcePath ?? null;
    const isSameSource =
      sourceIdentity(input.fileName, sourcePath) ===
      sourceIdentity(current.fileName, current.sourcePath);
    const compilation = compileCodeProjectSource({
      fileName: input.fileName,
      source: input.source,
      sourcePath,
      lastValidDocument: isSameSource ? current.lastValidDocument : null,
      lastValidComponentContract: isSameSource ? current.componentContract : [],
    });
    set({
      hasLoadedSource: true,
      fileName: input.fileName,
      sourcePath,
      source: input.source,
      diskHash: input.diskHash ?? null,
      dirty: false,
      ...compilation,
      selectedDiagnosticIndex: null,
    });
  },

  clearSource: () =>
    set({
      hasLoadedSource: false,
      fileName: DEFAULT_CODE_PROJECT_FILE_NAME,
      sourcePath: null,
      source: DEFAULT_CODE_PROJECT_SOURCE,
      diskHash: null,
      dirty: false,
      compileStatus: 'invalid',
      diagnostics: [],
      sourceMap: null,
      lastValidDocument: null,
      componentContract: [],
      previewStale: false,
      selectedDiagnosticIndex: null,
      architectureDiagnostics: [],
      architectureRecommendations: [],
      architectureCheckedFileCount: 0,
      selectedArchitectureDiagnosticIndex: null,
    }),

  updateSource: (source) => {
    const current = get();
    if (source === current.source) return;
    const compilation = compileCodeProjectSource({
      fileName: current.fileName,
      source,
      sourcePath: current.sourcePath,
      lastValidDocument: current.lastValidDocument,
      lastValidComponentContract: current.componentContract,
    });
    set({
      hasLoadedSource: true,
      source,
      dirty: true,
      ...compilation,
      selectedDiagnosticIndex: null,
    });
  },

  markSaved: (input = {}) =>
    set((state) => ({
      dirty: false,
      sourcePath: input.sourcePath === undefined ? state.sourcePath : input.sourcePath,
      diskHash: input.diskHash === undefined ? state.diskHash : input.diskHash,
    })),

  selectDiagnostic: (index) =>
    set((state) => ({
      selectedDiagnosticIndex:
        index !== null &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < state.diagnostics.length
          ? index
          : null,
      selectedArchitectureDiagnosticIndex: null,
    })),

  setArchitectureAnalysis: (analysis) =>
    set((state) => {
      const selected =
        state.selectedArchitectureDiagnosticIndex === null
          ? null
          : (state.architectureDiagnostics[state.selectedArchitectureDiagnosticIndex] ?? null);
      const selectedArchitectureDiagnosticIndex = selected
        ? analysis.diagnostics.findIndex(
            (diagnostic) =>
              diagnostic.code === selected.code &&
              diagnostic.fileName === selected.fileName &&
              diagnostic.span.start === selected.span.start &&
              diagnostic.span.end === selected.span.end,
          )
        : -1;
      return {
        architectureDiagnostics: analysis.diagnostics,
        architectureRecommendations: analysis.recommendations,
        architectureCheckedFileCount: analysis.checkedFileCount,
        selectedArchitectureDiagnosticIndex:
          selectedArchitectureDiagnosticIndex >= 0 ? selectedArchitectureDiagnosticIndex : null,
      };
    }),

  clearArchitectureAnalysis: () =>
    set({
      architectureDiagnostics: [],
      architectureRecommendations: [],
      architectureCheckedFileCount: 0,
      selectedArchitectureDiagnosticIndex: null,
    }),

  selectArchitectureDiagnostic: (index) =>
    set((state) => ({
      selectedArchitectureDiagnosticIndex:
        index !== null &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < state.architectureDiagnostics.length
          ? index
          : null,
      selectedDiagnosticIndex: null,
    })),

  applyQuickFix: (fix) => {
    const state = get();
    const isCurrentFix = state.diagnostics.some((diagnostic) =>
      diagnostic.quickFixes?.includes(fix),
    );
    if (!isCurrentFix) return false;
    const updated = applySourceEdits(state.source, fix.edits);
    if (updated === null || updated === state.source) return false;
    state.updateSource(updated);
    return true;
  },
}));
