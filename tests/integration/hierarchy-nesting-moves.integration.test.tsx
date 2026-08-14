import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateDocumentGraph } from '@srijika/document-engine';

import { Hierarchy, hierarchyLevelMoveTargets } from '../../apps/studio/src/components/Hierarchy';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

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

function hierarchyRow(label: string): HTMLElement {
  const tree = screen.getByRole('tree', { name: 'Page content hierarchy' });
  const name = within(tree).getByText(label, { selector: '.tree-name' });
  const row = name.closest<HTMLElement>('[role="treeitem"]');
  if (!row) throw new Error(`Expected a hierarchy row named ${label}`);
  return row;
}

function createContainer(name: string, parentId: string): string {
  const id = useStudioStore.getState().addComponent('srijika.container', parentId);
  if (!id) throw new Error(`Expected ${name} to be created`);
  useStudioStore.getState().dispatch({ kind: 'renameNode', nodeId: id, name });
  return id;
}

function childrenOf(nodeId: string): readonly string[] {
  const node = useStudioStore.getState().document.nodes[nodeId];
  if (!node || node.kind !== 'element') throw new Error(`Expected ${nodeId} to be an element`);
  return node.slots['children'] ?? [];
}

function mockRowBounds(row: HTMLElement, top = 100): void {
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    right: 260,
    bottom: top + 40,
    left: 0,
    width: 260,
    height: 40,
    toJSON: () => ({}),
  });
}

function deepHierarchy(): { a: string; b: string; c: string; d: string; x: string } {
  const rootId = useStudioStore.getState().document.rootNodeId;
  const a = createContainer('A', rootId);
  const b = createContainer('B', a);
  const c = createContainer('C', b);
  const d = createContainer('D', c);
  const x = createContainer('X', b);
  useStudioStore.getState().selectNode(d);
  return { a, b, c, d, x };
}

describe('hierarchy nesting level moves', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('outdents D beside C and indents it back with one undoable edit each', () => {
    const { b, c, d, x } = deepHierarchy();
    render(<Hierarchy />);

    expect(hierarchyRow('D')).toHaveAttribute('aria-level', '5');
    expect(hierarchyLevelMoveTargets(useStudioStore.getState().document, d)).toEqual({
      indent: null,
      outdent: { targetNodeId: c, intent: 'after' },
    });
    const revisionBeforeOutdent = useStudioStore.getState().document.revision;
    fireEvent.click(
      within(hierarchyRow('D')).getByRole('button', { name: 'Move D out one level' }),
    );

    let state = useStudioStore.getState();
    expect(childrenOf(b)).toEqual([c, d, x]);
    expect(childrenOf(c)).toEqual([]);
    expect(hierarchyRow('D')).toHaveAttribute('aria-level', '4');
    expect(hierarchyRow('D')).toHaveAttribute('aria-selected', 'true');
    expect(state.document.revision).toBe(revisionBeforeOutdent + 1);
    expect(state.notice?.message).toBe('Moved D out one level after C');
    expect(validateDocumentGraph(state.document)).toEqual([]);

    fireEvent.click(within(hierarchyRow('D')).getByRole('button', { name: /into previous/ }));
    state = useStudioStore.getState();
    expect(childrenOf(b)).toEqual([c, x]);
    expect(childrenOf(c)).toEqual([d]);
    expect(hierarchyRow('D')).toHaveAttribute('aria-level', '5');
    expect(state.notice?.message).toBe('Moved D into C');

    act(() => useStudioStore.getState().undo());
    expect(childrenOf(b)).toEqual([c, d, x]);
    expect(childrenOf(c)).toEqual([]);
    expect(hierarchyRow('D')).toHaveAttribute('aria-level', '4');
    act(() => useStudioStore.getState().undo());
    expect(childrenOf(b)).toEqual([c, x]);
    expect(childrenOf(c)).toEqual([d]);
    expect(hierarchyRow('D')).toHaveAttribute('aria-level', '5');
  });

  it('uses clear after/inside drag targets across levels and rejects cycles and no-ops', () => {
    const { a, b, c, d, x } = deepHierarchy();
    render(<Hierarchy />);
    const dRow = hierarchyRow('D');
    const cRow = hierarchyRow('C');
    mockRowBounds(cRow);
    const dataTransfer = new TestDataTransfer();
    fireEvent.dragStart(dRow, { dataTransfer });
    const after = createEvent.dragOver(cRow, { dataTransfer });
    Object.defineProperty(after, 'clientY', { value: 138 });
    fireEvent(cRow, after);
    expect(cRow).toHaveClass('is-drop-after');
    expect(screen.getByRole('status')).toHaveTextContent('D → After C');
    const dropAfter = createEvent.drop(cRow, { dataTransfer });
    Object.defineProperty(dropAfter, 'clientY', { value: 138 });
    fireEvent(cRow, dropAfter);
    expect(childrenOf(b)).toEqual([c, d, x]);
    expect(childrenOf(c)).toEqual([]);

    const movedDRow = hierarchyRow('D');
    const movedCRow = hierarchyRow('C');
    mockRowBounds(movedCRow, 200);
    const nestTransfer = new TestDataTransfer();
    fireEvent.dragStart(movedDRow, { dataTransfer: nestTransfer });
    const inside = createEvent.dragOver(movedCRow, { dataTransfer: nestTransfer });
    Object.defineProperty(inside, 'clientY', { value: 220 });
    fireEvent(movedCRow, inside);
    expect(movedCRow).toHaveClass('is-drop-inside');
    expect(screen.getByRole('status')).toHaveTextContent('D → Inside C');
    const dropInside = createEvent.drop(movedCRow, { dataTransfer: nestTransfer });
    Object.defineProperty(dropInside, 'clientY', { value: 220 });
    fireEvent(movedCRow, dropInside);
    expect(childrenOf(b)).toEqual([c, x]);
    expect(childrenOf(c)).toEqual([d]);

    const revisionBeforeNoop = useStudioStore.getState().document.revision;
    useStudioStore.getState().moveNode(d, c, 'inside');
    expect(useStudioStore.getState().document.revision).toBe(revisionBeforeNoop);

    const aRow = hierarchyRow('A');
    const nestedDRow = hierarchyRow('D');
    mockRowBounds(nestedDRow, 300);
    const invalidTransfer = new TestDataTransfer();
    fireEvent.dragStart(aRow, { dataTransfer: invalidTransfer });
    const invalid = createEvent.dragOver(nestedDRow, { dataTransfer: invalidTransfer });
    Object.defineProperty(invalid, 'clientY', { value: 320 });
    fireEvent(nestedDRow, invalid);
    expect(nestedDRow).not.toHaveClass('is-drop-inside');
    expect(invalidTransfer.dropEffect).toBe('none');
    const revisionBeforeInvalidDrop = useStudioStore.getState().document.revision;
    const invalidDrop = createEvent.drop(nestedDRow, { dataTransfer: invalidTransfer });
    Object.defineProperty(invalidDrop, 'clientY', { value: 320 });
    fireEvent(nestedDRow, invalidDrop);
    expect(useStudioStore.getState().document.revision).toBe(revisionBeforeInvalidDrop);
    expect(childrenOf(useStudioStore.getState().document.rootNodeId)).toEqual([a]);
  });

  it('supports Alt+Left/Right and disables impossible level changes', () => {
    const rootId = useStudioStore.getState().document.rootNodeId;
    const leaf = useStudioStore.getState().addComponent('srijika.text', rootId);
    if (!leaf) throw new Error('Expected Text to be created');
    const container = createContainer('Root Container', rootId);
    const child = createContainer('Child', container);
    render(<Hierarchy />);

    const rootContainerRow = hierarchyRow('Root Container');
    expect(
      within(rootContainerRow).getByRole('button', { name: 'Move Root Container out one level' }),
    ).toBeDisabled();
    expect(
      within(rootContainerRow).getByRole('button', { name: /into previous container/ }),
    ).toBeDisabled();

    const childRow = hierarchyRow('Child');
    childRow.focus();
    fireEvent.keyDown(childRow, { key: 'ArrowLeft', altKey: true });
    expect(childrenOf(container)).toEqual([]);
    expect(childrenOf(rootId)).toEqual([leaf, container, child]);
    expect(hierarchyRow('Child')).toHaveAttribute('aria-selected', 'true');

    const movedChildRow = hierarchyRow('Child');
    fireEvent.keyDown(movedChildRow, { key: 'ArrowRight', altKey: true });
    expect(childrenOf(rootId)).toEqual([leaf, container]);
    expect(childrenOf(container)).toEqual([child]);
    expect(useStudioStore.getState().selectedNodeId).toBe(child);
  });
});
