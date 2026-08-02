import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';

import coreComponentsCss from '@sutra/core-components/styles.css?inline';
import { SutraRenderer } from '@sutra/react-renderer';

import { useAppearance } from '../app/AppearanceProvider';
import { applyCanvasEditorAppearance } from '../lib/appearance';
import { componentRegistry } from '../lib/registry';
import {
  VIEWPORT_PRESET_SIZES,
  defaultSymbolValues,
  type NodeDropIntent,
  useStudioStore,
} from '../store/studio-store';
import canvasCss from '../styles/canvas.css?inline';
import {
  CanvasSelectionToolbar,
  directionalMoveTargets,
  type CanvasMoveDirection,
} from './CanvasSelectionToolbar';
import { sutraDragTypes } from './Palette';
import { PromotePropMenu, type ContextMenuAnchor } from './PromotePropMenu';

const frameSource = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${coreComponentsCss}\n${canvasCss}</style></head><body><div id="sutra-frame-root"></div></body></html>`;

interface CanvasDropPlacement {
  targetNodeId: string;
  intent: NodeDropIntent;
  axis: 'horizontal' | 'vertical';
}

interface CanvasContextMenu {
  nodeId: string;
  anchor: ContextMenuAnchor;
}

function gridColumnCount(template: string): number {
  const tokens: string[] = [];
  let current = '';
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  for (const character of template.trim()) {
    if (/\s/.test(character) && parenthesisDepth === 0 && bracketDepth === 0) {
      if (current) tokens.push(current);
      current = '';
      continue;
    }
    current += character;
    if (character === '(') parenthesisDepth += 1;
    if (character === ')') parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
  }
  if (current) tokens.push(current);
  return tokens.reduce((count, token) => {
    if (token === 'none' || (token.startsWith('[') && token.endsWith(']'))) return count;
    const repeatedTracks = /^repeat\(\s*(\d+)\s*,/i.exec(token)?.[1];
    return count + (repeatedTracks ? Number(repeatedTracks) : 1);
  }, 0);
}

export function dropAxis(element: Element): CanvasDropPlacement['axis'] {
  const parent = element.parentElement;
  const view = element.ownerDocument.defaultView;
  if (!parent || !view) return 'vertical';
  const style = view.getComputedStyle(parent);
  if (style.display.includes('grid')) {
    return gridColumnCount(style.gridTemplateColumns) > 1 ? 'horizontal' : 'vertical';
  }
  if (style.display.includes('flex') && style.flexDirection.startsWith('row')) return 'horizontal';
  return 'vertical';
}

function intentAtPoint(
  element: Element,
  clientX: number,
  clientY: number,
  canContain: boolean,
): Pick<CanvasDropPlacement, 'intent' | 'axis'> {
  const axis = dropAxis(element);
  const bounds = element.getBoundingClientRect();
  const length = axis === 'horizontal' ? bounds.width : bounds.height;
  const offset = axis === 'horizontal' ? clientX - bounds.left : clientY - bounds.top;
  const ratio = length > 0 ? offset / length : 0.5;
  if (ratio <= 0.22) return { intent: 'before', axis };
  if (ratio >= 0.78) return { intent: 'after', axis };
  return { intent: canContain ? 'inside' : ratio < 0.5 ? 'before' : 'after', axis };
}

export function DesignFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasPointerDrag = useRef<{
    pointerId: number;
    nodeId: string;
    startX: number;
    startY: number;
    moved: boolean;
    captureTarget: HTMLElement;
  } | null>(null);
  const suppressFrameClickNodeId = useRef<string | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [selectionAnchorElement, setSelectionAnchorElement] = useState<HTMLElement | null>(null);
  const { preferences: appearance, resolvedScheme } = useAppearance();
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const dropIntent = useStudioStore((state) => state.dropIntent);
  const viewport = useStudioStore((state) => state.viewport);
  const customViewportSize = useStudioStore((state) => state.customViewportSize);
  const activeIfBranches = useStudioStore((state) => state.activeIfBranches);
  const activeDrag = useStudioStore((state) => state.activeDrag);
  const dragPointer = useStudioStore((state) => state.dragPointer);
  const selectNode = useStudioStore((state) => state.selectNode);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const addComponent = useStudioStore((state) => state.addComponent);
  const addIfNode = useStudioStore((state) => state.addIfNode);
  const addRepeatNode = useStudioStore((state) => state.addRepeatNode);
  const moveNode = useStudioStore((state) => state.moveNode);
  const removeSelectedNode = useStudioStore((state) => state.removeSelectedNode);
  const showStatus = useStudioStore((state) => state.showStatus);
  const beginDrag = useStudioStore((state) => state.beginDrag);
  const moveDrag = useStudioStore((state) => state.moveDrag);
  const releaseDrag = useStudioStore((state) => state.releaseDrag);
  const endDrag = useStudioStore((state) => state.endDrag);
  const symbols = useMemo(() => defaultSymbolValues(document), [document]);
  const viewportSize = customViewportSize ?? VIEWPORT_PRESET_SIZES[viewport];

  useEffect(() => {
    const frameRoot = portalRoot?.ownerDocument.documentElement;
    if (!frameRoot) return;
    applyCanvasEditorAppearance(frameRoot, appearance, resolvedScheme);
  }, [appearance, portalRoot, resolvedScheme]);

  const findContainerTarget = useCallback(
    (target: EventTarget | null): string => {
      let element =
        target &&
        typeof (target as Element).getAttribute === 'function' &&
        'parentElement' in target
          ? (target as Element)
          : null;
      while (element) {
        const nodeId = element.getAttribute('data-sutra-node');
        if (nodeId) {
          const node = document.nodes[nodeId];
          if (
            (node?.kind === 'element' && node.slots['children']) ||
            node?.kind === 'if' ||
            node?.kind === 'repeat' ||
            node?.kind === 'fragment' ||
            node?.kind === 'slot'
          ) {
            return nodeId;
          }
        }
        element = element.parentElement;
      }
      return document.rootNodeId;
    },
    [document],
  );

  const findNodePlacement = useCallback(
    (target: EventTarget | null, clientX: number, clientY: number): CanvasDropPlacement => {
      const element =
        target && typeof (target as Element).closest === 'function'
          ? (target as Element).closest<HTMLElement>('[data-sutra-node]')
          : null;
      const nodeId = element?.getAttribute('data-sutra-node');
      const node = nodeId ? document.nodes[nodeId] : undefined;
      if (!element || !nodeId || !node || nodeId === document.rootNodeId) {
        return { targetNodeId: document.rootNodeId, intent: 'inside', axis: 'vertical' };
      }
      const canContain =
        (node.kind === 'element' && Boolean(node.slots['children'])) ||
        node.kind === 'if' ||
        node.kind === 'repeat' ||
        node.kind === 'fragment' ||
        node.kind === 'slot';
      return {
        targetNodeId: nodeId,
        ...intentAtPoint(element, clientX, clientY, canContain),
      };
    },
    [document],
  );

  const handleDragOver = (event: DragEvent): void => {
    if (
      event.dataTransfer.types.includes(sutraDragTypes.component) ||
      event.dataTransfer.types.includes(sutraDragTypes.structure) ||
      event.dataTransfer.types.includes(sutraDragTypes.node)
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes(sutraDragTypes.node)
        ? 'move'
        : 'copy';
      if (event.dataTransfer.types.includes(sutraDragTypes.node)) {
        const placement = findNodePlacement(event.target, event.clientX, event.clientY);
        setDropTarget(placement.targetNodeId, placement.intent);
      } else {
        setDropTarget(findContainerTarget(event.target), 'inside');
      }
    }
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    const isNodeMove = event.dataTransfer.types.includes(sutraDragTypes.node);
    const placement = isNodeMove
      ? findNodePlacement(event.target, event.clientX, event.clientY)
      : {
          targetNodeId: findContainerTarget(event.target),
          intent: 'inside' as const,
          axis: 'vertical' as const,
        };
    const componentId = event.dataTransfer.getData(sutraDragTypes.component);
    const structure = event.dataTransfer.getData(sutraDragTypes.structure);
    const nodeId = event.dataTransfer.getData(sutraDragTypes.node);

    if (componentId) addComponent(componentId, placement.targetNodeId);
    else if (structure === 'if') addIfNode(placement.targetNodeId);
    else if (structure === 'repeat') addRepeatNode(placement.targetNodeId);
    else if (nodeId) moveNode(nodeId, placement.targetNodeId, placement.intent);
    setDropTarget(null);
  };

  const findDropPlacementAtFramePoint = useCallback(
    (frameX: number, frameY: number, nodeMove: boolean): CanvasDropPlacement => {
      const frame = iframeRef.current;
      const frameDocument = frame?.contentDocument;
      if (!frame || !frameDocument) {
        return { targetNodeId: document.rootNodeId, intent: 'inside', axis: 'vertical' };
      }
      const element = frameDocument.elementFromPoint(frameX, frameY);
      if (nodeMove) return findNodePlacement(element, frameX, frameY);
      return {
        targetNodeId: findContainerTarget(element),
        intent: 'inside',
        axis: 'vertical',
      };
    },
    [document.rootNodeId, findContainerTarget, findNodePlacement],
  );

  const handleOverlayDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!activeDrag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = activeDrag.kind === 'node' ? 'move' : 'copy';
    const placement = findDropPlacementAtFramePoint(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      activeDrag.kind === 'node',
    );
    setDropTarget(placement.targetNodeId, placement.intent);
  };

  const handleOverlayDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!activeDrag) return;
    event.preventDefault();
    event.stopPropagation();
    const placement = findDropPlacementAtFramePoint(
      event.nativeEvent.offsetX,
      event.nativeEvent.offsetY,
      activeDrag.kind === 'node',
    );
    if (activeDrag.kind === 'component')
      addComponent(activeDrag.componentId, placement.targetNodeId);
    else if (activeDrag.kind === 'structure') {
      if (activeDrag.structure === 'if') addIfNode(placement.targetNodeId);
      else addRepeatNode(placement.targetNodeId);
    } else moveNode(activeDrag.nodeId, placement.targetNodeId, placement.intent);
    endDrag();
  };

  const dropTargetName = dropTargetNodeId
    ? (document.nodes[dropTargetNodeId]?.name ?? 'Page')
    : null;
  const dropLabel = dropTargetName
    ? dropIntent === 'inside'
      ? `Drop into ${dropTargetName}`
      : `Move ${dropIntent} ${dropTargetName}`
    : 'Move over a layout container';

  useEffect(() => {
    if (!activeDrag || !dragPointer) return;
    const frame = iframeRef.current;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    const frameX = dragPointer.clientX - bounds.left;
    const frameY = dragPointer.clientY - bounds.top;
    const isInsideFrame =
      frameX >= 0 && frameY >= 0 && frameX <= bounds.width && frameY <= bounds.height;
    const placement = isInsideFrame
      ? findDropPlacementAtFramePoint(frameX, frameY, activeDrag.kind === 'node')
      : null;
    setDropTarget(placement?.targetNodeId ?? null, placement?.intent);

    if (dragPointer.phase === 'drop') {
      const payload = activeDrag;
      endDrag();
      if (!placement) return;
      if (payload.kind === 'component') addComponent(payload.componentId, placement.targetNodeId);
      else if (payload.kind === 'structure') {
        if (payload.structure === 'if') addIfNode(placement.targetNodeId);
        else addRepeatNode(placement.targetNodeId);
      } else moveNode(payload.nodeId, placement.targetNodeId, placement.intent);
    }
  }, [
    activeDrag,
    addComponent,
    addIfNode,
    addRepeatNode,
    dragPointer,
    endDrag,
    findDropPlacementAtFramePoint,
    moveNode,
    setDropTarget,
  ]);

  useEffect(() => {
    const frameDocument = portalRoot?.ownerDocument;
    if (!frameDocument) return;
    const clearIndicators = (): void => {
      frameDocument.querySelectorAll<HTMLElement>('[data-sutra-drop-intent]').forEach((element) => {
        element.removeAttribute('data-sutra-drop-intent');
        element.removeAttribute('data-sutra-drop-axis');
      });
    };
    clearIndicators();
    if (activeDrag?.kind !== 'node' || !dropTargetNodeId || dropIntent === 'inside') return;
    frameDocument.querySelectorAll<HTMLElement>('[data-sutra-node]').forEach((element) => {
      if (element.getAttribute('data-sutra-node') !== dropTargetNodeId) return;
      element.setAttribute('data-sutra-drop-intent', dropIntent);
      element.setAttribute('data-sutra-drop-axis', dropAxis(element));
    });
    return clearIndicators;
  }, [activeDrag, dropIntent, dropTargetNodeId, portalRoot]);

  useEffect(() => {
    const frameDocument = portalRoot?.ownerDocument;
    if (!frameDocument) return;
    const handleFrameSelection = (event: MouseEvent): void => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      if (target?.closest('[data-sutra-editor-ui]')) return;
      const nodeElement =
        target && typeof target.closest === 'function'
          ? target.closest<HTMLElement>('[data-sutra-node]')
          : null;
      if (!nodeElement) return;
      const nodeId = nodeElement.getAttribute('data-sutra-node');
      if (!nodeId || !document.nodes[nodeId]) return;

      if (suppressFrameClickNodeId.current === nodeId) {
        suppressFrameClickNodeId.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      nodeElement.focus({ preventScroll: true });
      setContextMenu(null);
      setSelectionAnchorElement(nodeElement);
      selectNode(nodeId);
    };
    const handleFrameContextMenu = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest('[data-sutra-editor-ui]')) return;
      const nodeElement =
        target && typeof target.closest === 'function'
          ? target.closest<HTMLElement>('[data-sutra-node]')
          : null;
      const nodeId = nodeElement?.getAttribute('data-sutra-node');
      if (!nodeId || !document.nodes[nodeId]) return;
      const frameBounds = iframeRef.current?.getBoundingClientRect();
      if (!frameBounds) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectionAnchorElement(nodeElement ?? null);
      selectNode(nodeId);
      setContextMenu({
        nodeId,
        anchor: {
          clientX: frameBounds.left + event.clientX,
          clientY: frameBounds.top + event.clientY,
        },
      });
    };
    const handleFramePointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      const target = event.target as Element | null;
      const moveHandle =
        target && typeof target.closest === 'function'
          ? target.closest<HTMLElement>('[data-sutra-move-handle="true"]')
          : null;
      const nodeId = moveHandle?.getAttribute('data-sutra-toolbar-node');
      if (!moveHandle || !nodeId || nodeId === document.rootNodeId || !document.nodes[nodeId]) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectNode(nodeId);
      canvasPointerDrag.current = {
        pointerId: event.pointerId,
        nodeId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        captureTarget: moveHandle,
      };
      moveHandle.setPointerCapture?.(event.pointerId);
    };
    const handleFramePointerMove = (event: PointerEvent): void => {
      const session = canvasPointerDrag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
      if (!session.moved && distance < 5) return;
      if (!session.moved) {
        session.moved = true;
        selectNode(session.nodeId);
        beginDrag({ kind: 'node', nodeId: session.nodeId });
      }
      const bounds = iframeRef.current?.getBoundingClientRect();
      if (!bounds) return;
      event.preventDefault();
      moveDrag(bounds.left + event.clientX, bounds.top + event.clientY);
    };
    const finishFramePointerDrag = (event: PointerEvent, cancelled: boolean): void => {
      const session = canvasPointerDrag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      if (session.moved) {
        const bounds = iframeRef.current?.getBoundingClientRect();
        if (cancelled || !bounds) endDrag();
        else releaseDrag(bounds.left + event.clientX, bounds.top + event.clientY);
        suppressFrameClickNodeId.current = session.nodeId;
        window.setTimeout(() => {
          if (suppressFrameClickNodeId.current === session.nodeId) {
            suppressFrameClickNodeId.current = null;
          }
        }, 0);
      }
      if (session.captureTarget.hasPointerCapture?.(event.pointerId)) {
        session.captureTarget.releasePointerCapture?.(event.pointerId);
      }
      canvasPointerDrag.current = null;
    };
    const handleFramePointerUp = (event: PointerEvent): void =>
      finishFramePointerDrag(event, false);
    const handleFramePointerCancel = (event: PointerEvent): void =>
      finishFramePointerDrag(event, true);
    const handleFrameShortcut = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const editingText =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        Boolean(target?.isContentEditable);
      const directionByKey: Readonly<Partial<Record<string, CanvasMoveDirection>>> = {
        ArrowUp: 'up',
        ArrowRight: 'right',
        ArrowDown: 'down',
        ArrowLeft: 'left',
      };
      const direction = directionByKey[event.key];
      if (
        !editingText &&
        direction &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      ) {
        const selectedNode = document.nodes[selectedNodeId];
        const moveTarget = directionalMoveTargets(
          portalRoot,
          document,
          selectedNodeId,
          selectionAnchorElement,
        )[direction];
        if (selectedNode) {
          event.preventDefault();
          event.stopPropagation();
          if (moveTarget) {
            moveNode(selectedNodeId, moveTarget.targetNodeId, moveTarget.intent);
            showStatus(`Moved ${selectedNode.name} ${direction}`);
            portalRoot.ownerDocument.defaultView?.requestAnimationFrame(() => {
              selectionAnchorElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            });
          }
          return;
        }
      }
      if (!editingText && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        removeSelectedNode();
      }
    };
    portalRoot.addEventListener('click', handleFrameSelection, true);
    portalRoot.addEventListener('contextmenu', handleFrameContextMenu, true);
    portalRoot.addEventListener('pointerdown', handleFramePointerDown, true);
    portalRoot.addEventListener('pointermove', handleFramePointerMove, true);
    portalRoot.addEventListener('pointerup', handleFramePointerUp, true);
    portalRoot.addEventListener('pointercancel', handleFramePointerCancel, true);
    portalRoot.addEventListener('keydown', handleFrameShortcut);
    return () => {
      portalRoot.removeEventListener('click', handleFrameSelection, true);
      portalRoot.removeEventListener('contextmenu', handleFrameContextMenu, true);
      portalRoot.removeEventListener('pointerdown', handleFramePointerDown, true);
      portalRoot.removeEventListener('pointermove', handleFramePointerMove, true);
      portalRoot.removeEventListener('pointerup', handleFramePointerUp, true);
      portalRoot.removeEventListener('pointercancel', handleFramePointerCancel, true);
      portalRoot.removeEventListener('keydown', handleFrameShortcut);
    };
  }, [
    beginDrag,
    document,
    endDrag,
    moveNode,
    moveDrag,
    portalRoot,
    releaseDrag,
    removeSelectedNode,
    selectNode,
    selectedNodeId,
    selectionAnchorElement,
    showStatus,
  ]);

  return (
    <div className="design-workspace">
      <div className="canvas-ruler-bar">
        <span>{viewportSize.width} px</span>
        <span>100%</span>
      </div>
      <div className="canvas-scroll" role="region" aria-label="Design canvas viewport" tabIndex={0}>
        <div
          className={`device-frame device-frame--${viewport}`}
          data-viewport-height={viewportSize.height}
          data-viewport-width={viewportSize.width}
          style={{ width: viewportSize.width }}
        >
          <div className="device-label">
            <span>{customViewportSize ? 'custom' : viewport}</span>
            <span>
              {viewportSize.width} × {viewportSize.height}
            </span>
          </div>
          <iframe
            ref={iframeRef}
            className="design-iframe"
            data-testid="design-iframe"
            height={viewportSize.height}
            width={viewportSize.width}
            style={{ height: viewportSize.height }}
            title="Sutra DOM design surface"
            sandbox="allow-same-origin allow-scripts"
            srcDoc={frameSource}
            onLoad={() => {
              setPortalRoot(
                iframeRef.current?.contentDocument?.getElementById('sutra-frame-root') ?? null,
              );
            }}
          />
          {activeDrag && (
            <div
              className={`design-drop-overlay${dragPointer ? ' design-drop-overlay--pointer' : ''}`}
              data-testid="design-drop-overlay"
              onDragOver={handleOverlayDragOver}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setDropTarget(null);
              }}
              onDrop={handleOverlayDrop}
            >
              <span className="design-drop-label">{dropLabel}</span>
            </div>
          )}
          {portalRoot &&
            createPortal(
              <div
                className="sutra-edit-surface"
                data-sutra-document-id={document.id}
                data-sutra-revision={document.revision}
                onDragOver={handleDragOver}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropTarget(null);
                }}
                onDrop={handleDrop}
              >
                <SutraRenderer
                  document={document}
                  registry={componentRegistry}
                  mode="edit"
                  selectedNodeId={selectedNodeId}
                  dropTargetNodeId={dropIntent === 'inside' ? dropTargetNodeId : null}
                  viewportWidth={viewportSize.width}
                  symbols={symbols}
                  activeIfBranches={activeIfBranches}
                  onSelectNode={selectNode}
                />
                <CanvasSelectionToolbar
                  key={selectedNodeId}
                  surfaceRoot={portalRoot}
                  nodeId={selectedNodeId}
                  preferredAnchor={selectionAnchorElement}
                />
              </div>,
              portalRoot,
            )}
        </div>
      </div>
      {contextMenu && (
        <PromotePropMenu
          nodeId={contextMenu.nodeId}
          anchor={contextMenu.anchor}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
