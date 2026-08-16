import {
  Boxes,
  Braces,
  Cable,
  Cloud,
  FileType2,
  FolderInput,
  PackagePlus,
  Store,
  Workflow,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import {
  canonicalSrijikaOwnerName,
  resolveSrijikaArchitectureConfig,
  resolveSrijikaStructureOwner,
  srijikaFolderName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_NAME_PATTERN,
  type SrijikaArchitectureConfig,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';
import { availableSrijikaOwnershipCreationActions } from '@srijika/project-scaffold/ownership';

import type { CodeProjectScaffoldCapability } from '../../lib/project-service';

export type StructureOwnerContext = SrijikaStructureOwnerContext;
export type StructureCreationAction = SrijikaStructureCreationAction;

export interface CreateStructureItemInput {
  featureName: string;
  capability: CodeProjectScaffoldCapability;
}

export interface CreateStructureItemDialogProps {
  owner: StructureOwnerContext;
  architectureRoots?: Partial<SrijikaArchitectureConfig> | undefined;
  initialAction?: StructureCreationAction | undefined;
  existingRelativePaths: readonly string[];
  onClose: () => void;
  /** The validated scaffold service remains the only writer. */
  onCreate: (input: CreateStructureItemInput) => Promise<string | null>;
}

interface CreationChoice {
  action: StructureCreationAction;
  label: string;
  description: string;
  icon: typeof Cable;
}

const CREATION_CHOICES: readonly CreationChoice[] = [
  {
    action: 'sharedUi',
    label: 'Shared UI Primitive',
    description: 'Create a pure props-and-events UI with no runtime dependency.',
    icon: Boxes,
  },
  {
    action: 'sharedUiTypes',
    label: 'Shared UI Types',
    description: 'Add type-only contracts to this pure UI primitive.',
    icon: FileType2,
  },
  {
    action: 'sharedWidget',
    label: 'Shared Widget',
    description: 'Create reusable UI + Connector with the progressive behavior chain.',
    icon: PackagePlus,
  },
  {
    action: 'sharedWidgetConnector',
    label: 'Shared Widget Connector',
    description: 'Create the required public runtime gateway for this Widget UI.',
    icon: Cable,
  },
  {
    action: 'sharedWidgetHook',
    label: 'Shared Widget Hook gateway',
    description: 'Create the public React lifecycle and cache gateway.',
    icon: Workflow,
  },
  {
    action: 'sharedWidgetBehaviorHook',
    label: 'Private Shared Widget Hook',
    description: 'Add owner-prefixed behavior and organize the Hook gateway into hooks/.',
    icon: Workflow,
  },
  {
    action: 'sharedWidgetStore',
    label: 'Shared Widget Store',
    description: 'Create state private to this reusable Widget owner.',
    icon: Store,
  },
  {
    action: 'sharedWidgetStoreSlice',
    label: 'Private Shared Widget Store',
    description: 'Add a cohesive concern and organize the Store gateway into stores/.',
    icon: Store,
  },
  {
    action: 'sharedWidgetLogic',
    label: 'Shared Widget Logic',
    description: 'Add stable rules and transformations owned by this Widget.',
    icon: Braces,
  },
  {
    action: 'sharedWidgetApi',
    label: 'Shared Widget API',
    description: 'Add the Widget HTTP request and response boundary.',
    icon: Cloud,
  },
  {
    action: 'sharedWidgetTypes',
    label: 'Shared Widget Types',
    description: 'Add contracts owned by this Shared Widget.',
    icon: FileType2,
  },
  {
    action: 'sharedCapability',
    label: 'Shared Headless Capability',
    description: 'Create reusable behavior without UI or Connector.',
    icon: Workflow,
  },
  {
    action: 'sharedCapabilityHook',
    label: 'Shared Capability Hook gateway',
    description: 'Create the public React lifecycle and cache gateway.',
    icon: Workflow,
  },
  {
    action: 'sharedCapabilityBehaviorHook',
    label: 'Private Shared Capability Hook',
    description: 'Add owner-prefixed behavior and organize Hooks automatically.',
    icon: Workflow,
  },
  {
    action: 'sharedCapabilityStore',
    label: 'Shared Capability Store',
    description: 'Create cross-feature client state for this exact capability.',
    icon: Store,
  },
  {
    action: 'sharedCapabilityStoreSlice',
    label: 'Private Shared Capability Store',
    description: 'Add a cohesive Store concern and organize Stores automatically.',
    icon: Store,
  },
  {
    action: 'sharedCapabilityLogic',
    label: 'Shared Capability Logic',
    description: 'Add stable cross-feature business rules and transformations.',
    icon: Braces,
  },
  {
    action: 'sharedCapabilityApi',
    label: 'Shared Capability API',
    description: 'Add a cross-feature HTTP transport boundary.',
    icon: Cloud,
  },
  {
    action: 'sharedCapabilityTypes',
    label: 'Shared Capability Types',
    description: 'Add type-only contracts for this capability.',
    icon: FileType2,
  },
  {
    action: 'feature',
    label: 'New Feature',
    description: 'Create a new owner scope with its required pure UI entry.',
    icon: FolderInput,
  },
  {
    action: 'featureConnector',
    label: 'Feature Connector',
    description: 'Wire feature data, stores, hooks, routes, events, and slot composition.',
    icon: Cable,
  },
  {
    action: 'featureStore',
    label: 'Feature Store',
    description: 'Share Zustand client state with the feature and all of its descendants.',
    icon: Store,
  },
  {
    action: 'featureHook',
    label: 'Feature Hook gateway',
    description: 'Create the senior useFeature React lifecycle, query, and cache gateway.',
    icon: Workflow,
  },
  {
    action: 'featureBehaviorHook',
    label: 'Private Feature Hook',
    description: 'Add owner-prefixed behavior and organize the Hook gateway into hooks/.',
    icon: Workflow,
  },
  {
    action: 'featureStoreSlice',
    label: 'Private Feature Store',
    description: 'Add one cohesive state concern and organize the Store gateway into stores/.',
    icon: Store,
  },
  {
    action: 'featureLogic',
    label: 'Feature Logic',
    description: 'Add feature business rules, validation, transformation, and orchestration.',
    icon: Braces,
  },
  {
    action: 'featureApi',
    label: 'Feature API',
    description: 'Add the feature HTTP request and response boundary.',
    icon: Cloud,
  },
  {
    action: 'featureTypes',
    label: 'Feature Types',
    description: 'Add contracts shared by this feature capability chain.',
    icon: FileType2,
  },
  {
    action: 'slot',
    label: 'Named Slot',
    description: 'Create a private visual region owned by this feature.',
    icon: FolderInput,
  },
  {
    action: 'slotConnector',
    label: 'Slot Connector',
    description: 'Add data, store, hook, event, and composition wiring to this slot.',
    icon: Cable,
  },
  {
    action: 'slotStore',
    label: 'Slot Store',
    description: 'Share Zustand client state with this slot and its private parts.',
    icon: Store,
  },
  {
    action: 'slotHook',
    label: 'Slot Hook gateway',
    description: 'Create the senior useSlot React lifecycle, query, and cache gateway.',
    icon: Workflow,
  },
  {
    action: 'slotBehaviorHook',
    label: 'Private Slot Hook',
    description: 'Add slot-prefixed behavior and organize the Hook gateway into hooks/.',
    icon: Workflow,
  },
  {
    action: 'slotStoreSlice',
    label: 'Private Slot Store',
    description: 'Add one slot state concern and organize the Store gateway into stores/.',
    icon: Store,
  },
  {
    action: 'slotLogic',
    label: 'Slot Logic',
    description: 'Add business rules and transformations private to this slot subtree.',
    icon: Braces,
  },
  {
    action: 'slotApi',
    label: 'Slot API',
    description: 'Add server communication private to this slot subtree.',
    icon: Cloud,
  },
  {
    action: 'slotTypes',
    label: 'Slot Types',
    description: 'Add contracts private to this slot subtree.',
    icon: FileType2,
  },
  {
    action: 'part',
    label: 'Private Part',
    description: 'Split a large slot into a meaningful private visual unit.',
    icon: Boxes,
  },
  {
    action: 'partConnector',
    label: 'Part Connector',
    description: 'Add data, hook, state, or event wiring to this existing private part.',
    icon: Cable,
  },
  {
    action: 'partStore',
    label: 'Part Store',
    description: 'Share Zustand client state inside this exact private part only.',
    icon: Store,
  },
  {
    action: 'partHook',
    label: 'Part Hook gateway',
    description: 'Create the senior usePart React lifecycle, query, and cache gateway.',
    icon: Workflow,
  },
  {
    action: 'partBehaviorHook',
    label: 'Private Part Hook',
    description: 'Add part-prefixed behavior and organize the Hook gateway into hooks/.',
    icon: Workflow,
  },
  {
    action: 'partStoreSlice',
    label: 'Private Part Store',
    description: 'Add one part state concern and organize the Store gateway into stores/.',
    icon: Store,
  },
  {
    action: 'partLogic',
    label: 'Part Logic',
    description: 'Add business rules private to this exact part.',
    icon: Braces,
  },
  {
    action: 'partApi',
    label: 'Part API',
    description: 'Add server communication private to this exact part.',
    icon: Cloud,
  },
  {
    action: 'partTypes',
    label: 'Part Types',
    description: 'Add contracts private to this exact part.',
    icon: FileType2,
  },
];

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLocaleLowerCase('en-US')}${value.slice(1)}`;
}

function canonicalPascalName(value: string): string {
  return canonicalSrijikaOwnerName(value);
}

function normalizedNameGuidance(value: string): string | null {
  if (!SRIJIKA_OWNER_NAME_PATTERN.test(value)) return null;
  const canonical = canonicalPascalName(value);
  return canonical === value ? null : `Use ${canonical}, not ${value}.`;
}

function needsNameForAction(action: StructureCreationAction): boolean {
  return (
    action === 'feature' ||
    action === 'slot' ||
    action === 'part' ||
    action === 'sharedUi' ||
    action === 'sharedWidget' ||
    action === 'sharedCapability' ||
    action.endsWith('BehaviorHook') ||
    action.endsWith('StoreSlice')
  );
}

function creationNameExample(action: StructureCreationAction): string {
  if (action.endsWith('BehaviorHook')) return 'Keyboard';
  if (action.endsWith('StoreSlice')) return 'Filters';
  if (action === 'feature') return 'Dashboard';
  if (action === 'slot') return 'Navigation';
  if (action === 'sharedUi') return 'Button';
  if (action === 'sharedWidget') return 'ProfileCard';
  if (action === 'sharedCapability') return 'AuthSession';
  return 'UserMenu';
}

function ownerName(owner: StructureOwnerContext): string {
  switch (owner.level) {
    case 'featuresRoot':
      return 'Features';
    case 'sharedRoot':
      return 'Shared';
    case 'feature':
      return owner.featureName;
    case 'slot':
      return owner.slotName;
    case 'part':
      return owner.partName;
    case 'sharedUi':
    case 'sharedWidget':
    case 'sharedCapability':
      return owner.sharedName;
  }
}

export function structureOwnerFromFolder(
  folder: string,
  architectureRoots: Partial<SrijikaArchitectureConfig> = {},
): StructureOwnerContext | null {
  return resolveSrijikaStructureOwner(folder, architectureRoots);
}

export function structureCreationActionsForOwner(
  owner: StructureOwnerContext,
): readonly StructureCreationAction[] {
  return srijikaStructureCreationActionsForOwner(owner);
}

export function structureCreationPaths(
  featureName: string,
  capability: CodeProjectScaffoldCapability,
  architectureRoots: Partial<SrijikaArchitectureConfig> = {},
): readonly string[] {
  const architecture = resolveSrijikaArchitectureConfig(architectureRoots);
  const featureFolder = `${architecture.featuresRoot}/${srijikaFolderName(featureName)}`;
  const sharedFolder = (category: 'ui' | 'widgets' | 'capabilities'): string =>
    `${architecture.sharedRoot}/${category}/${srijikaFolderName(featureName)}`;
  const ownerFiles = (
    folder: string,
    ownerName: string,
    options: {
      ui: boolean;
      connector: boolean;
      hook?: boolean;
      store?: boolean;
      logic?: boolean;
      api?: boolean;
      types?: boolean;
    },
  ): string[] => {
    const stem = lowerFirst(ownerName);
    return [
      ...(options.ui ? [`${folder}/${ownerName}${architecture.uiSuffix}`] : []),
      ...(options.connector ? [`${folder}/${ownerName}${architecture.connectorSuffix}`] : []),
      ...(options.hook ? [`${folder}/use${ownerName}.ts`] : []),
      ...(options.store ? [`${folder}/${stem}${architecture.storeSuffix}`] : []),
      ...(options.logic ? [`${folder}/${stem}${architecture.logicSuffix}`] : []),
      ...(options.api ? [`${folder}/${stem}${architecture.apiSuffix}`] : []),
      ...(options.types ? [`${folder}/${stem}${architecture.typesSuffix}`] : []),
    ];
  };
  const featureOwnerFiles = (
    ownerName: string,
    options: Parameters<typeof ownerFiles>[2],
  ): string[] => ownerFiles(featureFolder, ownerName, options);
  const slotFolder = (slotName: string): string =>
    `${featureFolder}/${architecture.slotsDirectory}/${srijikaFolderName(slotName)}`;
  const partFolder = (slotName: string, partName: string): string =>
    `${slotFolder(slotName)}/${architecture.partsDirectory}/${srijikaFolderName(partName)}`;
  const privateHook = (folder: string, hookName: string): string =>
    `${folder}/${architecture.hooksDirectory}/${hookName}.ts`;
  const privateStore = (folder: string, storeName: string): string =>
    `${folder}/${architecture.storesDirectory}/${storeName}${architecture.storeSuffix}`;
  switch (capability.kind) {
    case 'sharedUi': {
      const folder = sharedFolder('ui');
      return [
        `${folder}/${featureName}${architecture.uiSuffix}`,
        ...(capability.createTypes
          ? [`${folder}/${lowerFirst(featureName)}${architecture.typesSuffix}`]
          : []),
      ];
    }
    case 'sharedUiTypes':
      return [`${sharedFolder('ui')}/${lowerFirst(featureName)}${architecture.typesSuffix}`];
    case 'sharedWidget':
      return ownerFiles(sharedFolder('widgets'), featureName, {
        ui: true,
        connector: capability.createConnector ?? false,
        hook: capability.createHook ?? false,
        store: capability.createStore ?? false,
        logic: capability.createLogic ?? false,
        api: capability.createApi ?? false,
        types: capability.createTypes ?? false,
      });
    case 'sharedWidgetConnector':
      return [`${sharedFolder('widgets')}/${featureName}${architecture.connectorSuffix}`];
    case 'sharedWidgetHook':
      return [`${sharedFolder('widgets')}/use${featureName}.ts`];
    case 'sharedWidgetBehaviorHook':
      return [privateHook(sharedFolder('widgets'), capability.hookName)];
    case 'sharedWidgetStore':
      return [`${sharedFolder('widgets')}/${lowerFirst(featureName)}${architecture.storeSuffix}`];
    case 'sharedWidgetStoreSlice':
      return [privateStore(sharedFolder('widgets'), capability.storeName)];
    case 'sharedWidgetLogic':
      return [`${sharedFolder('widgets')}/${lowerFirst(featureName)}${architecture.logicSuffix}`];
    case 'sharedWidgetApi':
      return [`${sharedFolder('widgets')}/${lowerFirst(featureName)}${architecture.apiSuffix}`];
    case 'sharedWidgetTypes':
      return [`${sharedFolder('widgets')}/${lowerFirst(featureName)}${architecture.typesSuffix}`];
    case 'sharedCapability':
      return ownerFiles(sharedFolder('capabilities'), featureName, {
        ui: false,
        connector: false,
        hook: capability.createHook ?? false,
        store: capability.createStore ?? false,
        logic: capability.createLogic ?? false,
        api: capability.createApi ?? false,
        types: capability.createTypes ?? false,
      });
    case 'sharedCapabilityHook':
      return [`${sharedFolder('capabilities')}/use${featureName}.ts`];
    case 'sharedCapabilityBehaviorHook':
      return [privateHook(sharedFolder('capabilities'), capability.hookName)];
    case 'sharedCapabilityStore':
      return [
        `${sharedFolder('capabilities')}/${lowerFirst(featureName)}${architecture.storeSuffix}`,
      ];
    case 'sharedCapabilityStoreSlice':
      return [privateStore(sharedFolder('capabilities'), capability.storeName)];
    case 'sharedCapabilityLogic':
      return [
        `${sharedFolder('capabilities')}/${lowerFirst(featureName)}${architecture.logicSuffix}`,
      ];
    case 'sharedCapabilityApi':
      return [
        `${sharedFolder('capabilities')}/${lowerFirst(featureName)}${architecture.apiSuffix}`,
      ];
    case 'sharedCapabilityTypes':
      return [
        `${sharedFolder('capabilities')}/${lowerFirst(featureName)}${architecture.typesSuffix}`,
      ];
    case 'feature':
      return featureOwnerFiles(featureName, {
        ui: true,
        connector: capability.createConnector ?? false,
        hook: capability.createHook ?? false,
        store: capability.createStore ?? false,
        logic: capability.createLogic ?? false,
        api: capability.createApi ?? false,
        types: capability.createTypes ?? false,
      });
    case 'featureConnector':
      return [`${featureFolder}/${featureName}${architecture.connectorSuffix}`];
    case 'featureStore':
      return [`${featureFolder}/${lowerFirst(featureName)}${architecture.storeSuffix}`];
    case 'featureHook':
      return [`${featureFolder}/use${featureName}.ts`];
    case 'featureBehaviorHook':
      return [privateHook(featureFolder, capability.hookName)];
    case 'featureStoreSlice':
      return [privateStore(featureFolder, capability.storeName)];
    case 'featureLogic':
      return [`${featureFolder}/${lowerFirst(featureName)}${architecture.logicSuffix}`];
    case 'featureApi':
      return [`${featureFolder}/${lowerFirst(featureName)}${architecture.apiSuffix}`];
    case 'featureTypes':
      return [`${featureFolder}/${lowerFirst(featureName)}${architecture.typesSuffix}`];
    case 'slot': {
      const folder = slotFolder(capability.slotName);
      const paths = ownerFiles(folder, capability.slotName, {
        ui: true,
        connector: capability.createConnector ?? false,
        hook: capability.createHook ?? false,
        store: capability.createStore ?? false,
        logic: capability.createLogic ?? false,
        api: capability.createApi ?? false,
        types: capability.createTypes ?? false,
      });
      if (capability.partName) {
        paths.push(
          ...ownerFiles(partFolder(capability.slotName, capability.partName), capability.partName, {
            ui: true,
            connector: capability.createPartConnector ?? false,
          }),
        );
      }
      return paths;
    }
    case 'slotHook':
      return [`${slotFolder(capability.slotName)}/use${capability.slotName}.ts`];
    case 'slotBehaviorHook':
      return [privateHook(slotFolder(capability.slotName), capability.hookName)];
    case 'slotStoreSlice':
      return [privateStore(slotFolder(capability.slotName), capability.storeName)];
    case 'slotConnector':
      return [
        `${slotFolder(capability.slotName)}/${capability.slotName}${architecture.connectorSuffix}`,
      ];
    case 'slotStore':
      return [
        `${slotFolder(capability.slotName)}/${lowerFirst(capability.slotName)}${architecture.storeSuffix}`,
      ];
    case 'slotLogic':
      return [
        `${slotFolder(capability.slotName)}/${lowerFirst(capability.slotName)}${architecture.logicSuffix}`,
      ];
    case 'slotApi':
      return [
        `${slotFolder(capability.slotName)}/${lowerFirst(capability.slotName)}${architecture.apiSuffix}`,
      ];
    case 'slotTypes':
      return [
        `${slotFolder(capability.slotName)}/${lowerFirst(capability.slotName)}${architecture.typesSuffix}`,
      ];
    case 'part':
      return ownerFiles(partFolder(capability.slotName, capability.partName), capability.partName, {
        ui: true,
        connector: capability.createConnector ?? false,
        hook: capability.createHook ?? false,
        store: capability.createStore ?? false,
        logic: capability.createLogic ?? false,
        api: capability.createApi ?? false,
        types: capability.createTypes ?? false,
      });
    case 'partConnector':
      return [
        `${partFolder(capability.slotName, capability.partName)}/${capability.partName}${architecture.connectorSuffix}`,
      ];
    case 'partStore':
      return [
        `${partFolder(capability.slotName, capability.partName)}/${lowerFirst(capability.partName)}${architecture.storeSuffix}`,
      ];
    case 'partHook':
      return [
        `${partFolder(capability.slotName, capability.partName)}/use${capability.partName}.ts`,
      ];
    case 'partBehaviorHook':
      return [
        privateHook(partFolder(capability.slotName, capability.partName), capability.hookName),
      ];
    case 'partStoreSlice':
      return [
        privateStore(partFolder(capability.slotName, capability.partName), capability.storeName),
      ];
    case 'partLogic':
      return [
        `${partFolder(capability.slotName, capability.partName)}/${lowerFirst(capability.partName)}${architecture.logicSuffix}`,
      ];
    case 'partApi':
      return [
        `${partFolder(capability.slotName, capability.partName)}/${lowerFirst(capability.partName)}${architecture.apiSuffix}`,
      ];
    case 'partTypes':
      return [
        `${partFolder(capability.slotName, capability.partName)}/${lowerFirst(capability.partName)}${architecture.typesSuffix}`,
      ];
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]',
    ),
  ].filter((element) => element.tabIndex >= 0 && !element.hidden);
}

export function CreateStructureItemDialog({
  owner,
  architectureRoots,
  initialAction,
  existingRelativePaths,
  onClose,
  onCreate,
}: CreateStructureItemDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const creatingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const architecture = useMemo(
    () => resolveSrijikaArchitectureConfig(architectureRoots ?? {}),
    [architectureRoots],
  );
  const allowedActions = useMemo(
    () =>
      availableSrijikaOwnershipCreationActions(
        owner,
        existingRelativePaths,
        {},
        architectureRoots ?? {},
      ),
    [architectureRoots, existingRelativePaths, owner],
  );
  const selectedInitialAction =
    initialAction && allowedActions.includes(initialAction)
      ? initialAction
      : (allowedActions[0] ?? 'featureConnector');
  const [action, setAction] = useState<StructureCreationAction>(selectedInitialAction);
  const [name, setName] = useState('');
  const [createConnector, setCreateConnector] = useState(true);
  const [createHook, setCreateHook] = useState(false);
  const [createStore, setCreateStore] = useState(false);
  const [createLogic, setCreateLogic] = useState(false);
  const [createApi, setCreateApi] = useState(false);
  const [createTypes, setCreateTypes] = useState(false);
  const [includePart, setIncludePart] = useState(false);
  const [partName, setPartName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const normalizedName = name.trim().replace(/^use(?=[A-Z])/, '');
  const normalizedPartName = partName.trim();
  const requestedFeatureName =
    owner.level === 'featuresRoot' || owner.level === 'sharedRoot'
      ? normalizedName || 'Name'
      : owner.level === 'sharedUi' ||
          owner.level === 'sharedWidget' ||
          owner.level === 'sharedCapability'
        ? owner.sharedName
        : owner.featureName;
  const selectedOwnerName = ownerName(owner);
  const primaryNameGuidance = needsNameForAction(action)
    ? normalizedNameGuidance(normalizedName)
    : null;
  const optionalPartGuidance = includePart ? normalizedNameGuidance(normalizedPartName) : null;

  const capability = useMemo<CodeProjectScaffoldCapability>(() => {
    switch (action) {
      case 'sharedUi':
        return { kind: 'sharedUi', createTypes };
      case 'sharedUiTypes':
        return { kind: 'sharedUiTypes' };
      case 'sharedWidget':
        return {
          kind: 'sharedWidget',
          createConnector: true,
          createHook,
          createStore,
          createLogic,
          createApi,
          createTypes,
        };
      case 'sharedWidgetConnector':
        return { kind: 'sharedWidgetConnector' };
      case 'sharedWidgetHook':
        return { kind: 'sharedWidgetHook' };
      case 'sharedWidgetBehaviorHook':
        return {
          kind: 'sharedWidgetBehaviorHook',
          hookName: `use${selectedOwnerName}${normalizedName || 'Behavior'}`,
        };
      case 'sharedWidgetStore':
        return { kind: 'sharedWidgetStore' };
      case 'sharedWidgetStoreSlice':
        return {
          kind: 'sharedWidgetStoreSlice',
          storeName: `${lowerFirst(selectedOwnerName)}${normalizedName || 'Concern'}`,
        };
      case 'sharedWidgetLogic':
        return { kind: 'sharedWidgetLogic' };
      case 'sharedWidgetApi':
        return { kind: 'sharedWidgetApi' };
      case 'sharedWidgetTypes':
        return { kind: 'sharedWidgetTypes' };
      case 'sharedCapability':
        return {
          kind: 'sharedCapability',
          createHook,
          createStore,
          createLogic,
          createApi,
          createTypes,
        };
      case 'sharedCapabilityHook':
        return { kind: 'sharedCapabilityHook' };
      case 'sharedCapabilityBehaviorHook':
        return {
          kind: 'sharedCapabilityBehaviorHook',
          hookName: `use${selectedOwnerName}${normalizedName || 'Behavior'}`,
        };
      case 'sharedCapabilityStore':
        return { kind: 'sharedCapabilityStore' };
      case 'sharedCapabilityStoreSlice':
        return {
          kind: 'sharedCapabilityStoreSlice',
          storeName: `${lowerFirst(selectedOwnerName)}${normalizedName || 'Concern'}`,
        };
      case 'sharedCapabilityLogic':
        return { kind: 'sharedCapabilityLogic' };
      case 'sharedCapabilityApi':
        return { kind: 'sharedCapabilityApi' };
      case 'sharedCapabilityTypes':
        return { kind: 'sharedCapabilityTypes' };
      case 'feature':
        return {
          kind: 'feature',
          createConnector,
          createHook,
          createStore,
          createLogic,
          createApi,
          createTypes,
          hookName: null,
        };
      case 'featureConnector':
        return { kind: 'featureConnector' };
      case 'featureStore':
        return { kind: 'featureStore' };
      case 'featureHook':
        return { kind: 'featureHook' };
      case 'featureBehaviorHook':
        return {
          kind: 'featureBehaviorHook',
          hookName: `use${selectedOwnerName}${normalizedName || 'Behavior'}`,
        };
      case 'featureStoreSlice':
        return {
          kind: 'featureStoreSlice',
          storeName: `${lowerFirst(selectedOwnerName)}${normalizedName || 'Concern'}`,
        };
      case 'featureLogic':
        return { kind: 'featureLogic' };
      case 'featureApi':
        return { kind: 'featureApi' };
      case 'featureTypes':
        return { kind: 'featureTypes' };
      case 'slot':
        return {
          kind: 'slot',
          slotName: normalizedName || 'Name',
          createConnector,
          createHook,
          createStore,
          createLogic,
          createApi,
          createTypes,
          hookName: null,
          partName: includePart ? normalizedPartName || 'Name' : null,
          createPartConnector: includePart,
        };
      case 'slotHook':
        return {
          kind: 'slotHook',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
        };
      case 'slotBehaviorHook':
        return {
          kind: 'slotBehaviorHook',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          hookName: `use${selectedOwnerName}${normalizedName || 'Behavior'}`,
        };
      case 'slotStoreSlice':
        return {
          kind: 'slotStoreSlice',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          storeName: `${lowerFirst(selectedOwnerName)}${normalizedName || 'Concern'}`,
        };
      case 'slotLogic':
      case 'slotApi':
      case 'slotTypes':
        return {
          kind: action,
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
        };
      case 'slotConnector':
        return {
          kind: 'slotConnector',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
        };
      case 'slotStore':
        return {
          kind: 'slotStore',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
        };
      case 'part':
        return {
          kind: 'part',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: normalizedName || 'Name',
          createConnector,
          createHook,
          createStore,
          createLogic,
          createApi,
          createTypes,
          hookName: null,
        };
      case 'partConnector':
        return {
          kind: 'partConnector',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
      case 'partStore':
        return {
          kind: 'partStore',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
      case 'partHook':
        return {
          kind: 'partHook',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
      case 'partBehaviorHook':
        return {
          kind: 'partBehaviorHook',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: owner.level === 'part' ? owner.partName : 'Part',
          hookName: `use${selectedOwnerName}${normalizedName || 'Behavior'}`,
        };
      case 'partStoreSlice':
        return {
          kind: 'partStoreSlice',
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: owner.level === 'part' ? owner.partName : 'Part',
          storeName: `${lowerFirst(selectedOwnerName)}${normalizedName || 'Concern'}`,
        };
      case 'partLogic':
      case 'partApi':
      case 'partTypes':
        return {
          kind: action,
          slotName: owner.level === 'slot' || owner.level === 'part' ? owner.slotName : 'Slot',
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
    }
  }, [
    action,
    createConnector,
    createHook,
    createLogic,
    createApi,
    createTypes,
    createStore,
    includePart,
    normalizedName,
    normalizedPartName,
    owner,
    selectedOwnerName,
  ]);

  const relativePaths = structureCreationPaths(
    requestedFeatureName,
    capability,
    architectureRoots ?? {},
  );
  const existingPaths = useMemo(
    () =>
      new Set(
        existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLocaleLowerCase('en-US')),
      ),
    [existingRelativePaths],
  );
  const gatewayPreview = useMemo(() => {
    if (!action.endsWith('BehaviorHook') && !action.endsWith('StoreSlice')) return null;
    const isHook = action.endsWith('BehaviorHook');
    const gatewayFile = isHook
      ? `use${selectedOwnerName}.ts`
      : `${lowerFirst(selectedOwnerName)}${architecture.storeSuffix}`;
    const folder = isHook ? architecture.hooksDirectory : architecture.storesDirectory;
    const flat = `${owner.folder}/${gatewayFile}`;
    const expanded = `${owner.folder}/${folder}/${gatewayFile}`;
    return existingPaths.has(flat.toLocaleLowerCase('en-US'))
      ? `[safe move] ${flat} → ${expanded}`
      : `[safe update] ${expanded}`;
  }, [action, architecture, existingPaths, owner.folder, selectedOwnerName]);
  const needsName = needsNameForAction(action);
  const canPreviewPaths =
    (!needsName || (SRIJIKA_OWNER_NAME_PATTERN.test(normalizedName) && !primaryNameGuidance)) &&
    (!includePart ||
      (SRIJIKA_OWNER_NAME_PATTERN.test(normalizedPartName) && !optionalPartGuidance));
  const selectedChoice = CREATION_CHOICES.find((choice) => choice.action === action);
  const displayOwnerName = ownerName(owner);

  useEffect(() => {
    creatingRef.current = creating;
  }, [creating]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !creatingRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
      previousFocus?.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const chooseAction = (nextAction: StructureCreationAction): void => {
    setAction(nextAction);
    setName('');
    setCreateConnector(true);
    setCreateHook(false);
    setCreateStore(false);
    setCreateLogic(false);
    setCreateApi(false);
    setCreateTypes(false);
    setIncludePart(false);
    setPartName('');
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (needsName && !SRIJIKA_OWNER_NAME_PATTERN.test(normalizedName)) {
      setError(`Use a PascalCase ${action} name, for example ${creationNameExample(action)}.`);
      return;
    }
    if (primaryNameGuidance) {
      setError(`Use normalized PascalCase. ${primaryNameGuidance}`);
      return;
    }
    if (action === 'slot' && includePart && !SRIJIKA_OWNER_NAME_PATTERN.test(normalizedPartName)) {
      setError('Use a PascalCase optional part name, for example UserMenu.');
      return;
    }
    if (action === 'slot' && optionalPartGuidance) {
      setError(`Use normalized PascalCase for the optional part. ${optionalPartGuidance}`);
      return;
    }
    if (
      action === 'sharedCapability' &&
      !createHook &&
      !createStore &&
      !createLogic &&
      !createApi
    ) {
      setError(
        'A Shared Headless Capability requires at least one runtime layer: Hook, Store, Logic, or API.',
      );
      return;
    }
    const duplicate = relativePaths.find((path) =>
      existingPaths.has(path.toLocaleLowerCase('en-US')),
    );
    if (duplicate) {
      setError(`${duplicate} already exists in this project.`);
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const creationError = await onCreate({ featureName: requestedFeatureName, capability });
      if (creationError) setError(creationError);
      else onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="code-first-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !creating) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="code-first-create-dialog code-first-structure-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-structure-title"
        aria-describedby="create-structure-description"
        onKeyDown={trapFocus}
      >
        <header>
          <div>
            <span className="code-first-dialog-eyebrow">SRIJIKA OWNERSHIP-AWARE CREATION</span>
            <h2 id="create-structure-title">Add to {displayOwnerName}</h2>
            <p id="create-structure-description">
              {owner.level === 'featuresRoot'
                ? 'This canonical feature collection lives at '
                : owner.level === 'sharedRoot'
                  ? 'This canonical cross-feature collection lives at '
                  : `This ${owner.level} owns `}
              <code>{owner.folder}</code>. Only capabilities supported by this exact boundary are
              available.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="code-first-dialog-close"
            aria-label="Close structure creation dialog"
            disabled={creating}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="code-first-structure-kind-choice">
            <legend>What capability does {displayOwnerName} need?</legend>
            {CREATION_CHOICES.filter((choice) => allowedActions.includes(choice.action)).map(
              (choice) => {
                const Icon = choice.icon;
                return (
                  <label
                    key={choice.action}
                    className={action === choice.action ? 'is-selected' : undefined}
                  >
                    <input
                      type="radio"
                      name="srijika-structure-kind"
                      value={choice.action}
                      checked={action === choice.action}
                      disabled={creating}
                      onChange={() => chooseAction(choice.action)}
                    />
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>{choice.label}</strong>
                      <small>{choice.description}</small>
                    </span>
                  </label>
                );
              },
            )}
          </fieldset>

          {needsName ? (
            <label className="code-first-dialog-field" htmlFor="create-structure-name">
              <span>{selectedChoice?.label} name</span>
              <input
                id="create-structure-name"
                aria-label={`${selectedChoice?.label ?? action} name`}
                value={name}
                placeholder={creationNameExample(action)}
                autoComplete="off"
                spellCheck={false}
                maxLength={67}
                disabled={creating}
                onChange={(event) => {
                  setName(event.target.value);
                  setError(null);
                }}
              />
              <small>
                {action.endsWith('BehaviorHook')
                  ? `Srijika derives use${selectedOwnerName}${normalizedName || 'Behavior'} and safely moves the public Hook gateway into ${architecture.hooksDirectory}/ when needed.`
                  : action.endsWith('StoreSlice')
                    ? `Srijika derives ${lowerFirst(selectedOwnerName)}${normalizedName || 'Concern'}${architecture.storeSuffix} and safely moves the public Store gateway into ${architecture.storesDirectory}/ when needed.`
                    : action === 'feature'
                      ? 'Srijika creates the feature owner folder and its required pure UI entry.'
                      : action === 'sharedUi'
                        ? 'Srijika creates a pure cross-feature UI owner with no runtime dependency.'
                        : action === 'sharedWidget'
                          ? 'Srijika creates a cross-feature Widget with required UI and Connector.'
                          : action === 'sharedCapability'
                            ? 'Srijika creates a headless cross-feature owner with at least one runtime layer.'
                            : 'Srijika creates the private owner folder and its required pure UI file.'}
              </small>
            </label>
          ) : null}

          {action === 'sharedUi' ? (
            <fieldset className="code-first-structure-options">
              <legend>
                Include with this UI primitive <small>Optional</small>
              </legend>
              <label>
                <input
                  type="checkbox"
                  checked={createTypes}
                  onChange={(event) => setCreateTypes(event.target.checked)}
                />
                <span>
                  <strong>Types</strong>
                  <small>
                    Type-only props and events contracts; runtime imports remain forbidden
                  </small>
                </span>
              </label>
            </fieldset>
          ) : action === 'sharedCapability' ? (
            <fieldset className="code-first-structure-options">
              <legend>
                Public capability chain <small>Select at least one runtime layer</small>
              </legend>
              <label>
                <input
                  type="checkbox"
                  checked={createHook}
                  onChange={(event) => setCreateHook(event.target.checked)}
                />
                <span>
                  <strong>Hook gateway</strong>
                  <small>React lifecycle, cache, retries, polling, and mutations</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createStore}
                  onChange={(event) => setCreateStore(event.target.checked)}
                />
                <span>
                  <strong>Zustand store</strong>
                  <small>Cross-feature client state owned by this capability</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createLogic}
                  onChange={(event) => setCreateLogic(event.target.checked)}
                />
                <span>
                  <strong>Business Logic</strong>
                  <small>Stable rules, validation, transformation, and orchestration</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createApi}
                  onChange={(event) => setCreateApi(event.target.checked)}
                />
                <span>
                  <strong>API</strong>
                  <small>Cross-feature HTTP request and response boundary</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createTypes}
                  onChange={(event) => setCreateTypes(event.target.checked)}
                />
                <span>
                  <strong>Types</strong>
                  <small>Type-only contracts for this capability</small>
                </span>
              </label>
            </fieldset>
          ) : action === 'feature' || action === 'sharedWidget' ? (
            <fieldset className="code-first-structure-options">
              <legend>
                Include with this {action === 'feature' ? 'feature' : 'shared widget'}{' '}
                <small>Optional</small>
              </legend>
              <label>
                <input type="checkbox" checked={createConnector} disabled readOnly />
                <span>
                  <strong>Connector · Required</strong>
                  <small>
                    The only runtime entry allowed to render this{' '}
                    {action === 'feature' ? 'Feature' : 'Shared Widget'} UI
                  </small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createHook}
                  onChange={(event) => setCreateHook(event.target.checked)}
                />
                <span>
                  <strong>Hook gateway</strong>
                  <small>
                    Creates the senior <code>use{requestedFeatureName}.ts</code> capability
                  </small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createStore}
                  onChange={(event) => setCreateStore(event.target.checked)}
                />
                <span>
                  <strong>Zustand store</strong>
                  <small>State for the complete feature subtree</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createLogic}
                  onChange={(event) => setCreateLogic(event.target.checked)}
                />
                <span>
                  <strong>Business Logic</strong>
                  <small>Rules, validation, transformation, and orchestration</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createApi}
                  onChange={(event) => setCreateApi(event.target.checked)}
                />
                <span>
                  <strong>API</strong>
                  <small>HTTP request and response boundary</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createTypes}
                  onChange={(event) => setCreateTypes(event.target.checked)}
                />
                <span>
                  <strong>Types</strong>
                  <small>Contracts shared by this owner chain</small>
                </span>
              </label>
            </fieldset>
          ) : action === 'slot' ? (
            <fieldset className="code-first-structure-options">
              <legend>
                Include with this slot <small>Optional</small>
              </legend>
              <label>
                <input type="checkbox" checked={createConnector} disabled readOnly />
                <span>
                  <strong>Connector · Required</strong>
                  <small>The only runtime entry allowed to render this Slot UI</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createHook}
                  onChange={(event) => setCreateHook(event.target.checked)}
                />
                <span>
                  <strong>Hook gateway</strong>
                  <small>Senior React/query/cache capability</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createStore}
                  onChange={(event) => setCreateStore(event.target.checked)}
                />
                <span>
                  <strong>Zustand store</strong>
                  <small>State for this slot subtree</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createLogic}
                  onChange={(event) => setCreateLogic(event.target.checked)}
                />
                <span>
                  <strong>Business Logic</strong>
                  <small>Rules and transformations private to this Slot</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createApi}
                  onChange={(event) => setCreateApi(event.target.checked)}
                />
                <span>
                  <strong>API</strong>
                  <small>Server communication private to this Slot</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createTypes}
                  onChange={(event) => setCreateTypes(event.target.checked)}
                />
                <span>
                  <strong>Types</strong>
                  <small>Contracts private to this Slot</small>
                </span>
              </label>
              <label className="has-detail">
                <input
                  type="checkbox"
                  checked={includePart}
                  onChange={(event) => setIncludePart(event.target.checked)}
                />
                <span>
                  <strong>First private part</strong>
                  <small>Meaningful nested UI unit</small>
                </span>
                {includePart ? (
                  <>
                    <input
                      aria-label="Optional first part name"
                      value={partName}
                      placeholder="UserMenu"
                      onChange={(event) => setPartName(event.target.value)}
                    />
                    <span className="code-first-nested-option">
                      <input
                        type="checkbox"
                        aria-label="Part Connector required"
                        checked
                        disabled
                        readOnly
                      />{' '}
                      Part Connector · Required
                    </span>
                  </>
                ) : null}
              </label>
            </fieldset>
          ) : action === 'part' ? (
            <fieldset className="code-first-structure-options">
              <legend>
                Include with this part <small>Optional</small>
              </legend>
              <label>
                <input type="checkbox" checked={createConnector} disabled readOnly />
                <span>
                  <strong>Connector · Required</strong>
                  <small>The only runtime entry allowed to render this Part UI</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createHook}
                  onChange={(event) => setCreateHook(event.target.checked)}
                />
                <span>
                  <strong>Hook gateway</strong>
                  <small>Senior React/query/cache capability</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createStore}
                  onChange={(event) => setCreateStore(event.target.checked)}
                />
                <span>
                  <strong>Zustand store</strong>
                  <small>State inside this exact private part</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createLogic}
                  onChange={(event) => setCreateLogic(event.target.checked)}
                />
                <span>
                  <strong>Business Logic</strong>
                  <small>Rules and transformations private to this Part</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createApi}
                  onChange={(event) => setCreateApi(event.target.checked)}
                />
                <span>
                  <strong>API</strong>
                  <small>Server communication private to this Part</small>
                </span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createTypes}
                  onChange={(event) => setCreateTypes(event.target.checked)}
                />
                <span>
                  <strong>Types</strong>
                  <small>Contracts private to this Part</small>
                </span>
              </label>
            </fieldset>
          ) : null}

          <section className="code-first-owner-summary" aria-label="Ownership boundary">
            <PackagePlus size={17} aria-hidden="true" />
            <div>
              <strong>
                {owner.level === 'featuresRoot'
                  ? `${requestedFeatureName} becomes a feature owner`
                  : owner.level === 'sharedRoot'
                    ? `${requestedFeatureName} becomes a strict shared owner`
                    : `${displayOwnerName} remains the owner`}
              </strong>
              <span>
                {owner.level === 'featuresRoot'
                  ? 'Its capabilities flow only through the new feature and its descendants.'
                  : owner.level === 'sharedRoot'
                    ? 'Shared never imports Features; consumers use only this owner’s public boundary.'
                    : `Available to this ${owner.level} and descendants. Parent, sibling, and other feature imports remain blocked.`}
              </span>
            </div>
          </section>

          {canPreviewPaths ? (
            <section className="code-first-generated-files" aria-label="Files to create">
              <span>Validated write request</span>
              {relativePaths.map((path) => (
                <code key={path}>{path}</code>
              ))}
              {gatewayPreview ? <code>{gatewayPreview}</code> : null}
            </section>
          ) : (
            <section className="code-first-generated-files is-blocked" aria-live="polite">
              <span>Resolve naming before preview</span>
              <p>
                {primaryNameGuidance ??
                  optionalPartGuidance ??
                  'Enter each required name in normalized PascalCase.'}
              </p>
            </section>
          )}

          <p className="code-first-dialog-note">
            The desktop scaffold service validates ownership, naming, duplicates, and project policy
            before writing this exact request.
          </p>
          {error ? (
            <p className="code-first-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <button type="button" disabled={creating} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="is-primary" disabled={creating}>
              {creating ? 'Validating…' : `Create ${selectedChoice?.label ?? action}`}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
