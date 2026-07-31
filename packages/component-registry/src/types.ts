import type { LiteralValue, UiNode, ValueType } from '@sutra/contracts';

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

export interface EventSpec {
  displayName: string;
  description?: string;
  payloadType: string;
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
