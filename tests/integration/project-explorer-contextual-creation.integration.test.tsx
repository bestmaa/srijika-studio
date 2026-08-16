import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CreateUiSourceDialog } from '../../apps/studio/src/components/code-first/CreateUiSourceDialog';
import { ProjectExplorer } from '../../apps/studio/src/components/code-first/ProjectExplorer';
import type { CodeProjectEntry } from '../../apps/studio/src/lib/project-service';

const ROOT = '/projects/srijika-app';

function entry(relativePath: string, kind: 'directory' | 'file'): CodeProjectEntry {
  return {
    path: `${ROOT}/${relativePath}`,
    relativePath,
    kind,
    bytes: kind === 'file' ? 120 : null,
    hash: kind === 'file' ? `${relativePath}-hash` : null,
    isUiSource: relativePath.endsWith('.ui.tsx'),
  };
}

const ENTRIES = [
  entry('src', 'directory'),
  entry('src/pages', 'directory'),
  entry('src/components', 'directory'),
  entry('src/components/home', 'directory'),
  entry('src/components/home/Home.connector.tsx', 'file'),
  entry('src/components/home/Home.ui.tsx', 'file'),
];

function renderExplorer(overrides?: {
  onCreatePage?: (folder?: string) => void;
  onCreateFeature?: () => void;
  onCreateStructure?: (folder: string) => void;
  entries?: readonly CodeProjectEntry[];
  architectureRoots?: { featuresRoot: string; sharedRoot: string };
}) {
  return render(
    <ProjectExplorer
      mode="desktop"
      displayName="srijika-app"
      rootPath={ROOT}
      entries={overrides?.entries ?? ENTRIES}
      selectedPath={null}
      activeUiSourcePath={`${ROOT}/src/components/home/Home.ui.tsx`}
      architectureRoots={overrides?.architectureRoots}
      onRefresh={vi.fn()}
      onNewProject={vi.fn()}
      onOpenProject={vi.fn()}
      onCreatePage={overrides?.onCreatePage ?? vi.fn()}
      onCreateFeature={overrides?.onCreateFeature ?? vi.fn()}
      onCreateStructure={overrides?.onCreateStructure}
      onSelect={vi.fn()}
      onSelectRoot={vi.fn()}
      onOpenRoot={vi.fn()}
      onOpenEntry={vi.fn()}
    />,
  );
}

describe('Project Explorer contextual creation', () => {
  it('discovers exact owners below configured Feature and Shared roots', () => {
    const onCreateStructure = vi.fn();
    renderExplorer({
      onCreateStructure,
      architectureRoots: {
        featuresRoot: 'application/domain/features',
        sharedRoot: 'application/domain/shared',
      },
      entries: [
        entry('src/features', 'directory'),
        entry('application', 'directory'),
        entry('application/domain', 'directory'),
        entry('application/domain/features', 'directory'),
        entry('application/domain/features/home', 'directory'),
        entry('application/domain/features/home/Home.ui.tsx', 'file'),
        entry('application/domain/shared', 'directory'),
        entry('application/domain/shared/widgets', 'directory'),
        entry('application/domain/shared/widgets/profile-card', 'directory'),
        entry('application/domain/shared/widgets/profile-card/ProfileCard.ui.tsx', 'file'),
      ],
    });

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    expect(within(explorer).getByTitle('New feature in application/domain/features')).toBeVisible();
    for (const folder of [
      'application/domain/features',
      'application/domain/features/home',
      'application/domain/shared',
      'application/domain/shared/widgets/profile-card',
    ]) {
      fireEvent.click(
        within(explorer).getByRole('button', { name: `Add capability inside ${folder}` }),
      );
      expect(onCreateStructure).toHaveBeenLastCalledWith(folder);
    }
    expect(
      within(explorer).queryByRole('button', { name: 'Add capability inside src/features' }),
    ).not.toBeInTheDocument();
  });

  it('routes pages and features to their canonical roots and hides legacy component creation', () => {
    const onCreatePage = vi.fn();
    const onCreateFeature = vi.fn();
    renderExplorer({ onCreatePage, onCreateFeature, onCreateStructure: vi.fn() });

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    fireEvent.click(within(explorer).getByRole('button', { name: 'New UI' }));
    expect(onCreatePage).toHaveBeenCalledWith();
    onCreatePage.mockClear();
    fireEvent.click(within(explorer).getByRole('button', { name: 'New feature' }));
    expect(onCreateFeature).toHaveBeenCalledTimes(1);

    fireEvent.click(
      within(explorer).getByRole('button', {
        name: 'Add page or feature inside src',
      }),
    );

    const menu = within(explorer).getByRole('menu', {
      name: 'Create inside src',
    });
    expect(within(menu).getByText('Create in src')).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: 'UI page' })).toBeVisible();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'UI page' }));

    expect(onCreatePage).toHaveBeenCalledWith('src/pages');
    expect(
      within(explorer).queryByRole('menu', { name: 'Create inside src' }),
    ).not.toBeInTheDocument();
    expect(
      within(explorer).queryByRole('button', {
        name: 'Add page or feature inside src/components/home',
      }),
    ).not.toBeInTheDocument();
  });

  it('keeps page creation inside src/pages and always includes its Connector', async () => {
    const onCreate = vi.fn(() => Promise.resolve(null));
    const onClose = vi.fn();
    render(
      <CreateUiSourceDialog
        initialFolder="src/components/home"
        existingRelativePaths={ENTRIES.map((candidate) => candidate.relativePath)}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Create UI page' });
    const folderInput = within(dialog).getByLabelText('Project folder');
    expect(folderInput).toHaveValue('src/pages');
    expect(within(dialog).getByText('Connector included')).toBeVisible();
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'HeroBanner' } });
    expect(within(dialog).getByText('src/pages/HeroBanner.ui.tsx')).toBeVisible();
    expect(within(dialog).getByText('src/pages/HeroBanner.connector.tsx')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create UI page' }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        kind: 'page',
        componentName: 'HeroBanner',
        folder: 'src/pages',
        relativePath: 'src/pages/HeroBanner.ui.tsx',
        createConnector: true,
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('offers ownership-aware capabilities only on exact feature and Shared owner folders', () => {
    const onCreateStructure = vi.fn();
    renderExplorer({
      onCreateStructure,
      entries: [
        entry('src', 'directory'),
        entry('src/features', 'directory'),
        entry('src/features/home', 'directory'),
        entry('src/features/home/Home.ui.tsx', 'file'),
        entry('src/features/home/slots', 'directory'),
        entry('src/features/home/slots/navigation', 'directory'),
        entry('src/features/home/slots/navigation/Navigation.ui.tsx', 'file'),
        entry('src/features/home/slots/navigation/parts', 'directory'),
        entry('src/features/home/slots/navigation/parts/user-menu', 'directory'),
        entry('src/features/home/slots/navigation/parts/user-menu/UserMenu.ui.tsx', 'file'),
        entry('src/shared', 'directory'),
        entry('src/shared/.gitkeep', 'file'),
        entry('src/shared/ui', 'directory'),
        entry('src/shared/ui/button', 'directory'),
        entry('src/shared/ui/button/Button.ui.tsx', 'file'),
        entry('src/shared/widgets', 'directory'),
        entry('src/shared/widgets/profile-card', 'directory'),
        entry('src/shared/widgets/profile-card/ProfileCard.ui.tsx', 'file'),
        entry('src/shared/capabilities', 'directory'),
        entry('src/shared/capabilities/auth-session', 'directory'),
        entry('src/shared/capabilities/auth-session/useAuthSession.ts', 'file'),
      ],
    });

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    fireEvent.click(
      within(explorer).getByRole('button', {
        name: 'Add capability inside src/features',
      }),
    );
    expect(within(explorer).queryByRole('menuitem', { name: 'UI page' })).not.toBeInTheDocument();
    expect(within(explorer).queryByRole('menuitem', { name: 'Component' })).not.toBeInTheDocument();
    expect(onCreateStructure).toHaveBeenLastCalledWith('src/features');

    fireEvent.click(
      within(explorer).getByRole('button', {
        name: 'Add capability inside src/features/home',
      }),
    );
    expect(within(explorer).queryByRole('menuitem', { name: 'UI page' })).not.toBeInTheDocument();
    expect(within(explorer).queryByRole('menuitem', { name: 'Component' })).not.toBeInTheDocument();
    expect(onCreateStructure).toHaveBeenLastCalledWith('src/features/home');

    fireEvent.click(
      within(explorer).getByRole('button', {
        name: 'Add capability inside src/features/home/slots/navigation',
      }),
    );
    expect(onCreateStructure).toHaveBeenLastCalledWith('src/features/home/slots/navigation');

    fireEvent.click(
      within(explorer).getByRole('button', {
        name: 'Add capability inside src/features/home/slots/navigation/parts/user-menu',
      }),
    );
    expect(onCreateStructure).toHaveBeenLastCalledWith(
      'src/features/home/slots/navigation/parts/user-menu',
    );

    for (const folder of [
      'src/shared',
      'src/shared/ui/button',
      'src/shared/widgets/profile-card',
      'src/shared/capabilities/auth-session',
    ]) {
      fireEvent.click(
        within(explorer).getByRole('button', {
          name: `Add capability inside ${folder}`,
        }),
      );
      expect(onCreateStructure).toHaveBeenLastCalledWith(folder);
    }
    expect(onCreateStructure).toHaveBeenCalledTimes(8);
  });

  it('opens the same strict creation dialog from a canonical folder right-click only', () => {
    const onCreateStructure = vi.fn();
    renderExplorer({
      onCreateStructure,
      entries: [
        entry('src', 'directory'),
        entry('src/features', 'directory'),
        entry('src/features/home', 'directory'),
        entry('src/features/home/Home.ui.tsx', 'file'),
        entry('src/random', 'directory'),
      ],
    });

    const explorer = screen.getByRole('region', { name: 'Project Explorer' });
    fireEvent.contextMenu(within(explorer).getByTitle('src/features/home'));
    expect(onCreateStructure).toHaveBeenCalledWith('src/features/home');
    expect(
      within(explorer).queryByRole('menu', { name: 'Create inside src/features/home' }),
    ).not.toBeInTheDocument();

    fireEvent.contextMenu(within(explorer).getByTitle('src/random'));
    expect(
      within(explorer).queryByRole('menu', { name: 'Create inside src/random' }),
    ).not.toBeInTheDocument();
  });
});
