import { act, render, screen, within } from '@testing-library/react';
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

  it('exposes every public event and creates a compatible argument mapping', async () => {
    const user = userEvent.setup();
    act(() => {
      useStudioStore.getState().addPublicProp('onValueChange', 'event');
    });
    const onValueChange = useStudioStore.getState().document.publicProps['onValueChange'];
    if (!onValueChange) throw new Error('Expected onValueChange public event');
    act(() => {
      useStudioStore.getState().setPublicPropEventSignature('onValueChange', {
        payload: { name: 'value', shape: { kind: 'string' } },
      });
    });
    useStudioStore.getState().selectNode('primary_action');
    render(<Inspector />);

    await user.click(screen.getByRole('button', { name: 'Events' }));
    const eventSection = screen.getByText('Event ports').closest('section');
    if (!eventSection) throw new Error('Expected the event-port Inspector section');
    let actionSelect = within(eventSection).getByLabelText('On click action');
    let optionLabels = [...actionSelect.querySelectorAll('option')].map(
      (option) => option.textContent,
    );

    expect(optionLabels).toContain('onGetStarted · () => void');
    expect(optionLabels.some((label) => label?.includes('title'))).toBe(false);
    expect(optionLabels).toContain('onValueChange · (value: string) => void');
    await user.selectOptions(actionSelect, onValueChange.symbolId);
    expect(useStudioStore.getState().document.nodes['primary_action']).toMatchObject({
      events: {
        onClick: {
          kind: 'reference',
          symbolId: onValueChange.symbolId,
          path: [],
        },
      },
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: { kind: 'literal', value: '' },
        },
      },
    });
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
    expect(useStudioStore.getState().document.nodes['primary_action']).not.toHaveProperty(
      'eventArguments',
    );

    let inputId: string | null = null;
    act(() => {
      inputId = useStudioStore.getState().addComponent('sutra.input');
    });
    if (!inputId) throw new Error('Expected Input to be created');
    actionSelect = screen.getByLabelText('On change action');
    optionLabels = [...actionSelect.querySelectorAll('option')].map((option) => option.textContent);
    expect(optionLabels).toContain('onGetStarted · () => void');
    expect(optionLabels).toContain('onValueChange · (value: string) => void');

    await user.selectOptions(actionSelect, onValueChange.symbolId);
    expect(useStudioStore.getState().document.nodes[inputId]).toMatchObject({
      events: {
        onChange: {
          kind: 'reference',
          symbolId: onValueChange.symbolId,
          path: [],
        },
      },
    });
  });
});

function literalExpression(value: string) {
  return { kind: 'literal' as const, value };
}
