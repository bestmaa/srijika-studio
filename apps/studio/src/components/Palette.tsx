import { Braces, ChevronDown, Component, GitBranch, Layers3, Repeat2, Search } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';

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

  const startComponentDrag = (event: DragEvent, manifest: ComponentManifest): void => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(DRAG_COMPONENT, manifest.id);
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
                  draggable
                  key={manifest.id}
                  type="button"
                  title={manifest.description}
                  onClick={() => addComponent(manifest.id)}
                  onDragStart={(event) => startComponentDrag(event, manifest)}
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
              draggable
              type="button"
              onClick={() => addIfNode()}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_STRUCTURE, 'if');
              }}
            >
              <GitBranch size={16} />
              <span>
                <strong>If / Else</strong>
                <small>Conditional JSX branch</small>
              </span>
            </button>
            <button
              className="structure-item"
              draggable
              type="button"
              onClick={() => addRepeatNode()}
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_STRUCTURE, 'repeat');
              }}
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
