import { Braces, ChevronDown, Component, GitBranch, Layers3, Repeat2, Search } from 'lucide-react';
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

import type { ComponentManifest } from '@sutra/component-registry';

import { componentRegistry } from '../lib/registry';
import { useStudioStore } from '../store/studio-store';

const DRAG_COMPONENT = 'application/x-sutra-component';
const DRAG_STRUCTURE = 'application/x-sutra-structure';

export function Palette() {
  const [query, setQuery] = useState('');
  const addComponent = useStudioStore((state) => state.addComponent);
  const addIfNode = useStudioStore((state) => state.addIfNode);
  const addRepeatNode = useStudioStore((state) => state.addRepeatNode);
  const beginDrag = useStudioStore((state) => state.beginDrag);
  const moveDrag = useStudioStore((state) => state.moveDrag);
  const releaseDrag = useStudioStore((state) => state.releaseDrag);
  const endDrag = useStudioStore((state) => state.endDrag);
  const pointerDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    payload: Parameters<typeof beginDrag>[0];
    moved: boolean;
  } | null>(null);
  const suppressClickTarget = useRef<EventTarget | null>(null);

  const grouped = useMemo(() => {
    const manifests = componentRegistry
      .manifests()
      .filter((manifest) => manifest.id !== 'sutra.page')
      .filter((manifest) =>
        `${manifest.displayName} ${manifest.category}`.toLowerCase().includes(query.toLowerCase()),
      );
    return manifests.reduce<Map<string, ComponentManifest[]>>((groups, manifest) => {
      const group = groups.get(manifest.category) ?? [];
      group.push(manifest);
      groups.set(manifest.category, group);
      return groups;
    }, new Map());
  }, [query]);

  const startPointerDrag = (
    event: PointerEvent<HTMLElement>,
    payload: Parameters<typeof beginDrag>[0],
  ): void => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      payload,
      moved: false,
    };
  };

  const movePointerDrag = (event: PointerEvent<HTMLElement>): void => {
    const session = pointerDrag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.moved && distance < 5) return;
    if (!session.moved) {
      session.moved = true;
      beginDrag(session.payload);
    }
    event.preventDefault();
    moveDrag(event.clientX, event.clientY);
  };

  const finishPointerDrag = (event: PointerEvent<HTMLElement>, cancelled = false): void => {
    const session = pointerDrag.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (session.moved) {
      if (cancelled) endDrag();
      else releaseDrag(event.clientX, event.clientY);
      const target = event.currentTarget;
      suppressClickTarget.current = target;
      window.setTimeout(() => {
        if (suppressClickTarget.current === target) suppressClickTarget.current = null;
      }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerDrag.current = null;
  };

  const runClick = (event: MouseEvent<HTMLElement>, action: () => void): void => {
    if (suppressClickTarget.current === event.currentTarget) {
      suppressClickTarget.current = null;
      return;
    }
    action();
  };

  return (
    <aside className="left-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">BUILD</span>
          <h2>Components</h2>
        </div>
        <Component size={17} />
      </div>

      <label className="search-box">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search components"
        />
      </label>

      <div className="palette-scroll">
        {[...grouped.entries()].map(([category, manifests]) => (
          <section className="palette-section" key={category}>
            <header>
              <span>{category}</span>
              <ChevronDown size={13} />
            </header>
            <div className="component-grid">
              {manifests.map((manifest) => (
                <button
                  className="component-tile"
                  key={manifest.id}
                  type="button"
                  title={manifest.description}
                  onClick={(event) => runClick(event, () => addComponent(manifest.id))}
                  onPointerDown={(event) =>
                    startPointerDrag(event, { kind: 'component', componentId: manifest.id })
                  }
                  onPointerMove={movePointerDrag}
                  onPointerUp={(event) => finishPointerDrag(event)}
                  onPointerCancel={(event) => finishPointerDrag(event, true)}
                >
                  <span className="component-icon">
                    <Layers3 size={16} />
                  </span>
                  <span>{manifest.displayName}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <section className="palette-section">
          <header>
            <span>JSX Structure</span>
            <Braces size={13} />
          </header>
          <div className="structure-list">
            <button
              className="structure-item"
              type="button"
              onClick={(event) => runClick(event, () => addIfNode())}
              onPointerDown={(event) =>
                startPointerDrag(event, { kind: 'structure', structure: 'if' })
              }
              onPointerMove={movePointerDrag}
              onPointerUp={(event) => finishPointerDrag(event)}
              onPointerCancel={(event) => finishPointerDrag(event, true)}
            >
              <GitBranch size={16} />
              <span>
                <strong>If / Else</strong>
                <small>Conditional JSX branch</small>
              </span>
            </button>
            <button
              className="structure-item"
              type="button"
              onClick={(event) => runClick(event, () => addRepeatNode())}
              onPointerDown={(event) =>
                startPointerDrag(event, { kind: 'structure', structure: 'repeat' })
              }
              onPointerMove={movePointerDrag}
              onPointerUp={(event) => finishPointerDrag(event)}
              onPointerCancel={(event) => finishPointerDrag(event, true)}
            >
              <Repeat2 size={16} />
              <span>
                <strong>Repeat</strong>
                <small>Typed collection map</small>
              </span>
            </button>
          </div>
        </section>
      </div>
    </aside>
  );
}

export const sutraDragTypes = {
  component: DRAG_COMPONENT,
  structure: DRAG_STRUCTURE,
  node: 'application/x-sutra-node',
} as const;
