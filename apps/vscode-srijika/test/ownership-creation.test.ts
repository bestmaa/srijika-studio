import { describe, expect, it } from 'vitest';

import { resolveSrijikaStructureOwner } from '@srijika/architecture-rules';
import {
  availableSrijikaOwnershipCreationActions,
  buildSrijikaOwnershipCapabilityBatchPlan,
  buildSrijikaOwnershipCreationPlan,
  srijikaOwnershipFileStatuses,
} from '../src/ownership-creation';

describe('VS Code strict ownership-aware creation', () => {
  const asExistingState = (
    files: readonly { relativePath: string; source: string }[],
  ): {
    existingRelativePaths: readonly string[];
    existingSources: Readonly<Record<string, string>>;
  } => ({
    existingRelativePaths: files.map(({ relativePath }) => relativePath),
    existingSources: Object.fromEntries(
      files.map(({ relativePath, source }) => [relativePath, source]),
    ),
  });

  it('creates required UI and Connector plus only checked optional files', () => {
    const root = resolveSrijikaStructureOwner('src/features');
    if (!root) throw new Error('Expected features root');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'feature',
      name: 'AuditDashboard',
      optionalCapabilities: ['hook', 'logic', 'api', 'types'],
    });
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/features/audit-dashboard/AuditDashboard.ui.tsx',
      'src/features/audit-dashboard/auditDashboard.types.ts',
      'src/features/audit-dashboard/auditDashboard.api.ts',
      'src/features/audit-dashboard/auditDashboard.logic.ts',
      'src/features/audit-dashboard/useAuditDashboard.ts',
      'src/features/audit-dashboard/AuditDashboard.connector.tsx',
    ]);
    expect(plan.files.at(-1)?.source).toContain("from './useAuditDashboard'");
  });

  it('creates a named Part only under a Slot and always includes its Connector', () => {
    const slot = resolveSrijikaStructureOwner('src/features/home/slots/navigation');
    if (!slot) throw new Error('Expected slot owner');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: slot,
      action: 'part',
      name: 'UserMenu',
      optionalCapabilities: ['store'],
    });
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx',
      'src/features/home/slots/navigation/parts/user-menu/userMenu.store.ts',
      'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx',
    ]);
  });

  it('blocks wrong-boundary actions, noncanonical names, duplicates, and broken owners', () => {
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!feature) throw new Error('Expected feature owner');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({ owner: feature, action: 'part', name: 'Menu' }),
    ).toThrow('not allowed');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({ owner: feature, action: 'slot', name: 'user_menu' }),
    ).toThrow('normalized PascalCase');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: feature,
        action: 'slot',
        name: 'Navigation',
        existingRelativePaths: ['src/features/home/slots/navigation/Navigation.connector.tsx'],
      }),
    ).toThrow('already exists');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: feature,
        action: 'featureHook',
        existingRelativePaths: [],
      }),
    ).toThrow('Required src/features/home/Home.ui.tsx is missing');
  });

  it('uses the highest available junior layer for standalone creation', () => {
    const root = resolveSrijikaStructureOwner('src/features');
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!root || !feature) throw new Error('Expected feature owners');
    const existing = asExistingState(
      buildSrijikaOwnershipCreationPlan({
        owner: root,
        action: 'feature',
        name: 'Home',
        optionalCapabilities: ['store', 'logic'],
      }).files,
    );
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: feature,
      action: 'featureHook',
      ...existing,
    });
    expect(plan.files[0]?.source).toContain("from './home.store'");
    expect(plan.files[0]?.source).not.toContain("from './home.logic'");
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.relativePath).toBe('src/features/home/Home.connector.tsx');
    expect(plan.updates[0]?.source).toContain("from './useHome'");
    expect(plan.updates[0]?.source).not.toContain("from './home.store'");
  });

  it('offers only missing capabilities while keeping child-owner creation available', () => {
    const root = resolveSrijikaStructureOwner('src/features');
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!root || !feature) throw new Error('Expected feature owners');
    const existing = asExistingState(
      buildSrijikaOwnershipCreationPlan({
        owner: root,
        action: 'feature',
        name: 'Home',
        optionalCapabilities: ['store'],
      }).files,
    );
    const actions = availableSrijikaOwnershipCreationActions(
      feature,
      existing.existingRelativePaths,
      existing.existingSources,
    );
    expect(actions).not.toContain('featureConnector');
    expect(actions).not.toContain('featureStore');
    expect(actions).toContain('featureHook');
    expect(actions).toContain('featureLogic');
    expect(actions).toContain('slot');
  });

  it('refuses to rewrite a customized senior file when inserting a capability', () => {
    const root = resolveSrijikaStructureOwner('src/features');
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!root || !feature) throw new Error('Expected feature owners');
    const base = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'feature',
      name: 'Home',
      optionalCapabilities: ['store'],
    });
    const existing = asExistingState(base.files);
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: feature,
        action: 'featureHook',
        ...existing,
        existingSources: {
          ...existing.existingSources,
          'src/features/home/Home.connector.tsx':
            'export function HomeConnector() { return null; }\n',
        },
      }),
    ).toThrow('contains custom code');
  });

  it('keeps missing capabilities visible and batch-creates them through a custom Connector', () => {
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!feature || feature.level === 'featuresRoot') throw new Error('Expected Feature owner');
    const existingRelativePaths = [
      'src/features/home/Home.ui.tsx',
      'src/features/home/Home.connector.tsx',
      'src/features/home/home.types.ts',
    ];
    const customConnector = [
      "import { HomeUI } from './Home.ui';",
      '',
      'export function HomeConnector() {',
      '  const customBehavior = true;',
      '  void customBehavior;',
      '  return <HomeUI />;',
      '}',
      '',
    ].join('\n');
    const existingSources = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }\n',
      'src/features/home/Home.connector.tsx': customConnector,
      'src/features/home/home.types.ts': 'export interface HomeResult { ok: boolean; }\n',
    };
    const actions = availableSrijikaOwnershipCreationActions(
      feature,
      existingRelativePaths,
      existingSources,
    );
    expect(actions).toEqual(['featureHook', 'featureStore', 'featureLogic', 'featureApi', 'slot']);

    const plan = buildSrijikaOwnershipCapabilityBatchPlan({
      owner: feature,
      actions: ['featureHook', 'featureStore', 'featureLogic', 'featureApi'],
      existingRelativePaths,
      existingSources,
    });
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/features/home/useHome.ts',
      'src/features/home/home.store.ts',
      'src/features/home/home.logic.ts',
      'src/features/home/home.api.ts',
    ]);
    expect(plan.files[0]?.source).toContain("from './home.store'");
    expect(plan.files[1]?.source).toContain("from './home.logic'");
    expect(plan.files[2]?.source).toContain("from './home.api'");
    expect(plan.files[3]?.source).toContain("from './home.types'");
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.source).toContain("import { useHome } from './useHome';");
    expect(plan.updates[0]?.source).toContain('const srijikaHomeModel = useHome();');
    expect(plan.updates[0]?.source).toContain('return <HomeUI />;');
  });

  it('reports every owner file as Created or Missing for the visual checklist', () => {
    const slot = resolveSrijikaStructureOwner('src/features/home/slots/new');
    if (!slot || slot.level === 'featuresRoot') throw new Error('Expected Slot owner');
    const statuses = srijikaOwnershipFileStatuses(slot, [
      'src/features/home/slots/new/New.ui.tsx',
      'src/features/home/slots/new/New.connector.tsx',
      'src/features/home/slots/new/useNew.ts',
      'src/features/home/slots/new/new.logic.ts',
    ]);
    expect(statuses.map(({ role, exists }) => [role, exists])).toEqual([
      ['ui', true],
      ['connector', true],
      ['hook', true],
      ['store', false],
      ['logic', true],
      ['api', false],
      ['types', false],
    ]);
    expect(statuses.find(({ role }) => role === 'store')?.action).toBe('slotStore');
  });

  it.each([
    {
      action: 'featureHook' as const,
      existingCapabilities: ['store', 'logic', 'api', 'types'] as const,
      createdPath: 'src/features/home/useHome.ts',
      updatedPath: 'src/features/home/Home.connector.tsx',
      updatedImport: "from './useHome'",
    },
    {
      action: 'featureStore' as const,
      existingCapabilities: ['hook', 'logic', 'api', 'types'] as const,
      createdPath: 'src/features/home/home.store.ts',
      updatedPath: 'src/features/home/useHome.ts',
      updatedImport: "from './home.store'",
    },
    {
      action: 'featureLogic' as const,
      existingCapabilities: ['hook', 'store', 'api', 'types'] as const,
      createdPath: 'src/features/home/home.logic.ts',
      updatedPath: 'src/features/home/home.store.ts',
      updatedImport: "from './home.logic'",
    },
    {
      action: 'featureApi' as const,
      existingCapabilities: ['hook', 'store', 'logic', 'types'] as const,
      createdPath: 'src/features/home/home.api.ts',
      updatedPath: 'src/features/home/home.logic.ts',
      updatedImport: "from './home.api'",
    },
    {
      action: 'featureTypes' as const,
      existingCapabilities: ['hook', 'store', 'logic', 'api'] as const,
      createdPath: 'src/features/home/home.types.ts',
      updatedPath: 'src/features/home/home.api.ts',
      updatedImport: "from './home.types'",
    },
  ])(
    'atomically inserts $action at its exact senior boundary',
    ({ action, existingCapabilities, createdPath, updatedPath, updatedImport }) => {
      const root = resolveSrijikaStructureOwner('src/features');
      const feature = resolveSrijikaStructureOwner('src/features/home');
      if (!root || !feature) throw new Error('Expected feature owners');
      const existing = asExistingState(
        buildSrijikaOwnershipCreationPlan({
          owner: root,
          action: 'feature',
          name: 'Home',
          optionalCapabilities: existingCapabilities,
        }).files,
      );
      const plan = buildSrijikaOwnershipCreationPlan({ owner: feature, action, ...existing });
      expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([createdPath]);
      expect(plan.updates.map(({ relativePath }) => relativePath)).toEqual([updatedPath]);
      expect(plan.updates[0]?.source).toContain(updatedImport);
    },
  );
});
