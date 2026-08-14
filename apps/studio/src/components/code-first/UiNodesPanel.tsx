import { ChevronDown, ChevronRight, GripVertical, Minus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

import type { UiDocument } from '@srijika/contracts';
import type { SrijikaSourceMap, SrijikaSourceSpan } from '@srijika/tsx-compiler';

import {
  buildUiNodePresentations,
  uiNodeChildren,
  type UiNodePresentation,
} from './ui-node-presentation';

export interface UiNodesPanelProps {
  document: UiDocument | null;
  sourceMap: SrijikaSourceMap | null;
  fileName?: string | undefined;
  selectedNodeId: string;
  componentSelected?: boolean | undefined;
  onSelectComponent?: (() => void) | undefined;
  onSelect: (nodeId: string) => void;
  onRevealSource?: ((nodeId: string, span: SrijikaSourceSpan) => void) | undefined;
  onOpenSource: (nodeId: string, span: SrijikaSourceSpan) => void;
  onDropComponent?: ((nodeId: string, componentId: string) => void) | undefined;
  dragHandleProps?:
    | {
        draggable: true;
        onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
        onDragEnd: () => void;
      }
    | undefined;
}

interface UiNodeRowProps extends UiNodesPanelProps {
  nodeId: string;
  depth: number;
  presentations: Readonly<Record<string, UiNodePresentation>>;
  selectionAncestors: ReadonlySet<string>;
}

function UiNodeRow({
  document,
  sourceMap,
  selectedNodeId,
  onSelect,
  onRevealSource,
  onOpenSource,
  onDropComponent,
  nodeId,
  depth,
  presentations,
  selectionAncestors,
}: UiNodeRowProps) {
  const [manuallyCollapsed, setManuallyCollapsed] = useState(depth >= 2);
  const rowRef = useRef<HTMLDivElement>(null);
  const node = document?.nodes[nodeId];
  const children = node ? uiNodeChildren(node) : [];
  const span = node ? sourceMap?.nodes[node.id] : undefined;
  const presentation = node
    ? (presentations[node.id] ?? { label: node.name, detail: node.kind })
    : { label: 'Unknown node', detail: 'Unavailable' };
  const selected = selectedNodeId === nodeId;
  const collapsed = manuallyCollapsed && !selected && !selectionAncestors.has(nodeId);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      rowRef.current?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  if (!node) return null;

  return (
    <li
      role="treeitem"
      aria-selected={selected}
      aria-expanded={children.length > 0 ? !collapsed : undefined}
    >
      <div
        ref={rowRef}
        className={`code-first-ui-node-row${selected ? ' is-selected' : ''}`}
        style={{ paddingInlineStart: 5 + depth * 14 }}
        onDragOver={(event) => {
          if (!onDropComponent) return;
          if (!event.dataTransfer.types.includes('application/x-srijika-component')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          const componentId = event.dataTransfer.getData('application/x-srijika-component');
          if (!componentId || !onDropComponent) return;
          event.preventDefault();
          event.stopPropagation();
          onDropComponent(nodeId, componentId);
        }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="code-first-ui-node-disclosure"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${presentation.label}`}
            onClick={() => setManuallyCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : (
          <span className="code-first-ui-node-disclosure" aria-hidden="true">
            <Minus size={10} />
          </span>
        )}
        <button
          type="button"
          className="code-first-ui-node"
          aria-label={`${presentation.label}, ${presentation.detail}`}
          title={
            span
              ? `Select to reveal ${span.line}:${span.column}; double-click to open in VS Code`
              : presentation.label
          }
          data-node-id={node.id}
          onClick={() => {
            onSelect(nodeId);
            if (span) onRevealSource?.(node.id, span);
          }}
          onDoubleClick={() => {
            if (span) onOpenSource(node.id, span);
          }}
        >
          <span>{presentation.label}</span>
          <span className="code-first-node-kind">{presentation.detail}</span>
        </button>
      </div>
      {children.length > 0 && !collapsed && (
        <ul role="group">
          {children.map((childId) => (
            <UiNodeRow
              key={childId}
              document={document}
              sourceMap={sourceMap}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onRevealSource={onRevealSource}
              onOpenSource={onOpenSource}
              onDropComponent={onDropComponent}
              nodeId={childId}
              depth={depth + 1}
              presentations={presentations}
              selectionAncestors={selectionAncestors}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function UiNodesPanel({
  document,
  sourceMap,
  fileName,
  selectedNodeId,
  componentSelected = false,
  onSelectComponent,
  onSelect,
  onRevealSource,
  onOpenSource,
  onDropComponent,
  dragHandleProps,
}: UiNodesPanelProps) {
  const presentations = useMemo(
    () => (document ? buildUiNodePresentations(document) : {}),
    [document],
  );
  const selectionAncestors = useMemo(() => {
    const result = new Set<string>();
    if (!document || !document.nodes[selectedNodeId]) return result;

    const visit = (
      nodeId: string,
      path: readonly string[],
      visited: ReadonlySet<string>,
    ): boolean => {
      if (nodeId === selectedNodeId) {
        for (const ancestor of path) result.add(ancestor);
        return true;
      }
      if (visited.has(nodeId)) return false;
      const node = document.nodes[nodeId];
      if (!node) return false;
      const nextVisited = new Set(visited).add(nodeId);
      return uiNodeChildren(node).some((childId) => visit(childId, [...path, nodeId], nextVisited));
    };

    visit(document.rootNodeId, [], new Set());
    return result;
  }, [document, selectedNodeId]);
  const [componentCollapsed, setComponentCollapsed] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const componentRowRef = useRef<HTMLDivElement>(null);
  const componentTreeCollapsed = componentCollapsed && componentSelected;

  useEffect(() => {
    if (!componentSelected) return;
    componentRowRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [componentSelected]);

  const componentSpan = sourceMap?.component;
  const sourceDetail = fileName?.split(/[\\/]/).at(-1) ?? 'UI function';
  return (
    <section
      className={`code-first-navigator-section code-first-ui-nodes${panelCollapsed ? ' is-collapsed' : ''}`}
      aria-label="UI Nodes"
    >
      <div className="code-first-navigator-header">
        <button
          type="button"
          className="code-first-workspace-disclosure"
          aria-label={`${panelCollapsed ? 'Expand' : 'Collapse'} UI Nodes panel`}
          aria-expanded={!panelCollapsed}
          onClick={() => setPanelCollapsed((current) => !current)}
        >
          {panelCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <h2>UI Nodes</h2>
        <span className="code-first-toolbar-spacer" />
        <span className="code-first-badge">
          {document ? Object.keys(document.nodes).length + 1 : 0}
        </span>
        {dragHandleProps && (
          <button
            type="button"
            className="code-first-panel-drag-handle"
            aria-label="Drag UI Nodes panel to reorder"
            title="Drag panel to reorder"
            {...dragHandleProps}
          >
            <GripVertical size={13} />
          </button>
        )}
      </div>
      {!panelCollapsed && document ? (
        <div className="code-first-tree-scroll">
          <ul className="code-first-ui-tree" role="tree" aria-label={`${document.name} UI nodes`}>
            <li
              role="treeitem"
              aria-selected={componentSelected}
              aria-expanded={!componentTreeCollapsed}
            >
              <div
                ref={componentRowRef}
                className={`code-first-ui-node-row code-first-ui-function-row${componentSelected ? ' is-selected' : ''}`}
                style={{ paddingInlineStart: 5 }}
              >
                <button
                  type="button"
                  className="code-first-ui-node-disclosure"
                  aria-label={`${componentTreeCollapsed ? 'Expand' : 'Collapse'} ${document.name}`}
                  onClick={() => setComponentCollapsed(!componentTreeCollapsed)}
                >
                  {componentTreeCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button
                  type="button"
                  className="code-first-ui-node"
                  aria-label={`${document.name}, ${sourceDetail}`}
                  title="Select the complete UI function and its props contract"
                  data-ui-function={document.name}
                  onClick={() => {
                    onSelectComponent?.();
                    if (componentSpan) onRevealSource?.('__srijika_component__', componentSpan);
                  }}
                  onDoubleClick={() => {
                    if (componentSpan) onOpenSource('__srijika_component__', componentSpan);
                  }}
                >
                  <span>{document.name}</span>
                  <span className="code-first-node-kind">{sourceDetail}</span>
                </button>
              </div>
              {!componentTreeCollapsed && (
                <ul role="group">
                  <UiNodeRow
                    key={`${document.id}:${sourceMap?.fileName ?? fileName ?? ''}`}
                    document={document}
                    sourceMap={sourceMap}
                    fileName={fileName}
                    selectedNodeId={selectedNodeId}
                    onSelect={onSelect}
                    onRevealSource={onRevealSource}
                    onOpenSource={onOpenSource}
                    onDropComponent={onDropComponent}
                    nodeId={document.rootNodeId}
                    depth={1}
                    presentations={presentations}
                    selectionAncestors={selectionAncestors}
                  />
                </ul>
              )}
            </li>
          </ul>
        </div>
      ) : !panelCollapsed ? (
        <p className="code-first-navigator-empty">
          Open a valid .ui.tsx file to inspect its nodes.
        </p>
      ) : null}
    </section>
  );
}
