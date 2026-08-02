import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateDocumentGraph } from '@sutra/document-engine';
import { generateTsx } from '@sutra/react-codegen';

import {
  CanvasSelectionToolbar,
  directionalMoveTargets,
  selectedNodeBounds,
} from '../../apps/studio/src/components/CanvasSelectionToolbar';
import { dropAxis } from '../../apps/studio/src/components/DesignFrame';
import { Hierarchy } from '../../apps/studio/src/components/Hierarchy';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function hierarchyRow(label: string): HTMLElement {
  const tree = screen.getByRole('tree', { name: 'Page content hierarchy' });
  const name = within(tree).getByText(label, { selector: '.tree-name' });
  const row = name.closest<HTMLElement>('[role="treeitem"]');
  if (!row) throw new Error(`Expected a hierarchy row named ${label}`);
  return row;
}

function createContainer(name: string): string {
  const state = useStudioStore.getState();
  const id = state.addComponent('sutra.container', state.document.rootNodeId);
  if (!id) throw new Error(`Expected ${name} to be created`);
  useStudioStore.getState().dispatch({ kind: 'renameNode', nodeId: id, name });
  return id;
}

function appendCanvasNode(surfaceRoot: HTMLElement, nodeId: string, rect: DOMRect): HTMLElement {
  const element = document.createElement('div');
  element.setAttribute('data-sutra-node', nodeId);
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
  surfaceRoot.append(element);
  return element;
}

class TestDataTransfer {
  private readonly values = new Map<string, string>();
  effectAllowed = 'uninitialized';
  dropEffect = 'none';

  get types(): string[] {
    return [...this.values.keys()];
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }

  getData(type: string): string {
    return this.values.get(type) ?? '';
  }
}

describe('editor contextual actions', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('moves a static value to a typed page prop as one undoable edit', () => {
    const store = useStudioStore.getState();
    const headingId = store.addComponent('sutra.heading', store.document.rootNodeId);
    if (!headingId) throw new Error('Expected Heading to be created');
    useStudioStore
      .getState()
      .dispatch({ kind: 'renameNode', nodeId: headingId, name: 'Hero Heading' });
    useStudioStore.getState().setLiteralProp(headingId, 'text', 'Ship faster');
    const revisionBeforePromotion = useStudioStore.getState().document.revision;
    render(<Hierarchy />);

    fireEvent.contextMenu(hierarchyRow('Hero Heading'), { clientX: 120, clientY: 180 });
    const menu = screen.getByRole('menu', {
      name: 'Move Hero Heading value to page props',
    });
    fireEvent.click(
      within(menu).getByRole('menuitem', {
        name: 'Move text to props.heroHeadingText',
      }),
    );

    let state = useStudioStore.getState();
    const prop = state.document.publicProps['heroHeadingText'];
    expect(prop).toMatchObject({
      name: 'heroHeadingText',
      valueType: 'string',
      required: false,
      defaultValue: 'Ship faster',
    });
    expect(state.document.symbols[prop!.symbolId]).toMatchObject({
      provider: 'prop',
      valueType: 'string',
      defaultValue: 'Ship faster',
    });
    expect(state.document.nodes[headingId]).toMatchObject({
      props: {
        text: { kind: 'reference', symbolId: prop!.symbolId, path: [] },
      },
    });
    expect(state.document.revision).toBe(revisionBeforePromotion + 1);
    expect(state.inspectorTab).toBe('props');
    expect(state.notice?.message).toBe('Moved text to props.heroHeadingText');
    expect(validateDocumentGraph(state.document)).toEqual([]);
    expect(generateTsx(state.document)).toContain('heroHeadingText?: string;');
    expect(generateTsx(state.document)).toContain('(props.heroHeadingText ?? "Ship faster")');

    state.undo();
    state = useStudioStore.getState();
    expect(state.document.publicProps['heroHeadingText']).toBeUndefined();
    expect(state.document.nodes[headingId]).toMatchObject({
      props: { text: { kind: 'literal', value: 'Ship faster' } },
    });
  });

  it('uses the rendered grid column count for responsive canvas drop placement', () => {
    const grid = document.createElement('div');
    const item = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(1, minmax(0, 1fr))';
    grid.append(item);
    document.body.append(grid);

    expect(dropAxis(item)).toBe('vertical');
    grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
    expect(dropAxis(item)).toBe('horizontal');
  });

  it('resolves visual row and grid neighbors without crossing the selected node slot', () => {
    const firstId = createContainer('First');
    const secondId = createContainer('Second');
    const thirdId = createContainer('Third');
    const fourthId = createContainer('Fourth');
    const nestedId = useStudioStore.getState().addComponent('sutra.container', secondId);
    if (!nestedId) throw new Error('Expected a nested Container');

    const surfaceRoot = document.createElement('div');
    const first = appendCanvasNode(surfaceRoot, firstId, new DOMRect(0, 0, 80, 80));
    appendCanvasNode(surfaceRoot, secondId, new DOMRect(100, 0, 80, 80));
    appendCanvasNode(surfaceRoot, thirdId, new DOMRect(0, 100, 80, 80));
    appendCanvasNode(surfaceRoot, fourthId, new DOMRect(100, 100, 80, 80));
    appendCanvasNode(surfaceRoot, nestedId, new DOMRect(0, 82, 80, 16));
    document.body.append(surfaceRoot);

    const targets = directionalMoveTargets(
      surfaceRoot,
      useStudioStore.getState().document,
      firstId,
      first,
    );
    expect(targets).toEqual({
      up: null,
      right: { targetNodeId: secondId, intent: 'after' },
      down: { targetNodeId: thirdId, intent: 'after' },
      left: null,
    });
  });

  it('derives move intent from canonical order when visual order is reversed', () => {
    const firstId = createContainer('First');
    const secondId = createContainer('Second');
    const surfaceRoot = document.createElement('div');
    const first = appendCanvasNode(surfaceRoot, firstId, new DOMRect(120, 0, 80, 80));
    appendCanvasNode(surfaceRoot, secondId, new DOMRect(20, 0, 80, 80));
    document.body.append(surfaceRoot);

    expect(
      directionalMoveTargets(surfaceRoot, useStudioStore.getState().document, firstId, first).left,
    ).toEqual({ targetNodeId: secondId, intent: 'after' });
  });

  it('keeps generated page-prop names unique across similar components', () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const firstId = useStudioStore.getState().addComponent('sutra.text', rootId);
    const secondId = useStudioStore.getState().addComponent('sutra.text', rootId);
    if (!firstId || !secondId) throw new Error('Expected both Text components');
    useStudioStore.getState().setLiteralProp(firstId, 'text', 'First');
    useStudioStore.getState().setLiteralProp(secondId, 'text', 'Second');

    expect(useStudioStore.getState().promoteLiteralProp(firstId, 'text')).toBe('textText');
    expect(useStudioStore.getState().promoteLiteralProp(secondId, 'text')).toBe('textText2');

    const state = useStudioStore.getState();
    expect(state.document.publicProps['textText']?.defaultValue).toBe('First');
    expect(state.document.publicProps['textText2']?.defaultValue).toBe('Second');
  });

  it('shows before/after hierarchy indicators and reorders siblings precisely', () => {
    const firstId = createContainer('First Container');
    const secondId = createContainer('Second Container');
    const thirdId = createContainer('Third Container');
    render(<Hierarchy />);

    const firstRow = hierarchyRow('First Container');
    const secondRow = hierarchyRow('Second Container');
    vi.spyOn(secondRow, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      top: 100,
      right: 260,
      bottom: 132,
      left: 0,
      width: 260,
      height: 32,
      toJSON: () => ({}),
    });
    const dataTransfer = new TestDataTransfer();
    fireEvent.dragStart(firstRow, { dataTransfer });
    const dragOver = createEvent.dragOver(secondRow, { dataTransfer });
    Object.defineProperty(dragOver, 'clientY', { value: 130 });
    fireEvent(secondRow, dragOver);
    expect(secondRow).toHaveClass('is-drop-after');
    const drop = createEvent.drop(secondRow, { dataTransfer });
    Object.defineProperty(drop, 'clientY', { value: 130 });
    fireEvent(secondRow, drop);

    let root =
      useStudioStore.getState().document.nodes[useStudioStore.getState().document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    expect(root.slots['children']).toEqual([secondId, firstId, thirdId]);

    useStudioStore.getState().moveNode(firstId, secondId, 'before');
    root = useStudioStore.getState().document.nodes[useStudioStore.getState().document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    expect(root.slots['children']).toEqual([firstId, secondId, thirdId]);
    expect(useStudioStore.getState().selectedNodeId).toBe(firstId);
    expect(validateDocumentGraph(useStudioStore.getState().document)).toEqual([]);
  });

  it('shows type-aware quick options and keeps formatting in the canonical document', () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const textId = useStudioStore.getState().addComponent('sutra.text', rootId);
    if (!textId) throw new Error('Expected Text to be created');
    useStudioStore.getState().setLiteralProp(textId, 'text', 'Editable copy');

    const surfaceRoot = document.createElement('div');
    const anchor = document.createElement('p');
    anchor.setAttribute('data-sutra-node', textId);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 120, 320, 42));
    surfaceRoot.append(anchor);
    document.body.append(surfaceRoot);
    render(
      <CanvasSelectionToolbar surfaceRoot={surfaceRoot} nodeId={textId} preferredAnchor={anchor} />,
    );

    const toolbar = screen.getByRole('toolbar', { name: 'Text actions' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Edit Text' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Text' });
    fireEvent.change(within(dialog).getByLabelText('Text'), {
      target: { value: 'Updated from the canvas' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bold' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Italic' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Underline' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Align center' }));

    const node = useStudioStore.getState().document.nodes[textId];
    expect(node).toMatchObject({
      kind: 'element',
      props: { text: { kind: 'literal', value: 'Updated from the canvas' } },
      style: {
        base: {
          fontWeight: 700,
          fontStyle: 'italic',
          textDecoration: 'underline',
          textAlign: 'center',
        },
      },
    });
    expect(validateDocumentGraph(useStudioStore.getState().document)).toEqual([]);
    expect(generateTsx(useStudioStore.getState().document)).toContain('fontWeight: 700');
  });

  it('moves the selected sibling with accessible direction buttons as one undoable edit', () => {
    const firstId = createContainer('First Container');
    const secondId = createContainer('Second Container');
    const thirdId = createContainer('Third Container');
    useStudioStore.getState().selectNode(secondId);

    const surfaceRoot = document.createElement('div');
    appendCanvasNode(surfaceRoot, firstId, new DOMRect(40, 20, 240, 60));
    const second = appendCanvasNode(surfaceRoot, secondId, new DOMRect(40, 100, 240, 60));
    appendCanvasNode(surfaceRoot, thirdId, new DOMRect(40, 180, 240, 60));
    document.body.append(surfaceRoot);
    render(
      <CanvasSelectionToolbar
        surfaceRoot={surfaceRoot}
        nodeId={secondId}
        preferredAnchor={second}
      />,
    );

    const group = screen.getByRole('group', { name: 'Move Second Container by direction' });
    const up = within(group).getByRole('button', { name: 'Move Second Container up' });
    const right = within(group).getByRole('button', { name: 'Move Second Container right' });
    const down = within(group).getByRole('button', { name: 'Move Second Container down' });
    const left = within(group).getByRole('button', { name: 'Move Second Container left' });
    expect(up).toBeEnabled();
    expect(down).toBeEnabled();
    expect(left).toBeDisabled();
    expect(right).toBeDisabled();

    const revision = useStudioStore.getState().document.revision;
    up.focus();
    fireEvent.click(up);

    let state = useStudioStore.getState();
    let root = state.document.nodes[state.document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    expect(root.slots['children']).toEqual([secondId, firstId, thirdId]);
    expect(state.document.revision).toBe(revision + 1);
    expect(state.selectedNodeId).toBe(secondId);
    expect(state.notice?.message).toBe('Moved Second Container up');
    expect(validateDocumentGraph(state.document)).toEqual([]);

    state.undo();
    state = useStudioStore.getState();
    root = state.document.nodes[state.document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    expect(root.slots['children']).toEqual([firstId, secondId, thirdId]);
    expect(state.selectedNodeId).toBe(secondId);
  });

  it('keeps bound quick content read-only instead of replacing its expression', () => {
    const state = useStudioStore.getState();
    state.addPublicProp('message', 'string');
    const prop = useStudioStore.getState().document.publicProps['message'];
    const textId = useStudioStore
      .getState()
      .addComponent('sutra.text', useStudioStore.getState().document.rootNodeId);
    if (!textId || !prop) throw new Error('Expected bound Text fixture');
    useStudioStore.getState().bindProp(textId, 'text', prop.symbolId);

    const surfaceRoot = document.createElement('div');
    const anchor = document.createElement('p');
    anchor.setAttribute('data-sutra-node', textId);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 80, 240, 30));
    surfaceRoot.append(anchor);
    document.body.append(surfaceRoot);
    render(<CanvasSelectionToolbar surfaceRoot={surfaceRoot} nodeId={textId} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Text' }));
    const content = screen
      .getByRole('dialog', { name: 'Edit Text' })
      .querySelector<HTMLInputElement>('input[placeholder="Bound to a prop or expression"]');
    if (!content) throw new Error('Expected a disabled bound-content field');
    expect(content).toBeDisabled();
    expect(content).toHaveAttribute('placeholder', 'Bound to a prop or expression');
    expect(useStudioStore.getState().document.nodes[textId]).toMatchObject({
      props: { text: { kind: 'reference', symbolId: prop.symbolId, path: [] } },
    });
  });

  it('deletes directly from the floating toolbar, selects the parent, and protects the Page root', () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const containerId = createContainer('Disposable Container');
    useStudioStore.getState().selectNode(containerId);

    const surfaceRoot = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.setAttribute('data-sutra-node', containerId);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(50, 90, 280, 160));
    surfaceRoot.append(anchor);
    document.body.append(surfaceRoot);
    const { rerender } = render(
      <CanvasSelectionToolbar surfaceRoot={surfaceRoot} nodeId={containerId} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Disposable Container' }));
    expect(useStudioStore.getState().document.nodes[containerId]).toBeUndefined();
    expect(useStudioStore.getState().selectedNodeId).toBe(rootId);
    expect(useStudioStore.getState().notice?.message).toBe('Deleted Disposable Container');

    anchor.setAttribute('data-sutra-node', rootId);
    rerender(<CanvasSelectionToolbar surfaceRoot={surfaceRoot} nodeId={rootId} />);
    expect(screen.getByRole('button', { name: 'Move Home Page', exact: true })).toBeDisabled();
    const directionGroup = screen.getByRole('group', { name: 'Move Home Page by direction' });
    expect(
      within(directionGroup).getByRole('button', { name: 'Move Home Page up' }),
    ).toBeDisabled();
    expect(
      within(directionGroup).getByRole('button', { name: 'Move Home Page right' }),
    ).toBeDisabled();
    expect(
      within(directionGroup).getByRole('button', { name: 'Move Home Page down' }),
    ).toBeDisabled();
    expect(
      within(directionGroup).getByRole('button', { name: 'Move Home Page left' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete Home Page/i })).toBeDisabled();
  });

  it('uses visible descendants to position structural nodes with display contents', () => {
    const surfaceRoot = document.createElement('div');
    const structure = document.createElement('div');
    structure.setAttribute('data-sutra-node', 'if_example');
    vi.spyOn(structure, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.setAttribute('data-sutra-node', 'first');
    second.setAttribute('data-sutra-node', 'second');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 50, 100, 40));
    vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(150, 70, 80, 60));
    structure.append(first, second);
    surfaceRoot.append(structure);

    expect(selectedNodeBounds(surfaceRoot, 'if_example')).toEqual(new DOMRect(30, 50, 200, 80));
  });
});
