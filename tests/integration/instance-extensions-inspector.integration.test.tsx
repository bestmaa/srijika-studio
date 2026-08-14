import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { EventSignature } from '@srijika/contracts';
import { generateTsx } from '@srijika/react-codegen';

import { Inspector } from '../../apps/studio/src/components/Inspector';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function selectTextNode(): void {
  act(() => {
    useStudioStore.getState().selectNode('hero_description');
    useStudioStore.getState().setInspectorTab('design');
  });
}

function addPageEvent(name: string, signature: EventSignature): string {
  act(() => {
    useStudioStore.getState().addPublicProp(name, 'event');
    useStudioStore.getState().setPublicPropEventSignature(name, signature);
  });
  const prop = useStudioStore.getState().document.publicProps[name];
  if (!prop) throw new Error(`Expected props.${name}`);
  return prop.symbolId;
}

async function addInstanceProp(
  user: UserEvent,
  name: string,
  type: 'string' | 'number' | 'boolean' | 'color' | 'object' | 'array' | 'unknown',
): Promise<void> {
  await user.clear(screen.getByLabelText('New instance prop name'));
  await user.type(screen.getByLabelText('New instance prop name'), name);
  await user.selectOptions(screen.getByLabelText('New instance prop type'), type);
  await user.click(screen.getByRole('button', { name: 'Add instance prop' }));
}

describe('Inspector instance extensions', () => {
  beforeEach(() => {
    useStudioStore.getState().resetDocument();
  });

  it('adds, changes, binds and edits typed Text instance props', async () => {
    const user = userEvent.setup();
    selectTextNode();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: /^Props$/ }));

    await addInstanceProp(user, 'title', 'string');
    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      instanceProps: {
        title: { displayName: 'title', type: 'string', required: false },
      },
      props: { title: { kind: 'literal', value: '' } },
    });

    const title = screen.getByLabelText('title', { exact: true });
    await user.type(title, 'Helpful text');
    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      props: { title: { kind: 'literal', value: 'Helpful text' } },
    });

    await user.selectOptions(screen.getByLabelText('Instance prop type title'), 'number');
    expect(screen.getByLabelText('title', { exact: true })).toHaveAttribute('type', 'number');
    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      instanceProps: {
        title: { displayName: 'title', type: 'number', required: false },
      },
      props: { title: { kind: 'literal', value: 0 } },
    });
    await user.clear(screen.getByLabelText('title', { exact: true }));
    await user.type(screen.getByLabelText('title', { exact: true }), '42');

    await addInstanceProp(user, 'data-testid', 'string');
    await user.type(screen.getByLabelText('data-testid', { exact: true }), 'hero-copy');
    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      instanceProps: {
        title: { type: 'number' },
        'data-testid': { displayName: 'data-testid', type: 'string', required: false },
      },
      props: {
        title: { kind: 'literal', value: 42 },
        'data-testid': { kind: 'literal', value: 'hero-copy' },
      },
    });

    const dataTestIdSource = screen.getByLabelText('data-testid value source');
    expect(within(dataTestIdSource).getByRole('option', { name: '↳ title' })).toBeVisible();
    await user.selectOptions(dataTestIdSource, 'prop_title');
    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      props: {
        'data-testid': { kind: 'reference', symbolId: 'prop_title', path: [] },
      },
    });
    expect(generateTsx(useStudioStore.getState().document)).toContain(
      '"data-testid": (props.title ?? "Build applications visually")',
    );

    await user.selectOptions(dataTestIdSource, 'literal');
    await user.type(screen.getByLabelText('data-testid', { exact: true }), 'description-copy');
    const node = useStudioStore.getState().document.nodes['hero_description'];
    expect(node).toMatchObject({
      props: {
        title: { kind: 'literal', value: 42 },
        'data-testid': { kind: 'literal', value: 'description-copy' },
      },
    });
    const generated = generateTsx(useStudioStore.getState().document);
    expect(generated).toContain('"title": 42');
    expect(generated).toContain('"data-testid": "description-copy"');
  });

  it('rejects reserved and raw-event prop names in the instance-prop editor', async () => {
    const user = userEvent.setup();
    selectTextNode();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: /^Props$/ }));

    const name = screen.getByLabelText('New instance prop name');
    const add = screen.getByRole('button', { name: 'Add instance prop' });
    await user.type(name, 'style');
    expect(add).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Instance prop style is reserved by Srijika or React',
    );

    await user.clear(name);
    await user.type(name, 'onClick');
    expect(add).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Instance prop onClick looks like a raw event; add an approved event port instead',
    );
    expect(useStudioStore.getState().document.nodes['hero_description']).not.toHaveProperty(
      'instanceProps',
    );
  });

  it('adds Text onClick, maps a page-event argument, and removes all binding state', async () => {
    const user = userEvent.setup();
    const onCount = addPageEvent('onCount', {
      payload: { name: 'count', shape: { kind: 'number' } },
    });
    selectTextNode();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: /^Events$/ }));

    const ports = screen.getByLabelText('New instance event port');
    expect(within(ports).getByRole('option', { name: 'onClick · no payload' })).toBeVisible();
    await user.selectOptions(ports, 'onClick');
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      instanceEvents: {
        onClick: { displayName: 'Click', source: 'click', signature: { payload: null } },
      },
    });

    await user.selectOptions(screen.getByLabelText('Click action'), onCount);
    expect(screen.getByLabelText('Click argument source')).toHaveValue('literal');
    expect(
      within(screen.getByLabelText('Click argument source')).getByRole('option', {
        name: 'Emitted event value',
      }),
    ).toBeDisabled();
    await user.clear(screen.getByLabelText('Click literal argument'));
    await user.type(screen.getByLabelText('Click literal argument'), '9');

    expect(useStudioStore.getState().document.nodes['hero_description']).toMatchObject({
      events: {
        onClick: { kind: 'reference', symbolId: onCount, path: [] },
      },
      eventArguments: {
        onClick: { kind: 'expression', expression: { kind: 'literal', value: 9 } },
      },
    });
    expect(generateTsx(useStudioStore.getState().document)).toContain(
      'onClick={() => props.onCount?.(9)}',
    );

    await user.click(screen.getByRole('button', { name: 'Remove event port onClick' }));
    const node = useStudioStore.getState().document.nodes['hero_description'];
    expect(node).not.toHaveProperty('instanceEvents');
    expect(node).not.toHaveProperty('events.onClick');
    expect(node).not.toHaveProperty('eventArguments.onClick');
    expect(screen.queryByLabelText('Click action')).toBeNull();
    expect(
      within(screen.getByLabelText('New instance event port')).getByRole('option', {
        name: 'onClick · no payload',
      }),
    ).toBeVisible();
  });
});
