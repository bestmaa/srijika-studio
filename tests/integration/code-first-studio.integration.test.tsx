import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeFirstStudio } from '../../apps/studio/src/components/code-first/CodeFirstStudio';
import { useCodeProjectStore } from '../../apps/studio/src/store/code-project-store';
import { useProjectSessionStore } from '../../apps/studio/src/store/project-session-store';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

const BASELINE_SOURCE = `export function BaselineUI() {
  return (
    <main>
      <h1>Last good preview</h1>
    </main>
  );
}
`;

function loadSource(source: string, fileName = 'Test.ui.tsx'): void {
  act(() => {
    useCodeProjectStore.getState().loadSource({
      fileName,
      source,
      sourcePath: null,
      diskHash: null,
    });
  });
}

function sourceEditor(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Srijika TSX source' });
}

function preview(): HTMLElement {
  return screen.getByRole('region', { name: 'Derived UI preview' });
}

function previewContent(): HTMLElement {
  const frame = preview().querySelector<HTMLIFrameElement>(
    'iframe[title="Styled Srijika UI preview"]',
  );
  const root = frame?.contentDocument?.getElementById('srijika-code-preview-root');
  if (!root) throw new Error('Expected the isolated Srijika preview document');
  return root;
}

describe('CodeFirstStudio', () => {
  beforeEach(() => {
    window.localStorage.removeItem('srijika-studio:navigator-order:v1');
    useStudioStore.getState().resetProject();
    useProjectSessionStore.getState().resetSession();
    useCodeProjectStore.getState().clearArchitectureAnalysis();
    loadSource(BASELINE_SOURCE, 'Baseline.ui.tsx');
  });

  it('starts with project choices instead of mounting a placeholder editor', () => {
    act(() => useCodeProjectStore.getState().clearSource());
    render(<CodeFirstStudio />);

    expect(
      screen.getByRole('main', { name: 'Explore Srijika without touching your files.' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create Demo Project' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Import One .ui.tsx File' })).toBeVisible();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute('accept', '.ui.tsx');
    expect(screen.queryByLabelText('Srijika TSX source')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Derived UI preview' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Srijika source Inspector')).not.toBeInTheDocument();
    expect(screen.queryByText('Profile.ui.tsx')).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome.ui.tsx')).not.toBeInTheDocument();
  });

  it('derives the initial preview and Inspector contract from authoritative TSX', () => {
    const source = `export interface WelcomeUIProps {
  name: string;
}

export function WelcomeUI(props: WelcomeUIProps) {
  return (
    <main>
      <h1>Welcome</h1>
      <p>{props.name}</p>
    </main>
  );
}
`;
    loadSource(source, 'Welcome.ui.tsx');

    render(<CodeFirstStudio />);

    expect(sourceEditor()).toHaveValue(source);
    expect(sourceEditor()).toHaveAttribute('readonly');
    expect(within(previewContent()).getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(within(previewContent()).getByText('name')).toBeInTheDocument();
    expect(screen.getByText('Srijika contract valid')).toBeInTheDocument();
    expect(
      screen.getByText('No Srijika diagnostics. The source contract is valid.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('Srijika source Inspector')).getByText('name'),
    ).toBeInTheDocument();
    expect(useCodeProjectStore.getState()).toMatchObject({
      source,
      compileStatus: 'valid',
      previewStale: false,
    });
  });

  it('merges project architecture boundaries into Problems and explains the selected rule', async () => {
    const user = userEvent.setup();
    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: '/projects/demo',
        displayName: 'demo',
        entries: [
          {
            path: '/projects/demo/src/features/home/Home.connector.tsx',
            relativePath: 'src/features/home/Home.connector.tsx',
            kind: 'file',
            bytes: 120,
            hash: 'connector-hash',
            isUiSource: false,
          },
        ],
      });
      useCodeProjectStore.getState().setArchitectureAnalysis({
        checkedFileCount: 6,
        recommendations: [],
        diagnostics: [
          {
            origin: 'architecture',
            code: 'SRIJIKA4103',
            severity: 'error',
            fileName: 'src/features/home/Home.connector.tsx',
            targetFileName: 'src/features/home/slots/navigation/navigation.store.ts',
            span: { start: 24, end: 62, line: 2, column: 8 },
            message: 'The navigation slot keeps its store inside its own subtree.',
            guidance: 'Promote shared state to the Home feature store.',
          },
        ],
      });
    });

    render(<CodeFirstStudio />);

    expect(screen.getByText('6 architecture files checked')).toBeVisible();
    const problemButton = screen.getByText('SRIJIKA4103').closest('button');
    if (!problemButton) throw new Error('Expected the architecture problem row');
    await user.click(problemButton);

    const details = screen.getByLabelText('Selected problem details');
    expect(within(details).getByText('Architecture boundary')).toBeVisible();
    expect(
      within(details).getByText('Promote shared state to the Home feature store.'),
    ).toBeVisible();
    expect(within(details).getByText('src/features/home/Home.connector.tsx:2:8')).toBeVisible();
    expect(useCodeProjectStore.getState().selectedArchitectureDiagnosticIndex).toBe(0);
  });

  it('shows deterministic architecture recommendations without marking the contract invalid', async () => {
    const user = userEvent.setup();
    const recommendation = {
      id: 'SRIJIKA-ARCH-RECOMMEND-LOGIC' as const,
      kind: 'maintainability' as const,
      owner: 'Report',
      ownerKind: 'feature' as const,
      from: 'connector' as const,
      currentTarget: 'api' as const,
      recommendedTarget: 'logic' as const,
      message: 'Add Logic before this growing API adapter.',
      suggestedFileName: 'report.logic.ts',
      evidence: { metric: 'logical-lines' as const, value: 40, threshold: 40 },
    };
    act(() => {
      useProjectSessionStore.getState().attachProject({
        rootPath: '/projects/demo',
        displayName: 'demo',
        entries: [
          {
            path: '/projects/demo/src/features/report/Report.connector.tsx',
            relativePath: 'src/features/report/Report.connector.tsx',
            kind: 'file',
            bytes: 120,
            hash: 'report-connector-hash',
            isUiSource: false,
          },
        ],
      });
      useCodeProjectStore.getState().setArchitectureAnalysis({
        checkedFileCount: 3,
        recommendations: [recommendation],
        diagnostics: [
          {
            origin: 'architecture',
            code: 'SRIJIKA4202',
            ruleId: 'SRIJIKA-ARCH-MAINTAINABILITY',
            severity: 'warning',
            fileName: 'src/features/report/Report.connector.tsx',
            targetFileName: 'src/features/report/report.api.ts',
            span: { start: 8, end: 20, line: 1, column: 9 },
            message: recommendation.message,
            guidance: 'Route this behavior through report.logic.ts.',
            recommendation,
          },
        ],
      });
    });

    render(<CodeFirstStudio />);

    expect(screen.getByText('0 issues')).toBeVisible();
    expect(screen.getAllByText('1 recommendation').length).toBeGreaterThan(0);
    expect(screen.getByText('1 architecture recommendation')).toHaveClass('is-ok');
    const warning = screen.getByText('SRIJIKA4202').closest('button');
    if (!warning) throw new Error('Expected the recommendation row');
    expect(warning).toHaveClass('is-warning');
    await user.click(warning);
    expect(screen.getByText('Architecture recommendation')).toBeVisible();
    expect(screen.getByText('SRIJIKA-ARCH-MAINTAINABILITY')).toBeVisible();
  });

  it('selects the UI function separately from its main return node and shows its full contract', async () => {
    const user = userEvent.setup();
    const source = `export interface HomeUIProps {
  title: string;
  isReady: boolean;
}

export function HomeUI(props: HomeUIProps) {
  return (
    <main>
      <h1>{props.title}</h1>
      {props.isReady && <p>Ready</p>}
    </main>
  );
}
`;
    loadSource(source, 'Home.ui.tsx');
    render(<CodeFirstStudio />);

    const uiNodes = screen.getByLabelText('UI Nodes');
    const functionRow = within(uiNodes).getByRole('button', {
      name: 'HomeUI, Home.ui.tsx',
    });
    expect(within(uiNodes).getByRole('button', { name: 'main, Main' })).toBeVisible();

    await user.click(functionRow);

    const functionStart = source.indexOf('export function HomeUI');
    expect(sourceEditor()).toHaveFocus();
    expect(sourceEditor().selectionStart).toBe(functionStart);
    expect(sourceEditor().selectionEnd).toBe(source.lastIndexOf('}') + 1);

    const inspector = screen.getByLabelText('Srijika source Inspector');
    expect(within(inspector).getByLabelText('Selected UI function')).toHaveTextContent('HomeUI');
    const contract = within(inspector).getByLabelText('Component contract');
    expect(within(contract).getByText('title')).toBeVisible();
    expect(within(contract).getByText('isReady')).toBeVisible();
  });

  it('authors the complete UI contract from the selected UI function', async () => {
    const user = userEvent.setup();
    const source = `export interface CardUIProps {}
export function CardUI(props: CardUIProps) {
  return <main>Card</main>;
}
`;
    loadSource(source, 'Card.ui.tsx');
    render(<CodeFirstStudio />);

    await user.click(
      within(screen.getByLabelText('UI Nodes')).getByRole('button', {
        name: 'CardUI, Card.ui.tsx',
      }),
    );
    const inspector = screen.getByLabelText('Srijika source Inspector');
    const contract = within(inspector).getByLabelText('Component contract');
    expect(within(contract).getByText('Total 0')).toBeVisible();

    await user.type(within(contract).getByLabelText('New prop name'), 'title');
    await user.click(within(contract).getByRole('button', { name: 'Add prop to TSX' }));
    await waitFor(() => expect(sourceEditor().value).toContain('title: string;'));

    await user.click(within(contract).getByRole('tab', { name: /Events/ }));
    await user.type(within(contract).getByLabelText('New event name'), 'onOpen');
    await user.click(within(contract).getByRole('button', { name: 'Add event to TSX' }));
    await waitFor(() => expect(sourceEditor().value).toContain('onOpen: () => void;'));

    await user.click(within(contract).getByRole('tab', { name: /Structure/ }));
    await user.type(within(contract).getByLabelText('New structure slot name'), 'toolbarSlot');
    await user.click(within(contract).getByRole('button', { name: 'Add structure slot to TSX' }));
    await waitFor(() => {
      expect(sourceEditor().value).toContain("import type { ReactNode } from 'react';");
      expect(sourceEditor().value).toContain('toolbarSlot: ReactNode;');
      expect(screen.getByText('Srijika contract valid')).toBeVisible();
      expect(within(contract).getByText('Total 3')).toBeVisible();
    });
  });

  it('expands and scrolls UI Nodes to an externally selected deep preview node', async () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollIntoView',
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const source = `export function DeepUI() {
  return (
    <main>
      <section>
        <div>
          <div>
            <h1>Deep selection</h1>
          </div>
        </div>
      </section>
    </main>
  );
}
`;
      loadSource(source, 'Deep.ui.tsx');
      render(<CodeFirstStudio />);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      scrollIntoView.mockClear();

      const compiled = useCodeProjectStore.getState().lastValidDocument;
      const heading = Object.values(compiled?.nodes ?? {}).find(
        (node) => node.kind === 'element' && node.name === 'Heading 1',
      );
      if (!heading) throw new Error('Expected the deep heading node');
      act(() => useStudioStore.getState().selectNode(heading.id));

      await waitFor(() => {
        expect(
          within(screen.getByLabelText('UI Nodes')).getByRole('button', {
            name: 'h1, Heading 1',
          }),
        ).toBeVisible();
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
      });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
      } else {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      }
    }
  });

  it('hides and restores Source while keeping a minimizable bottom Problems console', async () => {
    const user = userEvent.setup();
    render(<CodeFirstStudio />);

    const sourceHeader = screen.getByRole('heading', { name: 'Source viewer' }).parentElement;
    expect(sourceHeader).toHaveClass('code-first-source-header');
    expect(
      within(sourceHeader as HTMLElement).getByRole('button', { name: 'Hide source viewer' }),
    ).toBeVisible();

    const previewRegion = preview();
    const problems = screen.getByLabelText('Srijika diagnostics console');
    expect(previewRegion.nextElementSibling).toBe(problems);

    await user.click(screen.getByRole('button', { name: 'Hide source viewer' }));
    expect(screen.queryByRole('textbox', { name: 'Srijika TSX source' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show source viewer' }));
    expect(sourceEditor()).toBeVisible();

    await user.click(within(problems).getByRole('button', { name: 'Minimize' }));
    expect(problems).toHaveClass('is-collapsed');
    expect(
      within(problems).queryByText('No Srijika diagnostics. The source contract is valid.'),
    ).not.toBeInTheDocument();
    await user.click(within(problems).getByRole('button', { name: 'Open' }));
    expect(
      within(problems).getByText('No Srijika diagnostics. The source contract is valid.'),
    ).toBeVisible();
  });

  it('keeps and visibly marks the last-good preview when current TSX has a syntax error', async () => {
    render(<CodeFirstStudio />);
    expect(
      within(previewContent()).getByRole('heading', { name: 'Last good preview' }),
    ).toBeInTheDocument();

    const invalidSource = BASELINE_SOURCE.replace('</h1>', '');
    act(() => useCodeProjectStore.getState().updateSource(invalidSource));

    expect(sourceEditor()).toHaveValue(invalidSource);
    expect(await within(preview()).findByText('last valid')).toBeInTheDocument();
    expect(
      within(previewContent()).getByRole('heading', { name: 'Last good preview' }),
    ).toBeInTheDocument();
    expect(screen.getByText('SRIJIKA0001')).toBeInTheDocument();
    expect(useCodeProjectStore.getState()).toMatchObject({
      source: invalidSource,
      compileStatus: 'invalid',
      previewStale: true,
    });
    expect(document.querySelector('.code-first-preview-stage')).toHaveClass('is-stale');
  });

  it('shows a missing-prop diagnostic and applies its TSX quick fix before recompiling', async () => {
    const user = userEvent.setup();
    const source = `export interface ProfileUIProps {
  name: string;
}

export function ProfileUI(props: ProfileUIProps) {
  return (
    <main>
      <img src={props.image} alt={props.name} />
      <h1>{props.name}</h1>
    </main>
  );
}
`;
    loadSource(source, 'Profile.ui.tsx');
    render(<CodeFirstStudio />);

    const diagnosticCode = screen.getByText('SRIJIKA1004');
    const diagnosticButton = diagnosticCode.closest('button');
    if (!diagnosticButton) throw new Error('Expected the missing-prop diagnostic button');
    await user.click(diagnosticButton);

    const inspector = screen.getByLabelText('Srijika source Inspector');
    expect(within(inspector).getByText('Selected problem')).toBeInTheDocument();
    expect(within(inspector).getByText(/image is used but is not declared/)).toBeInTheDocument();

    await user.click(
      within(inspector).getByRole('button', {
        name: /Add image: string to the props interface/,
      }),
    );

    await waitFor(() => {
      expect(sourceEditor().value).toContain('image: string;');
      expect(screen.getByText('Srijika contract valid')).toBeInTheDocument();
    });
    expect(screen.queryByText('SRIJIKA1004')).not.toBeInTheDocument();
    expect(within(previewContent()).getByRole('heading', { name: 'name' })).toBeInTheDocument();
    expect(useCodeProjectStore.getState()).toMatchObject({
      compileStatus: 'valid',
      previewStale: false,
    });
  });

  it('selects an event problem, explains it in Inspector, and connects div onClick safely', async () => {
    const user = userEvent.setup();
    const validSource = `export interface CardUIProps {
  onOpen: () => void;
}
export function CardUI(props: CardUIProps) {
  return <div onClick={props.onOpen}>Open card</div>;
}
`;
    loadSource(validSource, 'Card.ui.tsx');
    render(<CodeFirstStudio />);

    act(() =>
      useCodeProjectStore
        .getState()
        .updateSource(validSource.replace('onClick={props.onOpen}', 'onClick={() => {}}')),
    );
    await waitFor(() => expect(screen.getByText('SRIJIKA2003')).toBeVisible());
    await user.click(screen.getByRole('button', { name: 'Hide source viewer' }));
    expect(screen.queryByLabelText('Srijika TSX source')).not.toBeInTheDocument();

    const diagnosticButton = screen.getByText('SRIJIKA2003').closest('button');
    if (!diagnosticButton) throw new Error('Expected the inline-event diagnostic button');
    await user.click(diagnosticButton);

    expect(screen.getByLabelText('Srijika TSX source')).toBeVisible();
    const inspector = screen.getByLabelText('Srijika source Inspector');
    const problem = within(inspector).getByLabelText('Selected problem details');
    expect(within(problem).getByText('Why this happens')).toBeVisible();
    expect(within(problem).getByText(/behavior in the Connector/)).toBeVisible();
    expect(within(inspector).getByLabelText('Selected node summary')).toHaveTextContent('div');

    await user.click(
      within(problem).getByRole('button', { name: 'Connect onClick to props.onOpen' }),
    );
    await waitFor(() => {
      expect(sourceEditor()).toHaveValue(validSource);
      expect(screen.getByText('Srijika contract valid')).toBeVisible();
    });
    expect(screen.queryByText('SRIJIKA2003')).not.toBeInTheDocument();
  });

  it('authors a new div prop and typed onClick contract from Inspector', async () => {
    const user = userEvent.setup();
    const source = `export interface CardUIProps {}
export function CardUI(props: CardUIProps) {
  return <main><div>Open card</div></main>;
}
`;
    loadSource(source, 'Card.ui.tsx');
    render(<CodeFirstStudio />);
    await user.click(
      within(screen.getByLabelText('UI Nodes')).getByRole('button', {
        name: 'div, Container',
      }),
    );

    const inspector = screen.getByLabelText('Srijika source Inspector');
    let authoring = within(inspector).getByLabelText('Available JSX attributes');
    await user.selectOptions(within(authoring).getByLabelText('Available JSX prop'), 'id');
    await user.type(within(authoring).getByLabelText('id new value'), 'card-trigger');
    await user.click(within(authoring).getByRole('button', { name: 'Add id to TSX' }));
    await waitFor(() => expect(sourceEditor().value).toContain('id={"card-trigger"}'));

    await user.click(
      within(within(inspector).getByLabelText('Selected element sections')).getByRole('tab', {
        name: /Events/,
      }),
    );
    authoring = within(inspector).getByLabelText('Available JSX attributes');
    expect(within(authoring).getByLabelText('Connector callback prop')).toHaveValue('onDivClick');
    await user.click(within(authoring).getByRole('button', { name: 'Connect onClick' }));

    await waitFor(() => {
      expect(sourceEditor().value).toContain('onDivClick?: () => void;');
      expect(sourceEditor().value).toContain('onClick={props.onDivClick}');
      expect(screen.getByText('Srijika contract valid')).toBeVisible();
      expect(
        within(screen.getByLabelText('UI Nodes'))
          .getByRole('button', { name: 'div, Container' })
          .closest('[role="treeitem"]'),
      ).toHaveAttribute('aria-selected', 'true');
    });
    expect(within(inspector).getByLabelText('Node events')).toHaveTextContent(
      'onClickprops.onDivClick',
    );
  });

  it('writes a selected literal node through the Inspector into TSX and the derived preview', async () => {
    const user = userEvent.setup();
    const source = `export function HeadingUI() {
  return (
    <main>
      <h1 className="hero-title">Hello Srijika</h1>
    </main>
  );
}
`;
    loadSource(source, 'Heading.ui.tsx');
    render(<CodeFirstStudio />);

    const uiNodes = screen.getByLabelText('UI Nodes');
    expect(
      within(uiNodes).getByRole('button', { name: 'HeadingUI, Heading.ui.tsx' }),
    ).toBeVisible();
    await user.click(within(uiNodes).getByRole('button', { name: 'h1, Heading 1' }));

    const headingStart = source.indexOf('<h1 className="hero-title">');
    const headingEnd = source.indexOf('</h1>') + '</h1>'.length;
    expect(sourceEditor()).toHaveFocus();
    expect(sourceEditor().selectionStart).toBe(headingStart);
    expect(sourceEditor().selectionEnd).toBe(headingEnd);

    const inspector = screen.getByLabelText('Srijika source Inspector');
    const textInput = within(inspector).getByLabelText('Visual text override (AST-safe TSX edit)');
    expect(textInput).toBeEnabled();
    expect(textInput).toHaveValue('Hello Srijika');
    await user.clear(textInput);
    await user.type(textInput, 'Namaste Srijika');
    await user.click(
      within(inspector).getByRole('button', { name: 'Apply validated visual edit' }),
    );

    await waitFor(() => {
      expect(sourceEditor().value).toContain('<h1 className="hero-title">Namaste Srijika</h1>');
      expect(
        within(previewContent()).getByRole('heading', { name: 'Namaste Srijika' }),
      ).toBeInTheDocument();
    });
    expect(
      within(previewContent()).queryByRole('heading', { name: 'Hello Srijika' }),
    ).not.toBeInTheDocument();
    expect(useCodeProjectStore.getState().source).toContain('Namaste Srijika');
    expect(useCodeProjectStore.getState()).toMatchObject({
      compileStatus: 'valid',
      previewStale: false,
      dirty: true,
    });
    expect(
      within(uiNodes).getByRole('button', { name: 'h1, Heading 1' }).closest('[role="treeitem"]'),
    ).toHaveAttribute('aria-selected', 'true');
    expect(
      within(inspector).getByLabelText('Visual text override (AST-safe TSX edit)'),
    ).toHaveValue('Namaste Srijika');
  });

  it('shows selected element props and writes an authored literal prop back to TSX', async () => {
    const user = userEvent.setup();
    const source = `export interface FeatureCardUIProps {
  title: string;
}

export function FeatureCardUI(props: FeatureCardUIProps) {
  return (
    <main>
      <section className="feature-card" aria-label="Featured card">
        <h1>{props.title}</h1>
      </section>
    </main>
  );
}
`;
    loadSource(source, 'FeatureCard.ui.tsx');
    render(<CodeFirstStudio />);

    const uiNodes = screen.getByLabelText('UI Nodes');
    await user.click(within(uiNodes).getByRole('button', { name: 'section, Section' }));

    const inspector = screen.getByLabelText('Srijika source Inspector');
    const props = within(inspector).getByLabelText('Node props');
    const className = within(props).getByLabelText('className prop value');
    expect(className).toBeEnabled();
    expect(className).toHaveValue('feature-card');
    expect(within(props).getAllByText('TSX literal / editable')).toHaveLength(2);

    await user.clear(className);
    await user.type(className, 'featured-card');
    await user.click(within(props).getByRole('button', { name: 'Apply className to TSX' }));

    await waitFor(() => {
      expect(sourceEditor().value).toContain('className={"featured-card"}');
      expect(useCodeProjectStore.getState().dirty).toBe(true);
    });

    expect(
      within(uiNodes)
        .getByRole('button', { name: 'section, Section' })
        .closest('[role="treeitem"]'),
    ).toHaveAttribute('aria-selected', 'true');
    await user.click(within(uiNodes).getByRole('button', { name: 'h1, Heading 1' }));
    expect(within(inspector).getByText('props.title')).toBeVisible();
    expect(within(inspector).getByText(/Connector supplies props\.title/i)).toBeVisible();
  });

  it('protects unsaved visual edits from project/source transitions and window unload', async () => {
    const user = userEvent.setup();
    render(<CodeFirstStudio />);
    const editedSource = BASELINE_SOURCE.replace('Last good preview', 'Unsaved visual edit');
    act(() => useCodeProjectStore.getState().updateSource(editedSource));
    expect(useCodeProjectStore.getState().dirty).toBe(true);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'New demo project' }));
    await user.click(screen.getByRole('button', { name: 'Import one .ui.tsx file' }));

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      'Discard unsaved Studio-generated visual edits and create a new project?',
    );
    expect(useCodeProjectStore.getState()).toMatchObject({ source: editedSource, dirty: true });
    expect(useProjectSessionStore.getState().displayName).toBeNull();

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    confirm.mockRestore();
  });

  it('creates a complete in-memory Project Explorer in browser mode', async () => {
    const user = userEvent.setup();
    render(<CodeFirstStudio />);

    await user.click(screen.getByRole('button', { name: 'New demo project' }));

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    expect(within(explorer).getByRole('button', { name: 'SRIJIKA-APP' })).toBeInTheDocument();
    expect(within(explorer).getByText('package.json')).toBeInTheDocument();
    expect(within(explorer).getByText('srijika.config.json')).toBeInTheDocument();
    expect(within(preview()).getByText('CSS 1')).toHaveAttribute('title', 'src/styles.css');
    const frame = preview().querySelector<HTMLIFrameElement>(
      'iframe[title="Styled Srijika UI preview"]',
    );
    expect(frame?.contentDocument?.getElementById('srijika-project-styles')).toHaveTextContent(
      '.srijika-home',
    );
    expect(
      frame?.contentDocument?.querySelector('img[alt="Srijika Studio"]')?.getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);
    expect(useProjectSessionStore.getState().entries.some((entry) => entry.isUiSource)).toBe(true);
    expect(useProjectSessionStore.getState()).toMatchObject({
      rootPath: null,
      displayName: 'srijika-app',
      indexStatus: 'ready',
    });
    await waitFor(() =>
      expect(useCodeProjectStore.getState().architectureCheckedFileCount).toBeGreaterThan(0),
    );
    expect(useCodeProjectStore.getState().architectureDiagnostics).toEqual([]);
    expect(screen.getByText(/architecture files checked/)).toBeVisible();
    const runtime = screen.getByRole('region', { name: 'Project runtime' });
    expect(within(runtime).getByText('Desktop project required')).toBeInTheDocument();
    expect(within(runtime).getByRole('button', { name: 'Install / Sync' })).toBeDisabled();
    expect(within(runtime).getByRole('button', { name: 'Run App' })).toBeDisabled();
    expect(within(runtime).getByRole('button', { name: 'Build App' })).toBeDisabled();
  });

  it('creates canonical pages with required Connectors and rejects non-page roots', async () => {
    const user = userEvent.setup();
    render(<CodeFirstStudio />);

    await user.click(screen.getByRole('button', { name: 'New demo project' }));
    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    await user.click(within(explorer).getByRole('button', { name: 'New UI' }));

    let dialog = screen.getByRole('dialog', { name: 'Create UI page' });
    const pageNameInput = within(dialog).getByLabelText('Name');
    await user.type(pageNameInput, 'PricingPage');
    expect(pageNameInput).toHaveFocus();
    expect(pageNameInput).toHaveValue('PricingPage');
    expect(within(dialog).getByText('src/pages/PricingPage.ui.tsx')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Create UI page' }));

    await waitFor(() => {
      expect(sourceEditor().value).toContain('export function PricingPageUI');
      expect(useProjectSessionStore.getState().activeUiSourcePath).toContain(
        'src/pages/PricingPage.ui.tsx',
      );
    });
    expect(within(previewContent()).getByRole('heading', { name: 'title' })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'UI Nodes' })).getByRole('tree', {
        name: 'PricingPageUI UI nodes',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByLabelText('Srijika source Inspector')).getByText('description'),
    ).toBeVisible();

    const uiSources = within(explorer).getByRole('region', { name: 'UI Sources' });
    await user.click(within(uiSources).getByRole('button', { name: /Home\.ui\.tsx/ }));
    await waitFor(() => expect(sourceEditor().value).toContain('export function HomeUI'));
    expect(
      within(previewContent()).getByRole('heading', {
        name: 'Build React interfaces with a clear thread from code to canvas.',
      }),
    ).toBeVisible();

    await user.click(within(explorer).getByRole('button', { name: 'New UI' }));
    dialog = screen.getByRole('dialog', { name: 'Create UI page' });
    expect(within(dialog).getByText('Connector included')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Name'), 'pricingPage');
    await user.click(within(dialog).getByRole('button', { name: 'Create UI page' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Name must be PascalCase');
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'PricingPage');
    await user.clear(within(dialog).getByLabelText('Project folder'));
    await user.type(within(dialog).getByLabelText('Project folder'), 'public/cards');
    await user.click(within(dialog).getByRole('button', { name: 'Create UI page' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('inside src/pages');
    await user.clear(within(dialog).getByLabelText('Project folder'));
    await user.type(within(dialog).getByLabelText('Project folder'), 'src/pages');
    await user.click(within(dialog).getByRole('button', { name: 'Create UI page' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('already exists');
    expect(sourceEditor().value).toContain('export function HomeUI');
  }, 10_000);

  it('authors components into authoritative TSX and keeps collapsible navigator panels in sync', async () => {
    const user = userEvent.setup();
    const source = `export function BuilderUI() {
  return (
    <main>
      <h1>Builder</h1>
    </main>
  );
}
`;
    loadSource(source, 'Builder.ui.tsx');
    render(<CodeFirstStudio />);

    const palette = screen.getByRole('region', { name: 'UI Components' });
    expect(within(palette).getByText('Add inside')).toHaveTextContent('<main>');
    await user.click(within(palette).getByRole('button', { name: 'Container' }));
    await waitFor(() => {
      expect(sourceEditor().value).toContain('<div className={"srijika-container"}></div>');
      expect(screen.getByText('Srijika contract valid')).toBeVisible();
    });

    await user.click(within(palette).getByRole('button', { name: 'Email input' }));
    await waitFor(() => {
      expect(sourceEditor().value).toContain('<input type={"email"}');
      expect(sourceEditor().value).toContain('aria-label={"email input"}');
      expect(within(previewContent()).getByRole('textbox', { name: 'email input' })).toBeVisible();
    });
    const inspector = screen.getByLabelText('Srijika source Inspector');
    expect(within(inspector).getByText('input', { selector: 'h3' })).toBeVisible();
    expect(within(inspector).getByLabelText('type prop value')).toHaveValue('email');

    const nodes = screen.getByRole('region', { name: 'UI Nodes' });
    await user.click(within(nodes).getByRole('button', { name: 'Collapse UI Nodes panel' }));
    expect(within(nodes).queryByRole('tree')).not.toBeInTheDocument();
    await user.click(within(nodes).getByRole('button', { name: 'Expand UI Nodes panel' }));
    expect(within(nodes).getByRole('tree')).toBeVisible();

    const dragged = within(palette).getByRole('button', { name: 'Paragraph' });
    const mainNode = within(nodes).getByRole('button', { name: 'main, Main' }).closest('div');
    const dataTransfer = {
      types: ['application/x-srijika-component'],
      effectAllowed: 'copy',
      dropEffect: 'copy',
      setData: vi.fn(),
      getData: vi.fn(() => 'paragraph'),
    };
    fireEvent.dragStart(dragged, { dataTransfer });
    fireEvent.dragOver(mainNode!, { dataTransfer });
    fireEvent.drop(mainNode!, { dataTransfer });
    await waitFor(() => expect(sourceEditor().value).toContain('Write your content here.'));
  });

  it('collapses project groups so the remaining navigator panels move up', async () => {
    const user = userEvent.setup();
    render(<CodeFirstStudio />);
    await user.click(screen.getByRole('button', { name: 'New demo project' }));

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    expect(within(explorer).getByText('package.json')).toBeVisible();
    await user.click(within(explorer).getByRole('button', { name: 'All project files' }));
    expect(within(explorer).queryByText('package.json')).not.toBeInTheDocument();
    await user.click(within(explorer).getByRole('button', { name: 'All project files' }));
    expect(within(explorer).getByText('package.json')).toBeVisible();

    await user.click(within(explorer).getByRole('button', { name: 'Collapse project workspace' }));
    expect(within(explorer).queryByRole('region', { name: 'UI Sources' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'UI Components' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'UI Nodes' })).toBeVisible();
  });

  it('reorders navigator panels with a dedicated drag handle and persists the order', () => {
    render(<CodeFirstStudio />);
    const projectHandle = screen.getByRole('button', { name: 'Drag Project panel to reorder' });
    const nodesPanel = document.querySelector<HTMLElement>('[data-navigator-panel="nodes"]');
    const values = new Map<string, string>();
    const dataTransfer = {
      types: ['application/x-srijika-panel'],
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    };

    fireEvent.dragStart(projectHandle, { dataTransfer });
    fireEvent.dragOver(nodesPanel!, { dataTransfer });
    fireEvent.drop(nodesPanel!, { dataTransfer });

    expect(
      [...document.querySelectorAll<HTMLElement>('[data-navigator-panel]')].map(
        (panel) => panel.dataset.navigatorPanel,
      ),
    ).toEqual(['components', 'nodes', 'project']);
    expect(window.localStorage.getItem('srijika-studio:navigator-order:v1')).toBe(
      '["components","nodes","project"]',
    );
  });
});
