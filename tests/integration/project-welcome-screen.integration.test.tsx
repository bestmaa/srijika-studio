import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectWelcomeScreen } from '../../apps/studio/src/components/code-first/ProjectWelcomeScreen';

describe('ProjectWelcomeScreen', () => {
  it('offers real project actions in desktop mode without placeholder or invented recents', async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const onOpenStandaloneUi = vi.fn();

    render(
      <ProjectWelcomeScreen
        mode="desktop"
        statusMessage="Choose a project to begin."
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onOpenStandaloneUi={onOpenStandaloneUi}
      />,
    );

    expect(screen.getByRole('main', { name: 'Start with a real project.' })).toBeInTheDocument();
    expect(screen.getByText('Desktop · real folders')).toBeInTheDocument();
    expect(screen.queryByText(/Recent projects/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Profile/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Welcome.ui.tsx')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Choose a project to begin.');

    await user.click(screen.getByRole('button', { name: 'Create New Project' }));
    await user.click(screen.getByRole('button', { name: 'Open Existing Project' }));
    await user.click(screen.getByRole('button', { name: 'Preview standalone .ui.tsx' }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onOpenProject).toHaveBeenCalledTimes(1);
    expect(onOpenStandaloneUi).toHaveBeenCalledTimes(1);
  });

  it('describes browser limitations and only exposes actions the browser can perform', async () => {
    const user = userEvent.setup();
    const onCreateProject = vi.fn();
    const onOpenProject = vi.fn();
    const onOpenStandaloneUi = vi.fn();

    render(
      <ProjectWelcomeScreen
        mode="browser"
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onOpenStandaloneUi={onOpenStandaloneUi}
      />,
    );

    expect(
      screen.getByRole('main', { name: 'Explore Srijika without touching your files.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Browser · in-memory')).toBeInTheDocument();
    expect(
      screen.getByText(/Browser mode cannot create or attach real project folders/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Existing Project' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create Demo Project' }));
    await user.click(screen.getByRole('button', { name: 'Import One .ui.tsx File' }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onOpenStandaloneUi).toHaveBeenCalledTimes(1);
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('offers a real persisted desktop project as an explicit resume choice', async () => {
    const user = userEvent.setup();
    const onResumeProject = vi.fn();

    render(
      <ProjectWelcomeScreen
        mode="desktop"
        recentProject={{
          displayName: 'customer-portal',
          path: '/projects/customer-portal',
        }}
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenStandaloneUi={vi.fn()}
        onResumeProject={onResumeProject}
      />,
    );

    expect(screen.getByRole('region', { name: 'Recent project' })).toHaveTextContent(
      'customer-portal',
    );
    await user.click(screen.getByRole('button', { name: /Resume Last Project/ }));
    expect(onResumeProject).toHaveBeenCalledTimes(1);
  });

  it('blocks every project transition while Studio is busy', () => {
    render(
      <ProjectWelcomeScreen
        mode="desktop"
        disabled
        onCreateProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenStandaloneUi={vi.fn()}
      />,
    );

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });
});
