import { NORMALIZED_INSTANCE_EVENT_PORTS, type ValueType } from '@srijika/contracts';

export interface SrijikaIntrinsicAttributeSpec {
  name: string;
  type: Exclude<ValueType, 'event' | 'array'>;
  description: string;
  tags?: readonly string[];
}

export interface SrijikaIntrinsicEventSpec {
  name: string;
  displayName: string;
  description: string;
}

export const SRIJIKA_INTRINSIC_ATTRIBUTES: readonly SrijikaIntrinsicAttributeSpec[] = [
  { name: 'className', type: 'string', description: 'CSS class names.' },
  { name: 'id', type: 'string', description: 'Unique element ID.' },
  { name: 'title', type: 'string', description: 'Advisory tooltip text.' },
  { name: 'role', type: 'string', description: 'ARIA role.' },
  { name: 'aria-label', type: 'string', description: 'Accessible name.' },
  { name: 'tabIndex', type: 'number', description: 'Keyboard tab order.' },
  { name: 'hidden', type: 'boolean', description: 'Hide this element.' },
  { name: 'draggable', type: 'boolean', description: 'Enable browser dragging.' },
  { name: 'spellCheck', type: 'boolean', description: 'Enable spell checking.' },
  { name: 'contentEditable', type: 'boolean', description: 'Allow editable content.' },
  { name: 'lang', type: 'string', description: 'Content language.' },
  { name: 'dir', type: 'string', description: 'Text direction.' },
  { name: 'translate', type: 'string', description: 'Translation hint.' },
  { name: 'src', type: 'string', description: 'Image source URL.', tags: ['img'] },
  { name: 'alt', type: 'string', description: 'Image alternative text.', tags: ['img'] },
  { name: 'loading', type: 'string', description: 'Image loading strategy.', tags: ['img'] },
  { name: 'fit', type: 'string', description: 'Srijika image fit mode.', tags: ['img'] },
  { name: 'width', type: 'number', description: 'Intrinsic image width.', tags: ['img'] },
  { name: 'height', type: 'number', description: 'Intrinsic image height.', tags: ['img'] },
  { name: 'decoding', type: 'string', description: 'Image decoding hint.', tags: ['img'] },
  { name: 'crossOrigin', type: 'string', description: 'Image CORS mode.', tags: ['img'] },
  {
    name: 'referrerPolicy',
    type: 'string',
    description: 'Image referrer policy.',
    tags: ['img'],
  },
  {
    name: 'disabled',
    type: 'boolean',
    description: 'Disable interaction.',
    tags: ['button', 'input'],
  },
  { name: 'variant', type: 'string', description: 'Srijika button variant.', tags: ['button'] },
  { name: 'type', type: 'string', description: 'Control type.', tags: ['button', 'input'] },
  { name: 'name', type: 'string', description: 'Form control name.', tags: ['button', 'input'] },
  { name: 'value', type: 'string', description: 'Form control value.', tags: ['button', 'input'] },
  { name: 'placeholder', type: 'string', description: 'Input placeholder.', tags: ['input'] },
  { name: 'defaultValue', type: 'string', description: 'Initial input value.', tags: ['input'] },
  {
    name: 'autoComplete',
    type: 'string',
    description: 'Browser autocomplete hint.',
    tags: ['input'],
  },
  { name: 'required', type: 'boolean', description: 'Require a value.', tags: ['input'] },
] as const;

export const SRIJIKA_INTRINSIC_EVENTS: readonly SrijikaIntrinsicEventSpec[] =
  NORMALIZED_INSTANCE_EVENT_PORTS.map((port) => ({
    name: port.eventName,
    displayName: port.displayName,
    description:
      port.signature.payload === null
        ? `${port.displayName} callback with no native event payload.`
        : `${port.displayName} callback with a normalized ${port.signature.payload.name} payload.`,
  }));

export function srijikaIntrinsicAttribute(
  tag: string,
  name: string,
): SrijikaIntrinsicAttributeSpec | undefined {
  return SRIJIKA_INTRINSIC_ATTRIBUTES.find(
    (attribute) => attribute.name === name && (!attribute.tags || attribute.tags.includes(tag)),
  );
}
