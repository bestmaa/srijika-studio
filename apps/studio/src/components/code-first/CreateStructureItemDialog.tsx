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
  resolveSrijikaStructureOwner,
  srijikaFolderName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_NAME_PATTERN,
  type SrijikaStructureCreationAction,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';

import type { CodeProjectScaffoldCapability } from '../../lib/project-service';

export type StructureOwnerContext = SrijikaStructureOwnerContext;
export type StructureCreationAction = SrijikaStructureCreationAction;

export interface CreateStructureItemInput {
  featureName: string;
  capability: CodeProjectScaffoldCapability;
}

export interface CreateStructureItemDialogProps {
  owner: StructureOwnerContext;
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
  return action === 'feature' || action === 'slot' || action === 'part';
}

function ownerName(owner: StructureOwnerContext): string {
  return owner.level === 'featuresRoot'
    ? 'Features'
    : owner.level === 'feature'
      ? owner.featureName
      : owner.level === 'slot'
        ? owner.slotName
        : owner.partName;
}

export function structureOwnerFromFolder(folder: string): StructureOwnerContext | null {
  return resolveSrijikaStructureOwner(folder);
}

export function structureCreationActionsForOwner(
  owner: StructureOwnerContext,
): readonly StructureCreationAction[] {
  return srijikaStructureCreationActionsForOwner(owner);
}

export function structureCreationPaths(
  featureName: string,
  capability: CodeProjectScaffoldCapability,
): readonly string[] {
  const featureFolder = `src/features/${srijikaFolderName(featureName)}`;
  switch (capability.kind) {
    case 'feature': {
      const paths = [`${featureFolder}/${featureName}.ui.tsx`];
      if (capability.createConnector) {
        paths.push(`${featureFolder}/${featureName}.connector.tsx`);
      }
      if (capability.createHook) paths.push(`${featureFolder}/use${featureName}.ts`);
      if (capability.createStore)
        paths.push(`${featureFolder}/${lowerFirst(featureName)}.store.ts`);
      if (capability.createLogic)
        paths.push(`${featureFolder}/${lowerFirst(featureName)}.logic.ts`);
      if (capability.createApi) paths.push(`${featureFolder}/${lowerFirst(featureName)}.api.ts`);
      if (capability.createTypes)
        paths.push(`${featureFolder}/${lowerFirst(featureName)}.types.ts`);
      return paths;
    }
    case 'featureConnector':
      return [`${featureFolder}/${featureName}.connector.tsx`];
    case 'featureStore':
      return [`${featureFolder}/${lowerFirst(featureName)}.store.ts`];
    case 'featureHook':
      return [`${featureFolder}/use${featureName}.ts`];
    case 'featureBehaviorHook':
      return [`${featureFolder}/hooks/${capability.hookName}.ts`];
    case 'featureLogic':
      return [`${featureFolder}/${lowerFirst(featureName)}.logic.ts`];
    case 'featureApi':
      return [`${featureFolder}/${lowerFirst(featureName)}.api.ts`];
    case 'featureTypes':
      return [`${featureFolder}/${lowerFirst(featureName)}.types.ts`];
    case 'slot': {
      const slotFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}`;
      const paths = [`${slotFolder}/${capability.slotName}.ui.tsx`];
      if (capability.createConnector) {
        paths.push(`${slotFolder}/${capability.slotName}.connector.tsx`);
      }
      if (capability.createHook) paths.push(`${slotFolder}/use${capability.slotName}.ts`);
      if (capability.createStore) {
        paths.push(`${slotFolder}/${lowerFirst(capability.slotName)}.store.ts`);
      }
      if (capability.createLogic)
        paths.push(`${slotFolder}/${lowerFirst(capability.slotName)}.logic.ts`);
      if (capability.createApi)
        paths.push(`${slotFolder}/${lowerFirst(capability.slotName)}.api.ts`);
      if (capability.createTypes)
        paths.push(`${slotFolder}/${lowerFirst(capability.slotName)}.types.ts`);
      if (capability.partName) {
        const partFolder = `${slotFolder}/parts/${srijikaFolderName(capability.partName)}`;
        paths.push(`${partFolder}/${capability.partName}.ui.tsx`);
        if (capability.createPartConnector) {
          paths.push(`${partFolder}/${capability.partName}.connector.tsx`);
        }
      }
      return paths;
    }
    case 'slotHook':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/use${capability.slotName}.ts`,
      ];
    case 'slotBehaviorHook':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/hooks/${capability.hookName}.ts`,
      ];
    case 'slotConnector':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/${capability.slotName}.connector.tsx`,
      ];
    case 'slotStore':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/${lowerFirst(capability.slotName)}.store.ts`,
      ];
    case 'slotLogic':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/${lowerFirst(capability.slotName)}.logic.ts`,
      ];
    case 'slotApi':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/${lowerFirst(capability.slotName)}.api.ts`,
      ];
    case 'slotTypes':
      return [
        `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/${lowerFirst(capability.slotName)}.types.ts`,
      ];
    case 'part': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [
        `${partFolder}/${capability.partName}.ui.tsx`,
        ...(capability.createConnector
          ? [`${partFolder}/${capability.partName}.connector.tsx`]
          : []),
        ...(capability.createHook ? [`${partFolder}/use${capability.partName}.ts`] : []),
        ...(capability.createStore
          ? [`${partFolder}/${lowerFirst(capability.partName)}.store.ts`]
          : []),
        ...(capability.createLogic
          ? [`${partFolder}/${lowerFirst(capability.partName)}.logic.ts`]
          : []),
        ...(capability.createApi
          ? [`${partFolder}/${lowerFirst(capability.partName)}.api.ts`]
          : []),
        ...(capability.createTypes
          ? [`${partFolder}/${lowerFirst(capability.partName)}.types.ts`]
          : []),
      ];
    }
    case 'partConnector': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/${capability.partName}.connector.tsx`];
    }
    case 'partStore': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/${lowerFirst(capability.partName)}.store.ts`];
    }
    case 'partHook': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/use${capability.partName}.ts`];
    }
    case 'partBehaviorHook': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/hooks/${capability.hookName}.ts`];
    }
    case 'partLogic': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/${lowerFirst(capability.partName)}.logic.ts`];
    }
    case 'partApi': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/${lowerFirst(capability.partName)}.api.ts`];
    }
    case 'partTypes': {
      const partFolder = `${featureFolder}/slots/${srijikaFolderName(capability.slotName)}/parts/${srijikaFolderName(capability.partName)}`;
      return [`${partFolder}/${lowerFirst(capability.partName)}.types.ts`];
    }
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
  initialAction,
  existingRelativePaths,
  onClose,
  onCreate,
}: CreateStructureItemDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const creatingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const allowedActions = useMemo(() => structureCreationActionsForOwner(owner), [owner]);
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
    owner.level === 'featuresRoot' ? normalizedName || 'Name' : owner.featureName;
  const primaryNameGuidance = needsNameForAction(action)
    ? normalizedNameGuidance(normalizedName)
    : null;
  const optionalPartGuidance = includePart ? normalizedNameGuidance(normalizedPartName) : null;

  const capability = useMemo<CodeProjectScaffoldCapability>(() => {
    switch (action) {
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
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
        };
      case 'slotLogic':
      case 'slotApi':
      case 'slotTypes':
        return {
          kind: action,
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
        };
      case 'slotConnector':
        return {
          kind: 'slotConnector',
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
        };
      case 'slotStore':
        return {
          kind: 'slotStore',
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
        };
      case 'part':
        return {
          kind: 'part',
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
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
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
      case 'partStore':
        return {
          kind: 'partStore',
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
      case 'partHook':
        return {
          kind: 'partHook',
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
          partName: owner.level === 'part' ? owner.partName : 'Part',
        };
      case 'partLogic':
      case 'partApi':
      case 'partTypes':
        return {
          kind: action,
          slotName:
            owner.level === 'featuresRoot' || owner.level === 'feature' ? 'Slot' : owner.slotName,
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
  ]);

  const relativePaths = structureCreationPaths(requestedFeatureName, capability);
  const existingPaths = useMemo(
    () =>
      new Set(
        existingRelativePaths.map((path) => path.replaceAll('\\', '/').toLocaleLowerCase('en-US')),
      ),
    [existingRelativePaths],
  );
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
      setError(
        `Use a PascalCase ${action} name, for example ${action === 'feature' ? 'Dashboard' : action === 'slot' ? 'Navigation' : 'UserMenu'}.`,
      );
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
                placeholder={
                  action === 'featureHook' || action === 'slotHook' || action === 'partHook'
                    ? 'NavigationKeyboard'
                    : action === 'feature'
                      ? 'Dashboard'
                      : action === 'slot'
                        ? 'Navigation'
                        : 'UserMenu'
                }
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
                {action === 'feature'
                  ? 'Srijika creates the feature owner folder and its required pure UI entry.'
                  : 'Srijika creates the private owner folder and its required pure UI file.'}
              </small>
            </label>
          ) : null}

          {action === 'feature' ? (
            <fieldset className="code-first-structure-options">
              <legend>
                Include with this feature <small>Optional</small>
              </legend>
              <label>
                <input type="checkbox" checked={createConnector} disabled readOnly />
                <span>
                  <strong>Connector · Required</strong>
                  <small>The only runtime entry allowed to render this Feature UI</small>
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
                  : `${displayOwnerName} remains the owner`}
              </strong>
              <span>
                {owner.level === 'featuresRoot'
                  ? 'Its capabilities flow only through the new feature and its descendants.'
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
