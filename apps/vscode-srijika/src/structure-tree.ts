import {
  resolveSrijikaStructureOwner,
  type SrijikaStructureOwnerContext,
} from '@srijika/architecture-rules';

export type SrijikaStructureTreeLevel = 'featuresRoot' | 'feature' | 'slot' | 'part';

export interface SrijikaStructureTreeOwner {
  level: SrijikaStructureTreeLevel;
  name: string;
  relativeFolder: string;
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
  }
}

export function buildSrijikaStructureTreeOwners(
  sourceFolders: readonly string[],
): readonly SrijikaStructureTreeOwner[] {
  const owners = new Map<string, SrijikaStructureTreeOwner>();
  for (const rawFolder of ['src/features', ...sourceFolders]) {
    const relativeFolder = normalizedFolder(rawFolder);
    const owner = resolveSrijikaStructureOwner(relativeFolder);
    if (!owner) continue;
    owners.set(relativeFolder.toLocaleLowerCase('en-US'), {
      level: owner.level,
      name: ownerName(owner),
      relativeFolder,
      owner,
    });
  }

  const levelOrder: Readonly<Record<SrijikaStructureTreeLevel, number>> = {
    featuresRoot: 0,
    feature: 1,
    slot: 2,
    part: 3,
  };
  return [...owners.values()].sort(
    (left, right) =>
      levelOrder[left.level] - levelOrder[right.level] ||
      left.relativeFolder.localeCompare(right.relativeFolder),
  );
}

export function parentSrijikaStructureFolder(owner: SrijikaStructureTreeOwner): string | null {
  switch (owner.level) {
    case 'featuresRoot':
      return null;
    case 'feature':
      return 'src/features';
    case 'slot':
      return owner.relativeFolder.slice(0, owner.relativeFolder.lastIndexOf('/slots/'));
    case 'part':
      return owner.relativeFolder.slice(0, owner.relativeFolder.lastIndexOf('/parts/'));
  }
}

export function childSrijikaStructureOwners(
  owners: readonly SrijikaStructureTreeOwner[],
  parentFolder: string | null,
): readonly SrijikaStructureTreeOwner[] {
  return owners.filter((owner) => parentSrijikaStructureFolder(owner) === parentFolder);
}
