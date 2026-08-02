import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Columns3,
  GripVertical,
  Italic,
  PanelRightOpen,
  Rows3,
  SlidersHorizontal,
  Trash2,
  Underline,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ElementNode, UiDocument, UiNode } from '@sutra/contracts';
import { childLists, deriveParentIndex } from '@sutra/document-engine';

import { componentRegistry } from '../lib/registry';
import { useStudioStore } from '../store/studio-store';

interface CanvasSelectionToolbarProps {
  surfaceRoot: HTMLElement;
  nodeId: string;
  preferredAnchor?: HTMLElement | null;
}

interface ToolbarPosition {
  left: number;
  top: number;
  menuAlign: 'left' | 'right';
  menuPlacement: 'above' | 'below';
}

interface QuickContentDefinition {
  propName: string;
  label: string;
}

const toolbarInset = 8;
const estimatedToolbarWidth = 316;
const estimatedToolbarHeight = 36;
const estimatedMenuWidth = 288;
const estimatedMenuHeight = 300;

const quickContentByComponent: Readonly<Record<string, QuickContentDefinition>> = {
  'sutra.text': { propName: 'text', label: 'Text' },
  'sutra.heading': { propName: 'text', label: 'Heading text' },
  'sutra.button': { propName: 'label', label: 'Button label' },
  'sutra.input': { propName: 'label', label: 'Input label' },
  'sutra.badge': { propName: 'label', label: 'Badge label' },
  'sutra.image': { propName: 'alt', label: 'Alternative text' },
  'sutra.avatar': { propName: 'alt', label: 'Alternative text' },
  'sutra.icon': { propName: 'label', label: 'Accessible label' },
};

const typographyComponents = new Set([
  'sutra.text',
  'sutra.heading',
  'sutra.button',
  'sutra.input',
  'sutra.badge',
]);

const flexLayoutComponents = new Set(['sutra.page', 'sutra.container', 'sutra.stack']);

function exactNodeElements(surfaceRoot: HTMLElement, nodeId: string): HTMLElement[] {
  return [...surfaceRoot.querySelectorAll<HTMLElement>('[data-sutra-node]')].filter(
    (element) => element.getAttribute('data-sutra-node') === nodeId,
  );
}

function rectHasArea(rect: DOMRect): boolean {
  return rect.width > 0.5 && rect.height > 0.5;
}

function unionRects(rects: readonly DOMRect[]): DOMRect | null {
  const visible = rects.filter(rectHasArea);
  if (visible.length === 0) return null;
  const left = Math.min(...visible.map((rect) => rect.left));
  const top = Math.min(...visible.map((rect) => rect.top));
  const right = Math.max(...visible.map((rect) => rect.right));
  const bottom = Math.max(...visible.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export function selectedNodeBounds(
  surfaceRoot: HTMLElement,
  nodeId: string,
  preferredAnchor?: HTMLElement | null,
): DOMRect | null {
  const preferredIsCurrent =
    preferredAnchor?.isConnected && preferredAnchor.getAttribute('data-sutra-node') === nodeId;
  const candidates = exactNodeElements(surfaceRoot, nodeId);
  const ordered = preferredIsCurrent
    ? [preferredAnchor, ...candidates.filter((element) => element !== preferredAnchor)]
    : candidates;

  for (const element of ordered) {
    const rect = element.getBoundingClientRect();
    if (rectHasArea(rect)) return rect;
  }

  // Structural nodes use display: contents. Their own box is empty, so anchor
  // the toolbar to the visible branch/template rendered below that wrapper.
  for (const element of ordered) {
    const descendantRects = [
      ...element.querySelectorAll<HTMLElement>('[data-sutra-node], .sutra-empty-structure'),
    ].map((descendant) => descendant.getBoundingClientRect());
    const union = unionRects(descendantRects);
    if (union) return union;
  }
  return null;
}

export type CanvasMoveDirection = 'up' | 'right' | 'down' | 'left';

export interface CanvasDirectionalMoveTarget {
  targetNodeId: string;
  intent: 'before' | 'after';
}

export type CanvasDirectionalMoveTargets = Record<
  CanvasMoveDirection,
  CanvasDirectionalMoveTarget | null
>;

interface DirectionalCandidate {
  targetNodeId: string;
  targetIndex: number;
  occurrence: number;
  overlapsCrossAxis: boolean;
  primaryGap: number;
  crossDistance: number;
  distance: number;
}

const moveDirections = ['up', 'right', 'down', 'left'] as const;
const directionEpsilon = 0.5;

function emptyDirectionalTargets(): CanvasDirectionalMoveTargets {
  return { up: null, right: null, down: null, left: null };
}

function visibleNodeBounds(surfaceRoot: HTMLElement, nodeId: string): DOMRect[] {
  const bounds: DOMRect[] = [];
  exactNodeElements(surfaceRoot, nodeId).forEach((element) => {
    const ownBounds = element.getBoundingClientRect();
    if (rectHasArea(ownBounds)) {
      bounds.push(ownBounds);
      return;
    }
    const descendantBounds = [
      ...element.querySelectorAll<HTMLElement>('[data-sutra-node], .sutra-empty-structure'),
    ].map((descendant) => descendant.getBoundingClientRect());
    const union = unionRects(descendantBounds);
    if (union) bounds.push(union);
  });
  return bounds;
}

function candidateMetrics(
  source: DOMRect,
  candidate: DOMRect,
  direction: CanvasMoveDirection,
): Omit<DirectionalCandidate, 'targetNodeId' | 'targetIndex' | 'occurrence'> | null {
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const candidateCenterX = candidate.left + candidate.width / 2;
  const candidateCenterY = candidate.top + candidate.height / 2;
  const deltaX = candidateCenterX - sourceCenterX;
  const deltaY = candidateCenterY - sourceCenterY;
  const isHorizontal = direction === 'left' || direction === 'right';
  const directionalDistance =
    direction === 'left'
      ? -deltaX
      : direction === 'right'
        ? deltaX
        : direction === 'up'
          ? -deltaY
          : deltaY;
  if (directionalDistance <= directionEpsilon) return null;

  const overlapsCrossAxis = isHorizontal
    ? Math.min(source.bottom, candidate.bottom) - Math.max(source.top, candidate.top) >
      directionEpsilon
    : Math.min(source.right, candidate.right) - Math.max(source.left, candidate.left) >
      directionEpsilon;
  const primaryGap = isHorizontal
    ? direction === 'left'
      ? Math.max(0, source.left - candidate.right)
      : Math.max(0, candidate.left - source.right)
    : direction === 'up'
      ? Math.max(0, source.top - candidate.bottom)
      : Math.max(0, candidate.top - source.bottom);
  const crossDistance = isHorizontal ? Math.abs(deltaY) : Math.abs(deltaX);

  return {
    overlapsCrossAxis,
    primaryGap,
    crossDistance,
    distance: Math.hypot(deltaX, deltaY),
  };
}

function compareDirectionalCandidates(a: DirectionalCandidate, b: DirectionalCandidate): number {
  return (
    Number(!a.overlapsCrossAxis) - Number(!b.overlapsCrossAxis) ||
    a.primaryGap - b.primaryGap ||
    a.crossDistance - b.crossDistance ||
    a.distance - b.distance ||
    a.targetIndex - b.targetIndex ||
    a.occurrence - b.occurrence
  );
}

/** Resolve a selected node's nearest visible sibling in each canvas direction. */
export function directionalMoveTargets(
  surfaceRoot: HTMLElement,
  uiDocument: UiDocument,
  nodeId: string,
  preferredAnchor?: HTMLElement | null,
): CanvasDirectionalMoveTargets {
  const targets = emptyDirectionalTargets();
  if (nodeId === uiDocument.rootNodeId) return targets;

  const location = deriveParentIndex(uiDocument).get(nodeId);
  if (!location) return targets;
  const parent = uiDocument.nodes[location.parentId];
  if (!parent) return targets;
  const siblings = childLists(parent).find(([slot]) => slot === location.slot)?.[1];
  if (!siblings || siblings.length < 2) return targets;

  const sourceBounds = selectedNodeBounds(surfaceRoot, nodeId, preferredAnchor);
  if (!sourceBounds) return targets;

  const candidatesByDirection = new Map<CanvasMoveDirection, DirectionalCandidate[]>();
  moveDirections.forEach((direction) => candidatesByDirection.set(direction, []));

  siblings.forEach((siblingId, targetIndex) => {
    if (siblingId === nodeId) return;
    visibleNodeBounds(surfaceRoot, siblingId).forEach((candidateBounds, occurrence) => {
      moveDirections.forEach((direction) => {
        const metrics = candidateMetrics(sourceBounds, candidateBounds, direction);
        if (!metrics) return;
        candidatesByDirection.get(direction)?.push({
          targetNodeId: siblingId,
          targetIndex,
          occurrence,
          ...metrics,
        });
      });
    });
  });

  moveDirections.forEach((direction) => {
    const candidate = candidatesByDirection.get(direction)?.sort(compareDirectionalCandidates)[0];
    if (!candidate) return;
    targets[direction] = {
      targetNodeId: candidate.targetNodeId,
      intent: candidate.targetIndex < location.index ? 'before' : 'after',
    };
  });
  return targets;
}

function toolbarPosition(
  surfaceRoot: HTMLElement,
  nodeId: string,
  preferredAnchor: HTMLElement | null,
  toolbarWidth: number,
  toolbarHeight: number,
): ToolbarPosition | null {
  const bounds = selectedNodeBounds(surfaceRoot, nodeId, preferredAnchor);
  if (!bounds) return null;
  const ownerDocument = surfaceRoot.ownerDocument;
  const viewportWidth =
    ownerDocument.documentElement.clientWidth ||
    ownerDocument.defaultView?.innerWidth ||
    bounds.right;
  const viewportHeight =
    ownerDocument.documentElement.clientHeight ||
    ownerDocument.defaultView?.innerHeight ||
    bounds.bottom;
  const aboveTop = bounds.top - toolbarHeight - toolbarInset;
  const belowTop = bounds.bottom + toolbarInset;
  const maximumTop = Math.max(toolbarInset, viewportHeight - toolbarHeight - toolbarInset);
  const top =
    aboveTop >= toolbarInset
      ? aboveTop
      : belowTop <= maximumTop
        ? belowTop
        : Math.min(Math.max(bounds.top + toolbarInset, toolbarInset), maximumTop);
  const left = Math.max(
    toolbarInset,
    Math.min(bounds.left, viewportWidth - toolbarWidth - toolbarInset),
  );
  const menuAlign = left + estimatedMenuWidth <= viewportWidth - toolbarInset ? 'left' : 'right';
  const menuPlacement =
    top + toolbarHeight + toolbarInset + estimatedMenuHeight <= viewportHeight ? 'below' : 'above';
  return { left, top, menuAlign, menuPlacement };
}

function displayName(node: UiNode): string {
  if (node.kind !== 'element') {
    if (node.kind === 'if') return 'If / Else';
    if (node.kind === 'repeat') return 'Repeat';
    return node.name;
  }
  return componentRegistry.get(node.componentId)?.manifest.displayName ?? node.name;
}

function literalString(node: ElementNode, propName: string): string | null {
  const value = node.props[propName];
  return value?.kind === 'literal' && typeof value.value === 'string' ? value.value : null;
}

function ToolbarIconButton({
  label,
  active = false,
  disabled = false,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="sutra-selection-option-button"
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function CanvasSelectionToolbar({
  surfaceRoot,
  nodeId,
  preferredAnchor = null,
}: CanvasSelectionToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<ToolbarPosition | null>(() =>
    toolbarPosition(
      surfaceRoot,
      nodeId,
      preferredAnchor,
      estimatedToolbarWidth,
      estimatedToolbarHeight,
    ),
  );
  const [optionsNodeId, setOptionsNodeId] = useState<string | null>(null);
  const document = useStudioStore((state) => state.document);
  const activeDrag = useStudioStore((state) => state.activeDrag);
  const dispatch = useStudioStore((state) => state.dispatch);
  const setStyle = useStudioStore((state) => state.setStyle);
  const setLiteralProp = useStudioStore((state) => state.setLiteralProp);
  const setInspectorTab = useStudioStore((state) => state.setInspectorTab);
  const showStatus = useStudioStore((state) => state.showStatus);
  const moveNode = useStudioStore((state) => state.moveNode);
  const removeSelectedNode = useStudioStore((state) => state.removeSelectedNode);
  const node = document.nodes[nodeId];
  const isRoot = nodeId === document.rootNodeId;
  const optionsOpen = optionsNodeId === nodeId && !activeDrag;
  const ownerDocument = surfaceRoot.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;

  const updatePosition = useCallback(() => {
    const toolbarWidth = toolbarRef.current?.offsetWidth || estimatedToolbarWidth;
    const toolbarHeight = toolbarRef.current?.offsetHeight || estimatedToolbarHeight;
    setPosition(toolbarPosition(surfaceRoot, nodeId, preferredAnchor, toolbarWidth, toolbarHeight));
  }, [nodeId, preferredAnchor, surfaceRoot]);

  useLayoutEffect(() => {
    const frame = ownerWindow?.requestAnimationFrame(updatePosition);
    return () => {
      if (frame !== undefined) ownerWindow?.cancelAnimationFrame(frame);
    };
  }, [document.revision, optionsOpen, ownerWindow, updatePosition]);

  useEffect(() => {
    const handleViewportChange = (): void => updatePosition();
    ownerWindow?.addEventListener('resize', handleViewportChange);
    ownerDocument.addEventListener('scroll', handleViewportChange, true);

    const ResizeObserverConstructor = ownerWindow?.ResizeObserver;
    const observer = ResizeObserverConstructor
      ? new ResizeObserverConstructor(handleViewportChange)
      : null;
    exactNodeElements(surfaceRoot, nodeId).forEach((element) => observer?.observe(element));

    return () => {
      ownerWindow?.removeEventListener('resize', handleViewportChange);
      ownerDocument.removeEventListener('scroll', handleViewportChange, true);
      observer?.disconnect();
    };
  }, [nodeId, ownerDocument, ownerWindow, surfaceRoot, updatePosition]);

  useEffect(() => {
    if (!optionsOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!toolbarRef.current?.contains(event.target as Node | null)) setOptionsNodeId(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOptionsNodeId(null);
      optionsButtonRef.current?.focus();
    };
    ownerDocument.addEventListener('pointerdown', closeOutside, true);
    ownerDocument.addEventListener('keydown', closeOnEscape, true);
    return () => {
      ownerDocument.removeEventListener('pointerdown', closeOutside, true);
      ownerDocument.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [optionsOpen, ownerDocument]);

  const quickContent = useMemo(
    () => (node?.kind === 'element' ? quickContentByComponent[node.componentId] : undefined),
    [node],
  );
  const supportsTypography = node?.kind === 'element' && typographyComponents.has(node.componentId);
  const supportsFlexLayout = node?.kind === 'element' && flexLayoutComponents.has(node.componentId);
  const quickText =
    node?.kind === 'element' && quickContent ? literalString(node, quickContent.propName) : null;
  const style = node?.kind === 'element' ? node.style.base : null;

  if (!node || !position) return null;

  const directionalTargets = directionalMoveTargets(surfaceRoot, document, nodeId, preferredAnchor);

  const moveInDirection = (direction: CanvasMoveDirection): void => {
    const target = directionalTargets[direction];
    if (!target) return;
    setOptionsNodeId(null);
    moveNode(node.id, target.targetNodeId, target.intent);
    showStatus(`Moved ${node.name} ${direction}`);
    ownerWindow?.requestAnimationFrame(() => {
      const anchor =
        preferredAnchor?.isConnected &&
        preferredAnchor.getAttribute('data-sutra-node') === node.id
          ? preferredAnchor
          : exactNodeElements(surfaceRoot, node.id)[0];
      anchor?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
  };

  const commitName = (value: string): void => {
    const nextName = value.trim();
    if (!nextName) return;
    if (nextName !== node.name) dispatch({ kind: 'renameNode', nodeId: node.id, name: nextName });
  };

  return (
    <div
      ref={toolbarRef}
      className={`sutra-selection-toolbar${activeDrag ? ' is-dragging' : ''}`}
      data-menu-align={position.menuAlign}
      data-menu-placement={position.menuPlacement}
      data-sutra-editor-ui="true"
      data-testid="canvas-selection-toolbar"
      style={{ left: position.left, top: position.top }}
      role="toolbar"
      aria-label={`${displayName(node)} actions`}
      aria-hidden={activeDrag ? true : undefined}
      onPointerDownCapture={(event) => {
        const target = event.target as Element;
        const button = target.closest('button');
        if (button && !button.matches('[data-sutra-move-handle="true"]')) {
          // Keep compact iframe toolbars from scrolling the outer design
          // viewport merely because a mouse click focuses a button.
          event.preventDefault();
        }
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="sutra-selection-toolbar-name" title={node.name}>
        {node.name}
      </span>
      <button
        className="sutra-selection-toolbar-button sutra-selection-move-handle"
        type="button"
        aria-label={`Move ${node.name}`}
        title={isRoot ? 'The Page root cannot be moved' : 'Drag to move or reorder'}
        disabled={isRoot}
        data-sutra-move-handle={isRoot ? undefined : 'true'}
        data-sutra-toolbar-node={node.id}
        onClick={() => {
          if (!isRoot)
            showStatus(`Drag the Move handle to place ${node.name} anywhere in the page`);
        }}
      >
        <GripVertical size={15} />
      </button>
      <div
        className="sutra-selection-direction-group"
        role="group"
        aria-label={`Move ${node.name} by direction`}
      >
        {moveDirections.map((direction) => {
          const target = directionalTargets[direction];
          const label = `Move ${node.name} ${direction}`;
          const icon =
            direction === 'up' ? (
              <ArrowUp size={13} aria-hidden="true" />
            ) : direction === 'right' ? (
              <ArrowRight size={13} aria-hidden="true" />
            ) : direction === 'down' ? (
              <ArrowDown size={13} aria-hidden="true" />
            ) : (
              <ArrowLeft size={13} aria-hidden="true" />
            );
          return (
            <button
              key={direction}
              className="sutra-selection-toolbar-button sutra-selection-direction-button"
              type="button"
              aria-label={label}
              title={target ? label : `No sibling ${direction} of ${node.name}`}
              disabled={!target}
              onClick={() => moveInDirection(direction)}
            >
              {icon}
            </button>
          );
        })}
      </div>
      <button
        ref={optionsButtonRef}
        className={`sutra-selection-toolbar-button${optionsOpen ? ' is-active' : ''}`}
        type="button"
        aria-label={`Edit ${node.name}`}
        aria-expanded={optionsOpen}
        aria-controls={`sutra-options-${node.id}`}
        title="Edit and quick options"
        onClick={() => setOptionsNodeId((current) => (current === node.id ? null : node.id))}
      >
        <SlidersHorizontal size={15} />
      </button>
      <button
        className="sutra-selection-toolbar-button is-danger"
        type="button"
        aria-label={`Delete ${node.name}`}
        title={isRoot ? 'The Page root cannot be deleted' : 'Delete immediately'}
        disabled={isRoot}
        onClick={() => {
          setOptionsNodeId(null);
          removeSelectedNode();
        }}
      >
        <Trash2 size={15} />
      </button>

      {optionsOpen && (
        <div
          className="sutra-selection-options"
          id={`sutra-options-${node.id}`}
          role="dialog"
          aria-label={`Edit ${node.name}`}
        >
          <div className="sutra-selection-options-heading">
            <div>
              <span>{displayName(node)}</span>
              <strong>Quick edit</strong>
            </div>
            <button
              type="button"
              onClick={() => {
                setInspectorTab('design');
                setOptionsNodeId(null);
                showStatus(`Opened the full Design inspector for ${node.name}`);
              }}
            >
              <PanelRightOpen size={14} />
              Inspector
            </button>
          </div>

          {!isRoot && (
            <label className="sutra-selection-field">
              <span>Layer name</span>
              <input
                key={node.name}
                defaultValue={node.name}
                onBlur={(event) => {
                  if (!event.currentTarget.value.trim()) event.currentTarget.value = node.name;
                  commitName(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitName(event.currentTarget.value);
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    event.currentTarget.value = node.name;
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          )}

          {node.kind === 'element' && quickContent && (
            <label className="sutra-selection-field">
              <span>{quickContent.label}</span>
              <input
                value={quickText ?? ''}
                disabled={quickText === null}
                placeholder={quickText === null ? 'Bound to a prop or expression' : undefined}
                onChange={(event) =>
                  setLiteralProp(node.id, quickContent.propName, event.target.value)
                }
              />
              {quickText === null && (
                <small>This value is dynamic. Edit its binding in the Props inspector.</small>
              )}
            </label>
          )}

          {node.kind === 'element' && supportsTypography && style && (
            <div className="sutra-selection-option-group">
              <span>Text format</span>
              <div className="sutra-selection-option-row">
                <ToolbarIconButton
                  label="Bold"
                  active={(style.fontWeight ?? 400) >= 600}
                  onClick={() =>
                    setStyle(node.id, 'fontWeight', (style.fontWeight ?? 400) >= 600 ? 400 : 700)
                  }
                >
                  <Bold size={15} />
                </ToolbarIconButton>
                <ToolbarIconButton
                  label="Italic"
                  active={style.fontStyle === 'italic'}
                  onClick={() =>
                    setStyle(
                      node.id,
                      'fontStyle',
                      style.fontStyle === 'italic' ? 'normal' : 'italic',
                    )
                  }
                >
                  <Italic size={15} />
                </ToolbarIconButton>
                <ToolbarIconButton
                  label="Underline"
                  active={style.textDecoration === 'underline'}
                  onClick={() =>
                    setStyle(
                      node.id,
                      'textDecoration',
                      style.textDecoration === 'underline' ? 'none' : 'underline',
                    )
                  }
                >
                  <Underline size={15} />
                </ToolbarIconButton>
                <span className="sutra-selection-option-divider" />
                <ToolbarIconButton
                  label="Align left"
                  active={(style.textAlign ?? 'left') === 'left'}
                  onClick={() => setStyle(node.id, 'textAlign', 'left')}
                >
                  <AlignLeft size={15} />
                </ToolbarIconButton>
                <ToolbarIconButton
                  label="Align center"
                  active={style.textAlign === 'center'}
                  onClick={() => setStyle(node.id, 'textAlign', 'center')}
                >
                  <AlignCenter size={15} />
                </ToolbarIconButton>
                <ToolbarIconButton
                  label="Align right"
                  active={style.textAlign === 'right'}
                  onClick={() => setStyle(node.id, 'textAlign', 'right')}
                >
                  <AlignRight size={15} />
                </ToolbarIconButton>
              </div>
            </div>
          )}

          {node.kind === 'element' && supportsFlexLayout && style && (
            <div className="sutra-selection-option-group">
              <span>Layout direction</span>
              <div className="sutra-selection-option-row is-wide">
                <button
                  type="button"
                  className={style.flexDirection === 'row' ? 'is-active' : ''}
                  aria-pressed={style.flexDirection === 'row'}
                  onClick={() => {
                    setStyle(node.id, 'display', 'flex');
                    setStyle(node.id, 'flexDirection', 'row');
                  }}
                >
                  <Columns3 size={14} /> Row
                </button>
                <button
                  type="button"
                  className={(style.flexDirection ?? 'column') === 'column' ? 'is-active' : ''}
                  aria-pressed={(style.flexDirection ?? 'column') === 'column'}
                  onClick={() => {
                    setStyle(node.id, 'display', 'flex');
                    setStyle(node.id, 'flexDirection', 'column');
                  }}
                >
                  <Rows3 size={14} /> Column
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
