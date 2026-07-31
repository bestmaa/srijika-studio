import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

import { ComponentRegistry, type ComponentManifest } from '@sutra/component-registry';
import { createElementNode, literal, type UiNode } from '@sutra/contracts';

export interface EditorDomAttributes {
  'data-sutra-node'?: string;
  'data-sutra-component'?: string;
  'data-sutra-selected'?: 'true' | 'false';
  'data-sutra-drop-target'?: 'true' | 'false';
  onClick?: MouseEventHandler<HTMLElement>;
}

export interface CoreRenderProps {
  nodeId: string;
  values: Readonly<Record<string, unknown>>;
  events: Readonly<Record<string, ((...args: unknown[]) => void) | undefined>>;
  style: CSSProperties;
  className: string;
  children: ReactNode;
  slots: Readonly<Record<string, ReactNode>>;
  editorAttributes: EditorDomAttributes;
}

export type CoreComponentRenderer = (props: CoreRenderProps) => ReactNode;

function displayString(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

const commonEditor = {
  draggable: true,
  selectable: true,
  resizable: 'both' as const,
  dropStrategy: 'none' as const,
};

const pageManifest: ComponentManifest = {
  id: 'sutra.page',
  version: 1,
  displayName: 'Page',
  description: 'The root viewport of a Sutra UI document.',
  category: 'Structure',
  icon: 'PanelsTopLeft',
  props: {},
  events: {},
  slots: { children: { displayName: 'Content', accepts: '*', minChildren: 0 } },
  editor: { ...commonEditor, draggable: false, dropStrategy: 'flow' },
};

const containerManifest: ComponentManifest = {
  id: 'sutra.container',
  version: 1,
  displayName: 'Container',
  description: 'A flexible semantic HTML container.',
  category: 'Layout',
  icon: 'Square',
  props: {
    ariaLabel: {
      type: 'string',
      displayName: 'ARIA label',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
  },
  events: {},
  slots: { children: { displayName: 'Content', accepts: '*', minChildren: 0 } },
  editor: { ...commonEditor, dropStrategy: 'flex' },
};

const stackManifest: ComponentManifest = {
  ...containerManifest,
  id: 'sutra.stack',
  displayName: 'Stack',
  description: 'A vertical flex layout with spacing.',
  icon: 'Rows3',
};

const gridManifest: ComponentManifest = {
  ...containerManifest,
  id: 'sutra.grid',
  displayName: 'Grid',
  description: 'A responsive CSS grid layout.',
  icon: 'Grid2X2',
  props: {
    columns: {
      type: 'number',
      displayName: 'Columns',
      defaultValue: 2,
      required: true,
      bindable: false,
      control: 'number',
    },
  },
  editor: { ...commonEditor, dropStrategy: 'grid' },
};

const textManifest: ComponentManifest = {
  id: 'sutra.text',
  version: 1,
  displayName: 'Text',
  description: 'A paragraph of text.',
  category: 'Typography',
  icon: 'Type',
  props: {
    text: {
      type: 'string',
      displayName: 'Text',
      defaultValue: 'Text',
      required: true,
      bindable: true,
      control: 'textarea',
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

const headingManifest: ComponentManifest = {
  ...textManifest,
  id: 'sutra.heading',
  displayName: 'Heading',
  description: 'A semantic heading.',
  icon: 'Heading',
  props: {
    ...textManifest.props,
    level: {
      type: 'number',
      displayName: 'Level',
      defaultValue: 2,
      required: true,
      bindable: false,
      control: 'select',
      options: ['1', '2', '3', '4', '5', '6'],
    },
  },
};

const buttonManifest: ComponentManifest = {
  id: 'sutra.button',
  version: 1,
  displayName: 'Button',
  description: 'A typed interactive button.',
  category: 'Inputs',
  icon: 'MousePointerClick',
  props: {
    label: {
      type: 'string',
      displayName: 'Label',
      defaultValue: 'Button',
      required: true,
      bindable: true,
      control: 'text',
    },
    variant: {
      type: 'string',
      displayName: 'Variant',
      defaultValue: 'primary',
      required: true,
      bindable: false,
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger'],
    },
    disabled: {
      type: 'boolean',
      displayName: 'Disabled',
      defaultValue: false,
      required: false,
      bindable: true,
      control: 'toggle',
    },
  },
  events: {
    onClick: {
      displayName: 'On click',
      description: 'Runs a compatible action when the button is activated.',
      payloadType: 'MouseEvent',
    },
  },
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

const inputManifest: ComponentManifest = {
  id: 'sutra.input',
  version: 1,
  displayName: 'Input',
  description: 'A labelled text input.',
  category: 'Inputs',
  icon: 'TextCursorInput',
  props: {
    label: {
      type: 'string',
      displayName: 'Label',
      defaultValue: 'Label',
      required: true,
      bindable: true,
      control: 'text',
    },
    placeholder: {
      type: 'string',
      displayName: 'Placeholder',
      defaultValue: 'Enter a value',
      required: false,
      bindable: true,
      control: 'text',
    },
    disabled: {
      type: 'boolean',
      displayName: 'Disabled',
      defaultValue: false,
      required: false,
      bindable: true,
      control: 'toggle',
    },
  },
  events: {
    onChange: {
      displayName: 'On change',
      payloadType: 'string',
    },
  },
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

function defaultNode(
  manifest: ComponentManifest,
  id: string,
  overrides: Parameters<typeof createElementNode>[3] = {},
): UiNode {
  const props = Object.fromEntries(
    Object.entries(manifest.props)
      .filter(([, spec]) => spec.defaultValue !== undefined)
      .map(([name, spec]) => [name, literal(spec.defaultValue ?? null)]),
  );
  return createElementNode(id, manifest.id, manifest.displayName, {
    props,
    slots: Object.fromEntries(Object.keys(manifest.slots).map((slot) => [slot, []])),
    ...overrides,
  });
}

const definitions: Array<{
  manifest: ComponentManifest;
  render: CoreComponentRenderer;
  createNode: (id: string) => UiNode;
}> = [
  {
    manifest: pageManifest,
    render: ({ children, style, className, editorAttributes }) => (
      <main className={className} style={style} {...editorAttributes}>
        {children}
      </main>
    ),
    createNode: (id) => defaultNode(pageManifest, id),
  },
  {
    manifest: containerManifest,
    render: ({ children, values, style, className, editorAttributes }) => (
      <div
        aria-label={displayString(values['ariaLabel']) || undefined}
        className={className}
        style={style}
        {...editorAttributes}
      >
        {children}
      </div>
    ),
    createNode: (id) =>
      defaultNode(containerManifest, id, {
        style: {
          base: {
            display: 'flex',
            flexDirection: 'column',
            width: { mode: 'percent', value: 100 },
            minHeight: 120,
            padding: { top: 24, right: 24, bottom: 24, left: 24 },
            gap: 16,
            backgroundColor: '#ffffff',
            borderColor: '#e5e7eb',
            borderWidth: 1,
            borderRadius: 12,
          },
        },
      }),
  },
  {
    manifest: stackManifest,
    render: ({ children, style, className, editorAttributes }) => (
      <div className={className} style={style} {...editorAttributes}>
        {children}
      </div>
    ),
    createNode: (id) =>
      defaultNode(stackManifest, id, {
        style: {
          base: {
            display: 'flex',
            flexDirection: 'column',
            width: { mode: 'percent', value: 100 },
            gap: 12,
          },
        },
      }),
  },
  {
    manifest: gridManifest,
    render: ({ children, values, style, className, editorAttributes }) => (
      <div
        className={className}
        style={{
          ...style,
          gridTemplateColumns: `repeat(${Number(values['columns'] ?? 2)}, minmax(0, 1fr))`,
        }}
        {...editorAttributes}
      >
        {children}
      </div>
    ),
    createNode: (id) =>
      defaultNode(gridManifest, id, {
        style: {
          base: {
            display: 'grid',
            width: { mode: 'percent', value: 100 },
            gap: 16,
          },
        },
      }),
  },
  {
    manifest: textManifest,
    render: ({ values, style, className, editorAttributes }) => (
      <p className={className} style={style} {...editorAttributes}>
        {displayString(values['text'])}
      </p>
    ),
    createNode: (id) =>
      defaultNode(textManifest, id, {
        style: { base: { color: '#374151', fontSize: 16 } },
      }),
  },
  {
    manifest: headingManifest,
    render: ({ values, style, className, editorAttributes }) => {
      const requestedLevel = Number(values['level'] ?? 2);
      const level = Math.max(1, Math.min(6, requestedLevel));
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag className={className} style={style} {...editorAttributes}>
          {displayString(values['text'])}
        </Tag>
      );
    },
    createNode: (id) =>
      defaultNode(headingManifest, id, {
        style: { base: { color: '#111827', fontSize: 36, fontWeight: 700 } },
      }),
  },
  {
    manifest: buttonManifest,
    render: ({ values, events, style, className, editorAttributes }) => (
      <button
        className={`${className} sutra-button sutra-button--${displayString(values['variant'], 'primary')}`}
        style={style}
        disabled={Boolean(values['disabled'])}
        onClick={events['onClick']}
        type="button"
        {...editorAttributes}
      >
        {displayString(values['label'], 'Button')}
      </button>
    ),
    createNode: (id) =>
      defaultNode(buttonManifest, id, {
        style: {
          base: {
            width: { mode: 'hug' },
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
          },
        },
      }),
  },
  {
    manifest: inputManifest,
    render: ({ values, events, style, className, editorAttributes }) => (
      <label className={`${className} sutra-field`} style={style} {...editorAttributes}>
        <span>{displayString(values['label'], 'Label')}</span>
        <input
          disabled={Boolean(values['disabled'])}
          placeholder={displayString(values['placeholder'])}
          onChange={(event) => events['onChange']?.(event.target.value)}
        />
      </label>
    ),
    createNode: (id) =>
      defaultNode(inputManifest, id, {
        style: {
          base: {
            display: 'flex',
            flexDirection: 'column',
            width: { mode: 'percent', value: 100 },
            gap: 6,
          },
        },
      }),
  },
];

export function createCoreComponentRegistry(): ComponentRegistry<CoreComponentRenderer> {
  const registry = new ComponentRegistry<CoreComponentRenderer>();
  definitions.forEach((definition) => {
    registry.register({
      manifest: definition.manifest,
      implementation: definition.render,
      createNode: definition.createNode,
    });
  });
  return registry;
}

export const coreComponentManifests = definitions.map((definition) => definition.manifest);
