import {
  ArrowLeft,
  ArrowRight,
  Braces,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  GitBranch,
  GripVertical,
  Layers,
  Repeat2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import type { ElementNode, UiDocument, UiNode, ValueExpression } from '@srijika/contracts';
import { deriveParentIndex, isDescendant } from '@srijika/document-engine';

import { componentRegistry } from '../lib/registry';
import { type NodeDropIntent, type StudioDragPayload, useStudioStore } from '../store/studio-store';
import { srijikaDragTypes } from './Palette';
import { PromotePropMenu, type ContextMenuAnchor } from './PromotePropMenu';

function StructureIcon({ node }: { node: UiNode }) {
  if (node.kind === 'if') return <GitBranch size={13} />;
  if (node.kind === 'repeat') return <Repeat2 size={13} />;
  if (node.kind === 'fragment' || node.kind === 'slot') return <Braces size={13} />;
  return <Layers size={13} />;
}

function literalNumber(expression: ValueExpression | undefined, fallback: number): number {
  return expression?.kind === 'literal' && typeof expression.value === 'number'
    ? expression.value
    : fallback;
}

function literalString(expression: ValueExpression | undefined): string | null {
  return expression?.kind === 'literal' && typeof expression.value === 'string'
    ? expression.value
    : null;
}

function semanticTag(node: ElementNode): string | null {
  if (node.componentId === 'srijika.page') return 'main';
  if (node.componentId === 'srijika.heading') {
    return `h${Math.max(1, Math.min(6, literalNumber(node.props['level'], 2)))}`;
  }
  if (node.componentId === 'srijika.text') return 'p';
  if (node.componentId === 'srijika.button') return 'button';
  if (node.componentId === 'srijika.input') return 'label';
  if (
    node.componentId === 'srijika.container' ||
    node.componentId === 'srijika.stack' ||
    node.componentId === 'srijika.grid'
  ) {
    return literalString(node.props['as']) ?? 'div';
  }
  return null;
}

function expressionSummary(expression: ValueExpression): string {
  if (expression.kind === 'reference') return `symbol:${expression.symbolId}`;
  if (expression.kind === 'unary' && expression.operand.kind === 'reference') {
    return `!symbol:${expression.operand.symbolId}`;
  }
  if (expression.kind === 'literal') {
    if (
      typeof expression.value === 'string' ||
      typeof expression.value === 'number' ||
      typeof expression.value === 'boolean'
    ) {
      return String(expression.value);
    }
    if (expression.value === null) return 'null';
    return JSON.stringify(expression.value);
  }
  return expression.kind;
}

function nodeMeta(node: UiNode): string | null {
  if (node.kind === 'element') {
    const tag = semanticTag(node);
    return tag
      ? `<${tag}>`
      : (componentRegistry.get(node.componentId)?.manifest.displayName ?? null);
  }
  if (node.kind === 'if') return expressionSummary(node.condition);
  if (node.kind === 'repeat') return expressionSummary(node.source);
  if (node.kind === 'fragment') return '<>';
  if (node.kind === 'slot') return node.slotName;
  return node.kind;
}

function ordinaryChildren(node: UiNode): readonly string[] {
  if (node.kind === 'element') return Object.values(node.slots).flat();
  if (node.kind === 'fragment') return node.children;
  if (node.kind === 'slot') return node.fallback;
  return [];
}

function nodeCanContain(node: UiNode | undefined): boolean {
  return Boolean(
    node &&
    ((node.kind === 'element' && Boolean(node.slots['children'])) ||
      node.kind === 'if' ||
      node.kind === 'repeat' ||
      node.kind === 'fragment' ||
      node.kind === 'slot'),
  );
}

function childrenForSlot(node: UiNode | undefined, slot: string): readonly string[] {
  if (!node) return [];
  if (node.kind === 'element') return node.slots[slot] ?? [];
  if (node.kind === 'if') {
    return slot === 'whenFalse' ? node.whenFalse : node.whenTrue;
  }
  if (node.kind === 'repeat' || node.kind === 'fragment') return node.children;
  if (node.kind === 'slot') return node.fallback;
  return [];
}

export interface HierarchyLevelMoveTarget {
  targetNodeId: string;
  intent: Extract<NodeDropIntent, 'inside' | 'after'>;
}

export interface HierarchyLevelMoveTargets {
  indent: HierarchyLevelMoveTarget | null;
  outdent: HierarchyLevelMoveTarget | null;
}

export function hierarchyLevelMoveTargets(
  document: UiDocument,
  nodeId: string,
): HierarchyLevelMoveTargets {
  const location = deriveParentIndex(document).get(nodeId);
  if (!location || nodeId === document.rootNodeId) return { indent: null, outdent: null };
  const siblings = childrenForSlot(document.nodes[location.parentId], location.slot);
  const previousSiblingId = siblings[location.index - 1];
  return {
    indent:
      previousSiblingId && nodeCanContain(document.nodes[previousSiblingId])
        ? { targetNodeId: previousSiblingId, intent: 'inside' }
        : null,
    outdent:
      location.parentId !== document.rootNodeId
        ? { targetNodeId: location.parentId, intent: 'after' }
        : null,
  };
}

function activateWithKeyboard(event: KeyboardEvent<HTMLElement>, activate: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  activate();
}

function hierarchyDropIntentAtY(
  bounds: Pick<DOMRect, 'top' | 'height'>,
  clientY: number,
  canContain: boolean,
): NodeDropIntent {
  if (bounds.height <= 0) return canContain ? 'inside' : 'after';
  const ratio = (clientY - bounds.top) / bounds.height;
  if (ratio <= 0.25) return 'before';
  if (ratio >= 0.75) return 'after';
  return canContain ? 'inside' : ratio < 0.5 ? 'before' : 'after';
}

function hierarchyDropIntent(event: DragEvent<HTMLElement>, canContain: boolean): NodeDropIntent {
  return hierarchyDropIntentAtY(
    event.currentTarget.getBoundingClientRect(),
    event.clientY,
    canContain,
  );
}

const hierarchyDropTargetSelector = '[data-srijika-hierarchy-drop-target]';

type HierarchySlot = 'whenTrue' | 'whenFalse' | 'children';

export interface HierarchyDropPlacement {
  targetNodeId: string;
  intent: NodeDropIntent;
  slot?: HierarchySlot;
}

export function hierarchyDropPlacementFromElement(
  element: Element | null,
  clientY: number,
  rootNodeId: string,
): HierarchyDropPlacement | null {
  const row = element?.closest<HTMLElement>(hierarchyDropTargetSelector);
  const targetNodeId = row?.dataset['srijikaHierarchyDropTarget'];
  if (!row || !targetNodeId) return null;
  const slot = row.dataset['srijikaHierarchySlot'] as HierarchySlot | undefined;
  const canContain = row.dataset['srijikaHierarchyCanContain'] === 'true';
  return {
    targetNodeId,
    intent:
      targetNodeId === rootNodeId || slot
        ? 'inside'
        : hierarchyDropIntentAtY(row.getBoundingClientRect(), clientY, canContain),
    ...(slot ? { slot } : {}),
  };
}

export function hierarchyDropIsValid(
  document: UiDocument,
  payload: StudioDragPayload,
  placement: HierarchyDropPlacement,
  activeIfBranches: Readonly<Record<string, 'whenTrue' | 'whenFalse'>> = {},
): boolean {
  let parentId: string;
  let slot: string;
  let index: number;
  if (placement.intent === 'inside') {
    const parent = document.nodes[placement.targetNodeId];
    if (!parent || !nodeCanContain(parent)) return false;
    parentId = placement.targetNodeId;
    slot =
      placement.slot ??
      (parent.kind === 'element'
        ? 'children'
        : parent.kind === 'if'
          ? (activeIfBranches[parent.id] ?? 'whenTrue')
          : parent.kind === 'slot'
            ? 'fallback'
            : 'children');
    index = childrenForSlot(parent, slot).length;
  } else {
    const target = deriveParentIndex(document).get(placement.targetNodeId);
    if (!target) return false;
    parentId = target.parentId;
    slot = target.slot;
    index = target.index + (placement.intent === 'after' ? 1 : 0);
  }

  if (payload.kind !== 'node') return true;
  if (
    payload.nodeId === document.rootNodeId ||
    payload.nodeId === placement.targetNodeId ||
    parentId === payload.nodeId ||
    isDescendant(document, payload.nodeId, parentId)
  ) {
    return false;
  }
  const current = deriveParentIndex(document).get(payload.nodeId);
  if (!current) return false;
  if (current.parentId === parentId && current.slot === slot) {
    const adjustedIndex = current.index < index ? index - 1 : index;
    if (adjustedIndex === current.index) return false;
  }
  return true;
}

function hasSrijikaDragPayload(dataTransfer: DataTransfer): boolean {
  return (
    dataTransfer.types.includes(srijikaDragTypes.component) ||
    dataTransfer.types.includes(srijikaDragTypes.structure) ||
    dataTransfer.types.includes(srijikaDragTypes.node)
  );
}

function srijikaDragPayloadFrom(dataTransfer: DataTransfer): StudioDragPayload | null {
  const componentId = dataTransfer.getData(srijikaDragTypes.component);
  if (componentId) return { kind: 'component', componentId };
  const structure = dataTransfer.getData(srijikaDragTypes.structure);
  if (structure === 'if' || structure === 'repeat') return { kind: 'structure', structure };
  const nodeId = dataTransfer.getData(srijikaDragTypes.node);
  return nodeId ? { kind: 'node', nodeId } : null;
}

interface HierarchyContextMenu {
  nodeId: string;
  anchor: ContextMenuAnchor;
}

type OpenContextMenu = (nodeId: string, event: MouseEvent<HTMLElement>) => void;

function VirtualSlot({
  ownerNodeId,
  slot,
  label,
  count,
  depth,
  childIds,
  active,
  activate,
  onOpenContextMenu,
}: {
  ownerNodeId: string;
  slot: HierarchySlot;
  label: string;
  count: number;
  depth: number;
  childIds: readonly string[];
  active: boolean;
  activate: () => void;
  onOpenContextMenu: OpenContextMenu;
}) {
  const document = useStudioStore((state) => state.document);
  const activeDrag = useStudioStore((state) => state.activeDrag);
  const activeIfBranches = useStudioStore((state) => state.activeIfBranches);
  const selectNode = useStudioStore((state) => state.selectNode);
  const dropDragPayload = useStudioStore((state) => state.dropDragPayload);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const dropIntent = useStudioStore((state) => state.dropIntent);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const endDrag = useStudioStore((state) => state.endDrag);
  const activateSlot = (): void => {
    activate();
    selectNode(ownerNodeId);
  };
  const dropPayload = (event: DragEvent<HTMLDivElement>): void => {
    const payload = srijikaDragPayloadFrom(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    if (
      !hierarchyDropIsValid(
        document,
        payload,
        { targetNodeId: ownerNodeId, intent: 'inside', slot },
        activeIfBranches,
      )
    ) {
      setDropTarget(null);
      endDrag();
      return;
    }
    activateSlot();
    dropDragPayload(payload, ownerNodeId, 'inside');
    endDrag();
  };

  return (
    <div className="tree-virtual-slot">
      <div
        className={[
          'tree-row tree-slot-row',
          active ? 'is-active-slot' : '',
          dropTargetNodeId === ownerNodeId &&
          dropIntent === 'inside' &&
          (active || slot === 'children')
            ? 'is-drop-inside'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          {
            paddingLeft: 8 + depth * 14,
            '--tree-drop-left': `${8 + depth * 14}px`,
          } as CSSProperties
        }
        role="treeitem"
        data-srijika-hierarchy-drop-target={ownerNodeId}
        data-srijika-hierarchy-slot={slot}
        data-srijika-hierarchy-can-contain="true"
        aria-level={depth + 1}
        aria-current={active ? 'true' : undefined}
        tabIndex={-1}
        onClick={activateSlot}
        onKeyDown={(event) => activateWithKeyboard(event, activateSlot)}
        onDragOver={(event) => {
          if (hasSrijikaDragPayload(event.dataTransfer)) {
            event.preventDefault();
            event.stopPropagation();
            const payload = activeDrag ?? srijikaDragPayloadFrom(event.dataTransfer);
            if (
              payload &&
              !hierarchyDropIsValid(
                document,
                payload,
                { targetNodeId: ownerNodeId, intent: 'inside', slot },
                activeIfBranches,
              )
            ) {
              event.dataTransfer.dropEffect = 'none';
              setDropTarget(null);
              return;
            }
            activate();
            event.dataTransfer.dropEffect = event.dataTransfer.types.includes(srijikaDragTypes.node)
              ? 'move'
              : 'copy';
            setDropTarget(ownerNodeId, 'inside');
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
        onDrop={dropPayload}
      >
        <span className="tree-slot-indent" />
        <CornerDownRight size={12} />
        <span className="tree-name">{label}</span>
        <span className="tree-count">{count}</span>
      </div>
      {childIds.length > 0 && (
        <div role="group">
          {childIds.map((childId) => (
            <TreeNode
              key={childId}
              nodeId={childId}
              depth={depth + 1}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeNode({
  nodeId,
  depth,
  onOpenContextMenu,
}: {
  nodeId: string;
  depth: number;
  onOpenContextMenu: OpenContextMenu;
}) {
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const activeIfBranches = useStudioStore((state) => state.activeIfBranches);
  const activeIfBranch = activeIfBranches[nodeId] ?? 'whenTrue';
  const activeDrag = useStudioStore((state) => state.activeDrag);
  const selectNode = useStudioStore((state) => state.selectNode);
  const setActiveIfBranch = useStudioStore((state) => state.setActiveIfBranch);
  const dropDragPayload = useStudioStore((state) => state.dropDragPayload);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const dropIntent = useStudioStore((state) => state.dropIntent);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const beginDrag = useStudioStore((state) => state.beginDrag);
  const endDrag = useStudioStore((state) => state.endDrag);
  const moveNode = useStudioStore((state) => state.moveNode);
  const showStatus = useStudioStore((state) => state.showStatus);
  const [expanded, setExpanded] = useState(true);
  const rowRef = useRef<HTMLDivElement>(null);
  const node = document.nodes[nodeId];
  const children = node ? ordinaryChildren(node) : [];
  const hasVirtualSlots = node?.kind === 'if' || node?.kind === 'repeat';
  const hasChildren = hasVirtualSlots || children.length > 0;
  const containsSelection = Boolean(
    node && selectedNodeId !== nodeId && isDescendant(document, nodeId, selectedNodeId),
  );
  const visiblyExpanded = expanded || containsSelection;
  const canContain = nodeCanContain(node);
  const activeDropIntent = dropTargetNodeId === nodeId ? dropIntent : null;
  const levelMoves = hierarchyLevelMoveTargets(document, nodeId);

  useEffect(() => {
    if (selectedNodeId === nodeId) rowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedNodeId, nodeId]);

  if (!node) return null;

  const select = (): void => selectNode(nodeId);
  const moveOneLevel = (direction: keyof HierarchyLevelMoveTargets): void => {
    const target = levelMoves[direction];
    if (!target) return;
    moveNode(nodeId, target.targetNodeId, target.intent);
    const targetName = document.nodes[target.targetNodeId]?.name ?? 'parent';
    showStatus(
      direction === 'outdent'
        ? `Moved ${node.name} out one level after ${targetName}`
        : `Moved ${node.name} into ${targetName}`,
    );
  };
  return (
    <div className="tree-node">
      <div
        ref={rowRef}
        className={[
          'tree-row',
          selectedNodeId === nodeId ? 'is-selected' : '',
          activeDropIntent ? `is-drop-${activeDropIntent}` : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          {
            paddingLeft: 8 + depth * 14,
            '--tree-drop-left': `${8 + depth * 14}px`,
          } as CSSProperties
        }
        role="treeitem"
        data-srijika-hierarchy-drop-target={nodeId}
        data-srijika-hierarchy-can-contain={canContain ? 'true' : 'false'}
        aria-level={depth + 1}
        aria-selected={selectedNodeId === nodeId}
        aria-expanded={hasChildren ? visiblyExpanded : undefined}
        tabIndex={selectedNodeId === nodeId ? 0 : -1}
        draggable={nodeId !== document.rootNodeId}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(nodeId, event)}
        onKeyDown={(event) => {
          if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            if (event.key === 'ArrowLeft' && levelMoves.outdent) {
              event.preventDefault();
              moveOneLevel('outdent');
              return;
            }
            if (event.key === 'ArrowRight' && levelMoves.indent) {
              event.preventDefault();
              moveOneLevel('indent');
              return;
            }
          }
          activateWithKeyboard(event, select);
        }}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(srijikaDragTypes.node, nodeId);
          event.dataTransfer.setData('text/plain', node.name);
          beginDrag({ kind: 'node', nodeId });
        }}
        onDragEnd={endDrag}
        onDragOver={(event) => {
          if (!hasSrijikaDragPayload(event.dataTransfer)) return;
          event.preventDefault();
          event.stopPropagation();
          const intent =
            nodeId === document.rootNodeId
              ? 'inside'
              : hierarchyDropIntent(event, Boolean(canContain));
          const placement = { targetNodeId: nodeId, intent };
          const payload = activeDrag ?? srijikaDragPayloadFrom(event.dataTransfer);
          if (payload && !hierarchyDropIsValid(document, payload, placement, activeIfBranches)) {
            event.dataTransfer.dropEffect = 'none';
            setDropTarget(null);
            return;
          }
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes(srijikaDragTypes.node)
            ? 'move'
            : 'copy';
          setDropTarget(nodeId, intent);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
        onDrop={(event) => {
          const payload = srijikaDragPayloadFrom(event.dataTransfer);
          const intent =
            nodeId === document.rootNodeId
              ? 'inside'
              : hierarchyDropIntent(event, Boolean(canContain));
          const placement = { targetNodeId: nodeId, intent };
          if (payload && !hierarchyDropIsValid(document, payload, placement, activeIfBranches)) {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(null);
            endDrag();
            return;
          }
          if (payload && (intent !== 'inside' || canContain)) {
            event.preventDefault();
            event.stopPropagation();
            dropDragPayload(payload, nodeId, intent);
            endDrag();
          }
        }}
      >
        <button
          className="tree-toggle"
          type="button"
          disabled={!hasChildren}
          aria-label={
            !hasChildren
              ? `${node.name} has no children`
              : visiblyExpanded
                ? `Collapse ${node.name}`
                : `Expand ${node.name}`
          }
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {hasChildren ? (
            visiblyExpanded ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : (
            <span />
          )}
        </button>
        <StructureIcon node={node} />
        <span className="tree-name">{node.name}</span>
        {nodeMeta(node) && <span className="tree-meta">{nodeMeta(node)}</span>}
        {nodeId !== document.rootNodeId && (
          <>
            <span
              className="tree-level-actions"
              role="group"
              aria-label={`Change ${node.name} nesting level`}
            >
              <button
                type="button"
                draggable={false}
                disabled={!levelMoves.outdent}
                aria-label={`Move ${node.name} out one level`}
                title="Outdent one level (Alt+Left)"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  moveOneLevel('outdent');
                }}
              >
                <ArrowLeft size={12} />
              </button>
              <button
                type="button"
                draggable={false}
                disabled={!levelMoves.indent}
                aria-label={`Move ${node.name} into previous container`}
                title="Indent into previous container (Alt+Right)"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  moveOneLevel('indent');
                }}
              >
                <ArrowRight size={12} />
              </button>
            </span>
            <GripVertical className="tree-grip" size={13} />
          </>
        )}
      </div>

      {visiblyExpanded && (
        <div role="group">
          {node.kind === 'if' ? (
            <>
              <VirtualSlot
                ownerNodeId={node.id}
                slot="whenTrue"
                label="Then"
                count={node.whenTrue.length}
                depth={depth + 1}
                childIds={node.whenTrue}
                active={activeIfBranch === 'whenTrue'}
                activate={() => setActiveIfBranch(node.id, 'whenTrue')}
                onOpenContextMenu={onOpenContextMenu}
              />
              <VirtualSlot
                ownerNodeId={node.id}
                slot="whenFalse"
                label="Else"
                count={node.whenFalse.length}
                depth={depth + 1}
                childIds={node.whenFalse}
                active={activeIfBranch === 'whenFalse'}
                activate={() => setActiveIfBranch(node.id, 'whenFalse')}
                onOpenContextMenu={onOpenContextMenu}
              />
            </>
          ) : node.kind === 'repeat' ? (
            <VirtualSlot
              ownerNodeId={node.id}
              slot="children"
              label="Template"
              count={node.children.length}
              depth={depth + 1}
              childIds={node.children}
              active={selectedNodeId === node.id}
              activate={() => undefined}
              onOpenContextMenu={onOpenContextMenu}
            />
          ) : (
            children.map((childId) => (
              <TreeNode
                key={childId}
                nodeId={childId}
                depth={depth + 1}
                onOpenContextMenu={onOpenContextMenu}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Hierarchy() {
  const document = useStudioStore((state) => state.document);
  const selectNode = useStudioStore((state) => state.selectNode);
  const activeDrag = useStudioStore((state) => state.activeDrag);
  const dragPointer = useStudioStore((state) => state.dragPointer);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const dropIntent = useStudioStore((state) => state.dropIntent);
  const dropDragPayload = useStudioStore((state) => state.dropDragPayload);
  const activeIfBranches = useStudioStore((state) => state.activeIfBranches);
  const setActiveIfBranch = useStudioStore((state) => state.setActiveIfBranch);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const endDrag = useStudioStore((state) => state.endDrag);
  const [contextMenu, setContextMenu] = useState<HierarchyContextMenu | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const draggedName = activeDrag
    ? activeDrag.kind === 'node'
      ? (document.nodes[activeDrag.nodeId]?.name ?? 'Component')
      : activeDrag.kind === 'component'
        ? (componentRegistry.get(activeDrag.componentId)?.manifest.displayName ?? 'Component')
        : activeDrag.structure === 'if'
          ? 'If / Else'
          : 'Repeat'
    : null;
  const dropTargetName = dropTargetNodeId
    ? (document.nodes[dropTargetNodeId]?.name ?? 'Page')
    : null;
  const dropGuide =
    draggedName && dropTargetName
      ? `${draggedName} → ${dropIntent === 'inside' ? 'Inside' : dropIntent === 'before' ? 'Before' : 'After'} ${dropTargetName}`
      : draggedName
        ? `${draggedName} → Choose a highlighted hierarchy position`
        : null;

  useEffect(() => {
    if (!activeDrag || !dragPointer) return;
    const tree = treeRef.current;
    const ownerDocument = tree?.ownerDocument;
    const hit = ownerDocument?.elementFromPoint?.(dragPointer.clientX, dragPointer.clientY) ?? null;
    const placement =
      hierarchyDropPlacementFromElement(hit, dragPointer.clientY, document.rootNodeId) ??
      (tree && hit && tree.contains(hit)
        ? { targetNodeId: document.rootNodeId, intent: 'inside' as const }
        : null);
    if (!placement) return;

    if (!hierarchyDropIsValid(document, activeDrag, placement, activeIfBranches)) {
      setDropTarget(null);
      if (dragPointer.phase === 'drop') endDrag();
      return;
    }

    if (
      (placement.slot === 'whenTrue' || placement.slot === 'whenFalse') &&
      activeIfBranches[placement.targetNodeId] !== placement.slot
    ) {
      setActiveIfBranch(placement.targetNodeId, placement.slot);
    }
    setDropTarget(placement.targetNodeId, placement.intent);

    if (dragPointer.phase === 'drop') {
      const payload = activeDrag;
      endDrag();
      dropDragPayload(payload, placement.targetNodeId, placement.intent);
    }
  }, [
    activeDrag,
    activeIfBranches,
    document,
    document.rootNodeId,
    dragPointer,
    dropDragPayload,
    endDrag,
    setActiveIfBranch,
    setDropTarget,
  ]);
  const openContextMenu = useCallback<OpenContextMenu>(
    (nodeId, event) => {
      event.preventDefault();
      event.stopPropagation();
      selectNode(nodeId);
      setContextMenu({ nodeId, anchor: { clientX: event.clientX, clientY: event.clientY } });
    },
    [selectNode],
  );
  return (
    <section className="hierarchy-panel">
      <header>
        <div>
          <span className="eyebrow">DOCUMENT</span>
          <h2>Hierarchy</h2>
        </div>
        <span className="status-dot" title="Document is valid" />
      </header>
      <div
        ref={treeRef}
        className="tree"
        role="tree"
        aria-label="Page content hierarchy"
        onDragOver={(event) => {
          if (!hasSrijikaDragPayload(event.dataTransfer)) return;
          event.preventDefault();
          const payload = activeDrag ?? srijikaDragPayloadFrom(event.dataTransfer);
          if (
            payload &&
            !hierarchyDropIsValid(
              document,
              payload,
              { targetNodeId: document.rootNodeId, intent: 'inside' },
              activeIfBranches,
            )
          ) {
            event.dataTransfer.dropEffect = 'none';
            setDropTarget(null);
            return;
          }
          event.dataTransfer.dropEffect = event.dataTransfer.types.includes(srijikaDragTypes.node)
            ? 'move'
            : 'copy';
          setDropTarget(document.rootNodeId, 'inside');
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
        onDrop={(event) => {
          const payload = srijikaDragPayloadFrom(event.dataTransfer);
          if (!payload) return;
          event.preventDefault();
          if (
            !hierarchyDropIsValid(
              document,
              payload,
              { targetNodeId: document.rootNodeId, intent: 'inside' },
              activeIfBranches,
            )
          ) {
            setDropTarget(null);
            endDrag();
            return;
          }
          dropDragPayload(payload, document.rootNodeId, 'inside');
          endDrag();
        }}
      >
        <TreeNode nodeId={document.rootNodeId} depth={0} onOpenContextMenu={openContextMenu} />
      </div>
      {dropGuide && (
        <div
          className="hierarchy-drop-guide"
          data-drop-intent={dropTargetName ? dropIntent : 'pending'}
          role="status"
          aria-live="polite"
        >
          <strong>{dropGuide}</strong>
          <span>Center nests · top/bottom places before or after</span>
        </div>
      )}
      {contextMenu && (
        <PromotePropMenu
          nodeId={contextMenu.nodeId}
          anchor={contextMenu.anchor}
          onClose={() => setContextMenu(null)}
        />
      )}
    </section>
  );
}
