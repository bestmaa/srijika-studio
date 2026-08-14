import { describe, expect, it } from 'vitest';

import {
  canonicalSrijikaOwnerName,
  resolveSrijikaStructureOwner,
  srijikaFolderName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_FILE_CONTRACT,
} from '../src';

describe('strict Srijika structure creation contract', () => {
  it('resolves only canonical Feature, Slot, and Part owner folders', () => {
    expect(resolveSrijikaStructureOwner('src/features')).toEqual({
      level: 'featuresRoot',
      folder: 'src/features',
    });
    expect(resolveSrijikaStructureOwner('src/features/audit-dashboard')).toMatchObject({
      level: 'feature',
      featureName: 'AuditDashboard',
    });
    expect(
      resolveSrijikaStructureOwner('src/features/audit-dashboard/slots/navigation'),
    ).toMatchObject({ level: 'slot', slotName: 'Navigation' });
    expect(
      resolveSrijikaStructureOwner('src/features/audit-dashboard/slots/navigation/parts/user-menu'),
    ).toMatchObject({ level: 'part', partName: 'UserMenu' });

    expect(resolveSrijikaStructureOwner('src/components/home')).toBeNull();
    expect(resolveSrijikaStructureOwner('src/features/audit-dashboard/random')).toBeNull();
    expect(
      resolveSrijikaStructureOwner('src/features/audit-dashboard/slots/navigation/parts'),
    ).toBeNull();
  });

  it('exposes only the allowed actions at each owner boundary', () => {
    const feature = resolveSrijikaStructureOwner('src/features/dashboard');
    const slot = resolveSrijikaStructureOwner('src/features/dashboard/slots/navigation');
    const part = resolveSrijikaStructureOwner(
      'src/features/dashboard/slots/navigation/parts/user-menu',
    );
    if (!feature || !slot || !part) throw new Error('Expected canonical owners');

    expect(srijikaStructureCreationActionsForOwner(feature)).toEqual([
      'featureConnector',
      'featureHook',
      'featureStore',
      'featureLogic',
      'featureApi',
      'featureTypes',
      'slot',
    ]);
    expect(srijikaStructureCreationActionsForOwner(slot).at(-1)).toBe('part');
    expect(srijikaStructureCreationActionsForOwner(part)).not.toContain('slot');
    expect(SRIJIKA_OWNER_FILE_CONTRACT).toEqual({
      required: ['ui', 'connector'],
      optional: ['hook', 'store', 'logic', 'api', 'types'],
    });
  });

  it('normalizes one owner name into exact PascalCase and kebab-case forms', () => {
    expect(srijikaFolderName('AuditDashboard')).toBe('audit-dashboard');
    expect(canonicalSrijikaOwnerName('AuditDashboard')).toBe('AuditDashboard');
    expect(canonicalSrijikaOwnerName('XMLParser')).toBe('XmlParser');
  });

  it('honors configured canonical root names without opening arbitrary paths', () => {
    const owner = resolveSrijikaStructureOwner('app/modules/orders/regions/summary', {
      profile: 'feature-slot-part-v1',
      featuresRoot: 'app/modules',
      slotsDirectory: 'regions',
    });
    expect(owner).toMatchObject({ level: 'slot', featureName: 'Orders', slotName: 'Summary' });
    expect(
      resolveSrijikaStructureOwner('src/features/orders', {
        profile: 'feature-slot-part-v1',
        featuresRoot: 'app/modules',
      }),
    ).toBeNull();
  });
});
