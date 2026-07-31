import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { SutraRenderer } from '@sutra/react-renderer';

import { Hierarchy } from '../../apps/studio/src/components/Hierarchy';
import { Inspector } from '../../apps/studio/src/components/Inspector';
import { componentRegistry } from '../../apps/studio/src/lib/registry';
import { defaultSymbolValues, useStudioStore } from '../../apps/studio/src/store/studio-store';

function LivePreview() {
  const document = useStudioStore((state) => state.document);
  return (
    <SutraRenderer
      document={document}
      registry={componentRegistry}
      mode="preview"
      symbols={defaultSymbolValues(document)}
    />
  );
}

describe('hierarchy and schema-driven Inspector', () => {
  beforeEach(() => {
    useStudioStore.getState().resetDocument();
  });

  it('keeps hierarchy selection, typed props, JSON and preview synchronized', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Hierarchy />
        <Inspector />
        <LivePreview />
      </>,
    );

    await user.click(screen.getByRole('treeitem', { name: /Get Started Button/ }));
    expect(useStudioStore.getState().selectedNodeId).toBe('primary_action');
    expect(screen.getByRole('heading', { name: 'Button' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Props' }));
    const labelInput = screen.getByDisplayValue('Start building');
    await user.clear(labelInput);
    await user.type(labelInput, 'Ship it');

    expect(useStudioStore.getState().document.nodes['primary_action']).toMatchObject({
      props: { label: literalExpression('Ship it') },
    });
    expect(screen.getByRole('button', { name: 'Ship it' })).toBeInTheDocument();
  });

  it('only exposes event-typed public props to an event port', async () => {
    const user = userEvent.setup();
    useStudioStore.getState().selectNode('primary_action');
    render(<Inspector />);

    await user.click(screen.getByRole('button', { name: 'Events' }));
    const eventSection = screen.getByText('Event ports').closest('section');
    if (!eventSection) throw new Error('Expected the event-port Inspector section');
    const actionSelect = within(eventSection).getByRole('combobox');
    const optionLabels = [...actionSelect.querySelectorAll('option')].map(
      (option) => option.textContent,
    );

    expect(optionLabels).toContain('onGetStarted');
    expect(optionLabels).not.toContain('title');
    await user.selectOptions(actionSelect, 'event_get_started');
    expect(useStudioStore.getState().document.nodes['primary_action']).toMatchObject({
      events: {
        onClick: {
          kind: 'reference',
          symbolId: 'event_get_started',
          path: [],
        },
      },
    });
  });
});

function literalExpression(value: string) {
  return { kind: 'literal' as const, value };
}
