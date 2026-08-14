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
    expect(within(tree).getByText('useHome.ts')).toBeVisible();
    expect(within(tree).getByText('Navigation.ui.tsx')).toBeVisible();
    expect(within(tree).getByText('navigation.store.ts')).toBeVisible();
    expect(within(tree).getByText('navigation.logic.ts')).toBeVisible();
    expect(within(tree).getByText('navigation.api.ts')).toBeVisible();
    const partUiRow = within(tree).getByText('UserMenu.ui.tsx').closest('li');
    if (!partUiRow) throw new Error('Expected the UserMenu UI blueprint row');
    expect(within(partUiRow).getByText('Required')).toBeVisible();

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
      'featureStore',
      'featureLogic',
      'featureApi',
      'featureTypes',
      'slot',
    ]);
    const featuresRoot = structureOwnerFromFolder('src/features');
    expect(featuresRoot).toEqual({ level: 'featuresRoot', folder: 'src/features' });
    expect(featuresRoot && structureCreationActionsForOwner(featuresRoot)).toEqual(['feature']);
    expect(structureCreationActionsForOwner(NAVIGATION_OWNER)).toEqual([
      'slotConnector',
      'slotHook',
      'slotStore',
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
      'partStore',
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

    render(
      <CreateStructureItemDialog
        owner={NAVIGATION_OWNER}
        existingRelativePaths={[]}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to Navigation' });
    expect(within(dialog).getByRole('radio', { name: /Slot Connector/ })).toBeVisible();
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

  it('offers an existing private part every canonical capability', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(() => Promise.resolve(null));
    const partOwner = structureOwnerFromFolder(
      'src/features/home/slots/navigation/parts/user-menu',
    );
    if (!partOwner) throw new Error('Expected canonical UserMenu part owner');

    render(
      <CreateStructureItemDialog
        owner={partOwner}
        existingRelativePaths={[]}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Add to UserMenu' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(6);
    expect(within(dialog).getByRole('radio', { name: /Part Connector/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Part Hook/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part Store/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part Logic/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part API/ })).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: /Part Types/ })).toBeVisible();
    expect(
      within(dialog).getByText(
        'src/features/home/slots/navigation/parts/user-menu/UserMenu.connector.tsx',
      ),
    ).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Create Part Connector' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        featureName: 'Home',
        capability: {
          kind: 'partConnector',
          slotName: 'Navigation',
          partName: 'UserMenu',
        },
      }),
    );
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
