import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { EventSignature, ValueShape } from '@srijika/contracts';

import { Inspector } from '../../apps/studio/src/components/Inspector';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function addEvent(name: string, signature: EventSignature): string {
  act(() => {
    useStudioStore.getState().addPublicProp(name, 'event');
    useStudioStore.getState().setPublicPropEventSignature(name, signature);
  });
  const prop = useStudioStore.getState().document.publicProps[name];
  if (!prop) throw new Error(`Expected props.${name}`);
  return prop.symbolId;
}

function selectNode(nodeId: string): void {
  act(() => {
    useStudioStore.getState().selectNode(nodeId);
    useStudioStore.getState().setInspectorTab('design');
  });
}

async function openEvents(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^Events$/ }));
}

describe('event action argument mapping Inspector', () => {
  beforeEach(() => {
    useStudioStore.getState().resetDocument();
  });

  it('lists incompatible emitted actions and atomically creates a typed number literal', async () => {
    const user = userEvent.setup();
    const onValueChange = addEvent('onValueChange', {
      payload: { name: 'value', shape: { kind: 'string' } },
    });
    const onCount = addEvent('onCount', {
      payload: { name: 'count', shape: { kind: 'number' } },
    });
    selectNode('secondary_action');
    render(<Inspector />);
    await openEvents(user);

    const action = screen.getByLabelText('On click action');
    const optionLabels = [...action.querySelectorAll('option')].map((option) => option.textContent);
    expect(optionLabels).toContain('onValueChange · (value: string) => void');
    expect(optionLabels).toContain('onCount · (count: number) => void');

    await user.selectOptions(action, onCount);
    const source = screen.getByLabelText('On click argument source');
    expect(source).toHaveValue('literal');
    expect(within(source).getByRole('option', { name: 'Emitted event value' })).toBeDisabled();
    expect(
      screen.getByText('On click emits no value. Choose a literal or page prop.'),
    ).toBeVisible();

    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      events: {
        onClick: { kind: 'reference', symbolId: onCount, path: [] },
      },
      eventArguments: {
        onClick: { kind: 'expression', expression: { kind: 'literal', value: 0 } },
      },
    });

    const argument = screen.getByLabelText('On click literal argument');
    await user.clear(argument);
    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      eventArguments: {
        onClick: { kind: 'expression', expression: { kind: 'literal', value: 0 } },
      },
    });
    await user.type(argument, '42');
    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      eventArguments: {
        onClick: { kind: 'expression', expression: { kind: 'literal', value: 42 } },
      },
    });

    expect(onValueChange).not.toBe(onCount);
  });

  it('defaults a compatible Input action to the normalized emitted event value', async () => {
    const user = userEvent.setup();
    const onValueChange = addEvent('onValueChange', {
      payload: { name: 'value', shape: { kind: 'string' } },
    });
    let inputId: string | null = null;
    act(() => {
      inputId = useStudioStore.getState().addComponent('srijika.input');
    });
    if (!inputId) throw new Error('Expected an Input node');
    render(<Inspector />);
    await openEvents(user);

    await user.selectOptions(screen.getByLabelText('On change action'), onValueChange);
    expect(screen.getByLabelText('On change argument source')).toHaveValue('eventPayload');
    expect(useStudioStore.getState().document.nodes[inputId]).toMatchObject({
      events: {
        onChange: { kind: 'reference', symbolId: onValueChange, path: [] },
      },
      eventArguments: {
        onChange: { kind: 'eventPayload' },
      },
    });
  });

  it('maps an event argument from a compatible page prop and clears both atomically', async () => {
    const user = userEvent.setup();
    const onCount = addEvent('onCount', {
      payload: { name: 'count', shape: { kind: 'number' } },
    });
    act(() => useStudioStore.getState().addPublicProp('count', 'number'));
    const countProp = useStudioStore.getState().document.publicProps['count'];
    if (!countProp) throw new Error('Expected props.count');

    selectNode('secondary_action');
    render(<Inspector />);
    await openEvents(user);
    const action = screen.getByLabelText('On click action');
    await user.selectOptions(action, onCount);
    await user.selectOptions(screen.getByLabelText('On click argument source'), 'pageProp');

    const pageProp = screen.getByLabelText('On click page prop argument');
    expect(pageProp).toHaveValue(countProp.symbolId);
    expect(within(pageProp).getByRole('option', { name: 'props.count · number' })).toBeVisible();
    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: { kind: 'reference', symbolId: countProp.symbolId, path: [] },
        },
      },
    });

    await user.selectOptions(action, '');
    const node = useStudioStore.getState().document.nodes['secondary_action'];
    expect(node).toMatchObject({ events: {} });
    expect(node).not.toHaveProperty('eventArguments');
  });

  it('keeps invalid structured JSON local and applies a shape-compatible object', async () => {
    const user = userEvent.setup();
    const shape: ValueShape = {
      kind: 'object',
      fields: { amount: { required: true, shape: { kind: 'number' } } },
      additionalProperties: false,
    };
    const onSubmit = addEvent('onSubmit', { payload: { name: 'form', shape } });
    selectNode('secondary_action');
    render(<Inspector />);
    await openEvents(user);
    await user.selectOptions(screen.getByLabelText('On click action'), onSubmit);

    const json = screen.getByLabelText('On click literal argument');
    expect(json.tagName).toBe('TEXTAREA');
    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: { kind: 'literal', value: { amount: 0 } },
        },
      },
    });

    fireEvent.change(json, { target: { value: '{"amount":"wrong"}' } });
    await user.click(screen.getByRole('button', { name: 'Apply On click literal argument' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The JSON value must match the object payload shape.',
    );
    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: { kind: 'literal', value: { amount: 0 } },
        },
      },
    });

    fireEvent.change(json, { target: { value: '{"amount":7}' } });
    await user.click(screen.getByRole('button', { name: 'Apply On click literal argument' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useStudioStore.getState().document.nodes['secondary_action']).toMatchObject({
      eventArguments: {
        onClick: {
          kind: 'expression',
          expression: { kind: 'literal', value: { amount: 7 } },
        },
      },
    });
  });
});
