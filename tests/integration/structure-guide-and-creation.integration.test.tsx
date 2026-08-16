import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeFirstStudio } from '../../apps/studio/src/components/code-first/CodeFirstStudio';
import {
  CreateStructureItemDialog,
  structureCreationActionsForOwner,
  structureCreationPaths,
  structureOwnerFromFolder,
  type StructureOwnerContext,
} from '../../apps/studio/src/components/code-first/CreateStructureItemDialog';
import { StructureGuideDialog } from '../../apps/studio/src/components/code-first/StructureGuideDialog';
import { useCodeProjectStore } from '../../apps/studio/src/store/code-project-store';
import { useProjectSessionStore } from '../../apps/studio/src/store/project-session-store';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

const NAVIGATION_OWNER: StructureOwnerContext = {
  level: 'slot',
  folder: 'src/features/home/slots/navigation',
  featureName: 'Home',
  slotName: 'Navigation',
};

describe('Srijika structure guide', () => {
  it('shows the resolved custom architecture in every path-bearing guide section', async () => {
    const user = userEvent.setup();
    const architecture = {
      featuresRoot: 'application/domain/features',
      sharedRoot: 'application/domain/shared',
      slotsDirectory: 'regions',
      partsDirectory: 'pieces',
      hooksDirectory: 'behaviors',
      storesDirectory: 'state',
      uiSuffix: '.view.tsx',
      connectorSuffix: '.bridge.tsx',
      storeSuffix: '.state.ts',
      logicSuffix: '.rules.ts',
      apiSuffix: '.transport.ts',
      typesSuffix: '.contract.ts',
    } as const;
    render(<StructureGuideDialog architectureRoots={architecture} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Feature ownership structure' });
    expect(within(dialog).getByText('.view.tsx')).toBeVisible();
    expect(within(dialog).getByText('home.state.ts')).toBeVisible();
    expect(within(dialog).getByText('navigation.state.ts')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Blueprint/ }));
    expect(within(dialog).getByText('application/domain/features/home')).toBeVisible();
    expect(within(dialog).getByText('Home.view.tsx')).toBeVisible();
    expect(within(dialog).getByText('Home.bridge.tsx')).toBeVisible();
    expect(within(dialog).getByText('behaviors/useHome.ts')).toBeVisible();
    expect(within(dialog).getByText('state/home.state.ts')).toBeVisible();
    expect(within(dialog).getByText('regions/')).toBeVisible();
    expect(within(dialog).getByText('pieces/')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Shared/ }));
    expect(within(dialog).getByText('application/domain/shared')).toBeVisible();
    expect(within(dialog).getByText('application/domain/features')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Boundaries/ }));
    expect(within(dialog).getByLabelText('Allowed: home.state.ts in Navigation')).toBeVisible();
    expect(within(dialog).getByLabelText('Allowed: UserMenu.view.tsx in Navigation')).toBeVisible();
    expect(within(dialog).getByText('regions/navigation/navigation.state.ts')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Checklist/ }));
    expect(within(dialog).getByText('Home.view.tsx')).toBeVisible();
    expect(within(dialog).getByText('Home.bridge.tsx')).toBeVisible();
    expect(within(dialog).getByText('home.rules.ts')).toBeVisible();
    expect(within(dialog).getByText('home.transport.ts')).toBeVisible();
    expect(within(dialog).getByText('home.contract.ts')).toBeVisible();
    expect(within(dialog).getByText('regions/')).toBeVisible();
    expect(within(dialog).getByText('pieces/')).toBeVisible();
  });

  it('documents the blueprint, access boundaries, and capability checklist in English', async () => {
    const user = userEvent.setup();
    render(<StructureGuideDialog onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Feature ownership structure' });
    expect(within(dialog).getByText('Structure that explains itself.')).toBeVisible();
    expect(within(dialog).getByText('The downward scope rule')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Blueprint/ }));
    const tree = within(dialog).getByRole('list', { name: 'Annotated feature file tree' });
    expect(within(tree).getByText('Home.ui.tsx')).toBeVisible();
    expect(within(tree).getByText('Home.connector.tsx')).toBeVisible();
    expect(within(tree).getByText('hooks/useHome.ts')).toBeVisible();
    expect(within(tree).getByText('stores/home.store.ts')).toBeVisible();
    expect(within(tree).getByText('Navigation.ui.tsx')).toBeVisible();
    expect(within(tree).getByText('navigation.store.ts')).toBeVisible();
    expect(within(tree).getByText('navigation.logic.ts')).toBeVisible();
    expect(within(tree).getByText('navigation.api.ts')).toBeVisible();
    const partUiRow = within(tree).getByText('UserMenu.ui.tsx').closest('li');
    if (!partUiRow) throw new Error('Expected the UserMenu UI blueprint row');
    expect(within(partUiRow).getByText('Required')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Shared/ }));
    expect(within(dialog).getByText('Shared UI Primitive')).toBeVisible();
    expect(within(dialog).getByText('Shared Widget')).toBeVisible();
    expect(within(dialog).getByText('Shared Headless Capability')).toBeVisible();
    expect(within(dialog).getByText('Two Features → promote it to Shared.')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Boundaries/ }));
    expect(
      within(dialog).getByRole('table', { name: 'Owner scope import permissions' }),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Allowed: home.store.ts in Navigation')).toBeVisible();
    expect(
      within(dialog).getByLabelText('Not allowed: navigation.store.ts in Header'),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Allowed: UserMenu.ui.tsx in Navigation')).toBeVisible();
    expect(
      within(dialog).getByLabelText('Not allowed: userMenu.store.ts in Sibling part'),
    ).toBeVisible();
    expect(within(dialog).getByText('SRIJIKA4103')).toBeVisible();

    await user.click(within(dialog).getByRole('tab', { name: /Runtime/ }));
    expect(
      within(dialog).getByText('Use the senior layer. Never jump an existing layer.'),
    ).toBeVisible();
    const runtimePath = within(dialog).getByLabelText('Progressive runtime capability path');
    for (const capability of ['Connector', 'Hook', 'Store', 'Logic', 'API']) {
      expect(within(runtimePath).getByText(capability)).toBeVisible();
    }

    await user.click(within(dialog).getByRole('tab', { name: /Checklist/ }));
    expect(within(dialog).getByText('New feature')).toBeVisible();
    expect(within(dialog).getByText('New slot')).toBeVisible();
    expect(within(dialog).getByText('Boundary review')).toBeVisible();
  });

  it('closes with Escape and restores focus to the launcher', async () => {
    const onClose = vi.fn();
    const launcher = document.createElement('button');
    launcher.textContent = 'Open guide';
    document.body.append(launcher);
    launcher.focus();

    const { unmount } = render(<StructureGuideDialog onClose={onClose} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close structure guide' })).toHaveFocus(),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(launcher).toHaveFocus();
    launcher.remove();
  });
});

describe('ownership-aware structure creation shell', () => {
  it('resolves configured owners and previews every created file below those roots', () => {
    const architectureRoots = {
      featuresRoot: 'application/domain/features',
      sharedRoot: 'application/domain/shared',
    } as const;
    expect(structureOwnerFromFolder('application/domain/features/home', architectureRoots)).toEqual(
      {
        level: 'feature',
        folder: 'application/domain/features/home',
        featureName: 'Home',
      },
    );
    expect(
      structureOwnerFromFolder('application/domain/shared/widgets/profile-card', architectureRoots),
    ).toEqual({
      level: 'sharedWidget',
      folder: 'application/domain/shared/widgets/profile-card',
      sharedName: 'ProfileCard',
    });
    expect(
      structureCreationPaths(
        'Home',
        {
          kind: 'slot',
          slotName: 'Navigation',
          createConnector: true,
        },
        architectureRoots,
      ),
    ).toEqual([
      'application/domain/features/home/slots/navigation/Navigation.ui.tsx',
      'application/domain/features/home/slots/navigation/Navigation.connector.tsx',
    ]);
    expect(
      structureCreationPaths(
        'ProfileCard',
        {
          kind: 'sharedWidget',
          createConnector: true,
          createHook: true,
          createStore: true,
        },
        architectureRoots,
      ),
    ).toEqual([
      'application/domain/shared/widgets/profile-card/ProfileCard.ui.tsx',
      'application/domain/shared/widgets/profile-card/ProfileCard.connector.tsx',
      'application/domain/shared/widgets/profile-card/useProfileCard.ts',
      'application/domain/shared/widgets/profile-card/profileCard.store.ts',
    ]);
  });

  it('previews custom directories and suffixes exactly like the native scaffold contract', () => {
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

    expect(
      structureCreationPaths(
        'Dashboard',
        {
          kind: 'slot',
          slotName: 'Summary',
          createConnector: true,
          createStore: true,
          partName: 'MetricCard',
          createPartConnector: true,
        },
        architecture,
      ),
    ).toEqual([
      'application/modules/dashboard/regions/summary/Summary.view.tsx',
      'application/modules/dashboard/regions/summary/Summary.gateway.tsx',
      'application/modules/dashboard/regions/summary/summary.state.ts',
      'application/modules/dashboard/regions/summary/fragments/metric-card/MetricCard.view.tsx',
      'application/modules/dashboard/regions/summary/fragments/metric-card/MetricCard.gateway.tsx',
    ]);
    expect(
      structureCreationPaths(
        'Dashboard',
        { kind: 'featureBehaviorHook', hookName: 'useDashboardSearch' },
        architecture,
      ),
    ).toEqual(['application/modules/dashboard/effects/useDashboardSearch.ts']);
    expect(
      structureCreationPaths(
        'Dashboard',
        { kind: 'featureStoreSlice', storeName: 'dashboardFilters' },
        architecture,
      ),
    ).toEqual(['application/modules/dashboard/state/dashboardFilters.state.ts']);
    expect(
      structureCreationPaths(
        'StatusCard',
        {
          kind: 'sharedWidget',
          createConnector: true,
          createHook: true,
          createStore: true,
          createLogic: true,
          createApi: true,
          createTypes: true,
        },
        architecture,
      ),
    ).toEqual([
      'application/common/widgets/status-card/StatusCard.view.tsx',
      'application/common/widgets/status-card/StatusCard.gateway.tsx',
      'application/common/widgets/status-card/useStatusCard.ts',
      'application/common/widgets/status-card/statusCard.state.ts',
      'application/common/widgets/status-card/statusCard.rules.ts',
      'application/common/widgets/status-card/statusCard.transport.ts',
      'application/common/widgets/status-card/statusCard.contract.ts',
    ]);
  });

  it('exposes only valid child capabilities and derives canonical paths', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const onClose = vi.fn();

    const featureOwner = structureOwnerFromFolder('src/features/home');
    expect(featureOwner).toEqual({
      level: 'feature',
      folder: 'src/features/home',
      featureName: 'Home',
    });
    expect(featureOwner && structureCreationActionsForOwner(featureOwner)).toEqual([
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
    const featuresRoot = structureOwnerFromFolder('src/features');
    expect(featuresRoot).toEqual({ level: 'featuresRoot', folder: 'src/features' });
    expect(featuresRoot && structureCreationActionsForOwner(featuresRoot)).toEqual(['feature']);
    const sharedRoot = structureOwnerFromFolder('src/shared');
    expect(sharedRoot).toEqual({ level: 'sharedRoot', folder: 'src/shared' });
    expect(sharedRoot && structureCreationActionsForOwner(sharedRoot)).toEqual([
      'sharedUi',
      'sharedWidget',
      'sharedCapability',
    ]);
    expect(structureOwnerFromFolder('src/shared/ui/button')).toEqual({
      level: 'sharedUi',
      folder: 'src/shared/ui/button',
      sharedName: 'Button',
    });
    expect(structureOwnerFromFolder('src/shared/widgets/profile-card')).toEqual({
      level: 'sharedWidget',
      folder: 'src/shared/widgets/profile-card',
      sharedName: 'ProfileCard',
    });
    expect(structureOwnerFromFolder('src/shared/capabilities/auth-session')).toEqual({
      level: 'sharedCapability',
      folder: 'src/shared/capabilities/auth-session',
      sharedName: 'AuthSession',
    });
    expect(structureCreationActionsForOwner(NAVIGATION_OWNER)).toEqual([
      'slotConnector',
      'slotHook',
      'slotBehaviorHook',
      'slotStore',
      'slotStoreSlice',
      'slotLogic',
      'slotApi',
      'slotTypes',
      'part',
    ]);
    const partOwner = structureOwnerFromFolder(
      'src/features/home/slots/navigation/parts/user-menu',
    );
    expect(partOwner).toEqual({
      level: 'part',
      folder: 'src/features/home/slots/navigation/parts/user-menu',
      featureName: 'Home',
      slotName: 'Navigation',
      partName: 'UserMenu',
    });
    expect(partOwner && structureCreationActionsForOwner(partOwner)).toEqual([
      'partConnector',
      'partHook',
      'partBehaviorHook',
      'partStore',
      'partStoreSlice',
      'partLogic',
      'partApi',
      'partTypes',
    ]);
    expect(
      structureCreationPaths('Home', {
        kind: 'slotHook',
        slotName: 'Navigation',
      }),
    ).toEqual(['src/features/home/slots/navigation/useNavigation.ts']);
    expect(
      structureCreationPaths('Home', {
        kind: 'slotConnector',
        slotName: 'Navigation',
      }),
    ).toEqual(['src/features/home/slots/navigation/Navigation.connector.tsx']);
    expect(
      structureCreationPaths('Home', {
        kind: 'slotStore',
        slotName: 'Navigation',
      }),
    ).toEqual(['src/features/home/slots/navigation/navigation.store.ts']);
    expect(structureCreationPaths('Button', { kind: 'sharedUi', createTypes: true })).toEqual([
      'src/shared/ui/button/Button.ui.tsx',
      'src/shared/ui/button/button.types.ts',
    ]);
    expect(
      structureCreationPaths('ProfileCard', {
        kind: 'sharedWidget',
        createConnector: true,
        createHook: true,
        createStore: true,
        createLogic: true,
        createApi: true,
        createTypes: true,
      }),
    ).toEqual([
      'src/shared/widgets/profile-card/ProfileCard.ui.tsx',
      'src/shared/widgets/profile-card/ProfileCard.connector.tsx',
      'src/shared/widgets/profile-card/useProfileCard.ts',
      'src/shared/widgets/profile-card/profileCard.store.ts',
      'src/shared/widgets/profile-card/profileCard.logic.ts',
      'src/shared/widgets/profile-card/profileCard.api.ts',
      'src/shared/widgets/profile-card/profileCard.types.ts',
    ]);
    expect(
      structureCreationPaths('AuthSession', {
        kind: 'sharedCapability',
        createHook: true,
        createStore: true,
        createLogic: true,
        createApi: true,
        createTypes: true,
      }),
    ).toEqual([
      'src/shared/capabilities/auth-session/useAuthSession.ts',
      'src/shared/capabilities/auth-session/authSession.store.ts',
      'src/shared/capabilities/auth-session/authSession.logic.ts',
      'src/shared/capabilities/auth-session/authSession.api.ts',
      'src/shared/capabilities/auth-session/authSession.types.ts',
    ]);

    render(
      <CreateStructureItemDialog
        owner={NAVIGATION_OWNER}
        existingRelativePaths={[
          'src/features/home/slots/navigation/Navigation.ui.tsx',
          'src/features/home/slots/navigation/Navigation.connector.tsx',
        ]}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Navigation' });
    expect(within(dialog).queryByRole('radio', { name: /Slot Connector/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Slot Store/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Slot Hook/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Private Part/ })).toBeVisible();
    expect(within(dialog).queryByRole('radio', { name: /Named slot/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('radio', { name: /Private Part/ }));
    await user.type(within(dialog).getByLabelText('Private Part name'), 'UserMenu');
    expect(
      within(dialog).getByText(
        'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx',
      ),
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Create Private Part' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Home',
        capability: {
          kind: 'part',
          slotName: 'Navigation',
          partName: 'UserMenu',
          createConnector: true,
          createHook: false,
          createStore: false,
          createLogic: false,
          createApi: false,
          createTypes: false,
          hookName: null,
        },
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('offers an existing private part every missing optional capability', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const partOwner = structureOwnerFromFolder(
      'src/features/home/slots/navigation/parts/user-menu',
    );
    if (!partOwner) throw new Error('Expected canonical UserMenu part owner');

    render(
      <CreateStructureItemDialog
        owner={partOwner}
        existingRelativePaths={[
          'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx',
          'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx',
        ]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to UserMenu' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(5);
    expect(within(dialog).queryByRole('radio', { name: /Part Connector/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Part Hook/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Part Store/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part Logic/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part API/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part Types/ })).toBeVisible();
    expect(
      within(dialog).getByText('src/features/home/slots/navigation/parts/user-menu/useUserMenu.ts'),
    ).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Create Part Hook gateway' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Home',
        capability: {
          kind: 'partHook',
          slotName: 'Navigation',
          partName: 'UserMenu',
        },
      }),
    );
  });

  it('creates only the three strict shared owner shapes and blocks a types-only headless owner', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const sharedRoot = structureOwnerFromFolder('src/shared');
    if (!sharedRoot) throw new Error('Expected canonical shared root');

    render(
      <CreateStructureItemDialog
        owner={sharedRoot}
        initialAction="sharedCapability"
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Shared' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(3);
    expect(within(dialog).getByRole('radio', { name: /Shared UI Primitive/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /^Shared Widget/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Shared Headless Capability/ })).toBeChecked();

    await user.type(
      within(dialog).getByLabelText('Shared Headless Capability name'),
      'AuthSession',
    );
    await user.click(within(dialog).getByRole('checkbox', { name: /Types/ }));
    await user.click(
      within(dialog).getByRole('button', { name: 'Create Shared Headless Capability' }),
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'requires at least one runtime layer',
    );
    expect(onCreate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('checkbox', { name: /Hook gateway/ }));
    expect(
      within(dialog).getByText('src/shared/capabilities/auth-session/useAuthSession.ts'),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole('button', { name: 'Create Shared Headless Capability' }),
    );

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'AuthSession',
        capability: {
          kind: 'sharedCapability',
          createHook: true,
          createStore: false,
          createLogic: false,
          createApi: false,
          createTypes: true,
        },
      }),
    );
  });

  it('derives a private Hook name from its owner and exposes expansion only after a gateway exists', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const featureOwner = structureOwnerFromFolder('src/features/home');
    if (!featureOwner) throw new Error('Expected canonical Home feature owner');

    render(
      <CreateStructureItemDialog
        owner={featureOwner}
        existingRelativePaths={[
          'src/features/home/Home.ui.tsx',
          'src/features/home/Home.connector.tsx',
          'src/features/home/useHome.ts',
          'src/features/home/home.store.ts',
        ]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Home' });
    expect(
      within(dialog).queryByRole('radio', { name: /^Feature Hook gateway/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Private Feature Hook/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Private Feature Store/ })).toBeVisible();
    await user.click(within(dialog).getByRole('radio', { name: /Private Feature Hook/ }));
    await user.type(within(dialog).getByLabelText('Private Feature Hook name'), 'Keyboard');
    expect(within(dialog).getByText('src/features/home/hooks/useHomeKeyboard.ts')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Create Private Feature Hook' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Home',
        capability: { kind: 'featureBehaviorHook', hookName: 'useHomeKeyboard' },
      }),
    );
  });

  it('previews configured Hook and Store moves with the exact resolved directories and suffix', async () => {
    const user = userEvent.setup();
    const architecture = {
      featuresRoot: 'application/modules',
      sharedRoot: 'application/common',
      slotsDirectory: 'regions',
      partsDirectory: 'fragments',
      hooksDirectory: 'effects',
      storesDirectory: 'state',
      storeSuffix: '.state.ts',
    };
    const featureOwner = structureOwnerFromFolder('application/modules/home', architecture);
    if (!featureOwner) throw new Error('Expected configured Home feature owner');

    render(
      <CreateStructureItemDialog
        owner={featureOwner}
        architectureRoots={architecture}
        existingRelativePaths={[
          'application/modules/home/Home.ui.tsx',
          'application/modules/home/Home.connector.tsx',
          'application/modules/home/useHome.ts',
          'application/modules/home/home.state.ts',
        ]}
        onClose={vi.fn()}
        onCreate={vi.fn(() => Promise.resolve(null))}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Home' });
    await user.click(within(dialog).getByRole('radio', { name: /Private Feature Hook/ }));
    await user.type(within(dialog).getByLabelText('Private Feature Hook name'), 'Keyboard');
    expect(
      within(dialog).getByText('application/modules/home/effects/useHomeKeyboard.ts'),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        '[safe move] application/modules/home/useHome.ts → application/modules/home/effects/useHome.ts',
      ),
    ).toBeVisible();
    expect(within(dialog).getByText(/gateway into effects\/ when needed/)).toBeVisible();

    await user.click(within(dialog).getByRole('radio', { name: /Private Feature Store/ }));
    await user.type(within(dialog).getByLabelText('Private Feature Store name'), 'Filters');
    expect(
      within(dialog).getByText('application/modules/home/state/homeFilters.state.ts'),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        '[safe move] application/modules/home/home.state.ts → application/modules/home/state/home.state.ts',
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(/derives homeFilters\.state\.ts.*gateway into state\/ when needed/),
    ).toBeVisible();
  });

  it('creates a named feature with required Connector and selected progressive capabilities', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const featuresRoot = structureOwnerFromFolder('src/features');
    if (!featuresRoot) throw new Error('Expected canonical features root');

    render(
      <CreateStructureItemDialog
        owner={featuresRoot}
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Features' });
    const featureNameInput = within(dialog).getByLabelText('New Feature name');
    await user.type(featureNameInput, 'Dashboard');
    expect(featureNameInput).toHaveFocus();
    expect(featureNameInput).toHaveValue('Dashboard');
    expect(within(dialog).getByRole('checkbox', { name: /Connector/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Connector/ })).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /Hook gateway/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Zustand store/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Business Logic/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^API/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Types/ }));

    expect(within(dialog).getByText('src/features/dashboard/Dashboard.ui.tsx')).toBeVisible();
    expect(
      within(dialog).getByText('src/features/dashboard/Dashboard.connector.tsx'),
    ).toBeVisible();
    expect(within(dialog).getByText('src/features/dashboard/dashboard.store.ts')).toBeVisible();
    expect(within(dialog).getByText('src/features/dashboard/useDashboard.ts')).toBeVisible();
    expect(within(dialog).getByText('src/features/dashboard/dashboard.logic.ts')).toBeVisible();
    expect(within(dialog).getByText('src/features/dashboard/dashboard.api.ts')).toBeVisible();
    expect(within(dialog).getByText('src/features/dashboard/dashboard.types.ts')).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Create New Feature' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Dashboard',
        capability: {
          kind: 'feature',
          createConnector: true,
          createHook: true,
          createStore: true,
          createLogic: true,
          createApi: true,
          createTypes: true,
          hookName: null,
        },
      }),
    );
  });

  it('keeps the owner name focused when the parent refreshes callbacks', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const featuresRoot = structureOwnerFromFolder('src/features');
    if (!featuresRoot) throw new Error('Expected canonical features root');

    const firstClose = vi.fn();
    const { rerender } = render(
      <CreateStructureItemDialog
        owner={featuresRoot}
        existingRelativePaths={[]}
        onClose={firstClose}
        onCreate={onCreate}
      />,
    );

    const featureNameInput = screen.getByLabelText('New Feature name');
    await user.type(featureNameInput, 'Dash');
    expect(featureNameInput).toHaveFocus();

    rerender(
      <CreateStructureItemDialog
        owner={featuresRoot}
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(featureNameInput).toHaveFocus();
    await user.type(featureNameInput, 'board');
    expect(featureNameInput).toHaveValue('Dashboard');

    rerender(
      <CreateStructureItemDialog
        owner={featuresRoot}
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(featureNameInput).toHaveFocus();
    expect(featureNameInput).toHaveValue('Dashboard');
  });

  it('blocks acronym-heavy names and gives the exact normalized PascalCase replacement', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const featuresRoot = structureOwnerFromFolder('src/features');
    if (!featuresRoot) throw new Error('Expected canonical features root');

    expect(
      structureCreationPaths('ApiClient', {
        kind: 'feature',
        createConnector: false,
        createStore: true,
        hookName: null,
      }),
    ).toEqual([
      'src/features/api-client/ApiClient.ui.tsx',
      'src/features/api-client/apiClient.store.ts',
    ]);

    render(
      <CreateStructureItemDialog
        owner={featuresRoot}
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Features' });
    await user.type(within(dialog).getByLabelText('New Feature name'), 'APIClient');
    expect(within(dialog).getByText('Resolve naming before preview')).toBeVisible();
    expect(within(dialog).getByText('Use ApiClient, not APIClient.')).toBeVisible();
    expect(within(dialog).queryByLabelText('Files to create')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/src\/features\/apiclient/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create New Feature' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Use normalized PascalCase. Use ApiClient, not APIClient.',
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a private part with required Connector and selected progressive capabilities', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    render(
      <CreateStructureItemDialog
        owner={NAVIGATION_OWNER}
        initialAction="part"
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Navigation' });
    await user.type(within(dialog).getByLabelText('Private Part name'), 'UserMenu');
    expect(within(dialog).getByRole('checkbox', { name: /Connector/ })).toBeChecked();
    await user.click(within(dialog).getByRole('checkbox', { name: /Hook gateway/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Zustand store/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Business Logic/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^API/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Types/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create Private Part' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Home',
        capability: {
          kind: 'part',
          slotName: 'Navigation',
          partName: 'UserMenu',
          createConnector: true,
          createHook: true,
          createStore: true,
          createLogic: true,
          createApi: true,
          createTypes: true,
          hookName: null,
        },
      }),
    );
  });

  it('rejects duplicates before asking the scaffold service to write', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    render(
      <CreateStructureItemDialog
        owner={NAVIGATION_OWNER}
        initialAction="part"
        existingRelativePaths={[
          'src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx',
        ]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Navigation' });
    await user.type(within(dialog).getByLabelText('Private Part name'), 'UserMenu');
    await user.click(within(dialog).getByRole('button', { name: 'Create Private Part' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('already exists');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('builds one exact slot capability request with optional files selected', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const featureOwner = structureOwnerFromFolder('src/features/home');
    if (!featureOwner) throw new Error('Expected canonical Home feature owner');

    render(
      <CreateStructureItemDialog
        owner={featureOwner}
        initialAction="slot"
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Home' });
    const slotName = within(dialog).getByLabelText('Named Slot name');
    await user.type(slotName, 'Navigation');
    expect(slotName).toHaveValue('Navigation');
    expect(within(dialog).getByRole('checkbox', { name: /Connector/ })).toBeChecked();
    expect(slotName).toHaveValue('Navigation');
    await user.click(within(dialog).getByRole('checkbox', { name: /Hook gateway/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Zustand store/ }));
    expect(slotName).toHaveValue('Navigation');
    await user.click(within(dialog).getByRole('checkbox', { name: /Business Logic/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /^API/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Types/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /First private part/ }));
    await user.type(within(dialog).getByLabelText('Optional first part name'), 'UserMenu');
    expect(within(dialog).getByRole('checkbox', { name: 'Part Connector required' })).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Part Connector required' }),
    ).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Create Named Slot' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Home',
        capability: {
          kind: 'slot',
          slotName: 'Navigation',
          createConnector: true,
          createHook: true,
          createStore: true,
          createLogic: true,
          createApi: true,
          createTypes: true,
          hookName: null,
          partName: 'UserMenu',
          createPartConnector: true,
        },
      }),
    );
  });
});

describe('structure guide discovery', () => {
  beforeEach(() => {
    window.localStorage.removeItem('srijika-studio:navigator-order:v1');
    useStudioStore.getState().resetProject();
    useProjectSessionStore.getState().resetSession();
    act(() => {
      useCodeProjectStore.getState().loadSource({
        fileName: 'Home.ui.tsx',
        sourcePath: null,
        diskHash: null,
        source: `export function HomeUI() {
  return <main>Home</main>;
}
`,
      });
    });
  });

  it('opens the guide from the Studio toolbar', async () => {
    const user = userEvent.setup();
    render(<CodeFirstStudio />);
    expect(screen.getByText('TSX → UiDocument')).toBeVisible();
    expect(document.body).not.toHaveTextContent('â');
    await user.click(screen.getByRole('button', { name: 'Open structure guide' }));
    expect(screen.getByRole('dialog', { name: 'Feature ownership structure' })).toBeVisible();
  });
});
