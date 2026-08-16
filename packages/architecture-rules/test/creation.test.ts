import { describe, expect, it } from 'vitest';

import {
  canonicalSrijikaOwnerName,
  resolveSrijikaStructureOwner,
  srijikaFolderName,
  srijikaStructureCreationActionsForOwner,
  SRIJIKA_OWNER_FILE_CONTRACT,
  SRIJIKA_SHARED_FILE_CONTRACT,
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
    expect(resolveSrijikaStructureOwner('src/features/AuditDashboard')).toBeNull();
    expect(resolveSrijikaStructureOwner('src/features/audit_dashboard')).toBeNull();
    expect(
      resolveSrijikaStructureOwner('src/features/audit-dashboard/slots/MainNavigation'),
    ).toBeNull();
    expect(
      resolveSrijikaStructureOwner('src/features/audit-dashboard/slots/navigation/parts/User_Menu'),
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
      'featureBehaviorHook',
      'featureStore',
      'featureStoreSlice',
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

  it('resolves only canonical Shared owner categories and exposes deterministic actions', () => {
    expect(resolveSrijikaStructureOwner('src/shared')).toEqual({
      level: 'sharedRoot',
      folder: 'src/shared',
    });
    const primitive = resolveSrijikaStructureOwner('src/shared/ui/action-button');
    const widget = resolveSrijikaStructureOwner('src/shared/widgets/user-menu');
    const capability = resolveSrijikaStructureOwner('src/shared/capabilities/auth');
    expect(primitive).toMatchObject({ level: 'sharedUi', sharedName: 'ActionButton' });
    expect(widget).toMatchObject({ level: 'sharedWidget', sharedName: 'UserMenu' });
    expect(capability).toMatchObject({ level: 'sharedCapability', sharedName: 'Auth' });
    expect(resolveSrijikaStructureOwner('src/shared/random/auth')).toBeNull();
    expect(resolveSrijikaStructureOwner('src/shared/widgets/user-menu/private')).toBeNull();
    expect(resolveSrijikaStructureOwner('src/shared/ui/ActionButton')).toBeNull();
    expect(resolveSrijikaStructureOwner('src/shared/widgets/user_menu')).toBeNull();
    if (!primitive || !widget || !capability) throw new Error('Expected Shared owners.');
    expect(srijikaStructureCreationActionsForOwner(primitive)).toEqual(['sharedUiTypes']);
    expect(srijikaStructureCreationActionsForOwner(widget)).toContain('sharedWidgetConnector');
    expect(srijikaStructureCreationActionsForOwner(capability)).not.toContain(
      'sharedCapabilityConnector',
    );
    expect(SRIJIKA_SHARED_FILE_CONTRACT.capability.minimumRuntimeCapabilities).toBe(1);
  });

  it('honors a configured Shared root', () => {
    expect(
      resolveSrijikaStructureOwner('app/common/widgets/toast', {
        profile: 'feature-slot-part-v1',
        sharedRoot: 'app/common',
      }),
    ).toMatchObject({ level: 'sharedWidget', sharedName: 'Toast' });
  });
});
