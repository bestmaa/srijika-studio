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
    'src/shared/ui/button',
    'src/shared/widgets/user-menu',
    'src/shared/capabilities/auth',
    'src/shared/freehand/nope',
    'src/components/legacy-home',
  ]);

  it('shows only canonical Feature, Slot, Part, and Shared owner folders', () => {
    expect(owners.map(({ relativeFolder }) => relativeFolder)).toEqual([
      'src/features',
      'src/shared',
      'src/features/dashboard',
      'src/shared/ui/button',
      'src/shared/widgets/user-menu',
      'src/shared/capabilities/auth',
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

  it('builds Shared UI, Widget, and Headless owners directly below Shared', () => {
    const shared = owners.find(({ level }) => level === 'sharedRoot');
    expect(shared && childSrijikaStructureOwners(owners, shared.relativeFolder)).toEqual([
      expect.objectContaining({ level: 'sharedUi', name: 'Button' }),
      expect.objectContaining({ level: 'sharedWidget', name: 'UserMenu' }),
      expect.objectContaining({ level: 'sharedCapability', name: 'Auth' }),
    ]);
  });

  it('honors configured Feature and Shared roots', () => {
    const configured = buildSrijikaStructureTreeOwners(
      [
        'product/features/dashboard',
        'product/features/dashboard/regions/summary',
        'product/features/dashboard/regions/summary/pieces/card',
        'common/widgets/toast',
      ],
      {
        featuresRoot: 'product/features',
        sharedRoot: 'common',
        slotsDirectory: 'regions',
        partsDirectory: 'pieces',
      },
    );
    expect(configured.map(({ relativeFolder }) => relativeFolder)).toEqual([
      'product/features',
      'common',
      'product/features/dashboard',
      'common/widgets/toast',
      'product/features/dashboard/regions/summary',
      'product/features/dashboard/regions/summary/pieces/card',
    ]);
    const feature = configured.find(({ level }) => level === 'feature');
    const slot = configured.find(({ level }) => level === 'slot');
    const part = configured.find(({ level }) => level === 'part');
    expect(feature && childSrijikaStructureOwners(configured, feature.relativeFolder)).toEqual([
      slot,
    ]);
    expect(slot && childSrijikaStructureOwners(configured, slot.relativeFolder)).toEqual([part]);
  });
});
