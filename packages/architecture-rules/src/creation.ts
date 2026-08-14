import { resolveSrijikaArchitectureConfig } from './config';
import type { SrijikaArchitectureConfig } from './types';

export const SRIJIKA_OWNER_NAME_PATTERN = /^[A-Z][A-Za-z0-9]{0,63}$/;

export type SrijikaStructureOwnerContext =
  | {
      level: 'featuresRoot';
      folder: string;
    }
  | {
      level: 'feature';
      folder: string;
      featureName: string;
    }
  | {
      level: 'slot';
      folder: string;
      featureName: string;
      slotName: string;
    }
  | {
      level: 'part';
      folder: string;
      featureName: string;
      slotName: string;
      partName: string;
    };

export type SrijikaStructureCreationAction =
  | 'feature'
  | 'featureConnector'
  | 'featureHook'
  | 'featureStore'
  | 'featureLogic'
  | 'featureApi'
  | 'featureTypes'
  | 'slot'
  | 'slotConnector'
  | 'slotHook'
  | 'slotStore'
  | 'slotLogic'
  | 'slotApi'
  | 'slotTypes'
  | 'part'
  | 'partConnector'
  | 'partHook'
  | 'partStore'
  | 'partLogic'
  | 'partApi'
  | 'partTypes';

export const SRIJIKA_STRUCTURE_CREATION_MATRIX = Object.freeze({
  featuresRoot: Object.freeze(['feature'] as const),
  feature: Object.freeze([
    'featureConnector',
    'featureHook',
    'featureStore',
    'featureLogic',
    'featureApi',
    'featureTypes',
    'slot',
  ] as const),
  slot: Object.freeze([
    'slotConnector',
    'slotHook',
    'slotStore',
    'slotLogic',
    'slotApi',
    'slotTypes',
    'part',
  ] as const),
  part: Object.freeze([
    'partConnector',
    'partHook',
    'partStore',
    'partLogic',
    'partApi',
    'partTypes',
  ] as const),
});

export const SRIJIKA_OWNER_FILE_CONTRACT = Object.freeze({
  required: Object.freeze(['ui', 'connector'] as const),
  optional: Object.freeze(['hook', 'store', 'logic', 'api', 'types'] as const),
});

export function normalizeSrijikaRelativePath(value: string): string {
  return value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+|\/+$/g, '');
}

export function srijikaPascalName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => `${segment.slice(0, 1).toLocaleUpperCase('en-US')}${segment.slice(1)}`)
    .join('');
}

export function srijikaFolderName(value: string): string {
  const characters = [...value];
  let output = '';
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index] ?? '';
    const previous = characters[index - 1];
    const next = characters[index + 1];
    if (
      /[A-Z]/.test(character) &&
      index > 0 &&
      ((previous !== undefined && /[a-z0-9]/.test(previous)) ||
        (previous !== undefined &&
          /[A-Z]/.test(previous) &&
          next !== undefined &&
          /[a-z]/.test(next)))
    ) {
      output += '-';
    }
    output += character.toLocaleLowerCase('en-US');
  }
  return output;
}

export function canonicalSrijikaOwnerName(value: string): string {
  return srijikaPascalName(srijikaFolderName(value));
}

export function resolveSrijikaStructureOwner(
  folder: string,
  architecture: Partial<SrijikaArchitectureConfig> = {},
): SrijikaStructureOwnerContext | null {
  const config = resolveSrijikaArchitectureConfig(architecture);
  const normalized = normalizeSrijikaRelativePath(folder);
  const rootSegments = config.featuresRoot.split('/');
  const segments = normalized.split('/');
  if (segments.slice(0, rootSegments.length).join('/') !== config.featuresRoot) return null;

  const remainder = segments.slice(rootSegments.length);
  if (remainder.length === 0) {
    return { level: 'featuresRoot', folder: config.featuresRoot };
  }
  if (remainder.length === 1 && remainder[0]) {
    return {
      level: 'feature',
      folder: normalized,
      featureName: srijikaPascalName(remainder[0]),
    };
  }
  if (
    remainder.length === 3 &&
    remainder[0] &&
    remainder[1] === config.slotsDirectory &&
    remainder[2]
  ) {
    return {
      level: 'slot',
      folder: normalized,
      featureName: srijikaPascalName(remainder[0]),
      slotName: srijikaPascalName(remainder[2]),
    };
  }
  if (
    remainder.length === 5 &&
    remainder[0] &&
    remainder[1] === config.slotsDirectory &&
    remainder[2] &&
    remainder[3] === config.partsDirectory &&
    remainder[4]
  ) {
    return {
      level: 'part',
      folder: normalized,
      featureName: srijikaPascalName(remainder[0]),
      slotName: srijikaPascalName(remainder[2]),
      partName: srijikaPascalName(remainder[4]),
    };
  }
  return null;
}

export function srijikaStructureCreationActionsForOwner(
  owner: SrijikaStructureOwnerContext,
): readonly SrijikaStructureCreationAction[] {
  return SRIJIKA_STRUCTURE_CREATION_MATRIX[owner.level];
}
