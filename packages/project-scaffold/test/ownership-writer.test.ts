import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveSrijikaStructureOwner } from '@srijika/architecture-rules';

import {
  applySrijikaOwnershipCreationPlan,
  availableSrijikaOwnershipCreationActions,
  buildSrijikaOwnershipCapabilityBatchPlan,
  buildSrijikaOwnershipCreationPlan,
  createSrijikaProjectFileMap,
  srijikaOwnershipFileStatuses,
} from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'srijika-owner-writer-'));
  roots.push(root);
  return root;
}

describe('applySrijikaOwnershipCreationPlan', () => {
  it('creates a complete owner batch without overwriting any target', async () => {
    const root = await temporaryRoot();
    const owner = resolveSrijikaStructureOwner('src/features');
    if (!owner) throw new Error('Expected the Features root.');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'logic', 'types'],
    });

    const result = await applySrijikaOwnershipCreationPlan(root, plan);

    expect(result.created).toHaveLength(5);
    await expect(
      readFile(join(root, 'src/features/dashboard/Dashboard.connector.tsx'), 'utf8'),
    ).resolves.toContain("import { useDashboard } from './useDashboard';");
    await expect(applySrijikaOwnershipCreationPlan(root, plan)).rejects.toThrow(/already exists/);
  });

  it('rejects a stale planned update before replacing custom source', async () => {
    const root = await temporaryRoot();
    const relativePath = 'src/features/home/Home.connector.tsx';
    const absolutePath = join(root, relativePath);
    await mkdir(join(root, 'src/features/home'), { recursive: true });
    await writeFile(absolutePath, 'newer user source', { encoding: 'utf8', flag: 'wx' });
    const plan = {
      ownerName: 'Home',
      ownerFolder: 'src/features/home',
      files: [],
      updates: [{ relativePath, source: 'planned source' }],
    } as const;

    await expect(
      applySrijikaOwnershipCreationPlan(root, plan, {
        expectedUpdateSources: { [relativePath]: 'older source' },
      }),
    ).rejects.toThrow(/changed after planning/);
  });

  it('rejects a symbolic-link owner ancestor without writing outside the project', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    await mkdir(join(root, 'src/features'), { recursive: true });
    await symlink(outside, join(root, 'src/features/home'), 'dir');
    const owner = resolveSrijikaStructureOwner('src/features');
    if (!owner) throw new Error('Expected the Features root.');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'feature',
      name: 'Home',
      optionalCapabilities: ['hook', 'store'],
    });

    await expect(applySrijikaOwnershipCreationPlan(root, plan)).rejects.toThrow(
      /symbolic-link directory/,
    );
    await expect(readFile(join(outside, 'Home.ui.tsx'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(outside, 'Home.connector.tsx'), 'utf8')).rejects.toThrow();
  });

  it('atomically expands a flat Hook gateway and rewires its consumers', async () => {
    const root = await temporaryRoot();
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner) throw new Error('Expected the Home feature owner.');
    const ownerFolder = join(root, 'src/features/home');
    await mkdir(ownerFolder, { recursive: true });
    const existingSources = {
      'src/features/home/Home.ui.tsx': 'export function HomeUI() { return null; }\n',
      'src/features/home/Home.connector.tsx':
        "import { useHome } from './useHome';\nexport function HomeConnector() { return useHome(); }\n",
      'src/features/home/useHome.ts': 'export function useHome() { return { ready: true }; }\n',
    };
    await Promise.all(
      Object.entries(existingSources).map(([relativePath, source]) =>
        writeFile(join(root, relativePath), source, { encoding: 'utf8', flag: 'wx' }),
      ),
    );

    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'featureBehaviorHook',
      name: 'Keyboard',
      existingRelativePaths: Object.keys(existingSources),
      existingSources,
    });
    const result = await applySrijikaOwnershipCreationPlan(root, plan, {
      expectedUpdateSources: existingSources,
    });

    expect(result.moved).toEqual([
      {
        from: 'src/features/home/useHome.ts',
        to: 'src/features/home/hooks/useHome.ts',
      },
    ]);
    await expect(readFile(join(ownerFolder, 'useHome.ts'), 'utf8')).rejects.toThrow();
    await expect(
      readFile(join(ownerFolder, 'hooks/useHomeKeyboard.ts'), 'utf8'),
    ).resolves.toContain('useHomeKeyboard');
    await expect(readFile(join(ownerFolder, 'hooks/useHome.ts'), 'utf8')).resolves.toContain(
      "export { useHomeKeyboard } from './useHomeKeyboard';",
    );
    await expect(readFile(join(ownerFolder, 'Home.connector.tsx'), 'utf8')).resolves.toContain(
      "from './hooks/useHome'",
    );
  });

  it('completes Logic, API, and Types without overwriting the official custom Home Store', async () => {
    const root = await temporaryRoot();
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner || owner.level !== 'feature') throw new Error('Expected the Home feature.');
    const starter = createSrijikaProjectFileMap();
    const homeStorePath = 'src/features/home/home.store.ts';
    const originalStore = starter[homeStorePath];
    if (!originalStore) throw new Error('Expected the official Home Store source.');
    for (const relativePath of [
      'src/features/home/Home.ui.tsx',
      'src/features/home/Home.connector.tsx',
      'src/features/home/useHome.ts',
      homeStorePath,
    ]) {
      const source = starter[relativePath];
      if (!source) throw new Error(`Missing starter source: ${relativePath}`);
      await mkdir(join(root, relativePath, '..'), { recursive: true });
      await writeFile(join(root, relativePath), source, { encoding: 'utf8', flag: 'wx' });
    }

    const existingSources = Object.fromEntries(
      Object.entries(starter).filter(([relativePath]) => relativePath.startsWith('src/features/')),
    );
    const plan = buildSrijikaOwnershipCapabilityBatchPlan({
      owner,
      actions: ['featureLogic', 'featureApi', 'featureTypes'],
      existingRelativePaths: Object.keys(existingSources),
      existingSources,
    });
    await applySrijikaOwnershipCreationPlan(root, plan, {
      expectedUpdateSources: existingSources,
    });

    await expect(readFile(join(root, homeStorePath), 'utf8')).resolves.toBe(originalStore);
    await expect(
      readFile(join(root, 'src/features/home/home.logic.ts'), 'utf8'),
    ).resolves.toContain("from './home.api'");
    await expect(readFile(join(root, 'src/features/home/home.api.ts'), 'utf8')).resolves.toContain(
      "from './home.types'",
    );
  });

  it('moves the official connected Home Hook and Store gateways and rewrites every consumer', async () => {
    const starter = createSrijikaProjectFileMap();
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner || owner.level !== 'feature') throw new Error('Expected the Home feature.');

    const hookRoot = await temporaryRoot();
    const hookSources = Object.fromEntries(
      [
        'src/features/home/Home.ui.tsx',
        'src/features/home/Home.connector.tsx',
        'src/features/home/useHome.ts',
        'src/features/home/home.store.ts',
      ].map((relativePath) => [relativePath, starter[relativePath] ?? '']),
    );
    hookSources['src/features/home/useHome.ts'] +=
      "void import(`./home.store.js`);\nconst note = './home.store';\n";
    hookSources['src/app/home-hook-consumer.ts'] =
      "import { useHome } from '../features/home/useHome';\nvoid useHome;\n";
    hookSources['src/app/home-hook-dynamic.ts'] = 'void import(`../features/home/useHome`);\n';
    hookSources['src/app/home-hook-js-extension.ts'] =
      "void import('../features/home/useHome.js');\n";
    hookSources['src/app/home-hook-alias.ts'] = "void import('@app/features/home/useHome.ts');\n";
    hookSources['src/app/home-hook-root-alias.ts'] =
      "void import('@root/src/features/home/useHome.mts');\n";
    hookSources['src/app/home-hook-module-kinds.ts'] = [
      "export { useHome } from '../features/home/useHome.tsx';",
      "export * from '../features/home/useHome.mts';",
      "import HomeHook = require('../features/home/useHome.cts');",
      'const commonJsHook = require("../features/home/useHome.cjs");',
      "type HomeHookModule = import('../features/home/useHome.jsx');",
      "void import('../features/home/useHome.mjs');",
      'void HomeHook; void commonJsHook; void ({} as HomeHookModule);',
      '',
    ].join('\n');
    hookSources['src/app/home-hook-reserved-alias.ts'] = [
      "import '@features/home/useHome';",
      "import 'src/features/home/useHome.js';",
      '',
    ].join('\n');
    hookSources['src/app/home-hook-unrelated.ts'] =
      "const route = '../features/home/useHome';\n// '../features/home/useHome' is documentation.\nvoid route;\n";
    hookSources['src/app/home-store-consumer.ts'] =
      "import { useHomeStore } from '../features/home/home.store';\nvoid useHomeStore;\n";
    for (const [relativePath, source] of Object.entries(hookSources)) {
      await mkdir(join(hookRoot, relativePath, '..'), { recursive: true });
      await writeFile(join(hookRoot, relativePath), source, { encoding: 'utf8', flag: 'wx' });
    }
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner,
        action: 'featureBehaviorHook',
        name: 'Keyboard',
        existingRelativePaths: Object.keys(hookSources),
        existingSources: hookSources,
        aliases: { '@home': 'src/features/home/useHome' },
      }),
    ).toThrow(/exact tsconfig alias @home/);
    const hookPlan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'featureBehaviorHook',
      name: 'Keyboard',
      existingRelativePaths: Object.keys(hookSources),
      existingSources: hookSources,
      aliases: { '@app/': 'src/', '@root/': '' },
    });
    await applySrijikaOwnershipCreationPlan(hookRoot, hookPlan, {
      expectedUpdateSources: hookSources,
    });
    await expect(
      readFile(join(hookRoot, 'src/features/home/hooks/useHome.ts'), 'utf8'),
    ).resolves.toEqual(expect.stringContaining("from '../home.store'"));
    await expect(
      readFile(join(hookRoot, 'src/features/home/hooks/useHome.ts'), 'utf8'),
    ).resolves.toContain('import(`../home.store.js`)');
    await expect(
      readFile(join(hookRoot, 'src/features/home/hooks/useHome.ts'), 'utf8'),
    ).resolves.toContain("const note = './home.store'");
    await expect(
      readFile(join(hookRoot, 'src/features/home/Home.connector.tsx'), 'utf8'),
    ).resolves.toContain("from './hooks/useHome'");
    await expect(
      readFile(join(hookRoot, 'src/app/home-hook-consumer.ts'), 'utf8'),
    ).resolves.toContain("from '../features/home/hooks/useHome'");
    await expect(
      readFile(join(hookRoot, 'src/app/home-hook-dynamic.ts'), 'utf8'),
    ).resolves.toContain('import(`../features/home/hooks/useHome`)');
    await expect(
      readFile(join(hookRoot, 'src/app/home-hook-js-extension.ts'), 'utf8'),
    ).resolves.toContain("import('../features/home/hooks/useHome.js')");
    await expect(readFile(join(hookRoot, 'src/app/home-hook-alias.ts'), 'utf8')).resolves.toContain(
      "import('@app/features/home/hooks/useHome.ts')",
    );
    await expect(
      readFile(join(hookRoot, 'src/app/home-hook-root-alias.ts'), 'utf8'),
    ).resolves.toContain("import('@root/src/features/home/hooks/useHome.mts')");
    const moduleKinds = await readFile(join(hookRoot, 'src/app/home-hook-module-kinds.ts'), 'utf8');
    for (const extension of ['.tsx', '.mts', '.cts', '.cjs', '.jsx', '.mjs']) {
      expect(moduleKinds).toContain(`../features/home/hooks/useHome${extension}`);
    }
    await expect(
      readFile(join(hookRoot, 'src/app/home-hook-reserved-alias.ts'), 'utf8'),
    ).resolves.toBe(
      [
        "import '@features/home/hooks/useHome';",
        "import 'src/features/home/hooks/useHome.js';",
        '',
      ].join('\n'),
    );
    await expect(readFile(join(hookRoot, 'src/app/home-hook-unrelated.ts'), 'utf8')).resolves.toBe(
      hookSources['src/app/home-hook-unrelated.ts'],
    );
    await expect(
      readFile(join(hookRoot, 'src/features/home/useHome.ts'), 'utf8'),
    ).rejects.toThrow();

    const storeRoot = await temporaryRoot();
    const storeSources = { ...hookSources };
    for (const [relativePath, source] of Object.entries(storeSources)) {
      await mkdir(join(storeRoot, relativePath, '..'), { recursive: true });
      await writeFile(join(storeRoot, relativePath), source, { encoding: 'utf8', flag: 'wx' });
    }
    const storePlan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'featureStoreSlice',
      name: 'Filters',
      existingRelativePaths: Object.keys(storeSources),
      existingSources: storeSources,
    });
    await applySrijikaOwnershipCreationPlan(storeRoot, storePlan, {
      expectedUpdateSources: storeSources,
    });
    await expect(
      readFile(join(storeRoot, 'src/features/home/useHome.ts'), 'utf8'),
    ).resolves.toContain("from './stores/home.store'");
    await expect(
      readFile(join(storeRoot, 'src/features/home/stores/home.store.ts'), 'utf8'),
    ).resolves.toContain('export const useHomeStore');
    await expect(
      readFile(join(storeRoot, 'src/app/home-store-consumer.ts'), 'utf8'),
    ).resolves.toContain("from '../features/home/stores/home.store'");
    await expect(
      readFile(join(storeRoot, 'src/features/home/home.store.ts'), 'utf8'),
    ).rejects.toThrow();
  });
});

describe('configured ownership creation parity', () => {
  const architecture = {
    featuresRoot: 'application/modules',
    sharedRoot: 'application/common',
    slotsDirectory: 'regions',
    partsDirectory: 'fragments',
    hooksDirectory: 'effects',
    storesDirectory: 'state',
    uiSuffix: '.view.tsx',
    connectorSuffix: '.gateway.tsx',
    storeSuffix: '.state.ts',
    logicSuffix: '.rules.ts',
    apiSuffix: '.transport.ts',
    typesSuffix: '.contract.ts',
  } as const;

  it('uses every configured directory and suffix in plans, sources, statuses, and rewrites', () => {
    const featureRoot = resolveSrijikaStructureOwner(architecture.featuresRoot, architecture);
    if (!featureRoot || featureRoot.level !== 'featuresRoot') {
      throw new Error('Expected configured Features root.');
    }
    const feature = buildSrijikaOwnershipCreationPlan({
      owner: featureRoot,
      action: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
      architecture,
    });
    expect(feature.files.map(({ relativePath }) => relativePath)).toEqual([
      'application/modules/dashboard/Dashboard.view.tsx',
      'application/modules/dashboard/dashboard.contract.ts',
      'application/modules/dashboard/dashboard.transport.ts',
      'application/modules/dashboard/dashboard.rules.ts',
      'application/modules/dashboard/dashboard.state.ts',
      'application/modules/dashboard/useDashboard.ts',
      'application/modules/dashboard/Dashboard.gateway.tsx',
    ]);
    const featureSources = Object.fromEntries(
      feature.files.map(({ relativePath, source }) => [relativePath, source]),
    );
    expect(featureSources['application/modules/dashboard/Dashboard.gateway.tsx']).toContain(
      "from './Dashboard.view'",
    );
    expect(featureSources['application/modules/dashboard/useDashboard.ts']).toContain(
      "from './dashboard.state'",
    );
    expect(featureSources['application/modules/dashboard/dashboard.state.ts']).toContain(
      "from './dashboard.rules'",
    );
    expect(featureSources['application/modules/dashboard/dashboard.rules.ts']).toContain(
      "from './dashboard.transport'",
    );
    expect(featureSources['application/modules/dashboard/dashboard.transport.ts']).toContain(
      "from './dashboard.contract'",
    );

    const featureOwner = resolveSrijikaStructureOwner(
      'application/modules/dashboard',
      architecture,
    );
    if (!featureOwner || featureOwner.level !== 'feature') {
      throw new Error('Expected configured Dashboard owner.');
    }
    const slot = buildSrijikaOwnershipCreationPlan({
      owner: featureOwner,
      action: 'slot',
      name: 'Summary',
      architecture,
    });
    expect(slot.ownerFolder).toBe('application/modules/dashboard/regions/summary');
    const slotOwner = resolveSrijikaStructureOwner(slot.ownerFolder, architecture);
    if (!slotOwner || slotOwner.level !== 'slot') throw new Error('Expected configured Slot.');
    const part = buildSrijikaOwnershipCreationPlan({
      owner: slotOwner,
      action: 'part',
      name: 'MetricCard',
      architecture,
    });
    expect(part.ownerFolder).toBe(
      'application/modules/dashboard/regions/summary/fragments/metric-card',
    );

    const aliasedSources = {
      ...featureSources,
      'application/modules/dashboard/Dashboard.gateway.tsx': (
        featureSources['application/modules/dashboard/Dashboard.gateway.tsx'] ?? ''
      ).replace("'./useDashboard'", "'@features/dashboard/useDashboard'"),
    };
    const hookExpansion = buildSrijikaOwnershipCreationPlan({
      owner: featureOwner,
      action: 'featureBehaviorHook',
      name: 'Search',
      existingRelativePaths: Object.keys(aliasedSources),
      existingSources: aliasedSources,
      aliases: { '@features/': architecture.featuresRoot },
      architecture,
    });
    expect(hookExpansion.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'application/modules/dashboard/useDashboard.ts',
        toRelativePath: 'application/modules/dashboard/effects/useDashboard.ts',
      }),
    ]);
    expect(hookExpansion.files[0]?.relativePath).toBe(
      'application/modules/dashboard/effects/useDashboardSearch.ts',
    );
    expect(
      hookExpansion.updates.find(
        ({ relativePath }) =>
          relativePath === 'application/modules/dashboard/Dashboard.gateway.tsx',
      )?.source,
    ).toContain("from '@features/dashboard/effects/useDashboard'");

    const storeExpansion = buildSrijikaOwnershipCreationPlan({
      owner: featureOwner,
      action: 'featureStoreSlice',
      name: 'Filters',
      existingRelativePaths: Object.keys(featureSources),
      existingSources: featureSources,
      architecture,
    });
    expect(storeExpansion.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'application/modules/dashboard/dashboard.state.ts',
        toRelativePath: 'application/modules/dashboard/state/dashboard.state.ts',
      }),
    ]);
    expect(storeExpansion.files[0]?.relativePath).toBe(
      'application/modules/dashboard/state/dashboardFilters.state.ts',
    );
    expect(
      storeExpansion.updates.find(
        ({ relativePath }) => relativePath === 'application/modules/dashboard/useDashboard.ts',
      )?.source,
    ).toContain("from './state/dashboard.state'");

    expect(
      srijikaOwnershipFileStatuses(featureOwner, Object.keys(featureSources), architecture).every(
        ({ exists }) => exists,
      ),
    ).toBe(true);
    expect(
      availableSrijikaOwnershipCreationActions(
        featureOwner,
        Object.keys(featureSources),
        featureSources,
        architecture,
      ),
    ).toContain('featureBehaviorHook');

    const sharedRoot = resolveSrijikaStructureOwner(architecture.sharedRoot, architecture);
    if (!sharedRoot || sharedRoot.level !== 'sharedRoot') {
      throw new Error('Expected configured Shared root.');
    }
    const widget = buildSrijikaOwnershipCreationPlan({
      owner: sharedRoot,
      action: 'sharedWidget',
      name: 'StatusCard',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
      architecture,
    });
    expect(widget.files.map(({ relativePath }) => relativePath)).toEqual([
      'application/common/widgets/status-card/StatusCard.view.tsx',
      'application/common/widgets/status-card/statusCard.contract.ts',
      'application/common/widgets/status-card/statusCard.transport.ts',
      'application/common/widgets/status-card/statusCard.rules.ts',
      'application/common/widgets/status-card/statusCard.state.ts',
      'application/common/widgets/status-card/useStatusCard.ts',
      'application/common/widgets/status-card/StatusCard.gateway.tsx',
    ]);
  });
});

describe('canonical Shared creation plans', () => {
  it('creates a pure Shared UI primitive with optional Types and rejects runtime flags', () => {
    const root = resolveSrijikaStructureOwner('src/shared');
    if (!root || root.level !== 'sharedRoot') throw new Error('Expected Shared root.');

    const plan = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'sharedUi',
      name: 'ActionButton',
      optionalCapabilities: ['types'],
    });

    expect(plan.files.map((file) => file.relativePath)).toEqual([
      'src/shared/ui/action-button/ActionButton.ui.tsx',
      'src/shared/ui/action-button/actionButton.types.ts',
    ]);
    expect(plan.files[0]?.source).not.toContain('Connector');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: root,
        action: 'sharedUi',
        name: 'UnsafeButton',
        optionalCapabilities: ['hook'],
      }),
    ).toThrow(/only the optional Types/);
  });

  it('moves a canonical Shared UI props contract into standalone Types without overwriting custom UI', () => {
    const root = resolveSrijikaStructureOwner('src/shared');
    if (!root || root.level !== 'sharedRoot') throw new Error('Expected Shared root.');
    const initial = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'sharedUi',
      name: 'ActionButton',
    });
    const owner = resolveSrijikaStructureOwner('src/shared/ui/action-button');
    if (!owner || owner.level !== 'sharedUi') throw new Error('Expected ActionButton owner.');
    const existingSources = Object.fromEntries(
      initial.files.map((file) => [file.relativePath, file.source]),
    );
    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'sharedUiTypes',
      existingRelativePaths: Object.keys(existingSources),
      existingSources,
    });

    expect(plan.files).toEqual([
      expect.objectContaining({
        relativePath: 'src/shared/ui/action-button/actionButton.types.ts',
      }),
    ]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.relativePath).toBe('src/shared/ui/action-button/ActionButton.ui.tsx');
    expect(plan.updates[0]?.source).toContain(
      "import type { ActionButtonUIProps } from './actionButton.types';",
    );
    expect(plan.updates[0]?.source).toContain(
      'export function ActionButtonUI(props: ActionButtonUIProps)',
    );
    expect(plan.updates[0]?.source).toContain('className={props.className}');
    expect(plan.updates[0]?.source).not.toContain('export interface ActionButtonUIProps');

    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner,
        action: 'sharedUiTypes',
        existingRelativePaths: Object.keys(existingSources),
        existingSources: {
          ...existingSources,
          'src/shared/ui/action-button/ActionButton.ui.tsx':
            'export function ActionButtonUI() { return <button type="button" />; }\n',
        },
      }),
    ).toThrow(/custom code.*inline props contract/);
  });

  it('creates a Shared Widget with the same strict progressive runtime chain as a Feature', () => {
    const root = resolveSrijikaStructureOwner('src/shared');
    if (!root || root.level !== 'sharedRoot') throw new Error('Expected Shared root.');

    const plan = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'sharedWidget',
      name: 'UserMenu',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
    });
    const byPath = new Map(plan.files.map((file) => [file.relativePath, file.source]));

    expect([...byPath.keys()]).toEqual([
      'src/shared/widgets/user-menu/UserMenu.ui.tsx',
      'src/shared/widgets/user-menu/userMenu.types.ts',
      'src/shared/widgets/user-menu/userMenu.api.ts',
      'src/shared/widgets/user-menu/userMenu.logic.ts',
      'src/shared/widgets/user-menu/userMenu.store.ts',
      'src/shared/widgets/user-menu/useUserMenu.ts',
      'src/shared/widgets/user-menu/UserMenu.connector.tsx',
    ]);
    expect(byPath.get('src/shared/widgets/user-menu/UserMenu.connector.tsx')).toContain(
      "from './useUserMenu'",
    );
    expect(byPath.get('src/shared/widgets/user-menu/useUserMenu.ts')).toContain(
      "from './userMenu.store'",
    );
  });

  it('requires a runtime gateway for a Shared Capability and supports expanded Hooks', () => {
    const root = resolveSrijikaStructureOwner('src/shared');
    if (!root || root.level !== 'sharedRoot') throw new Error('Expected Shared root.');
    expect(() =>
      buildSrijikaOwnershipCreationPlan({
        owner: root,
        action: 'sharedCapability',
        name: 'Auth',
        optionalCapabilities: ['types'],
      }),
    ).toThrow(/at least one runtime layer/);

    const initial = buildSrijikaOwnershipCreationPlan({
      owner: root,
      action: 'sharedCapability',
      name: 'Auth',
      optionalCapabilities: ['hook', 'store', 'types'],
    });
    const owner = resolveSrijikaStructureOwner('src/shared/capabilities/auth');
    if (!owner || owner.level !== 'sharedCapability') throw new Error('Expected Auth owner.');
    expect(availableSrijikaOwnershipCreationActions(owner, [])).not.toContain(
      'sharedCapabilityTypes',
    );
    expect(srijikaOwnershipFileStatuses(owner, []).map(({ action }) => action)).not.toContain(
      'sharedCapabilityTypes',
    );
    expect(
      availableSrijikaOwnershipCreationActions(owner, ['src/shared/capabilities/auth/useAuth.ts']),
    ).toContain('sharedCapabilityTypes');
    const paths = initial.files.map((file) => file.relativePath);
    const sources = Object.fromEntries(
      initial.files.map((file) => [file.relativePath, file.source]),
    );
    const expanded = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'sharedCapabilityBehaviorHook',
      name: 'Session',
      existingRelativePaths: paths,
      existingSources: sources,
    });

    expect(expanded.moves).toEqual([
      expect.objectContaining({
        fromRelativePath: 'src/shared/capabilities/auth/useAuth.ts',
        toRelativePath: 'src/shared/capabilities/auth/hooks/useAuth.ts',
      }),
    ]);
    expect(expanded.files[0]?.relativePath).toBe(
      'src/shared/capabilities/auth/hooks/useAuthSession.ts',
    );
  });
});
