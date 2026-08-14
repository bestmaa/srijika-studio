import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

import { ComponentRegistry, type ComponentManifest } from '@srijika/component-registry';
import { createElementNode, literal, type UiNode } from '@srijika/contracts';

export interface EditorDomAttributes {
  'data-srijika-node'?: string;
  'data-srijika-component'?: string;
  'data-srijika-selected'?: 'true' | 'false';
  'data-srijika-drop-target'?: 'true' | 'false';
  'data-srijika-empty-container'?: 'true' | 'false';
  tabIndex?: number;
  onClick?: MouseEventHandler<HTMLElement>;
}

export interface CoreRenderProps {
  nodeId: string;
  values: Readonly<Record<string, unknown>>;
  events: Readonly<Record<string, ((...args: unknown[]) => void) | undefined>>;
  style: CSSProperties;
  className: string;
  instanceAttributes: Readonly<Record<string, unknown>>;
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

/**
 * Validates an externally supplied style object before it reaches an Input sub-element.
 * Only own, primitive CSS values are retained; arrays, class instances, executable values,
 * unsafe prototype keys and non-finite numbers are ignored.
 */
export function srijikaInputPartStyle(value: unknown): CSSProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return {};

  return Object.fromEntries(
    Object.entries(value).filter(
      ([property, propertyValue]) =>
        property !== '__proto__' &&
        property !== 'prototype' &&
        property !== 'constructor' &&
        (typeof propertyValue === 'string' ||
          (typeof propertyValue === 'number' && Number.isFinite(propertyValue))),
    ),
  );
}

const CONTAINER_TAGS = [
  'div',
  'section',
  'header',
  'footer',
  'nav',
  'article',
  'aside',
  'form',
  'figure',
  'ul',
  'ol',
  'li',
  'label',
] as const;
type ContainerTag = (typeof CONTAINER_TAGS)[number];

function containerTag(value: unknown): ContainerTag {
  return typeof value === 'string' && (CONTAINER_TAGS as readonly string[]).includes(value)
    ? (value as ContainerTag)
    : 'div';
}

const commonEditor = {
  draggable: true,
  selectable: true,
  resizable: 'both' as const,
  dropStrategy: 'none' as const,
};

const pageManifest: ComponentManifest = {
  id: 'srijika.page',
  version: 1,
  displayName: 'Page',
  description: 'The root viewport of a Srijika UI document.',
  category: 'Structure',
  icon: 'PanelsTopLeft',
  props: {},
  events: {},
  slots: { children: { displayName: 'Content', accepts: '*', minChildren: 0 } },
  editor: { ...commonEditor, draggable: false, dropStrategy: 'flow' },
};

const containerManifest: ComponentManifest = {
  id: 'srijika.container',
  version: 1,
  displayName: 'Container',
  description: 'A flexible semantic HTML container.',
  category: 'Layout',
  icon: 'Square',
  props: {
    as: {
      type: 'string',
      displayName: 'Semantic element',
      defaultValue: 'div',
      required: true,
      bindable: false,
      control: 'select',
      options: [...CONTAINER_TAGS],
    },
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
  id: 'srijika.stack',
  displayName: 'Stack',
  description: 'A vertical flex layout with spacing.',
  icon: 'Rows3',
};

const gridManifest: ComponentManifest = {
  ...containerManifest,
  id: 'srijika.grid',
  displayName: 'Grid',
  description: 'A responsive CSS grid layout.',
  icon: 'Grid2X2',
  props: {
    ...containerManifest.props,
    columns: {
      type: 'number',
      displayName: 'Columns',
      defaultValue: 2,
      required: true,
      bindable: false,
      control: 'number',
    },
    columnsTemplate: {
      type: 'string',
      displayName: 'Column template',
      description: 'Optional CSS grid track template, for example “264px minmax(0, 1fr)”.',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
    rowsTemplate: {
      type: 'string',
      displayName: 'Row template',
      description: 'Optional CSS grid row template, for example “auto minmax(0, 1fr)”.',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
  },
  editor: { ...commonEditor, dropStrategy: 'grid' },
};

const textManifest: ComponentManifest = {
  id: 'srijika.text',
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
  id: 'srijika.heading',
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
  id: 'srijika.button',
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
      signature: { payload: null },
    },
  },
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

const inputManifest: ComponentManifest = {
  id: 'srijika.input',
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
    type: {
      type: 'string',
      displayName: 'Input type',
      defaultValue: 'text',
      required: true,
      bindable: false,
      control: 'select',
      options: [
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
      ],
    },
    name: {
      type: 'string',
      displayName: 'Field name',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
    defaultValue: {
      type: 'string',
      displayName: 'Default value',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
    autoComplete: {
      type: 'string',
      displayName: 'Autocomplete',
      defaultValue: 'off',
      required: false,
      bindable: true,
      control: 'text',
    },
    required: {
      type: 'boolean',
      displayName: 'Required',
      defaultValue: false,
      required: false,
      bindable: true,
      control: 'toggle',
    },
    disabled: {
      type: 'boolean',
      displayName: 'Disabled',
      defaultValue: false,
      required: false,
      bindable: true,
      control: 'toggle',
    },
    hideLabel: {
      type: 'boolean',
      displayName: 'Hide label',
      description: 'Hides the visual label while preserving it as the input accessible name.',
      defaultValue: false,
      required: false,
      bindable: true,
      control: 'toggle',
    },
    labelStyle: {
      type: 'object',
      displayName: 'Label style',
      description: 'Validated React style properties applied to the visible label text.',
      defaultValue: {},
      required: false,
      bindable: true,
      control: 'textarea',
    },
    controlStyle: {
      type: 'object',
      displayName: 'Control style',
      description: 'Validated React style properties applied to the native input control.',
      defaultValue: {},
      required: false,
      bindable: true,
      control: 'textarea',
    },
  },
  events: {
    onChange: {
      displayName: 'On change',
      signature: { payload: { name: 'value', shape: { kind: 'string' } } },
    },
  },
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

const imageManifest: ComponentManifest = {
  id: 'srijika.image',
  version: 1,
  displayName: 'Image',
  description: 'A responsive image with typed source, alternative text and fit controls.',
  category: 'Media',
  icon: 'Image',
  props: {
    src: {
      type: 'string',
      displayName: 'Source URL',
      defaultValue: '',
      required: true,
      bindable: true,
      control: 'text',
    },
    alt: {
      type: 'string',
      displayName: 'Alternative text',
      defaultValue: '',
      required: true,
      bindable: true,
      control: 'text',
    },
    fit: {
      type: 'string',
      displayName: 'Object fit',
      defaultValue: 'cover',
      required: true,
      bindable: false,
      control: 'select',
      options: ['cover', 'contain', 'fill', 'none', 'scale-down'],
    },
    loading: {
      type: 'string',
      displayName: 'Loading',
      defaultValue: 'lazy',
      required: true,
      bindable: false,
      control: 'select',
      options: ['lazy', 'eager'],
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, dropStrategy: 'none' },
};

const ICON_NAMES = [
  'activity',
  'bell',
  'briefcase',
  'chart',
  'check-circle',
  'chevron-down',
  'chevron-right',
  'clock',
  'cube',
  'file',
  'folder',
  'hexagon',
  'home',
  'layout-dashboard',
  'menu',
  'plus',
  'search',
  'settings',
  'star',
  'upload',
  'user',
  'users',
] as const;

type IconName = (typeof ICON_NAMES)[number];

const iconManifest: ComponentManifest = {
  id: 'srijika.icon',
  version: 1,
  displayName: 'Icon',
  description: 'A deterministic inline SVG icon that inherits the current text color.',
  category: 'Media',
  icon: 'Shapes',
  props: {
    name: {
      type: 'string',
      displayName: 'Icon',
      defaultValue: 'home',
      required: true,
      bindable: false,
      control: 'select',
      options: ICON_NAMES,
    },
    label: {
      type: 'string',
      displayName: 'Accessible label',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
    size: {
      type: 'number',
      displayName: 'Size',
      defaultValue: 24,
      required: true,
      bindable: true,
      control: 'number',
    },
    strokeWidth: {
      type: 'number',
      displayName: 'Stroke width',
      defaultValue: 2,
      required: true,
      bindable: true,
      control: 'number',
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'both', dropStrategy: 'none' },
};

const dividerManifest: ComponentManifest = {
  id: 'srijika.divider',
  version: 1,
  displayName: 'Divider',
  description: 'A horizontal or vertical semantic separator.',
  category: 'Layout',
  icon: 'Minus',
  props: {
    orientation: {
      type: 'string',
      displayName: 'Orientation',
      defaultValue: 'horizontal',
      required: true,
      bindable: false,
      control: 'select',
      options: ['horizontal', 'vertical'],
    },
    color: {
      type: 'color',
      displayName: 'Color',
      defaultValue: '#d1d5db',
      required: true,
      bindable: true,
      control: 'color',
    },
    thickness: {
      type: 'number',
      displayName: 'Thickness',
      defaultValue: 1,
      required: true,
      bindable: true,
      control: 'number',
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'both', dropStrategy: 'none' },
};

const progressManifest: ComponentManifest = {
  id: 'srijika.progress',
  version: 1,
  displayName: 'Progress',
  description: 'An accessible determinate progress bar with configurable track and fill.',
  category: 'Inputs',
  icon: 'Gauge',
  props: {
    value: {
      type: 'number',
      displayName: 'Value',
      defaultValue: 65,
      required: true,
      bindable: true,
      control: 'number',
    },
    max: {
      type: 'number',
      displayName: 'Maximum',
      defaultValue: 100,
      required: true,
      bindable: true,
      control: 'number',
    },
    label: {
      type: 'string',
      displayName: 'Accessible label',
      defaultValue: 'Progress',
      required: true,
      bindable: true,
      control: 'text',
    },
    fillColor: {
      type: 'color',
      displayName: 'Fill color',
      defaultValue: '#6d5dfc',
      required: true,
      bindable: true,
      control: 'color',
    },
    trackColor: {
      type: 'color',
      displayName: 'Track color',
      defaultValue: '#2a303b',
      required: true,
      bindable: true,
      control: 'color',
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

const badgeManifest: ComponentManifest = {
  id: 'srijika.badge',
  version: 1,
  displayName: 'Badge',
  description: 'A compact status or category label with deterministic semantic tones.',
  category: 'Typography',
  icon: 'Badge',
  props: {
    label: {
      type: 'string',
      displayName: 'Label',
      defaultValue: 'Badge',
      required: true,
      bindable: true,
      control: 'text',
    },
    tone: {
      type: 'string',
      displayName: 'Tone',
      defaultValue: 'neutral',
      required: true,
      bindable: true,
      control: 'select',
      options: ['neutral', 'primary', 'info', 'success', 'warning', 'danger'],
    },
    dot: {
      type: 'boolean',
      displayName: 'Show dot',
      defaultValue: false,
      required: false,
      bindable: true,
      control: 'toggle',
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'horizontal', dropStrategy: 'none' },
};

const avatarManifest: ComponentManifest = {
  id: 'srijika.avatar',
  version: 1,
  displayName: 'Avatar',
  description: 'A circular user image or initials fallback with an optional status indicator.',
  category: 'Media',
  icon: 'CircleUserRound',
  props: {
    src: {
      type: 'string',
      displayName: 'Source URL',
      defaultValue: '',
      required: false,
      bindable: true,
      control: 'text',
    },
    alt: {
      type: 'string',
      displayName: 'Alternative text',
      defaultValue: 'Avatar',
      required: true,
      bindable: true,
      control: 'text',
    },
    fallback: {
      type: 'string',
      displayName: 'Fallback initials',
      defaultValue: 'A',
      required: true,
      bindable: true,
      control: 'text',
    },
    size: {
      type: 'number',
      displayName: 'Size',
      defaultValue: 40,
      required: true,
      bindable: true,
      control: 'number',
    },
    status: {
      type: 'string',
      displayName: 'Status',
      defaultValue: 'none',
      required: true,
      bindable: true,
      control: 'select',
      options: ['none', 'online', 'away', 'busy', 'offline'],
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'both', dropStrategy: 'none' },
};

const chartManifest: ComponentManifest = {
  id: 'srijika.chart',
  version: 1,
  displayName: 'Chart',
  description: 'A lightweight SVG line, bar or donut chart driven by literal or bound data.',
  category: 'Media',
  icon: 'ChartNoAxesCombined',
  props: {
    chartType: {
      type: 'string',
      displayName: 'Chart type',
      defaultValue: 'line',
      required: true,
      bindable: false,
      control: 'select',
      options: ['line', 'bar', 'donut'],
    },
    curve: {
      type: 'string',
      displayName: 'Line curve',
      defaultValue: 'linear',
      required: true,
      bindable: false,
      control: 'select',
      options: ['linear', 'smooth'],
    },
    data: {
      type: 'array',
      displayName: 'Data',
      description: 'Numbers for one series, or nested number arrays for multiple line series.',
      defaultValue: [24, 42, 35, 68, 32, 49, 45],
      required: true,
      bindable: true,
      control: 'textarea',
    },
    colors: {
      type: 'array',
      displayName: 'Series colors',
      defaultValue: ['#6d5dfc', '#18b8d6', '#e14283'],
      required: true,
      bindable: true,
      control: 'textarea',
    },
    label: {
      type: 'string',
      displayName: 'Accessible label',
      defaultValue: 'Data chart',
      required: true,
      bindable: true,
      control: 'text',
    },
    showGrid: {
      type: 'boolean',
      displayName: 'Show grid',
      defaultValue: true,
      required: false,
      bindable: true,
      control: 'toggle',
    },
    strokeWidth: {
      type: 'number',
      displayName: 'Stroke width',
      defaultValue: 3,
      required: true,
      bindable: true,
      control: 'number',
    },
    innerRadius: {
      type: 'number',
      displayName: 'Donut inner radius',
      defaultValue: 58,
      required: true,
      bindable: true,
      control: 'number',
    },
  },
  events: {},
  slots: {},
  editor: { ...commonEditor, resizable: 'both', dropStrategy: 'none' },
};

const INPUT_TYPES = [
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
] as const;

function inputType(value: unknown): (typeof INPUT_TYPES)[number] {
  return typeof value === 'string' && (INPUT_TYPES as readonly string[]).includes(value)
    ? (value as (typeof INPUT_TYPES)[number])
    : 'text';
}

function imageFit(value: unknown): CSSProperties['objectFit'] {
  return typeof value === 'string' &&
    ['cover', 'contain', 'fill', 'none', 'scale-down'].includes(value)
    ? (value as CSSProperties['objectFit'])
    : 'cover';
}

const ICON_PATHS: Readonly<Record<IconName, readonly string[]>> = {
  activity: ['M3 12h4l2.5-7 5 14 2.5-7H21'],
  bell: ['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M10 21h4'],
  briefcase: ['M9 7V4h6v3', 'M3 7h18v13H3z', 'M3 12h18', 'M10 12v2h4v-2'],
  chart: ['M4 19V9', 'M10 19V5', 'M16 19v-7', 'M22 19H2'],
  'check-circle': ['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'M22 4 12 14.01l-3-3'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 6v6l4 2'],
  cube: ['m12 2 9 5-9 5-9-5z', 'm3 7 9 5 9-5', 'M12 12v10', 'm3 7v10l9 5 9-5V7'],
  file: ['M6 2h8l4 4v16H6z', 'M14 2v5h5'],
  folder: ['M3 5h7l2 2h9v12H3z'],
  hexagon: ['m12 2 9 5v10l-9 5-9-5V7z'],
  home: ['m3 11 9-8 9 8', 'M5 10v11h14V10', 'M9 21v-7h6v7'],
  'layout-dashboard': ['M3 3h7v7H3z', 'M14 3h7v4h-7z', 'M14 11h7v10h-7z', 'M3 14h7v7H3z'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16', 'm21 21-4.35-4.35'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    'M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 3.67-.08-.02a1.7 1.7 0 0 0-1.8-.45l-.82.47a1.7 1.7 0 0 0-.82 1.75V22H9.84v-.1a1.7 1.7 0 0 0-.82-1.75l-.82-.47a1.7 1.7 0 0 0-1.8.45l-.08.02L4.2 16.48l.06-.06A1.7 1.7 0 0 0 4.6 15v-.94a1.7 1.7 0 0 0-.34-1.02l-.06-.06 2.12-3.67.08.02a1.7 1.7 0 0 0 1.8.45l.82-.47a1.7 1.7 0 0 0 .82-1.75V7.5h4.32v.06a1.7 1.7 0 0 0 .82 1.75l.82.47a1.7 1.7 0 0 0 1.8-.45l.08-.02 2.12 3.67-.06.06a1.7 1.7 0 0 0-.34 1.02z',
  ],
  star: ['m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1z'],
  upload: ['M12 16V4', 'm7 9 5-5 5 5', 'M5 20h14'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M4 21a8 8 0 0 1 16 0'],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
};

const BADGE_TONES: Readonly<
  Record<string, { backgroundColor: string; borderColor: string; color: string }>
> = {
  neutral: { backgroundColor: '#252c36', borderColor: '#353e49', color: '#c7cdd6' },
  primary: { backgroundColor: '#2a214f', borderColor: '#5844b8', color: '#a996ff' },
  info: { backgroundColor: '#102f3a', borderColor: '#13758b', color: '#37c8e5' },
  success: { backgroundColor: '#102f26', borderColor: '#17643f', color: '#4add8d' },
  warning: { backgroundColor: '#362a0e', borderColor: '#805a00', color: '#ffc64d' },
  danger: { backgroundColor: '#3b1820', borderColor: '#873040', color: '#ff7285' },
};

const STATUS_COLORS: Readonly<Record<string, string>> = {
  online: '#2bd67b',
  away: '#f3b83f',
  busy: '#ef5364',
  offline: '#7c8490',
};

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function definedStyle(style: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined));
}

function requestedIcon(value: unknown): IconName {
  return typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value)
    ? (value as IconName)
    : 'home';
}

function chartSeries(value: unknown): number[][] {
  if (!Array.isArray(value)) return [[]];
  if (value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return [[...(value as number[])]];
  }
  const nested = value.flatMap((entry) => {
    if (!Array.isArray(entry)) return [];
    const numbers = entry.filter(
      (item): item is number => typeof item === 'number' && Number.isFinite(item),
    );
    return numbers.length > 0 ? [numbers] : [];
  });
  if (nested.length > 0) return nested;
  const objectValues = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = (entry as Record<string, unknown>)['value'];
    return typeof candidate === 'number' && Number.isFinite(candidate) ? [candidate] : [];
  });
  return [objectValues];
}

function chartColors(value: unknown): string[] {
  if (!Array.isArray(value)) return ['#6d5dfc', '#18b8d6', '#e14283'];
  const colors = value.filter(
    (entry): entry is string => typeof entry === 'string' && entry !== '',
  );
  return colors.length > 0 ? colors : ['#6d5dfc', '#18b8d6', '#e14283'];
}

interface ChartPoint {
  x: number;
  y: number;
}

function lineCoordinates(values: readonly number[]): ChartPoint[] {
  if (values.length === 0) return [];
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(1, ...values);
  const range = Math.max(1, maximum - minimum);
  return values.map((value, index) => {
    const x = values.length === 1 ? 200 : 18 + (index / (values.length - 1)) * 364;
    const y = 204 - ((value - minimum) / range) * 188;
    return { x, y };
  });
}

function linePoints(values: readonly number[]): string {
  return lineCoordinates(values)
    .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
}

function smoothLinePath(values: readonly number[]): string {
  const points = lineCoordinates(values);
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;

  const commands = [`M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const following = points[index + 2] ?? next;
    const control1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const control2 = {
      x: next.x - (following.x - current.x) / 6,
      y: next.y - (following.y - current.y) / 6,
    };
    commands.push(
      `C ${control1.x.toFixed(2)} ${control1.y.toFixed(2)}, ${control2.x.toFixed(2)} ${control2.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
    );
  }
  return commands.join(' ');
}

function chartGraphic(
  type: string,
  series: readonly (readonly number[])[],
  colors: readonly string[],
  showGrid: boolean,
  strokeWidth: number,
  innerRadius: number,
  curve: string,
): ReactNode {
  const grid = showGrid
    ? [40, 80, 120, 160, 200].map((y) => (
        <line
          key={y}
          x1="12"
          x2="388"
          y1={y}
          y2={y}
          stroke="currentColor"
          strokeDasharray="3 5"
          strokeOpacity="0.16"
          vectorEffect="non-scaling-stroke"
        />
      ))
    : null;

  if (type === 'donut') {
    const values = (series[0] ?? []).map((value) => Math.max(0, value));
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const safeInnerRadius = Math.max(0, Math.min(94, innerRadius));
    const donutStroke = Math.max(2, 98 - safeInnerRadius);
    const radius = safeInnerRadius + donutStroke / 2;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return (
      <svg aria-hidden="true" height="100%" viewBox="0 0 220 220" width="100%">
        <circle
          cx="110"
          cy="110"
          fill="none"
          r={radius}
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth={donutStroke}
        />
        {values.map((value, index) => {
          const length = (value / total) * circumference;
          const dashOffset = -offset;
          offset += length;
          return (
            <circle
              key={index}
              cx="110"
              cy="110"
              fill="none"
              r={radius}
              stroke={colors[index % colors.length]}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={dashOffset}
              strokeWidth={donutStroke}
              transform="rotate(-90 110 110)"
            />
          );
        })}
      </svg>
    );
  }

  if (type === 'bar') {
    const values = series[0] ?? [];
    const maximum = Math.max(1, ...values.map((value) => Math.max(0, value)));
    const gap = 8;
    const availableWidth = 364;
    const width = Math.max(
      2,
      (availableWidth - gap * Math.max(0, values.length - 1)) / Math.max(1, values.length),
    );
    return (
      <svg
        aria-hidden="true"
        height="100%"
        preserveAspectRatio="none"
        viewBox="0 0 400 220"
        width="100%"
      >
        {grid}
        {values.map((value, index) => {
          const height = (Math.max(0, value) / maximum) * 184;
          return (
            <rect
              key={index}
              fill={colors[index % colors.length]}
              height={height}
              rx="3"
              width={width}
              x={18 + index * (width + gap)}
              y={204 - height}
            />
          );
        })}
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      height="100%"
      preserveAspectRatio="none"
      viewBox="0 0 400 220"
      width="100%"
    >
      {grid}
      {series.map((values, index) =>
        curve === 'smooth' ? (
          <path
            key={index}
            d={smoothLinePath(values)}
            fill="none"
            stroke={colors[index % colors.length]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <polyline
            key={index}
            fill="none"
            points={linePoints(values)}
            stroke={colors[index % colors.length]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  );
}

interface OpenVisualProps {
  [key: string]: unknown;
  className?: string;
  style?: CSSProperties;
}

export interface SrijikaIconProps extends OpenVisualProps {
  name?: unknown;
  label?: unknown;
  size?: unknown;
  strokeWidth?: unknown;
}

export function SrijikaIcon({
  name,
  label,
  size,
  strokeWidth,
  className = '',
  style = {},
  ...domProps
}: SrijikaIconProps): ReactNode {
  const resolvedName = requestedIcon(name);
  const resolvedLabel = displayString(label);
  const resolvedSize = positiveNumber(size, 24);
  return (
    <span
      aria-label={resolvedLabel || undefined}
      aria-hidden={resolvedLabel ? undefined : true}
      className={className}
      role={resolvedLabel ? 'img' : undefined}
      style={{
        display: 'inline-flex',
        width: resolvedSize,
        height: resolvedSize,
        alignItems: 'center',
        justifyContent: 'center',
        ...definedStyle(style),
      }}
      {...domProps}
    >
      <svg
        aria-hidden="true"
        fill="none"
        height="100%"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={positiveNumber(strokeWidth, 2)}
        viewBox="0 0 24 24"
        width="100%"
      >
        {ICON_PATHS[resolvedName].map((path, index) => (
          <path key={index} d={path} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </span>
  );
}

export interface SrijikaDividerProps extends OpenVisualProps {
  orientation?: unknown;
  color?: unknown;
  thickness?: unknown;
}

export function SrijikaDivider({
  orientation,
  color,
  thickness,
  className = '',
  style = {},
  ...domProps
}: SrijikaDividerProps): ReactNode {
  const vertical = orientation === 'vertical';
  const resolvedThickness = positiveNumber(thickness, 1);
  return (
    <div
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={className}
      role="separator"
      style={{
        flexShrink: 0,
        width: vertical ? resolvedThickness : '100%',
        height: vertical ? '100%' : resolvedThickness,
        backgroundColor: displayString(color, '#d1d5db'),
        ...definedStyle(style),
      }}
      {...domProps}
    />
  );
}

export interface SrijikaProgressProps extends OpenVisualProps {
  value?: unknown;
  max?: unknown;
  label?: unknown;
  fillColor?: unknown;
  trackColor?: unknown;
}

export function SrijikaProgress({
  value,
  max,
  label,
  fillColor,
  trackColor,
  className = '',
  style = {},
  ...domProps
}: SrijikaProgressProps): ReactNode {
  const resolvedMax = Math.max(0.000001, positiveNumber(max, 100));
  const resolvedValue = Math.max(0, Math.min(resolvedMax, finiteNumber(value, 0)));
  const percentage = (resolvedValue / resolvedMax) * 100;
  return (
    <div
      aria-label={displayString(label, 'Progress')}
      aria-valuemax={resolvedMax}
      aria-valuemin={0}
      aria-valuenow={resolvedValue}
      className={className}
      role="progressbar"
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: displayString(trackColor, '#2a303b'),
        ...definedStyle(style),
      }}
      {...domProps}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          width: `${percentage}%`,
          height: '100%',
          borderRadius: 'inherit',
          backgroundColor: displayString(fillColor, '#6d5dfc'),
          transition: 'width 160ms ease',
        }}
      />
    </div>
  );
}

export interface SrijikaBadgeProps extends OpenVisualProps {
  label?: unknown;
  tone?: unknown;
  dot?: unknown;
}

export function SrijikaBadge({
  label,
  tone,
  dot,
  className = '',
  style = {},
  ...domProps
}: SrijikaBadgeProps): ReactNode {
  const palette = BADGE_TONES[displayString(tone, 'neutral')] ?? BADGE_TONES['neutral']!;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        width: 'fit-content',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderWidth: 1,
        borderStyle: 'solid',
        ...palette,
        ...definedStyle(style),
      }}
      {...domProps}
    >
      {Boolean(dot) && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: 'currentColor' }}
        />
      )}
      {displayString(label, 'Badge')}
    </span>
  );
}

export interface SrijikaAvatarProps extends OpenVisualProps {
  src?: unknown;
  alt?: unknown;
  fallback?: unknown;
  size?: unknown;
  status?: unknown;
}

export function SrijikaAvatar({
  src,
  alt,
  fallback,
  size,
  status,
  className = '',
  style = {},
  ...domProps
}: SrijikaAvatarProps): ReactNode {
  const resolvedSize = positiveNumber(size, 40);
  const source = displayString(src);
  const statusColor = STATUS_COLORS[displayString(status, 'none')];
  return (
    <span
      aria-label={displayString(alt, 'Avatar')}
      className={className}
      role="img"
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: resolvedSize,
        height: resolvedSize,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        borderRadius: 999,
        backgroundColor: '#2a303b',
        color: '#f7f8fa',
        ...definedStyle(style),
      }}
      {...domProps}
    >
      <span aria-hidden="true">{displayString(fallback, 'A')}</span>
      {source && (
        <img
          alt=""
          aria-hidden="true"
          src={source}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            borderRadius: 'inherit',
            objectFit: 'cover',
          }}
        />
      )}
      {statusColor && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(8, resolvedSize * 0.26),
            height: Math.max(8, resolvedSize * 0.26),
            border: '2px solid #111820',
            borderRadius: 999,
            backgroundColor: statusColor,
          }}
        />
      )}
    </span>
  );
}

export interface SrijikaChartProps extends OpenVisualProps {
  chartType?: unknown;
  curve?: unknown;
  data?: unknown;
  colors?: unknown;
  label?: unknown;
  showGrid?: unknown;
  strokeWidth?: unknown;
  innerRadius?: unknown;
}

export function SrijikaChart({
  chartType,
  curve,
  data,
  colors,
  label,
  showGrid,
  strokeWidth,
  innerRadius,
  className = '',
  style = {},
  ...domProps
}: SrijikaChartProps): ReactNode {
  return (
    <div
      aria-label={displayString(label, 'Data chart')}
      className={className}
      role="img"
      style={{ color: '#7b8491', ...definedStyle(style) }}
      {...domProps}
    >
      {chartGraphic(
        displayString(chartType, 'line'),
        chartSeries(data),
        chartColors(colors),
        Boolean(showGrid),
        positiveNumber(strokeWidth, 3),
        positiveNumber(innerRadius, 58),
        displayString(curve, 'linear'),
      )}
    </div>
  );
}

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
    render: ({ children, style, className, instanceAttributes, editorAttributes }) => (
      <main className={className} style={style} {...instanceAttributes} {...editorAttributes}>
        {children}
      </main>
    ),
    createNode: (id) => defaultNode(pageManifest, id),
  },
  {
    manifest: containerManifest,
    render: ({ children, values, style, className, instanceAttributes, editorAttributes }) => {
      const Tag = containerTag(values['as']);
      return (
        <Tag
          aria-label={displayString(values['ariaLabel']) || undefined}
          className={className}
          style={style}
          {...instanceAttributes}
          {...editorAttributes}
        >
          {children}
        </Tag>
      );
    },
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
    render: ({ children, style, className, instanceAttributes, editorAttributes }) => (
      <div className={className} style={style} {...instanceAttributes} {...editorAttributes}>
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
    render: ({ children, values, style, className, instanceAttributes, editorAttributes }) => {
      const columnsTemplate = displayString(values['columnsTemplate']).trim();
      const rowsTemplate = displayString(values['rowsTemplate']).trim();
      const columns = Math.max(1, Math.floor(Number(values['columns'] ?? 2) || 2));
      return (
        <div
          aria-label={displayString(values['ariaLabel']) || undefined}
          className={className}
          style={{
            ...definedStyle(style),
            gridTemplateColumns:
              style.gridTemplateColumns || columnsTemplate || `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: style.gridTemplateRows || rowsTemplate,
          }}
          {...instanceAttributes}
          {...editorAttributes}
        >
          {children}
        </div>
      );
    },
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
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <p
        className={className}
        style={{ margin: 0, ...definedStyle(style) }}
        {...instanceAttributes}
        {...editorAttributes}
      >
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
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => {
      const requestedLevel = Number(values['level'] ?? 2);
      const level = Math.max(1, Math.min(6, requestedLevel));
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag
          className={className}
          style={{ margin: 0, ...definedStyle(style) }}
          {...instanceAttributes}
          {...editorAttributes}
        >
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
    render: ({ values, events, style, className, instanceAttributes, editorAttributes }) => (
      <button
        className={`${className} srijika-button srijika-button--${displayString(values['variant'], 'primary')}`}
        style={style}
        disabled={Boolean(values['disabled'])}
        onClick={() => events['onClick']?.()}
        type="button"
        {...instanceAttributes}
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
    render: ({ values, events, style, className, instanceAttributes, editorAttributes }) => {
      const label = displayString(values['label'], 'Label');
      const hideLabel = Boolean(values['hideLabel']);
      return (
        <label className={`${className} srijika-field`} style={style} {...editorAttributes}>
          {!hideLabel && <span style={srijikaInputPartStyle(values['labelStyle'])}>{label}</span>}
          <input
            aria-label={hideLabel ? label || undefined : undefined}
            autoComplete={displayString(values['autoComplete'], 'off')}
            defaultValue={displayString(values['defaultValue'])}
            disabled={Boolean(values['disabled'])}
            name={displayString(values['name']) || undefined}
            placeholder={displayString(values['placeholder'])}
            required={Boolean(values['required'])}
            style={srijikaInputPartStyle(values['controlStyle'])}
            type={inputType(values['type'])}
            onChange={(event) => events['onChange']?.(event.currentTarget.value)}
            {...instanceAttributes}
          />
        </label>
      );
    },
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
  {
    manifest: imageManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <img
        alt={displayString(values['alt'])}
        className={className}
        loading={values['loading'] === 'eager' ? 'eager' : 'lazy'}
        src={displayString(values['src'])}
        style={{ ...style, objectFit: imageFit(values['fit']) }}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) =>
      defaultNode(imageManifest, id, {
        style: {
          base: {
            display: 'block',
            width: { mode: 'percent', value: 100 },
            height: { mode: 'fixed', value: 180, unit: 'px' },
            borderRadius: 12,
            backgroundColor: '#e5e7eb',
          },
        },
      }),
  },
  {
    manifest: iconManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <SrijikaIcon
        className={className}
        label={values['label']}
        name={values['name']}
        size={values['size']}
        strokeWidth={values['strokeWidth']}
        style={style}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) =>
      defaultNode(iconManifest, id, {
        style: { base: { color: '#6d5dfc' } },
      }),
  },
  {
    manifest: dividerManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <SrijikaDivider
        className={className}
        color={values['color']}
        orientation={values['orientation']}
        style={style}
        thickness={values['thickness']}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) => defaultNode(dividerManifest, id),
  },
  {
    manifest: progressManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <SrijikaProgress
        className={className}
        fillColor={values['fillColor']}
        label={values['label']}
        max={values['max']}
        style={style}
        trackColor={values['trackColor']}
        value={values['value']}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) =>
      defaultNode(progressManifest, id, {
        style: {
          base: {
            width: { mode: 'percent', value: 100 },
            height: { mode: 'fixed', value: 8, unit: 'px' },
            borderRadius: 999,
          },
        },
      }),
  },
  {
    manifest: badgeManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <SrijikaBadge
        className={className}
        dot={values['dot']}
        label={values['label']}
        style={style}
        tone={values['tone']}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) =>
      defaultNode(badgeManifest, id, {
        style: {
          base: {
            padding: { top: 5, right: 10, bottom: 5, left: 10 },
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1,
          },
        },
      }),
  },
  {
    manifest: avatarManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <SrijikaAvatar
        alt={values['alt']}
        className={className}
        fallback={values['fallback']}
        size={values['size']}
        src={values['src']}
        status={values['status']}
        style={style}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) =>
      defaultNode(avatarManifest, id, {
        style: { base: { fontSize: 14, fontWeight: 700 } },
      }),
  },
  {
    manifest: chartManifest,
    render: ({ values, style, className, instanceAttributes, editorAttributes }) => (
      <SrijikaChart
        chartType={values['chartType']}
        className={className}
        colors={values['colors']}
        curve={values['curve']}
        data={values['data']}
        innerRadius={values['innerRadius']}
        label={values['label']}
        showGrid={values['showGrid']}
        strokeWidth={values['strokeWidth']}
        style={style}
        {...instanceAttributes}
        {...editorAttributes}
      />
    ),
    createNode: (id) =>
      defaultNode(chartManifest, id, {
        style: {
          base: {
            display: 'block',
            width: { mode: 'percent', value: 100 },
            height: { mode: 'fixed', value: 220, unit: 'px' },
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
