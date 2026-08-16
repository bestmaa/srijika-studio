import type { SrijikaStructureCreationAction } from '@srijika/architecture-rules';

import type { SrijikaOptionalOwnerCapability } from './ownership-creation';

export const SRIJIKA_CREATION_ACTION_LABELS: Readonly<
  Record<SrijikaStructureCreationAction, { label: string; description: string }>
> = {
  feature: { label: 'New Feature', description: 'Required UI + Connector in the Features root' },
  featureConnector: { label: 'Feature Connector', description: 'Required runtime UI gateway' },
  featureHook: { label: 'Feature Hook gateway', description: 'useFeature.ts' },
  featureBehaviorHook: {
    label: 'New Feature Hook behavior',
    description: 'Adds useFeature<Behavior>.ts and organizes Hooks when needed',
  },
  featureStore: { label: 'Feature Zustand store', description: 'Feature subtree state' },
  featureStoreSlice: {
    label: 'New Feature Store concern',
    description: 'Adds feature<Concern>.store.ts and organizes Stores when needed',
  },
  featureLogic: { label: 'Feature Business Logic', description: 'Rules and transformations' },
  featureApi: { label: 'Feature API', description: 'HTTP boundary' },
  featureTypes: { label: 'Feature Types', description: 'Owner contracts' },
  slot: { label: 'New Slot', description: 'Required UI + Connector inside this Feature' },
  slotConnector: { label: 'Slot Connector', description: 'Required runtime UI gateway' },
  slotHook: { label: 'Slot Hook gateway', description: 'useSlot.ts' },
  slotBehaviorHook: {
    label: 'New Slot Hook behavior',
    description: 'Adds useSlot<Behavior>.ts and organizes Hooks when needed',
  },
  slotStore: { label: 'Slot Zustand store', description: 'Slot subtree state' },
  slotStoreSlice: {
    label: 'New Slot Store concern',
    description: 'Adds slot<Concern>.store.ts and organizes Stores when needed',
  },
  slotLogic: { label: 'Slot Business Logic', description: 'Slot-private rules' },
  slotApi: { label: 'Slot API', description: 'Slot-private HTTP boundary' },
  slotTypes: { label: 'Slot Types', description: 'Slot-private contracts' },
  part: { label: 'New Part', description: 'Required UI + Connector inside this Slot' },
  partConnector: { label: 'Part Connector', description: 'Required runtime UI gateway' },
  partHook: { label: 'Part Hook gateway', description: 'usePart.ts' },
  partBehaviorHook: {
    label: 'New Part Hook behavior',
    description: 'Adds usePart<Behavior>.ts and organizes Hooks when needed',
  },
  partStore: { label: 'Part Zustand store', description: 'Part-private state' },
  partStoreSlice: {
    label: 'New Part Store concern',
    description: 'Adds part<Concern>.store.ts and organizes Stores when needed',
  },
  partLogic: { label: 'Part Business Logic', description: 'Part-private rules' },
  partApi: { label: 'Part API', description: 'Part-private HTTP boundary' },
  partTypes: { label: 'Part Types', description: 'Part-private contracts' },
  sharedUi: {
    label: 'New Shared UI Primitive',
    description: 'Pure props/events UI; runtime imports are forbidden',
  },
  sharedUiTypes: {
    label: 'Shared UI Types',
    description: 'Optional props/events contract for this primitive',
  },
  sharedWidget: {
    label: 'New Shared Widget',
    description: 'Reusable UI + Connector with the strict runtime chain',
  },
  sharedWidgetConnector: {
    label: 'Shared Widget Connector',
    description: 'Required and only runtime gateway for this Widget UI',
  },
  sharedWidgetHook: {
    label: 'Shared Widget Hook gateway',
    description: 'Public React lifecycle gateway for this Widget',
  },
  sharedWidgetBehaviorHook: {
    label: 'New Shared Widget Hook behavior',
    description: 'Adds a private behavior and safely organizes Widget Hooks',
  },
  sharedWidgetStore: {
    label: 'Shared Widget Zustand store',
    description: 'Widget-owned reusable client state',
  },
  sharedWidgetStoreSlice: {
    label: 'New Shared Widget Store concern',
    description: 'Adds a private concern and safely organizes Widget Stores',
  },
  sharedWidgetLogic: {
    label: 'Shared Widget Business Logic',
    description: 'Widget-owned rules and transformations',
  },
  sharedWidgetApi: {
    label: 'Shared Widget API',
    description: 'Widget-owned HTTP boundary',
  },
  sharedWidgetTypes: {
    label: 'Shared Widget Types',
    description: 'Widget-owned contracts',
  },
  sharedCapability: {
    label: 'New Headless Capability',
    description: 'Cross-feature runtime behavior with no UI or Connector',
  },
  sharedCapabilityHook: {
    label: 'Headless Capability Hook gateway',
    description: 'Public React lifecycle gateway for this capability',
  },
  sharedCapabilityBehaviorHook: {
    label: 'New Headless Capability Hook behavior',
    description: 'Adds a private behavior and safely organizes capability Hooks',
  },
  sharedCapabilityStore: {
    label: 'Headless Capability Zustand store',
    description: 'Cross-feature shared client state',
  },
  sharedCapabilityStoreSlice: {
    label: 'New Headless Capability Store concern',
    description: 'Adds a private concern and safely organizes capability Stores',
  },
  sharedCapabilityLogic: {
    label: 'Headless Capability Business Logic',
    description: 'Cross-feature rules and transformations',
  },
  sharedCapabilityApi: {
    label: 'Headless Capability API',
    description: 'Cross-feature HTTP boundary',
  },
  sharedCapabilityTypes: {
    label: 'Headless Capability Types',
    description: 'Cross-feature contracts; a runtime layer is still required',
  },
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
