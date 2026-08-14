import type { EventSignature, InstanceEventSpec, NormalizedEventSource } from './schemas';

const noPayload = (): EventSignature => ({ payload: null });

const stringPayload = (): EventSignature => ({
  payload: { name: 'value', shape: { kind: 'string' } },
});

const keyPayload = (): EventSignature => ({
  payload: {
    name: 'keyEvent',
    shape: {
      kind: 'object',
      fields: {
        key: { required: true, shape: { kind: 'string' } },
        code: { required: true, shape: { kind: 'string' } },
        altKey: { required: true, shape: { kind: 'boolean' } },
        ctrlKey: { required: true, shape: { kind: 'boolean' } },
        metaKey: { required: true, shape: { kind: 'boolean' } },
        shiftKey: { required: true, shape: { kind: 'boolean' } },
        repeat: { required: true, shape: { kind: 'boolean' } },
      },
      additionalProperties: false,
    },
  },
});

export interface NormalizedInstanceEventPort {
  eventName: string;
  displayName: string;
  source: NormalizedEventSource;
  signature: EventSignature;
}

/**
 * Approved instance-addable React event ports. The signatures contain only
 * serializable normalized values and never expose a native SyntheticEvent.
 */
export const NORMALIZED_INSTANCE_EVENT_PORTS = [
  { eventName: 'onClick', displayName: 'Click', source: 'click', signature: noPayload() },
  {
    eventName: 'onDoubleClick',
    displayName: 'Double click',
    source: 'doubleClick',
    signature: noPayload(),
  },
  {
    eventName: 'onMouseEnter',
    displayName: 'Mouse enter',
    source: 'mouseEnter',
    signature: noPayload(),
  },
  {
    eventName: 'onMouseLeave',
    displayName: 'Mouse leave',
    source: 'mouseLeave',
    signature: noPayload(),
  },
  { eventName: 'onFocus', displayName: 'Focus', source: 'focus', signature: noPayload() },
  { eventName: 'onBlur', displayName: 'Blur', source: 'blur', signature: noPayload() },
  {
    eventName: 'onKeyDown',
    displayName: 'Key down',
    source: 'keyDown',
    signature: keyPayload(),
  },
  {
    eventName: 'onChange',
    displayName: 'Value change',
    source: 'valueChange',
    signature: stringPayload(),
  },
  {
    eventName: 'onInput',
    displayName: 'Value input',
    source: 'valueInput',
    signature: stringPayload(),
  },
  { eventName: 'onSubmit', displayName: 'Submit', source: 'submit', signature: noPayload() },
] as const satisfies readonly NormalizedInstanceEventPort[];

const portsByName = new Map<string, NormalizedInstanceEventPort>(
  NORMALIZED_INSTANCE_EVENT_PORTS.map((port) => [port.eventName, port] as const),
);

const reservedInstancePropNames = new Set([
  'children',
  'style',
  'className',
  'key',
  'ref',
  'dangerouslySetInnerHTML',
  '__proto__',
  'prototype',
  'constructor',
]);

const instancePropNamePattern = /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|(?:aria|data)-[a-z][a-z0-9_.:-]*)$/;

export function instancePropNameError(name: string): string | null {
  if (name.length === 0) return 'Instance prop name is required';
  if (name.length > 128 || !instancePropNamePattern.test(name)) {
    return `Instance prop ${name} is not a valid React prop name`;
  }
  if (reservedInstancePropNames.has(name)) {
    return `Instance prop ${name} is reserved by Srijika or React`;
  }
  if (/^on/i.test(name)) {
    return `Instance prop ${name} looks like a raw event; add an approved event port instead`;
  }
  return null;
}

export function isSafeInstancePropName(name: string): boolean {
  return instancePropNameError(name) === null;
}

export function normalizedInstanceEventPort(
  eventName: string,
): NormalizedInstanceEventPort | undefined {
  return portsByName.get(eventName);
}

export function createInstanceEventSpec(eventName: string): InstanceEventSpec | undefined {
  const port = normalizedInstanceEventPort(eventName);
  if (!port) return undefined;
  return {
    displayName: port.displayName,
    source: port.source,
    signature: structuredClone(port.signature),
  };
}

export function isApprovedInstanceEventSpec(eventName: string, spec: InstanceEventSpec): boolean {
  const canonical = createInstanceEventSpec(eventName);
  return (
    canonical !== undefined &&
    canonical.source === spec.source &&
    stableJson(canonical.signature) === stableJson(spec.signature)
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
