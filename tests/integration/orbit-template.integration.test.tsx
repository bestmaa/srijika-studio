import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SutraRenderer } from '@sutra/react-renderer';

import { componentRegistry } from '../../apps/studio/src/lib/registry';
import { studioTemplateById } from '../../apps/studio/src/lib/templates';

describe('Orbit Analytics template', () => {
  it('renders the complete dashboard shell and high-fidelity visual primitives', () => {
    const template = studioTemplateById('analytics-dashboard');
    expect(template).toBeDefined();
    const document = template!.createDocument('page_orbit_render');

    render(
      <SutraRenderer
        document={document}
        mode="preview"
        registry={componentRegistry}
        symbols={{
          prop_activity: document.publicProps['activity']?.defaultValue,
          prop_showGrowth: document.publicProps['showGrowth']?.defaultValue,
        }}
      />,
    );

    expect(screen.getByLabelText('Orbit analytics dashboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Good morning, Alex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
    expect(screen.getByText('Active projects')).toBeInTheDocument();
    expect(screen.getByText('Weekly hours')).toBeInTheDocument();

    expect(
      screen.getByRole('img', {
        name: 'Projects created and tasks completed over seven days',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Task progress: 94 completed, 56 in progress and 34 todo',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '68 percent of storage used' })).toHaveAttribute(
      'aria-valuenow',
      '68',
    );
    expect(screen.getByRole('img', { name: 'Alex Johnson Avatar' })).toBeInTheDocument();
    expect(screen.getAllByText('On track')).toHaveLength(2);
    expect(screen.getByText('Sarah Chen completed a task')).toBeInTheDocument();
  });
});
