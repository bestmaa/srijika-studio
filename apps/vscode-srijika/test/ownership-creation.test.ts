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

  it('uses every configured directory and suffix for custom-root creation', () => {
    const architecture = {
      profile: 'feature-slot-part-v1' as const,
      featuresRoot: 'product/features',
      sharedRoot: 'common',
      slotsDirectory: 'regions',
      partsDirectory: 'pieces',
      hooksDirectory: 'behaviors',
      storesDirectory: 'state',
      uiSuffix: '.view.tsx',
      connectorSuffix: '.bridge.tsx',
      storeSuffix: '.state.ts',
      logicSuffix: '.rules.ts',
      apiSuffix: '.http.ts',
      typesSuffix: '.contracts.ts',
    };
    const feature = resolveSrijikaStructureOwner('product/features/home', architecture);
    if (!feature || feature.level !== 'feature') throw new Error('Expected custom Feature owner');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: feature,
      action: 'slot',
      name: 'Summary',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
      architecture,
    });

    expect(plan.ownerFolder).toBe('product/features/home/regions/summary');
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'product/features/home/regions/summary/Summary.view.tsx',
      'product/features/home/regions/summary/summary.contracts.ts',
      'product/features/home/regions/summary/summary.http.ts',
      'product/features/home/regions/summary/summary.rules.ts',
      'product/features/home/regions/summary/summary.state.ts',
      'product/features/home/regions/summary/useSummary.ts',
      'product/features/home/regions/summary/Summary.bridge.tsx',
    ]);
    expect(
      srijikaOwnershipFileStatuses(
        feature,
        ['product/features/home/Home.view.tsx'],
        architecture,
      ).find(({ role }) => role === 'ui'),
    ).toMatchObject({
      relativePath: 'product/features/home/Home.view.tsx',
      exists: true,
    });
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
    if (!feature || feature.level !== 'feature') throw new Error('Expected Feature owner');
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
    if (!slot || slot.level !== 'slot') throw new Error('Expected Slot owner');
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
      ownerPath: 'src/features/home',
      rootPath: 'src/features',
      ownerAction: 'feature' as const,
      behaviorAction: 'featureBehaviorHook' as const,
      name: 'Home',
      flatGateway: 'src/features/home/useHome.ts',
      expandedGateway: 'src/features/home/hooks/useHome.ts',
      helper: 'src/features/home/hooks/useHomeSearch.ts',
      connector: 'src/features/home/Home.connector.tsx',
      importText: "from './hooks/useHome'",
      outsideConsumer: 'src/app/home-runtime.ts',
      outsideImportBefore: "from '../features/home/useHome'",
      outsideImportAfter: "from '../features/home/hooks/useHome'",
    },
    {
      ownerPath: 'src/features/home/slots/navigation',
      rootPath: 'src/features/home',
      ownerAction: 'slot' as const,
      behaviorAction: 'slotBehaviorHook' as const,
      name: 'Navigation',
      flatGateway: 'src/features/home/slots/navigation/useNavigation.ts',
      expandedGateway: 'src/features/home/slots/navigation/hooks/useNavigation.ts',
      helper: 'src/features/home/slots/navigation/hooks/useNavigationSearch.ts',
      connector: 'src/features/home/slots/navigation/Navigation.connector.tsx',
      importText: "from './hooks/useNavigation'",
      outsideConsumer: 'src/app/navigation-runtime.ts',
      outsideImportBefore: "from '../features/home/slots/navigation/useNavigation'",
      outsideImportAfter: "from '../features/home/slots/navigation/hooks/useNavigation'",
    },
  ])(
    'atomically expands $name Hooks and rewires its Connector',
    ({
      ownerPath,
      rootPath,
      ownerAction,
      behaviorAction,
      name,
      flatGateway,
      expandedGateway,
      helper,
      connector,
      importText,
      outsideConsumer,
      outsideImportBefore,
      outsideImportAfter,
    }) => {
      const parent = resolveSrijikaStructureOwner(rootPath);
      const owner = resolveSrijikaStructureOwner(ownerPath);
      if (!parent || !owner) throw new Error('Expected owner boundaries');
      const base = buildSrijikaOwnershipCreationPlan({
        owner: parent,
        action: ownerAction,
        name,
        optionalCapabilities: ['hook'],
      });
      const plan = buildSrijikaOwnershipCreationPlan({
        owner,
        action: behaviorAction,
        name: 'Search',
        ...asExistingState([
          ...base.files,
          {
            relativePath: outsideConsumer,
            source: `import { use${name} } ${outsideImportBefore};\nvoid use${name};\n`,
          },
        ]),
      });
      expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([helper]);
      expect(plan.moves).toEqual([
        expect.objectContaining({
          fromRelativePath: flatGateway,
          toRelativePath: expandedGateway,
        }),
      ]);
      expect(plan.moves?.[0]?.source).toContain(`export { use${name}Search }`);
      expect(plan.updates.find(({ relativePath }) => relativePath === connector)?.source).toContain(
        importText,
      );
      expect(
        plan.updates.find(({ relativePath }) => relativePath === outsideConsumer)?.source,
      ).toContain(outsideImportAfter);
    },
  );

  it('expands Stores once, keeps one public gateway, and adds later concerns in-place', () => {
    const root = resolveSrijikaStructureOwner('src/features');
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!root || !feature) throw new Error('Expected Feature owner');
    const base = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'feature',
      name: 'Home',
      optionalCapabilities: ['hook', 'store'],
    });
    const first = buildSrijikaOwnershipCreationPlan({
      owner: feature,
      action: 'featureStoreSlice',
      name: 'Selection',
      ...asExistingState(base.files),
    });
    expect(first.files[0]?.relativePath).toBe('src/features/home/stores/homeSelection.store.ts');
    expect(first.moves?.[0]).toMatchObject({
      fromRelativePath: 'src/features/home/home.store.ts',
      toRelativePath: 'src/features/home/stores/home.store.ts',
    });
    expect(
      first.updates.find(({ relativePath }) => relativePath === 'src/features/home/useHome.ts')
        ?.source,
    ).toContain("from './stores/home.store'");

    const afterFirst = [
      ...base.files.filter(
        ({ relativePath }) => relativePath !== 'src/features/home/home.store.ts',
      ),
      ...first.files,
      ...(first.moves ?? []).map(({ toRelativePath, source }) => ({
        relativePath: toRelativePath,
        source,
      })),
      ...first.updates,
    ];
    const second = buildSrijikaOwnershipCreationPlan({
      owner: feature,
      action: 'featureStoreSlice',
      name: 'Filters',
      ...asExistingState(afterFirst),
    });
    expect(second.moves).toEqual([]);
    expect(second.files[0]?.relativePath).toBe('src/features/home/stores/homeFilters.store.ts');
    expect(second.updates).toEqual([
      expect.objectContaining({ relativePath: 'src/features/home/stores/home.store.ts' }),
    ]);
  });

  it('rejects mixed gateways, arbitrary helper names, and duplicate concerns', () => {
    const feature = resolveSrijikaStructureOwner('src/features/home');
    if (!feature) throw new Error('Expected Feature owner');
    const common = {
      owner: feature,
      action: 'featureBehaviorHook' as const,
      existingRelativePaths: [
        'src/features/home/Home.ui.tsx',
        'src/features/home/Home.connector.tsx',
        'src/features/home/useHome.ts',
        'src/features/home/hooks/useHome.ts',
      ],
      existingSources: {
        'src/features/home/useHome.ts': 'export function useHome() { return {}; }\n',
        'src/features/home/hooks/useHome.ts': 'export function useHome() { return {}; }\n',
      },
    };
    expect(() => buildSrijikaOwnershipCreationPlan({ ...common, name: 'Search' })).toThrow(
      'mixes flat and folder hook gateways',
    );
    expect(() => buildSrijikaOwnershipCreationPlan({ ...common, name: 'search_filter' })).toThrow(
      'normalized PascalCase',
    );
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

  it('offers exactly the three strict Shared owner kinds at the Shared root', () => {
    const sharedRoot = resolveSrijikaStructureOwner('src/shared');
    if (!sharedRoot || sharedRoot.level !== 'sharedRoot') throw new Error('Expected Shared root');
    expect(availableSrijikaOwnershipCreationActions(sharedRoot, [])).toEqual([
      'sharedUi',
      'sharedWidget',
      'sharedCapability',
    ]);
  });

  it('creates a props/events-only Shared UI Primitive with optional Types only', () => {
    const sharedRoot = resolveSrijikaStructureOwner('src/shared');
    if (!sharedRoot || sharedRoot.level !== 'sharedRoot') throw new Error('Expected Shared root');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: sharedRoot,
      action: 'sharedUi',
      name: 'Button',
      optionalCapabilities: ['types'],
    });
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/shared/ui/button/Button.ui.tsx',
      'src/shared/ui/button/button.types.ts',
    ]);
    expect(plan.files[0]?.source).not.toMatch(/Connector|useButton|buttonApi|buttonLogic/);
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: sharedRoot,
        action: 'sharedUi',
        name: 'Input',
        optionalCapabilities: ['hook'],
      }),
    ).toThrow('only the optional Types contract');
  });

  it('creates a Shared Widget with required UI + Connector and its selected chain', () => {
    const sharedRoot = resolveSrijikaStructureOwner('src/shared');
    if (!sharedRoot || sharedRoot.level !== 'sharedRoot') throw new Error('Expected Shared root');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: sharedRoot,
      action: 'sharedWidget',
      name: 'UserMenu',
      optionalCapabilities: ['hook', 'logic'],
    });
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/shared/widgets/user-menu/UserMenu.ui.tsx',
      'src/shared/widgets/user-menu/userMenu.logic.ts',
      'src/shared/widgets/user-menu/useUserMenu.ts',
      'src/shared/widgets/user-menu/UserMenu.connector.tsx',
    ]);
    expect(plan.files.at(-1)?.source).toContain("from './useUserMenu'");
  });

  it('keeps a Headless Capability UI-free and requires a runtime layer', () => {
    const sharedRoot = resolveSrijikaStructureOwner('src/shared');
    if (!sharedRoot || sharedRoot.level !== 'sharedRoot') throw new Error('Expected Shared root');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: sharedRoot,
        action: 'sharedCapability',
        name: 'Auth',
        optionalCapabilities: ['types'],
      }),
    ).toThrow('requires at least one runtime layer');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner: sharedRoot,
      action: 'sharedCapability',
      name: 'Auth',
      optionalCapabilities: ['hook', 'logic', 'api', 'types'],
    });
    expect(plan.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/shared/capabilities/auth/auth.types.ts',
      'src/shared/capabilities/auth/auth.api.ts',
      'src/shared/capabilities/auth/auth.logic.ts',
      'src/shared/capabilities/auth/useAuth.ts',
    ]);
    expect(
      plan.files.some(({ relativePath }) => /\.ui\.tsx|\.connector\.tsx/.test(relativePath)),
    ).toBe(false);
  });

  it.each([
    {
      ownerPath: 'src/shared/widgets/user-menu',
      createAction: 'sharedWidget' as const,
      expansionAction: 'sharedWidgetBehaviorHook' as const,
      ownerName: 'UserMenu',
      gateway: 'src/shared/widgets/user-menu/hooks/useUserMenu.ts',
      helper: 'src/shared/widgets/user-menu/hooks/useUserMenuKeyboard.ts',
    },
    {
      ownerPath: 'src/shared/capabilities/auth',
      createAction: 'sharedCapability' as const,
      expansionAction: 'sharedCapabilityBehaviorHook' as const,
      ownerName: 'Auth',
      gateway: 'src/shared/capabilities/auth/hooks/useAuth.ts',
      helper: 'src/shared/capabilities/auth/hooks/useAuthKeyboard.ts',
    },
  ])(
    'safely organizes multiple Hooks for $ownerPath',
    ({ ownerPath, createAction, expansionAction, ownerName, gateway, helper }) => {
      const sharedRoot = resolveSrijikaStructureOwner('src/shared');
      const owner = resolveSrijikaStructureOwner(ownerPath);
      if (!sharedRoot || sharedRoot.level !== 'sharedRoot' || !owner) {
        throw new Error('Expected Shared owners');
      }
      const base = buildSrijikaOwnershipCreationPlan({
        owner: sharedRoot,
        action: createAction,
        name: ownerName,
        optionalCapabilities: ['hook'],
      });
      const expanded = buildSrijikaOwnershipCreationPlan({
        owner,
        action: expansionAction,
        name: 'Keyboard',
        ...asExistingState(base.files),
      });
      expect(expanded.moves?.[0]?.toRelativePath).toBe(gateway);
      expect(expanded.files[0]?.relativePath).toBe(helper);
    },
  );

  it('rewires reserved and declared VS Code aliases and rejects an exact gateway alias', () => {
    const featuresRoot = resolveSrijikaStructureOwner('src/features');
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!featuresRoot || featuresRoot.level !== 'featuresRoot' || !owner) {
      throw new Error('Expected Feature owners');
    }
    const base = buildSrijikaOwnershipCreationPlan({
      owner: featuresRoot,
      action: 'feature',
      name: 'Home',
      optionalCapabilities: ['hook'],
    });
    const sources = {
      ...asExistingState(base.files).existingSources,
      'src/app/declared.ts': "export { useHome } from '@app/features/home/useHome.js';\n",
      'src/app/reserved.ts': "export { useHome } from '@features/home/useHome.js';\n",
    };
    const paths = Object.keys(sources);

    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner,
        action: 'featureBehaviorHook',
        name: 'Keyboard',
        existingRelativePaths: paths,
        existingSources: sources,
        aliases: { '#home': 'src/features/home/useHome.ts' },
      }),
    ).toThrow(/exact tsconfig alias #home/);

    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'featureBehaviorHook',
      name: 'Keyboard',
      existingRelativePaths: paths,
      existingSources: sources,
      aliases: { '@app/': 'src' },
    });
    expect(
      plan.updates.find(({ relativePath }) => relativePath === 'src/app/declared.ts')?.source,
    ).toContain("'@app/features/home/hooks/useHome.js'");
    expect(
      plan.updates.find(({ relativePath }) => relativePath === 'src/app/reserved.ts')?.source,
    ).toContain("'@features/home/hooks/useHome.js'");
  });
});
