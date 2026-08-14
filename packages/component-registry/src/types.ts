import type { EventSignature, LiteralValue, UiNode, ValueType } from '@srijika/contracts';

export type InspectorControl =
  'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'color' | 'event';

export interface PropSpec {
  type: ValueType;
  displayName: string;
  description?: string;
  defaultValue?: LiteralValue;
  required: boolean;
  bindable: boolean;
  control: InspectorControl;
  options?: readonly string[];
}

/** React props supported consistently by every registered visual component. */
export const COMMON_REACT_PROPS = {
  className: {
    type: 'string',
    displayName: 'Class name',
    description: 'Additional CSS classes, supplied literally or through a binding.',
    required: false,
    bindable: true,
    control: 'text',
  },
  style: {
    type: 'object',
    displayName: 'Dynamic style',
    description: 'A React style object merged after the visual design properties.',
    required: false,
    bindable: true,
    control: 'textarea',
  },
} as const satisfies Readonly<Record<'className' | 'style', PropSpec>>;

export interface EventSpec {
  displayName: string;
  description?: string;
  signature: EventSignature;
}

export interface SlotSpec {
  displayName: string;
  accepts: readonly string[] | '*';
  minChildren: number;
  maxChildren?: number;
}

export type DropStrategy = 'flow' | 'flex' | 'grid' | 'none';

export interface EditorBehavior {
  draggable: boolean;
  selectable: boolean;
  resizable: 'none' | 'horizontal' | 'vertical' | 'both';
  dropStrategy: DropStrategy;
}

export interface ComponentManifest {
  id: string;
  version: number;
  displayName: string;
  description: string;
  category: 'Layout' | 'Typography' | 'Inputs' | 'Media' | 'Structure';
  icon: string;
  props: Record<string, PropSpec>;
  events: Record<string, EventSpec>;
  slots: Record<string, SlotSpec>;
  editor: EditorBehavior;
}

export interface ComponentDefinition<TImplementation = unknown> {
  manifest: ComponentManifest;
  implementation: TImplementation;
  createNode: (id: string) => UiNode;
}

export interface RegistryDiagnostic {
  code: 'duplicate-component' | 'unknown-component' | 'version-mismatch';
  message: string;
  componentId: string;
}
