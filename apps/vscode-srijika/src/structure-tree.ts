import {
  resolveSrijikaArchitectureConfig,
  resolveSrijikaStructureOwner,
  type SrijikaArchitectureConfig,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';

export type SrijikaStructureTreeLevel = SrijikaStructureOwnerContext['level'];

export interface SrijikaStructureTreeOwner {
  level: SrijikaStructureTreeLevel;
  name: string;
  relativeFolder: string;
  parentRelativeFolder: string | null;
  owner: SrijikaStructureOwnerContext;
}

function normalizedFolder(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
}

function ownerName(owner: SrijikaStructureOwnerContext): string {
  switch (owner.level) {
    case 'featuresRoot':
      return 'Features';
    case 'feature':
      return owner.featureName;
    case 'slot':
      return owner.slotName;
    case 'part':
      return owner.partName;
    case 'sharedRoot':
      return 'Shared';
    case 'sharedUi':
    case 'sharedWidget':
    case 'sharedCapability':
      return owner.sharedName;
  }
}

function ownerParentFolder(
  owner: SrijikaStructureOwnerContext,
  architecture: ReturnType<typeof resolveSrijikaArchitectureConfig>,
): string | null {
  switch (owner.level) {
    case 'featuresRoot':
    case 'sharedRoot':
      return null;
    case 'feature':
      return architecture.featuresRoot;
    case 'slot':
      return owner.folder.slice(
        0,
        owner.folder.lastIndexOf('/' + architecture.slotsDirectory + '/'),
      );
    case 'part':
      return owner.folder.slice(
        0,
        owner.folder.lastIndexOf('/' + architecture.partsDirectory + '/'),
      );
    case 'sharedUi':
    case 'sharedWidget':
    case 'sharedCapability':
      return architecture.sharedRoot;
  }
}

export function buildSrijikaStructureTreeOwners(
  sourceFolders: readonly string[],
  architecture: Partial<SrijikaArchitectureConfig> = {},
): readonly SrijikaStructureTreeOwner[] {
  const config = resolveSrijikaArchitectureConfig(architecture);
  const owners = new Map<string, SrijikaStructureTreeOwner>();
  for (const rawFolder of [config.featuresRoot, config.sharedRoot, ...sourceFolders]) {
    const relativeFolder = normalizedFolder(rawFolder);
    const owner = resolveSrijikaStructureOwner(relativeFolder, config);
    if (!owner) continue;
    owners.set(relativeFolder.toLocaleLowerCase('en-US'), {
      level: owner.level,
      name: ownerName(owner),
      relativeFolder,
      parentRelativeFolder: ownerParentFolder(owner, config),
      owner,
    });
  }

  const levelOrder: Readonly<Record<SrijikaStructureTreeLevel, number>> = {
    featuresRoot: 0,
    sharedRoot: 1,
    feature: 2,
    sharedUi: 2,
    sharedWidget: 3,
    sharedCapability: 4,
    slot: 5,
    part: 6,
  };
  return [...owners.values()].sort(
    (left, right) =>
      levelOrder[left.level] - levelOrder[right.level] ||
      left.relativeFolder.localeCompare(right.relativeFolder),
  );
}

export function parentSrijikaStructureFolder(owner: SrijikaStructureTreeOwner): string | null {
  return owner.parentRelativeFolder;
}

export function childSrijikaStructureOwners(
  owners: readonly SrijikaStructureTreeOwner[],
  parentFolder: string | null,
): readonly SrijikaStructureTreeOwner[] {
  return owners.filter((owner) => parentSrijikaStructureFolder(owner) === parentFolder);
}
