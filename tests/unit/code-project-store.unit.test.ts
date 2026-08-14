import { beforeEach, describe, expect, it } from 'vitest';

import type { UiDocument } from '@srijika/contracts';

import {
  DEFAULT_CODE_PROJECT_FILE_NAME,
  DEFAULT_CODE_PROJECT_SOURCE,
  compileCodeProjectSource,
  useCodeProjectStore,
} from '../../apps/studio/src/store/code-project-store';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function literalPageSource(value: string): string {
  return `export interface DashboardProps {}

export function Dashboard(props: DashboardProps) {
  return (
    <main>
      <h1>${value}</h1>
    </main>
  );
}
`;
}

function headingText(document: UiDocument | null): unknown {
  if (!document) return undefined;
  const heading = Object.values(document.nodes).find(
    (node) => node.kind === 'element' && node.componentId === 'srijika.heading',
  );
  return heading?.kind === 'element' ? heading.props['text'] : undefined;
}

function loadDefaultSource(): void {
  useCodeProjectStore.getState().loadSource({
    fileName: DEFAULT_CODE_PROJECT_FILE_NAME,
    source: DEFAULT_CODE_PROJECT_SOURCE,
  });
}

describe('code-first project store', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
    loadDefaultSource();
  });

  it('boots and reloads from a valid project-first Welcome source as the sole mutable authority', () => {
    const state = useCodeProjectStore.getState();

    expect(state).toMatchObject({
      fileName: 'Welcome.ui.tsx',
      sourcePath: null,
      source: DEFAULT_CODE_PROJECT_SOURCE,
      diskHash: null,
      dirty: false,
      compileStatus: 'valid',
      diagnostics: [],
      previewStale: false,
      selectedDiagnosticIndex: null,
    });
    expect(state.sourceMap?.fileName).toBe('Welcome.ui.tsx');
    expect(state.lastValidDocument).toBe(useStudioStore.getState().document);
    expect(state.lastValidDocument?.name).toBe('Welcome');
  });

  it('loads disk metadata and updates it only when the current TSX source is marked saved', () => {
    const source = literalPageSource('From disk');
    useCodeProjectStore.getState().loadSource({
      fileName: 'Dashboard.ui.tsx',
      source,
      sourcePath: '/workspace/src/pages/Dashboard.ui.tsx',
      diskHash: 'sha256:first',
    });

    expect(useCodeProjectStore.getState()).toMatchObject({
      fileName: 'Dashboard.ui.tsx',
      sourcePath: '/workspace/src/pages/Dashboard.ui.tsx',
      diskHash: 'sha256:first',
      dirty: false,
      compileStatus: 'valid',
    });
    expect(useCodeProjectStore.getState().sourceMap?.fileName).toBe(
      '/workspace/src/pages/Dashboard.ui.tsx',
    );

    useCodeProjectStore.getState().updateSource(literalPageSource('Unsaved edit'));
    expect(useCodeProjectStore.getState().dirty).toBe(true);

    useCodeProjectStore.getState().markSaved({
      sourcePath: '/workspace/src/pages/Dashboard.renamed.ui.tsx',
      diskHash: 'sha256:second',
    });
    expect(useCodeProjectStore.getState()).toMatchObject({
      sourcePath: '/workspace/src/pages/Dashboard.renamed.ui.tsx',
      diskHash: 'sha256:second',
      dirty: false,
    });
  });

  it('replaces derived IR after a valid edit and preserves the last-good preview after an invalid edit', () => {
    useCodeProjectStore.getState().loadSource({
      fileName: 'Dashboard.ui.tsx',
      source: literalPageSource('First'),
    });
    const firstDocument = useCodeProjectStore.getState().lastValidDocument;
    expect(headingText(firstDocument)).toEqual({ kind: 'literal', value: 'First' });

    useCodeProjectStore.getState().updateSource(literalPageSource('Second'));
    const validState = useCodeProjectStore.getState();
    const secondDocument = validState.lastValidDocument;
    expect(secondDocument).not.toBe(firstDocument);
    expect(secondDocument).toBe(useStudioStore.getState().document);
    expect(headingText(secondDocument)).toEqual({ kind: 'literal', value: 'Second' });
    expect(validState).toMatchObject({
      dirty: true,
      compileStatus: 'valid',
      previewStale: false,
    });

    const invalidSource = `export function Dashboard() {
  return <main><h1>Broken</main>;
}`;
    useCodeProjectStore.getState().updateSource(invalidSource);
    const invalidState = useCodeProjectStore.getState();
    expect(invalidState.source).toBe(invalidSource);
    expect(invalidState.compileStatus).toBe('invalid');
    expect(invalidState.previewStale).toBe(true);
    expect(invalidState.diagnostics.some((diagnostic) => diagnostic.code === 'SRIJIKA0001')).toBe(
      true,
    );
    expect(invalidState.lastValidDocument).toBe(secondDocument);
    expect(useStudioStore.getState().document).toBe(secondDocument);
  });

  it('preserves the last-good preview when the same disk source reloads with invalid TSX', () => {
    const sourcePath = '/workspace/src/pages/Dashboard.ui.tsx';
    useCodeProjectStore.getState().loadSource({
      fileName: 'Dashboard.ui.tsx',
      source: literalPageSource('Last good'),
      sourcePath,
    });
    const lastGoodDocument = useCodeProjectStore.getState().lastValidDocument;

    useCodeProjectStore.getState().loadSource({
      fileName: 'Dashboard.ui.tsx',
      source: 'export function Dashboard() { return <main><h1>Broken</main>; }',
      sourcePath,
    });

    const state = useCodeProjectStore.getState();
    expect(state.compileStatus).toBe('invalid');
    expect(state.previewStale).toBe(true);
    expect(state.lastValidDocument).toBe(lastGoodDocument);
    expect(useStudioStore.getState().document).toBe(lastGoodDocument);
  });

  it('does not carry a last-good preview into a different source identity', () => {
    useCodeProjectStore.getState().loadSource({
      fileName: 'Dashboard.ui.tsx',
      source: literalPageSource('Project A'),
      sourcePath: '/projects/a/src/pages/Dashboard.ui.tsx',
    });
    const projectADocument = useCodeProjectStore.getState().lastValidDocument;
    expect(projectADocument).not.toBeNull();

    useCodeProjectStore.getState().loadSource({
      fileName: 'Dashboard.ui.tsx',
      source: 'export function Dashboard() { return <main><h1>Broken</main>; }',
      sourcePath: '/projects/b/src/pages/Dashboard.ui.tsx',
    });

    const state = useCodeProjectStore.getState();
    expect(state.compileStatus).toBe('invalid');
    expect(state.previewStale).toBe(true);
    expect(state.lastValidDocument).toBeNull();
    expect(state.lastValidDocument).not.toBe(projectADocument);
  });

  it('selects source diagnostics and applies a missing-prop quick fix before recompiling', () => {
    const source = `export interface ProfileProps {
  image: string;
}

export function Profile(props: ProfileProps) {
  return (
    <main>
      <img src={props.image} alt={props.name} />
      <h1>{props.name}</h1>
    </main>
  );
}
`;
    useCodeProjectStore.getState().loadSource({ fileName: 'Profile.ui.tsx', source });
    const diagnosticIndex = useCodeProjectStore
      .getState()
      .diagnostics.findIndex((diagnostic) => diagnostic.code === 'SRIJIKA1004');
    expect(diagnosticIndex).toBeGreaterThanOrEqual(0);

    useCodeProjectStore.getState().selectDiagnostic(diagnosticIndex);
    expect(useCodeProjectStore.getState().selectedDiagnosticIndex).toBe(diagnosticIndex);
    const fix = useCodeProjectStore.getState().diagnostics[diagnosticIndex]?.quickFixes?.[0];
    if (!fix) throw new Error('Expected a missing-prop quick fix');

    expect(useCodeProjectStore.getState().applyQuickFix(fix)).toBe(true);
    const fixed = useCodeProjectStore.getState();
    expect(fixed.source).toContain('name: string;');
    expect(fixed.compileStatus).toBe('valid');
    expect(fixed.previewStale).toBe(false);
    expect(fixed.diagnostics).toEqual([]);
    expect(fixed.dirty).toBe(true);
    expect(fixed.selectedDiagnosticIndex).toBeNull();
    expect(fixed.lastValidDocument).toBe(useStudioStore.getState().document);
  });

  it('applies multi-edit interface fixes in descending source order without corrupting offsets', () => {
    const source = `export function Welcome(props) {
  return (
    <main>
      <h1>{props.name}</h1>
    </main>
  );
}
`;
    useCodeProjectStore.getState().loadSource({ fileName: 'Welcome.ui.tsx', source });
    const fix = useCodeProjectStore
      .getState()
      .diagnostics.flatMap((diagnostic) => diagnostic.quickFixes ?? [])
      .find((candidate) => candidate.kind === 'create-props-interface');
    if (!fix) throw new Error('Expected a create-props-interface quick fix');
    expect(fix.edits).toHaveLength(2);

    expect(useCodeProjectStore.getState().applyQuickFix(fix)).toBe(true);
    const fixed = useCodeProjectStore.getState();
    expect(fixed.source).toContain('export interface WelcomeProps');
    expect(fixed.source).toContain('name: string;');
    expect(fixed.source).toContain('export function Welcome(props: WelcomeProps)');
    expect(fixed.compileStatus).toBe('valid');
    expect(fixed.diagnostics).toEqual([]);
  });

  it('rejects stale fixes and out-of-range diagnostic selections', () => {
    const source = `export interface ProfileProps {}
export function Profile(props: ProfileProps) {
  return <main><h1>{props.name}</h1></main>;
}`;
    useCodeProjectStore.getState().loadSource({ fileName: 'Profile.ui.tsx', source });
    const staleFix = useCodeProjectStore.getState().diagnostics[0]?.quickFixes?.[0];
    if (!staleFix) throw new Error('Expected a quick fix');

    useCodeProjectStore.getState().selectDiagnostic(999);
    expect(useCodeProjectStore.getState().selectedDiagnosticIndex).toBeNull();
    loadDefaultSource();
    expect(useCodeProjectStore.getState().applyQuickFix(staleFix)).toBe(false);
    expect(useCodeProjectStore.getState().source).toBe(DEFAULT_CODE_PROJECT_SOURCE);
  });

  it('keeps project architecture diagnostics separate from active TSX compiler diagnostics', () => {
    useCodeProjectStore.getState().setArchitectureAnalysis({
      checkedFileCount: 4,
      recommendations: [],
      diagnostics: [
        {
          origin: 'architecture',
          code: 'SRIJIKA4103',
          severity: 'error',
          fileName: 'src/features/home/Home.connector.tsx',
          span: { start: 10, end: 20, line: 2, column: 5 },
          message: 'A slot-private store cannot travel upward.',
          guidance: 'Promote shared state to the owning feature store.',
        },
      ],
    });

    useCodeProjectStore.getState().selectArchitectureDiagnostic(0);
    expect(useCodeProjectStore.getState()).toMatchObject({
      architectureCheckedFileCount: 4,
      selectedArchitectureDiagnosticIndex: 0,
      selectedDiagnosticIndex: null,
    });

    useCodeProjectStore.getState().selectDiagnostic(0);
    expect(useCodeProjectStore.getState().selectedArchitectureDiagnosticIndex).toBeNull();
    expect(useCodeProjectStore.getState().diagnostics).toEqual([]);

    useCodeProjectStore.getState().clearArchitectureAnalysis();
    expect(useCodeProjectStore.getState()).toMatchObject({
      architectureDiagnostics: [],
      architectureRecommendations: [],
      architectureCheckedFileCount: 0,
      selectedArchitectureDiagnosticIndex: null,
    });
  });

  it('exposes the same compile-and-commit boundary for project orchestration', () => {
    const previous = useCodeProjectStore.getState().lastValidDocument;
    const result = compileCodeProjectSource({
      fileName: 'Standalone.ui.tsx',
      source: literalPageSource('Standalone'),
      lastValidDocument: previous,
    });

    expect(result.compileStatus).toBe('valid');
    expect(result.previewStale).toBe(false);
    expect(headingText(result.lastValidDocument)).toEqual({
      kind: 'literal',
      value: 'Standalone',
    });
    expect(result.lastValidDocument).toBe(useStudioStore.getState().document);
  });
});
