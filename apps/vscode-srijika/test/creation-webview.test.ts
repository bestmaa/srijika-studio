import { describe, expect, it } from 'vitest';

import {
  resolveSrijikaArchitectureConfig,
  resolveSrijikaStructureOwner,
} from '@srijika/architecture-rules';
import { SRIJIKA_CREATION_ACTION_LABELS } from '../src/creation-presentation';
import { renderSrijikaCreationWebview } from '../src/creation-webview';
import { buildSrijikaOwnershipCreationPlan } from '../src/ownership-creation';

describe('Srijika visual creation form', () => {
  it('renders required and optional controls for a new owner with an exact preview', () => {
    const owner = resolveSrijikaStructureOwner('src/features');
    if (!owner) throw new Error('Expected features root');
    const plan = buildSrijikaOwnershipCreationPlan({
      owner,
      action: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
    });
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Features',
      ownerFiles: [],
      childActions: [
        {
          action: 'feature',
          ...SRIJIKA_CREATION_ACTION_LABELS.feature,
        },
      ],
      selectedMode: 'childOwner',
      selectedOwnerActions: [],
      selectedChildAction: 'feature',
      name: 'Dashboard',
      optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
      plan,
      nonce: 'audit-nonce',
    });
    expect(html).toContain('UI + Connector · Required');
    expect(html).toContain('Hook gateway');
    expect(html).toContain('Business Logic');
    expect(html).toContain('src/features/dashboard/Dashboard.connector.tsx');
    expect(html).toContain("script-src 'nonce-audit-nonce'");
    expect(html).not.toContain("'unsafe-inline'");
  });

  it('shows created and missing owner files as a batch checklist without hiding New Slot', () => {
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner) throw new Error('Expected Feature owner');
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Home',
      ownerFiles: [
        {
          role: 'ui',
          label: 'Home UI',
          description: 'Pure React UI source for this owner',
          relativePath: 'src/features/home/Home.ui.tsx',
          exists: true,
          required: true,
        },
        {
          role: 'connector',
          action: 'featureConnector',
          label: 'Feature Connector',
          description: 'Required runtime UI gateway',
          relativePath: 'src/features/home/Home.connector.tsx',
          exists: true,
          required: true,
        },
        {
          role: 'hook',
          action: 'featureHook',
          label: 'Feature Hook gateway',
          description: 'useFeature.ts',
          relativePath: 'src/features/home/useHome.ts',
          exists: false,
          required: false,
        },
      ],
      childActions: [{ action: 'slot', ...SRIJIKA_CREATION_ACTION_LABELS.slot }],
      selectedMode: 'ownerFiles',
      selectedOwnerActions: ['featureHook'],
      selectedChildAction: 'slot',
      name: '',
      optionalCapabilities: [],
      plan: {
        ownerName: 'Home',
        ownerFolder: 'src/features/home',
        files: [{ relativePath: 'src/features/home/useHome.ts', source: '' }],
        updates: [{ relativePath: 'src/features/home/Home.connector.tsx', source: '' }],
      },
      nonce: 'owner-nonce',
    });
    expect(html).toContain('Complete Home files');
    expect(html).toContain('New Slot');
    expect(html).toContain('Home file checklist');
    expect(html).toContain('Select all missing files');
    expect(html).toContain('Created');
    expect(html).toContain('name="owner-action" value="featureHook" checked');
    expect(html).toContain('[safe rewire] src/features/home/Home.connector.tsx');
  });

  it('requests a canonical planner preview without rerendering the typing surface', () => {
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner) throw new Error('Expected Feature owner');
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Home',
      ownerFiles: [],
      childActions: [{ action: 'slot', ...SRIJIKA_CREATION_ACTION_LABELS.slot }],
      selectedMode: 'childOwner',
      selectedOwnerActions: [],
      selectedChildAction: 'slot',
      name: '',
      optionalCapabilities: [],
      nonce: 'focus-nonce',
    });
    expect(html).toContain("addEventListener('input', requestCanonicalPreview)");
    expect(html).toContain("vscode.postMessage({ type: 'preview', requestId, ...state })");
    expect(html).toContain("message.type !== 'previewResult'");
    expect(html).not.toContain("model.owner.folder + '/slots/'");
    expect(html).not.toContain("name + '.ui.tsx'");
    expect(html).not.toContain('window.location');
  });

  it('keeps multiple Hook and Store creation visible beside incomplete owner files', () => {
    const owner = resolveSrijikaStructureOwner('src/features/home');
    if (!owner) throw new Error('Expected Feature owner');
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Home',
      ownerFiles: [
        {
          role: 'logic',
          action: 'featureLogic',
          label: 'Feature Business Logic',
          description: 'Rules and transformations',
          relativePath: 'src/features/home/home.logic.ts',
          exists: false,
          required: false,
        },
      ],
      childActions: [{ action: 'slot', ...SRIJIKA_CREATION_ACTION_LABELS.slot }],
      expansionActions: [
        {
          action: 'featureBehaviorHook',
          ...SRIJIKA_CREATION_ACTION_LABELS.featureBehaviorHook,
        },
        {
          action: 'featureStoreSlice',
          ...SRIJIKA_CREATION_ACTION_LABELS.featureStoreSlice,
        },
      ],
      selectedMode: 'ownerFiles',
      selectedOwnerActions: [],
      selectedChildAction: 'slot',
      selectedExpansionAction: 'featureBehaviorHook',
      name: '',
      optionalCapabilities: [],
      nonce: 'multiple-nonce',
    });
    expect(html).toContain('Add another Hook / Store · Multiple mode');
    expect(html).toContain('Complete Home files');
    expect(html).toContain('New Slot');
  });

  it('presents exactly the three strict Shared owner kinds and a pure Primitive form', () => {
    const owner = resolveSrijikaStructureOwner('src/shared');
    if (!owner || owner.level !== 'sharedRoot') throw new Error('Expected Shared root');
    const childActions = (['sharedUi', 'sharedWidget', 'sharedCapability'] as const).map(
      (action) => ({ action, ...SRIJIKA_CREATION_ACTION_LABELS[action] }),
    );
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Shared',
      ownerFiles: [],
      childActions,
      selectedMode: 'childOwner',
      selectedOwnerActions: [],
      selectedChildAction: 'sharedUi',
      name: 'Button',
      optionalCapabilities: ['types'],
      nonce: 'shared-nonce',
    });
    expect(html).toContain('New Shared UI Primitive');
    expect(html).toContain('New Shared Widget');
    expect(html).toContain('New Headless Capability');
    expect(html).toContain('Pure UI · Required');
    expect(html).toContain('value="types" checked');
    expect(html).not.toContain('name="capability" value="hook"');
    expect(html).toContain("vscode.postMessage({ type: 'preview', requestId, ...state })");
    expect(html).toContain('input[name=child-action]');
    expect(html).toContain('Freehand shared folders');
  });

  it('explains that a Headless Capability has no UI or Connector and needs runtime', () => {
    const owner = resolveSrijikaStructureOwner('src/shared');
    if (!owner || owner.level !== 'sharedRoot') throw new Error('Expected Shared root');
    const html = renderSrijikaCreationWebview({
      owner,
      ownerLabel: 'Shared',
      ownerFiles: [],
      childActions: (['sharedUi', 'sharedWidget', 'sharedCapability'] as const).map((action) => ({
        action,
        ...SRIJIKA_CREATION_ACTION_LABELS[action],
      })),
      selectedMode: 'childOwner',
      selectedOwnerActions: [],
      selectedChildAction: 'sharedCapability',
      name: 'Auth',
      optionalCapabilities: ['hook'],
      nonce: 'headless-nonce',
    });
    expect(html).toContain('Choose at least one runtime layer');
    expect(html).toContain('Headless means no UI and no Connector');
    expect(html).toContain('name="capability" value="hook" checked');
    expect(html).not.toContain('Pure UI · Required');
    expect(html).not.toContain('UI + Connector · Required');
    expect(html).toContain("vscode.postMessage({ type: 'preview', requestId, ...state })");
  });

  it('renders canonical full-config previews for every owner boundary and expansion', () => {
    const architecture = resolveSrijikaArchitectureConfig({
      profile: 'feature-slot-part-v1',
      featuresRoot: 'product/modules',
      sharedRoot: 'common/kernel',
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
    });
    const featuresRoot = resolveSrijikaStructureOwner(architecture.featuresRoot, architecture);
    const feature = resolveSrijikaStructureOwner('product/modules/home', architecture);
    const slot = resolveSrijikaStructureOwner(
      'product/modules/home/regions/navigation',
      architecture,
    );
    const sharedRoot = resolveSrijikaStructureOwner(architecture.sharedRoot, architecture);
    if (!featuresRoot || !feature || !slot || !sharedRoot) {
      throw new Error('Expected every custom owner boundary');
    }

    const childPlans = [
      buildSrijikaOwnershipCreationPlan({
        owner: featuresRoot,
        action: 'feature',
        name: 'Dashboard',
        optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
        architecture,
      }),
      buildSrijikaOwnershipCreationPlan({
        owner: feature,
        action: 'slot',
        name: 'Summary',
        optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
        architecture,
      }),
      buildSrijikaOwnershipCreationPlan({
        owner: slot,
        action: 'part',
        name: 'Menu',
        optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
        architecture,
      }),
      buildSrijikaOwnershipCreationPlan({
        owner: sharedRoot,
        action: 'sharedUi',
        name: 'Button',
        optionalCapabilities: ['types'],
        architecture,
      }),
      buildSrijikaOwnershipCreationPlan({
        owner: sharedRoot,
        action: 'sharedWidget',
        name: 'Toast',
        optionalCapabilities: ['hook', 'store', 'logic', 'api', 'types'],
        architecture,
      }),
      buildSrijikaOwnershipCreationPlan({
        owner: sharedRoot,
        action: 'sharedCapability',
        name: 'Auth',
        optionalCapabilities: ['hook', 'logic', 'api', 'types'],
        architecture,
      }),
    ];
    const expectedChildPaths = [
      'product/modules/dashboard/Dashboard.view.tsx',
      'product/modules/dashboard/Dashboard.bridge.tsx',
      'product/modules/home/regions/summary/summary.state.ts',
      'product/modules/home/regions/summary/summary.rules.ts',
      'product/modules/home/regions/navigation/pieces/menu/menu.http.ts',
      'product/modules/home/regions/navigation/pieces/menu/menu.contracts.ts',
      'common/kernel/ui/button/Button.view.tsx',
      'common/kernel/widgets/toast/Toast.bridge.tsx',
      'common/kernel/capabilities/auth/useAuth.ts',
    ];
    const childHtml = childPlans
      .map((plan) =>
        renderSrijikaCreationWebview({
          owner: featuresRoot,
          ownerLabel: 'Custom owner',
          ownerFiles: [],
          childActions: [],
          selectedMode: 'childOwner',
          selectedOwnerActions: [],
          name: '',
          optionalCapabilities: [],
          plan,
          nonce: 'custom-child',
        }),
      )
      .join('\n');
    for (const expectedPath of expectedChildPaths) expect(childHtml).toContain(expectedPath);

    const hookBase = buildSrijikaOwnershipCreationPlan({
      owner: featuresRoot,
      action: 'feature',
      name: 'Home',
      optionalCapabilities: ['hook'],
      architecture,
    });
    const storeBase = buildSrijikaOwnershipCreationPlan({
      owner: featuresRoot,
      action: 'feature',
      name: 'Home',
      optionalCapabilities: ['store'],
      architecture,
    });
    const existingState = (plan: typeof hookBase) => ({
      existingRelativePaths: plan.files.map(({ relativePath }) => relativePath),
      existingSources: Object.fromEntries(
        plan.files.map(({ relativePath, source }) => [relativePath, source]),
      ),
    });
    const expansionPlans = [
      buildSrijikaOwnershipCreationPlan({
        owner: feature,
        action: 'featureBehaviorHook',
        name: 'Search',
        ...existingState(hookBase),
        architecture,
      }),
      buildSrijikaOwnershipCreationPlan({
        owner: feature,
        action: 'featureStoreSlice',
        name: 'Search',
        ...existingState(storeBase),
        architecture,
      }),
    ];
    const expansionHtml = expansionPlans
      .map((plan) =>
        renderSrijikaCreationWebview({
          owner: feature,
          ownerLabel: 'Home',
          ownerFiles: [],
          childActions: [],
          selectedMode: 'ownerExpansion',
          selectedOwnerActions: [],
          name: 'Search',
          optionalCapabilities: [],
          plan,
          nonce: 'custom-expansion',
        }),
      )
      .join('\n');
    for (const expectedPath of [
      'product/modules/home/behaviors/useHomeSearch.ts',
      '[safe rewire] product/modules/home/Home.bridge.tsx',
      '[safe move] product/modules/home/useHome.ts → product/modules/home/behaviors/useHome.ts',
      'product/modules/home/state/homeSearch.state.ts',
      '[safe move] product/modules/home/home.state.ts → product/modules/home/state/home.state.ts',
    ]) {
      expect(expansionHtml).toContain(expectedPath);
    }
    expect(`${childHtml}\n${expansionHtml}`).not.toContain('/slots/');
    expect(`${childHtml}\n${expansionHtml}`).not.toContain('/parts/');
    expect(`${childHtml}\n${expansionHtml}`).not.toContain('.ui.tsx');
    expect(`${childHtml}\n${expansionHtml}`).not.toContain('.connector.tsx');
    expect(`${childHtml}\n${expansionHtml}`).not.toContain('.store.ts');
  });
});
