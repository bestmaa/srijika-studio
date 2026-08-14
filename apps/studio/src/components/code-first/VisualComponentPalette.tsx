import {
  Box,
  ChevronDown,
  ChevronRight,
  Columns3,
  FormInput,
  GripVertical,
  Heading1,
  Image,
  LayoutGrid,
  MousePointerClick,
  Search,
  SquareDashed,
  Type,
} from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';

import type { InsertSrijikaJsxElementInput } from '@srijika/tsx-compiler';

export type VisualComponentCategory = 'Layout' | 'Content' | 'Forms' | 'Media';

export interface VisualComponentDefinition {
  id: string;
  name: string;
  description: string;
  category: VisualComponentCategory;
  template: InsertSrijikaJsxElementInput;
  icon: typeof Box;
}

export const VISUAL_COMPONENTS: readonly VisualComponentDefinition[] = [
  {
    id: 'container',
    name: 'Container',
    description: 'Neutral div wrapper',
    category: 'Layout',
    template: { tag: 'div', attributes: { className: 'srijika-container' } },
    icon: Box,
  },
  {
    id: 'flex-row',
    name: 'Flex row',
    description: 'Horizontal layout hook',
    category: 'Layout',
    template: { tag: 'div', attributes: { className: 'srijika-flex-row' } },
    icon: Columns3,
  },
  {
    id: 'grid',
    name: 'Grid',
    description: 'Responsive grid hook',
    category: 'Layout',
    template: { tag: 'div', attributes: { className: 'srijika-grid' } },
    icon: LayoutGrid,
  },
  {
    id: 'section',
    name: 'Section',
    description: 'Semantic page section',
    category: 'Layout',
    template: { tag: 'section', attributes: { 'aria-label': 'New section' } },
    icon: SquareDashed,
  },
  {
    id: 'header',
    name: 'Header',
    description: 'Page or section header',
    category: 'Layout',
    template: { tag: 'header' },
    icon: SquareDashed,
  },
  {
    id: 'navigation',
    name: 'Navigation',
    description: 'Accessible navigation area',
    category: 'Layout',
    template: { tag: 'nav', attributes: { 'aria-label': 'Navigation' } },
    icon: SquareDashed,
  },
  {
    id: 'article',
    name: 'Article',
    description: 'Self-contained content',
    category: 'Layout',
    template: { tag: 'article' },
    icon: SquareDashed,
  },
  {
    id: 'aside',
    name: 'Aside',
    description: 'Complementary side content',
    category: 'Layout',
    template: { tag: 'aside', attributes: { 'aria-label': 'Aside' } },
    icon: SquareDashed,
  },
  {
    id: 'figure',
    name: 'Figure',
    description: 'Media and caption wrapper',
    category: 'Layout',
    template: { tag: 'figure' },
    icon: SquareDashed,
  },
  {
    id: 'footer',
    name: 'Footer',
    description: 'Page or section footer',
    category: 'Layout',
    template: { tag: 'footer' },
    icon: SquareDashed,
  },
  {
    id: 'heading-1',
    name: 'Heading 1',
    description: 'Primary page heading',
    category: 'Content',
    template: { tag: 'h1', text: 'New heading' },
    icon: Heading1,
  },
  {
    id: 'heading-2',
    name: 'Heading 2',
    description: 'Section heading',
    category: 'Content',
    template: { tag: 'h2', text: 'New section' },
    icon: Heading1,
  },
  {
    id: 'paragraph',
    name: 'Paragraph',
    description: 'Body copy',
    category: 'Content',
    template: { tag: 'p', text: 'Write your content here.' },
    icon: Type,
  },
  {
    id: 'text',
    name: 'Inline text',
    description: 'Short inline label',
    category: 'Content',
    template: { tag: 'span', text: 'Text' },
    icon: Type,
  },
  {
    id: 'button',
    name: 'Button',
    description: 'Interactive action',
    category: 'Content',
    template: { tag: 'button', attributes: { type: 'button' }, text: 'Button' },
    icon: MousePointerClick,
  },
  ...(
    [
      'text',
      'email',
      'password',
      'number',
      'search',
      'tel',
      'url',
      'date',
      'time',
      'datetime-local',
    ] as const
  ).map((type): VisualComponentDefinition => ({
    id: `input-${type}`,
    name: `${type[0]!.toUpperCase()}${type.slice(1)} input`,
    description: `${type} form control`,
    category: 'Forms',
    template: {
      tag: 'input',
      attributes: {
        type,
        name: type === 'text' ? 'field' : type,
        placeholder: `Enter ${type}`,
        'aria-label': `${type} input`,
      },
    },
    icon: type === 'search' ? Search : FormInput,
  })),
  {
    id: 'form',
    name: 'Form',
    description: 'Semantic form container',
    category: 'Forms',
    template: { tag: 'form', attributes: { 'aria-label': 'Form' } },
    icon: FormInput,
  },
  {
    id: 'image',
    name: 'Image',
    description: 'Accessible responsive image',
    category: 'Media',
    template: { tag: 'img', attributes: { src: '/srijika-mark.svg', alt: 'Image' } },
    icon: Image,
  },
] as const;

export function visualComponentById(id: string): VisualComponentDefinition | null {
  return VISUAL_COMPONENTS.find((component) => component.id === id) ?? null;
}

export interface VisualComponentPaletteProps {
  selectedTarget: string;
  disabled?: boolean;
  onInsert: (component: VisualComponentDefinition) => void;
  onDragStateChange?: (componentId: string | null) => void;
  dragHandleProps?: {
    draggable: true;
    onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
    onDragEnd: () => void;
  };
}

export function VisualComponentPalette({
  selectedTarget,
  disabled = false,
  onInsert,
  onDragStateChange,
  dragHandleProps,
}: VisualComponentPaletteProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? VISUAL_COMPONENTS.filter((component) =>
          `${component.name} ${component.description} ${component.category}`
            .toLowerCase()
            .includes(normalized),
        )
      : VISUAL_COMPONENTS;
  }, [query]);
  const categories = ['Layout', 'Content', 'Forms', 'Media'] as const;

  return (
    <section
      className={`code-first-navigator-section code-first-component-library${collapsed ? ' is-collapsed' : ''}`}
      aria-label="UI Components"
    >
      <div className="code-first-navigator-header">
        <button
          type="button"
          className="code-first-workspace-disclosure"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} UI Components`}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <h2>Components</h2>
        <span className="code-first-badge">{VISUAL_COMPONENTS.length}</span>
        <span className="code-first-toolbar-spacer" />
        {dragHandleProps && (
          <button
            type="button"
            className="code-first-panel-drag-handle"
            aria-label="Drag Components panel to reorder"
            title="Drag panel to reorder"
            {...dragHandleProps}
          >
            <GripVertical size={13} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="code-first-component-library-content">
          <label className="code-first-palette-search">
            <Search size={12} aria-hidden="true" />
            <input
              value={query}
              placeholder="Find a component"
              aria-label="Find a UI component"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="code-first-palette-target" title={selectedTarget}>
            Add inside <strong>{selectedTarget}</strong>
          </p>
          <div className="code-first-palette-scroll">
            {categories.map((category) => {
              const components = filtered.filter((component) => component.category === category);
              if (components.length === 0) return null;
              return (
                <section key={category} className="code-first-palette-category">
                  <h3>{category}</h3>
                  <div className="code-first-palette-grid">
                    {components.map((component) => {
                      const Icon = component.icon;
                      return (
                        <button
                          key={component.id}
                          type="button"
                          draggable={!disabled}
                          disabled={disabled}
                          title={`${component.description}. Click or drag into a UI node.`}
                          data-visual-component={component.id}
                          onClick={() => onInsert(component)}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'copy';
                            event.dataTransfer.setData(
                              'application/x-srijika-component',
                              component.id,
                            );
                            event.dataTransfer.setData('text/plain', component.name);
                            onDragStateChange?.(component.id);
                          }}
                          onDragEnd={() => onDragStateChange?.(null)}
                        >
                          <Icon size={15} aria-hidden="true" />
                          <span>{component.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {filtered.length === 0 && <p className="code-first-navigator-empty">No match.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
