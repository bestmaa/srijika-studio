import { Braces, MoveRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { literalPropPromotionCandidates, useStudioStore } from '../store/studio-store';

export interface ContextMenuAnchor {
  clientX: number;
  clientY: number;
}

export function PromotePropMenu({
  nodeId,
  anchor,
  onClose,
}: {
  nodeId: string;
  anchor: ContextMenuAnchor;
  onClose: () => void;
}) {
  const document = useStudioStore((state) => state.document);
  const promoteLiteralProp = useStudioStore((state) => state.promoteLiteralProp);
  const node = document.nodes[nodeId];
  const candidates = useMemo(
    () => literalPropPromotionCandidates(document, nodeId),
    [document, nodeId],
  );

  useEffect(() => {
    const close = (): void => onClose();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  if (!node) return null;
  const left = Math.max(8, Math.min(anchor.clientX, window.innerWidth - 316));
  const top = Math.max(8, Math.min(anchor.clientY, window.innerHeight - 320));

  return (
    <div
      className="literal-prop-menu"
      style={{ left, top }}
      role="menu"
      aria-label={`Move ${node.name} value to page props`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="literal-prop-menu__heading">
        <Braces size={14} />
        <span>Move value to page props</span>
      </div>
      {candidates.length === 0 ? (
        <p className="literal-prop-menu__empty">This component has no static values.</p>
      ) : (
        candidates.map((candidate) => (
          <button
            key={candidate.propName}
            type="button"
            role="menuitem"
            aria-label={`Move ${candidate.propName} to props.${candidate.suggestedName}`}
            onClick={() => {
              promoteLiteralProp(nodeId, candidate.propName);
              onClose();
            }}
          >
            <span className="literal-prop-menu__source">{candidate.propName}</span>
            <MoveRight size={13} />
            <span className="literal-prop-menu__target">props.{candidate.suggestedName}</span>
            <small>{candidate.valueType}</small>
          </button>
        ))
      )}
    </div>
  );
}
