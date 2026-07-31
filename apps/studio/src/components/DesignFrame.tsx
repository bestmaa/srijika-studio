import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';

import { SutraRenderer } from '@sutra/react-renderer';

import { componentRegistry } from '../lib/registry';
import { defaultSymbolValues, useStudioStore } from '../store/studio-store';
import canvasCss from '../styles/canvas.css?inline';
import { sutraDragTypes } from './Palette';

const viewportWidths = {
  desktop: 1180,
  tablet: 768,
  mobile: 390,
} as const;

const frameSource = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${canvasCss}</style></head><body><div id="sutra-frame-root"></div></body></html>`;

export function DesignFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const document = useStudioStore((state) => state.document);
  const selectedNodeId = useStudioStore((state) => state.selectedNodeId);
  const dropTargetNodeId = useStudioStore((state) => state.dropTargetNodeId);
  const viewport = useStudioStore((state) => state.viewport);
  const activeIfBranches = useStudioStore((state) => state.activeIfBranches);
  const selectNode = useStudioStore((state) => state.selectNode);
  const setDropTarget = useStudioStore((state) => state.setDropTarget);
  const addComponent = useStudioStore((state) => state.addComponent);
  const addIfNode = useStudioStore((state) => state.addIfNode);
  const addRepeatNode = useStudioStore((state) => state.addRepeatNode);
  const moveNode = useStudioStore((state) => state.moveNode);
  const symbols = useMemo(() => defaultSymbolValues(document), [document]);

  const findDropTarget = useCallback(
    (target: EventTarget | null): string => {
      let element = target instanceof Element ? target : null;
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
      setDropTarget(findDropTarget(event.target));
    }
  };

  const handleDrop = (event: DragEvent): void => {
    event.preventDefault();
    const targetId = findDropTarget(event.target);
    const componentId = event.dataTransfer.getData(sutraDragTypes.component);
    const structure = event.dataTransfer.getData(sutraDragTypes.structure);
    const nodeId = event.dataTransfer.getData(sutraDragTypes.node);

    if (componentId) addComponent(componentId, targetId);
    else if (structure === 'if') addIfNode(targetId);
    else if (structure === 'repeat') addRepeatNode(targetId);
    else if (nodeId) moveNode(nodeId, targetId);
    setDropTarget(null);
  };

  return (
    <div className="design-workspace">
      <div className="canvas-ruler-bar">
        <span>{viewportWidths[viewport]} px</span>
        <span>100%</span>
      </div>
      <div className="canvas-scroll">
        <div
          className={`device-frame device-frame--${viewport}`}
          style={{ width: viewportWidths[viewport] }}
        >
          <div className="device-label">
            <span>{viewport}</span>
            <span>
              {viewportWidths[viewport]} ×{' '}
              {viewport === 'mobile' ? 844 : viewport === 'tablet' ? 1024 : 820}
            </span>
          </div>
          <iframe
            ref={iframeRef}
            className="design-iframe"
            title="Sutra DOM design surface"
            sandbox="allow-same-origin"
            srcDoc={frameSource}
            onLoad={() => {
              setPortalRoot(
                iframeRef.current?.contentDocument?.getElementById('sutra-frame-root') ?? null,
              );
            }}
          />
          {portalRoot &&
            createPortal(
              <div
                className="sutra-edit-surface"
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
                  dropTargetNodeId={dropTargetNodeId}
                  symbols={symbols}
                  activeIfBranches={activeIfBranches}
                  onSelectNode={selectNode}
                />
              </div>,
              portalRoot,
            )}
        </div>
      </div>
    </div>
  );
}
