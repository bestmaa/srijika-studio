import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { generateTsx } from '@sutra/react-codegen';
import { SutraRenderer } from '@sutra/react-renderer';

import { StudioApp } from '../../apps/studio/src/app/StudioApp';
import { Hierarchy } from '../../apps/studio/src/components/Hierarchy';
import { Inspector } from '../../apps/studio/src/components/Inspector';
import { PagesPanel } from '../../apps/studio/src/components/PagesPanel';
import { Palette } from '../../apps/studio/src/components/Palette';
import { componentRegistry } from '../../apps/studio/src/lib/registry';
import { defaultSymbolValues, useStudioStore } from '../../apps/studio/src/store/studio-store';

function CanonicalCanvas() {
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const activeIfBranches = useStudioStore((state) => state.activeIfBranches);
  const selectNode = useStudioStore((state) => state.selectNode);

  return (
    <section aria-label="Canonical design surface">
      <SutraRenderer
        document={document}
        registry={componentRegistry}
        mode="edit"
        selectedNodeId={selectedNodeId}
        symbols={defaultSymbolValues(document)}
        activeIfBranches={activeIfBranches}
        onSelectNode={selectNode}
      />
    </section>
  );
}

function hierarchyRow(label: string): HTMLElement {
  const tree = screen.getByRole('tree', { name: 'Page content hierarchy' });
  const name = within(tree).getByText(label, { selector: '.tree-name' });
  const row = name.closest<HTMLElement>('[role="treeitem"]');
  if (!row) throw new Error(`Expected a hierarchy row named ${label}`);
  return row;
}

function addNestedContainers(): { outerId: string; innerId: string } {
  const store = useStudioStore.getState();
  const rootId = store.document.rootNodeId;
  const outerId = store.addComponent('sutra.container', rootId);
  if (!outerId) throw new Error('Expected the outer Container to be created');
  const innerId = useStudioStore.getState().addComponent('sutra.container', outerId);
  if (!innerId) throw new Error('Expected the inner Container to be created');
  useStudioStore
    .getState()
    .dispatch({ kind: 'renameNode', nodeId: outerId, name: 'Outer Container' });
  useStudioStore
    .getState()
    .dispatch({ kind: 'renameNode', nodeId: innerId, name: 'Inner Container' });
  return { outerId, innerId };
}

describe('canonical page editor', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('opens a blank Home Page with its locked Page Inspector', () => {
    render(<StudioApp />);

    const pages = screen.getByRole('navigation', { name: 'Project pages' });
    expect(within(pages).getByRole('button', { name: /Home Page/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(hierarchyRow('Home Page')).toHaveAttribute('aria-selected', 'true');

    const inspector = screen.getByLabelText('Inspector');
    expect(within(inspector).getByText('SELECTED PAGE')).toBeInTheDocument();
    expect(within(inspector).getByRole('heading', { name: 'Home Page' })).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Page name')).toHaveValue('Home Page');
    expect(within(inspector).getByText(/fixed React return root/)).toBeInTheDocument();
    expect(useStudioStore.getState().document.nodes).toHaveProperty(
      useStudioStore.getState().document.rootNodeId,
    );
    expect(Object.keys(useStudioStore.getState().document.nodes)).toHaveLength(1);
  });

  it('creates and switches between isolated page documents', async () => {
    const user = userEvent.setup();
    render(
      <>
        <PagesPanel />
        <Palette />
        <Hierarchy />
      </>,
    );

    const homePageId = useStudioStore.getState().selectedPageId;
    await user.click(screen.getByRole('button', { name: 'New page' }));
    await user.type(screen.getByLabelText('New page name'), 'Product Page');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    const productPageId = useStudioStore.getState().selectedPageId;
    expect(productPageId).not.toBe(homePageId);
    fireEvent.click(screen.getByRole('button', { name: 'Container' }));
    expect(Object.keys(useStudioStore.getState().document.nodes)).toHaveLength(2);

    const pages = screen.getByRole('navigation', { name: 'Project pages' });
    await user.click(within(pages).getByRole('button', { name: /Home Page/ }));
    expect(useStudioStore.getState().selectedPageId).toBe(homePageId);
    expect(Object.keys(useStudioStore.getState().document.nodes)).toHaveLength(1);
    expect(
      within(screen.getByRole('tree', { name: 'Page content hierarchy' })).queryByText(
        'Container',
        { selector: '.tree-name' },
      ),
    ).not.toBeInTheDocument();

    await user.click(within(pages).getByRole('button', { name: /Product Page/ }));
    expect(useStudioStore.getState().selectedPageId).toBe(productPageId);
    expect(Object.keys(useStudioStore.getState().document.nodes)).toHaveLength(2);
    expect(hierarchyRow('Container')).toBeInTheDocument();
    expect(
      useStudioStore.getState().pages.find((page) => page.id === homePageId)?.document.nodes,
    ).not.toHaveProperty(
      Object.keys(useStudioStore.getState().document.nodes).find(
        (nodeId) => nodeId !== useStudioStore.getState().document.rootNodeId,
      ) ?? '',
    );
  });

  it('synchronizes nested Container selection across canvas, hierarchy, and Inspector', async () => {
    const user = userEvent.setup();
    const { outerId, innerId } = addNestedContainers();
    useStudioStore.getState().selectNode(useStudioStore.getState().document.rootNodeId);
    render(
      <>
        <CanonicalCanvas />
        <Hierarchy />
        <Inspector />
      </>,
    );

    const canvas = screen.getByLabelText('Canonical design surface');
    const innerCanvasNode = canvas.querySelector<HTMLElement>(`[data-sutra-node="${innerId}"]`);
    if (!innerCanvasNode) throw new Error('Expected the nested Container on the design surface');
    await user.click(innerCanvasNode);

    expect(useStudioStore.getState().selectedNodeId).toBe(innerId);
    expect(hierarchyRow('Inner Container')).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByLabelText('Inspector')).getByLabelText('Layer name')).toHaveValue(
      'Inner Container',
    );
    expect(
      within(screen.getByLabelText('Inspector')).getByRole('heading', { name: 'Container' }),
    ).toBeInTheDocument();

    await user.click(hierarchyRow('Outer Container'));

    expect(useStudioStore.getState().selectedNodeId).toBe(outerId);
    await waitFor(() => {
      expect(canvas.querySelector(`[data-sutra-node="${outerId}"]`)).toHaveAttribute(
        'data-sutra-selected',
        'true',
      );
      expect(canvas.querySelector(`[data-sutra-node="${innerId}"]`)).toHaveAttribute(
        'data-sutra-selected',
        'false',
      );
    });
    expect(screen.getByLabelText('Layer name')).toHaveValue('Outer Container');
  });

  it('deletes a selected subtree and returns selection to its parent', async () => {
    const user = userEvent.setup();
    const { outerId, innerId } = addNestedContainers();
    const textId = useStudioStore.getState().addComponent('sutra.text', innerId);
    if (!textId) throw new Error('Expected nested Text to be created');
    useStudioStore.getState().selectNode(innerId);
    render(
      <>
        <CanonicalCanvas />
        <Hierarchy />
        <Inspector />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete Inner Container' }));

    const state = useStudioStore.getState();
    expect(state.document.nodes[outerId]).toBeDefined();
    expect(state.document.nodes[innerId]).toBeUndefined();
    expect(state.document.nodes[textId]).toBeUndefined();
    expect(state.selectedNodeId).toBe(outerId);
    expect(hierarchyRow('Outer Container')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByDisplayValue('Inner Container')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Layer name')).toHaveValue('Outer Container');
  });

  it('shows explicit Then, Else, and Repeat Template hierarchy rows', async () => {
    const user = userEvent.setup();
    const store = useStudioStore.getState();
    const rootId = store.document.rootNodeId;
    const ifId = store.addIfNode(rootId);
    if (!ifId) throw new Error('Expected If / Else to be created');
    useStudioStore.getState().addComponent('sutra.text', ifId);
    useStudioStore.getState().setActiveIfBranch(ifId, 'whenFalse');
    useStudioStore.getState().addComponent('sutra.heading', ifId);
    const repeatId = useStudioStore.getState().addRepeatNode(rootId);
    if (!repeatId) throw new Error('Expected Repeat to be created');
    useStudioStore.getState().addComponent('sutra.container', repeatId);
    render(<Hierarchy />);

    const tree = screen.getByRole('tree', { name: 'Page content hierarchy' });
    expect(within(tree).getByText('Then', { selector: '.tree-name' })).toBeInTheDocument();
    expect(within(tree).getByText('Else', { selector: '.tree-name' })).toBeInTheDocument();
    expect(within(tree).getByText('Template', { selector: '.tree-name' })).toBeInTheDocument();
    expect(hierarchyRow('Text')).toBeInTheDocument();
    expect(hierarchyRow('Heading')).toBeInTheDocument();
    expect(hierarchyRow('Container')).toBeInTheDocument();

    await user.click(within(tree).getByText('Else', { selector: '.tree-name' }));
    expect(useStudioStore.getState().selectedNodeId).toBe(ifId);
    expect(useStudioStore.getState().activeIfBranches[ifId]).toBe('whenFalse');
  });

  it('only offers declared props for binding and emits the binding in generated JSX', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Palette />
        <Hierarchy />
        <Inspector />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
    const headingId = useStudioStore.getState().selectedNodeId;
    await user.click(screen.getByRole('button', { name: 'Props' }));
    const sourceBeforeDeclaration = screen.getByLabelText('Text value source');
    expect(within(sourceBeforeDeclaration).getAllByRole('option')).toHaveLength(1);
    expect(within(sourceBeforeDeclaration).getByRole('option')).toHaveTextContent('Literal');

    await user.click(hierarchyRow('Home Page'));
    await user.type(screen.getByLabelText('New public prop name'), 'title');
    await user.click(screen.getByTitle('Add typed prop'));

    const publicProp = Object.values(useStudioStore.getState().document.publicProps).find(
      (prop) => prop.name === 'title',
    );
    if (!publicProp) throw new Error('Expected the declared title prop');
    await user.click(hierarchyRow('Heading'));
    await user.selectOptions(screen.getByLabelText('Text value source'), publicProp.symbolId);

    expect(useStudioStore.getState().document.nodes[headingId]).toMatchObject({
      props: {
        text: { kind: 'reference', symbolId: publicProp.symbolId, path: [] },
      },
    });
    const jsx = generateTsx(useStudioStore.getState().document);
    expect(jsx).toContain('title?: string;');
    expect(jsx).toContain('{(props.title ?? "")}');
  });

  it('rejects an undeclared prop reference without changing the document', () => {
    const store = useStudioStore.getState();
    const headingId = store.addComponent('sutra.heading', store.document.rootNodeId);
    if (!headingId) throw new Error('Expected Heading to be created');
    const before = useStudioStore.getState().document;

    const accepted = useStudioStore.getState().dispatch({
      kind: 'setProp',
      nodeId: headingId,
      propName: 'text',
      value: { kind: 'reference', symbolId: 'prop_not_declared', path: [] },
    });

    expect(accepted).toBe(false);
    expect(useStudioStore.getState().document).toBe(before);
    expect(useStudioStore.getState().notice?.kind).toBe('error');
    expect(useStudioStore.getState().notice?.message).toContain('Could not apply this change');
  });
});
