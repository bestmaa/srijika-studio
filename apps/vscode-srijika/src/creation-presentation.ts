import type { SrijikaStructureCreationAction } from '@srijika/architecture-rules';

import type { SrijikaOptionalOwnerCapability } from './ownership-creation';

export const SRIJIKA_CREATION_ACTION_LABELS: Readonly<
  Record<SrijikaStructureCreationAction, { label: string; description: string }>
> = {
  feature: { label: 'New Feature', description: 'Required UI + Connector in src/features' },
  featureConnector: { label: 'Feature Connector', description: 'Required runtime UI gateway' },
  featureHook: { label: 'Feature Hook gateway', description: 'useFeature.ts' },
  featureStore: { label: 'Feature Zustand store', description: 'Feature subtree state' },
  featureLogic: { label: 'Feature Business Logic', description: 'Rules and transformations' },
  featureApi: { label: 'Feature API', description: 'HTTP boundary' },
  featureTypes: { label: 'Feature Types', description: 'Owner contracts' },
  slot: { label: 'New Slot', description: 'Required UI + Connector inside this Feature' },
  slotConnector: { label: 'Slot Connector', description: 'Required runtime UI gateway' },
  slotHook: { label: 'Slot Hook gateway', description: 'useSlot.ts' },
  slotStore: { label: 'Slot Zustand store', description: 'Slot subtree state' },
  slotLogic: { label: 'Slot Business Logic', description: 'Slot-private rules' },
  slotApi: { label: 'Slot API', description: 'Slot-private HTTP boundary' },
  slotTypes: { label: 'Slot Types', description: 'Slot-private contracts' },
  part: { label: 'New Part', description: 'Required UI + Connector inside this Slot' },
  partConnector: { label: 'Part Connector', description: 'Required runtime UI gateway' },
  partHook: { label: 'Part Hook gateway', description: 'usePart.ts' },
  partStore: { label: 'Part Zustand store', description: 'Part-private state' },
  partLogic: { label: 'Part Business Logic', description: 'Part-private rules' },
  partApi: { label: 'Part API', description: 'Part-private HTTP boundary' },
  partTypes: { label: 'Part Types', description: 'Part-private contracts' },
};

export const SRIJIKA_OPTIONAL_CREATION_CAPABILITIES: readonly {
  capability: SrijikaOptionalOwnerCapability;
  label: string;
  description: string;
}[] = [
  { capability: 'hook', label: 'Hook gateway', description: 'React/query/cache lifecycle' },
  { capability: 'store', label: 'Zustand store', description: 'Shared client state' },
  { capability: 'logic', label: 'Business Logic', description: 'Rules and transformations' },
  { capability: 'api', label: 'API', description: 'HTTP request/response boundary' },
  { capability: 'types', label: 'Types', description: 'Owner contracts' },
];
