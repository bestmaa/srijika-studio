import {
  Braces,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GripVertical,
  Layers,
  Repeat2,
} from 'lucide-react';
import { useState } from 'react';

import type { UiNode } from '@sutra/contracts';
import { childLists } from '@sutra/document-engine';

import { useStudioStore } from '../store/studio-store';
import { sutraDragTypes } from './Palette';

function StructureIcon({ node }: { node: UiNode }) {
  if (node.kind === 'if') return <GitBranch size={13} />;
  if (node.kind === 'repeat') return <Repeat2 size={13} />;
  if (node.kind === 'fragment' || node.kind === 'slot') return <Braces size={13} />;
  return <Layers size={13} />;
}

function TreeNode({ nodeId, depth }: { nodeId: string; depth: number }) {
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const selectNode = useStudioStore((state) => state.selectNode);
  const moveNode = useStudioStore((state) => state.moveNode);
  const [expanded, setExpanded] = useState(true);
  const node = document.nodes[nodeId];
  if (!node) return null;
  const children = childLists(node).flatMap(([, ids]) => ids);
  const canContain =
    (node.kind === 'element' && Boolean(node.slots['children'])) ||
    node.kind === 'if' ||
    node.kind === 'repeat' ||
    node.kind === 'fragment' ||
    node.kind === 'slot';

  return (
    <div className="tree-node">
      <div
        className={selectedNodeId === nodeId ? 'tree-row is-selected' : 'tree-row'}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-selected={selectedNodeId === nodeId}
        aria-expanded={children.length > 0 ? expanded : undefined}
        draggable={nodeId !== document.rootNodeId}
        onClick={() => selectNode(nodeId)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData(sutraDragTypes.node, nodeId);
        }}
        onDragOver={(event) => {
          if (canContain && event.dataTransfer.types.includes(sutraDragTypes.node)) {
            event.preventDefault();
          }
        }}
        onDrop={(event) => {
          const draggedNodeId = event.dataTransfer.getData(sutraDragTypes.node);
          if (canContain && draggedNodeId) {
            event.preventDefault();
            event.stopPropagation();
            moveNode(draggedNodeId, nodeId);
          }
        }}
      >
        <button
          className="tree-toggle"
          type="button"
          disabled={children.length === 0}
          aria-label={
            children.length === 0
              ? `${node.name} has no children`
              : expanded
                ? `Collapse ${node.name}`
                : `Expand ${node.name}`
          }
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((value) => !value);
          }}
        >
          {children.length > 0 ? (
            expanded ? (
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
        {nodeId !== document.rootNodeId && <GripVertical className="tree-grip" size={13} />}
      </div>
      {expanded &&
        children.map((childId) => <TreeNode key={childId} nodeId={childId} depth={depth + 1} />)}
    </div>
  );
}

export function Hierarchy() {
  const rootNodeId = useStudioStore((state) => state.document.rootNodeId);
  return (
    <section className="hierarchy-panel">
      <header>
        <div>
          <span className="eyebrow">DOCUMENT</span>
          <h2>Hierarchy</h2>
        </div>
        <span className="status-dot" title="Document is valid" />
      </header>
      <div className="tree" role="tree" aria-label="UI hierarchy">
        <TreeNode nodeId={rootNodeId} depth={0} />
      </div>
    </section>
  );
}
