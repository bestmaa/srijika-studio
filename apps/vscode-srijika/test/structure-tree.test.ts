import { describe, expect, it } from 'vitest';

import {
  buildSrijikaStructureTreeOwners,
  childSrijikaStructureOwners,
  parentSrijikaStructureFolder,
} from '../src/structure-tree';

describe('Srijika Structure sidebar model', () => {
  const owners = buildSrijikaStructureTreeOwners([
    'src/features/dashboard',
    'src/features/dashboard/slots/navigation',
    'src/features/dashboard/slots/navigation/parts/user-menu',
    'src/features/dashboard/random-folder',
    'src/components/legacy-home',
  ]);

  it('shows only canonical Feature, Slot, and Part owner folders', () => {
    expect(owners.map(({ relativeFolder }) => relativeFolder)).toEqual([
      'src/features',
      'src/features/dashboard',
      'src/features/dashboard/slots/navigation',
      'src/features/dashboard/slots/navigation/parts/user-menu',
    ]);
  });

  it('builds the exact Feature to Slot to Part hierarchy used by inline Add', () => {
    const root = owners.find(({ level }) => level === 'featuresRoot');
    const feature = owners.find(({ level }) => level === 'feature');
    const slot = owners.find(({ level }) => level === 'slot');
    const part = owners.find(({ level }) => level === 'part');
    expect(root && childSrijikaStructureOwners(owners, root.relativeFolder)).toEqual([feature]);
    expect(feature && childSrijikaStructureOwners(owners, feature.relativeFolder)).toEqual([slot]);
    expect(slot && childSrijikaStructureOwners(owners, slot.relativeFolder)).toEqual([part]);
    expect(part && parentSrijikaStructureFolder(part)).toBe(
      'src/features/dashboard/slots/navigation',
    );
  });
});
