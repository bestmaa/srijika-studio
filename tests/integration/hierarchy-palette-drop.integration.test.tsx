import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateDocumentGraph } from '@srijika/document-engine';

import { Hierarchy } from '../../apps/studio/src/components/Hierarchy';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function hierarchyRow(label: string): HTMLElement {
  const tree = screen.getByRole('tree', { name: 'Page content hierarchy' });
  const name = within(tree).getByText(label, { selector: '.tree-name' });
  const row = name.closest<HTMLElement>('[role="treeitem"]');
  if (!row) throw new Error(`Expected a hierarchy row named ${label}`);
  return row;
}

function createContainer(name: string, parentId?: string): string {
  const state = useStudioStore.getState();
  const id = state.addComponent('srijika.container', parentId ?? state.document.rootNodeId);
  if (!id) throw new Error(`Expected ${name} to be created`);
  useStudioStore.getState().dispatch({ kind: 'renameNode', nodeId: id, name });
  return id;
}

function mockRowBounds(row: HTMLElement, top = 100, height = 40): void {
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    right: 260,
    bottom: top + height,
    left: 0,
    width: 260,
    height,
    toJSON: () => ({}),
  });
}

function hitTest(element: Element): void {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => element),
  });
}

describe('palette drops into the hierarchy', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds a palette component inside a nested container as one selected, undoable edit', async () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const outerId = createContainer('Outer Container', rootId);
    const revisionBeforeDrop = useStudioStore.getState().document.revision;
    render(<Hierarchy />);

    const outerRow = hierarchyRow('Outer Container');
    mockRowBounds(outerRow);
    hitTest(outerRow);

    act(() => {
      useStudioStore.getState().beginDrag({ kind: 'component', componentId: 'srijika.text' });
      useStudioStore.getState().moveDrag(130, 120);
    });
    await waitFor(() => expect(outerRow).toHaveClass('is-drop-inside'));

    act(() => useStudioStore.getState().releaseDrag(130, 120));

    await waitFor(() => expect(useStudioStore.getState().activeDrag).toBeNull());
    let state = useStudioStore.getState();
    const selected = state.document.nodes[state.selectedNodeId];
    const outer = state.document.nodes[outerId];
    const root = state.document.nodes[rootId];
    expect(selected).toMatchObject({ kind: 'element', componentId: 'srijika.text' });
    expect(outer).toMatchObject({ slots: { children: [state.selectedNodeId] } });
    expect(root).toMatchObject({ slots: { children: [outerId] } });
    expect(state.document.revision).toBe(revisionBeforeDrop + 1);
    expect(hierarchyRow('Text')).toHaveAttribute('aria-selected', 'true');
    expect(state.dropTargetNodeId).toBeNull();
    expect(validateDocumentGraph(state.document)).toEqual([]);

    act(() => useStudioStore.getState().undo());
    state = useStudioStore.getState();
    expect(state.document.nodes[outerId]).toMatchObject({ slots: { children: [] } });
    expect(state.document.nodes[state.selectedNodeId]).toBeDefined();
  });

  it('inserts palette components at exact before and after sibling positions', async () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const firstId = createContainer('First Container', rootId);
    const secondId = createContainer('Second Container', rootId);
    render(<Hierarchy />);

    const secondRow = hierarchyRow('Second Container');
    mockRowBounds(secondRow);
    hitTest(secondRow);
    act(() => {
      useStudioStore.getState().beginDrag({ kind: 'component', componentId: 'srijika.button' });
      useStudioStore.getState().moveDrag(130, 103);
    });
    await waitFor(() => expect(secondRow).toHaveClass('is-drop-before'));
    act(() => useStudioStore.getState().releaseDrag(130, 103));
    await waitFor(() => expect(useStudioStore.getState().activeDrag).toBeNull());

    let state = useStudioStore.getState();
    const buttonId = state.selectedNodeId;
    expect(state.document.nodes[rootId]).toMatchObject({
      slots: { children: [firstId, buttonId, secondId] },
    });

    const firstRow = hierarchyRow('First Container');
    mockRowBounds(firstRow, 200);
    hitTest(firstRow);
    act(() => {
      useStudioStore.getState().beginDrag({ kind: 'component', componentId: 'srijika.input' });
      useStudioStore.getState().moveDrag(130, 237);
    });
    await waitFor(() => expect(firstRow).toHaveClass('is-drop-after'));
    act(() => useStudioStore.getState().releaseDrag(130, 237));
    await waitFor(() => expect(useStudioStore.getState().activeDrag).toBeNull());

    state = useStudioStore.getState();
    const inputId = state.selectedNodeId;
    expect(state.document.nodes[rootId]).toMatchObject({
      slots: { children: [firstId, inputId, buttonId, secondId] },
    });
    expect(validateDocumentGraph(state.document)).toEqual([]);
  });

  it('targets the exact Else and Repeat Template virtual slots', async () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const containerId = createContainer('Logic Container', rootId);
    const ifId = useStudioStore.getState().addIfNode(containerId);
    if (!ifId) throw new Error('Expected If / Else to be created');
    render(<Hierarchy />);

    const elseRow = hierarchyRow('Else');
    mockRowBounds(elseRow);
    hitTest(elseRow);
    act(() => {
      useStudioStore.getState().beginDrag({ kind: 'structure', structure: 'repeat' });
      useStudioStore.getState().moveDrag(130, 120);
    });
    await waitFor(() => expect(elseRow).toHaveClass('is-drop-inside'));
    act(() => useStudioStore.getState().releaseDrag(130, 120));
    await waitFor(() => expect(useStudioStore.getState().activeDrag).toBeNull());

    let state = useStudioStore.getState();
    const repeatId = state.selectedNodeId;
    expect(state.activeIfBranches[ifId]).toBe('whenFalse');
    expect(state.document.nodes[ifId]).toMatchObject({ whenTrue: [], whenFalse: [repeatId] });
    expect(state.document.nodes[repeatId]).toMatchObject({ kind: 'repeat', children: [] });
    expect(state.document.symbols[`${repeatId}_item`]).toMatchObject({ provider: 'repeatItem' });
    expect(state.document.symbols[`${repeatId}_index`]).toMatchObject({ provider: 'repeatIndex' });

    const templateRow = hierarchyRow('Template');
    mockRowBounds(templateRow, 200);
    hitTest(templateRow);
    act(() => {
      useStudioStore.getState().beginDrag({ kind: 'component', componentId: 'srijika.text' });
      useStudioStore.getState().moveDrag(130, 220);
    });
    await waitFor(() => expect(templateRow).toHaveClass('is-drop-inside'));
    act(() => useStudioStore.getState().releaseDrag(130, 220));
    await waitFor(() => expect(useStudioStore.getState().activeDrag).toBeNull());

    state = useStudioStore.getState();
    expect(state.document.nodes[repeatId]).toMatchObject({ children: [state.selectedNodeId] });
    expect(state.document.nodes[state.selectedNodeId]).toMatchObject({
      kind: 'element',
      componentId: 'srijika.text',
    });
    expect(validateDocumentGraph(state.document)).toEqual([]);
  });

  it('uses blank hierarchy space as a Page-root drop target', async () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    render(<Hierarchy />);
    const tree = screen.getByRole('tree', { name: 'Page content hierarchy' });
    hitTest(tree);

    act(() => {
      useStudioStore.getState().beginDrag({ kind: 'component', componentId: 'srijika.grid' });
      useStudioStore.getState().moveDrag(130, 300);
      useStudioStore.getState().releaseDrag(130, 300);
    });

    await waitFor(() => expect(useStudioStore.getState().activeDrag).toBeNull());
    const state = useStudioStore.getState();
    expect(state.document.nodes[rootId]).toMatchObject({
      slots: { children: [state.selectedNodeId] },
    });
    expect(state.document.nodes[state.selectedNodeId]).toMatchObject({
      kind: 'element',
      componentId: 'srijika.grid',
    });
  });
});
