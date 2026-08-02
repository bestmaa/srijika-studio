import {
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
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import type { ElementNode, UiNode, ValueExpression } from '@sutra/contracts';
import { isDescendant } from '@sutra/document-engine';

import { componentRegistry } from '../lib/registry';
import { type NodeDropIntent, useStudioStore } from '../store/studio-store';
import { sutraDragTypes } from './Palette';
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
  if (node.componentId === 'sutra.page') return 'main';
  if (node.componentId === 'sutra.heading') {
    return `h${Math.max(1, Math.min(6, literalNumber(node.props['level'], 2)))}`;
  }
  if (node.componentId === 'sutra.text') return 'p';
  if (node.componentId === 'sutra.button') return 'button';
  if (node.componentId === 'sutra.input') return 'label';
  if (
    node.componentId === 'sutra.container' ||
    node.componentId === 'sutra.stack' ||
    node.componentId === 'sutra.grid'
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

function activateWithKeyboard(event: KeyboardEvent<HTMLElement>, activate: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  activate();
}

function hierarchyDropIntent(event: DragEvent<HTMLElement>, canContain: boolean): NodeDropIntent {
  const bounds = event.currentTarget.getBoundingClientRect();
  if (bounds.height <= 0) return canContain ? 'inside' : 'after';
  const ratio = (event.clientY - bounds.top) / bounds.height;
  if (ratio <= 0.25) return 'before';
  if (ratio >= 0.75) return 'after';
  return canContain ? 'inside' : ratio < 0.5 ? 'before' : 'after';
}

interface HierarchyContextMenu {
  nodeId: string;
  anchor: ContextMenuAnchor;
}

type OpenContextMenu = (nodeId: string, event: MouseEvent<HTMLElement>) => void;

function VirtualSlot({
  ownerNodeId,
  label,
  count,
  depth,
  childIds,
  active,
  activate,
  onOpenContextMenu,
}: {
  ownerNodeId: string;
  label: string;
  count: number;
  depth: number;
  childIds: readonly string[];
  active: boolean;
  activate: () => void;
  onOpenContextMenu: OpenContextMenu;
}) {
  const selectNode = useStudioStore((state) => state.selectNode);
  const moveNode = useStudioStore((state) => state.moveNode);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const dropIntent = useStudioStore((state) => state.dropIntent);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const endDrag = useStudioStore((state) => state.endDrag);
  const activateSlot = (): void => {
    activate();
    selectNode(ownerNodeId);
  };
  const dropNode = (event: DragEvent<HTMLDivElement>): void => {
    const draggedNodeId = event.dataTransfer.getData(sutraDragTypes.node);
    if (!draggedNodeId) return;
    event.preventDefault();
    event.stopPropagation();
    activateSlot();
    moveNode(draggedNodeId, ownerNodeId);
    endDrag();
  };

  return (
    <div className="tree-virtual-slot">
      <div
        className={[
          'tree-row tree-slot-row',
          active ? 'is-active-slot' : '',
          dropTargetNodeId === ownerNodeId && dropIntent === 'inside' ? 'is-drop-inside' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-level={depth + 1}
        aria-current={active ? 'true' : undefined}
        tabIndex={-1}
        onClick={activateSlot}
        onKeyDown={(event) => activateWithKeyboard(event, activateSlot)}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(sutraDragTypes.node)) {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(ownerNodeId, 'inside');
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
        onDrop={dropNode}
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
  const activeIfBranch = useStudioStore((state) => state.activeIfBranches[nodeId] ?? 'whenTrue');
  const selectNode = useStudioStore((state) => state.selectNode);
  const setActiveIfBranch = useStudioStore((state) => state.setActiveIfBranch);
  const moveNode = useStudioStore((state) => state.moveNode);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const dropIntent = useStudioStore((state) => state.dropIntent);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const beginDrag = useStudioStore((state) => state.beginDrag);
  const endDrag = useStudioStore((state) => state.endDrag);
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
  const canContain =
    node &&
    ((node.kind === 'element' && Boolean(node.slots['children'])) ||
      node.kind === 'if' ||
      node.kind === 'repeat' ||
      node.kind === 'fragment' ||
      node.kind === 'slot');
  const activeDropIntent = dropTargetNodeId === nodeId ? dropIntent : null;

  useEffect(() => {
    if (selectedNodeId === nodeId) rowRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedNodeId, nodeId]);

  if (!node) return null;

  const select = (): void => selectNode(nodeId);
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
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selectedNodeId === nodeId}
        aria-expanded={hasChildren ? visiblyExpanded : undefined}
        tabIndex={selectedNodeId === nodeId ? 0 : -1}
        draggable={nodeId !== document.rootNodeId}
        onClick={select}
        onContextMenu={(event) => onOpenContextMenu(nodeId, event)}
        onKeyDown={(event) => activateWithKeyboard(event, select)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(sutraDragTypes.node, nodeId);
          event.dataTransfer.setData('text/plain', node.name);
          beginDrag({ kind: 'node', nodeId });
        }}
        onDragEnd={endDrag}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(sutraDragTypes.node)) return;
          event.preventDefault();
          event.stopPropagation();
          const intent =
            nodeId === document.rootNodeId
              ? 'inside'
              : hierarchyDropIntent(event, Boolean(canContain));
          event.dataTransfer.dropEffect = 'move';
          setDropTarget(nodeId, intent);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropTarget(null);
        }}
        onDrop={(event) => {
          const draggedNodeId = event.dataTransfer.getData(sutraDragTypes.node);
          const intent =
            nodeId === document.rootNodeId
              ? 'inside'
              : hierarchyDropIntent(event, Boolean(canContain));
          if (draggedNodeId && (intent !== 'inside' || canContain)) {
            event.preventDefault();
            event.stopPropagation();
            moveNode(draggedNodeId, nodeId, intent);
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
        {nodeId !== document.rootNodeId && <GripVertical className="tree-grip" size={13} />}
      </div>

      {visiblyExpanded && (
        <div role="group">
          {node.kind === 'if' ? (
            <>
              <VirtualSlot
                ownerNodeId={node.id}
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
  const [contextMenu, setContextMenu] = useState<HierarchyContextMenu | null>(null);
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
      <div className="tree" role="tree" aria-label="Page content hierarchy">
        <TreeNode nodeId={document.rootNodeId} depth={0} onOpenContextMenu={openContextMenu} />
      </div>
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
