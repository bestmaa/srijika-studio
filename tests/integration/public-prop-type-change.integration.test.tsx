import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ElementNode, ValueType } from '@srijika/contracts';

import { Inspector } from '../../apps/studio/src/components/Inspector';
import { TopBar } from '../../apps/studio/src/components/TopBar';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

async function addPublicProp(user: UserEvent, name: string, type: ValueType): Promise<void> {
  await user.type(screen.getByLabelText('New public prop name'), name);
  await user.selectOptions(screen.getByLabelText('New public prop type'), type);
  await user.click(screen.getByRole('button', { name: 'Add public prop' }));
}

function element(nodeId: string): ElementNode {
  const node = useStudioStore.getState().document.nodes[nodeId];
  if (!node || node.kind !== 'element') throw new Error(`Expected element ${nodeId}`);
  return node;
}

describe('existing public prop type changes', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('changes an unreferenced data prop with synchronized defaults and shapes', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'content', 'string');
    fireEvent.change(screen.getByLabelText('Design value for props.content'), {
      target: { value: 'Sample content' },
    });

    const type = screen.getByLabelText('Type for props.content');
    expect(within(type).getByRole('option', { name: 'event' })).toBeInTheDocument();
    await user.selectOptions(type, 'number');

    let document = useStudioStore.getState().document;
    let prop = document.publicProps['content'];
    if (!prop) throw new Error('Expected content public prop');
    expect(prop).toMatchObject({ valueType: 'number', defaultValue: 0 });
    expect(prop).not.toHaveProperty('valueShape');
    expect(document.symbols[prop.symbolId]).toMatchObject({
      provider: 'prop',
      valueType: 'number',
      defaultValue: 0,
    });
    expect(document.symbols[prop.symbolId]).not.toHaveProperty('valueShape');
    expect(screen.getByLabelText('Design value for props.content')).toHaveAttribute(
      'type',
      'number',
    );
    expect(screen.getByLabelText('Design value for props.content')).toHaveValue(0);

    await user.selectOptions(type, 'array');
    document = useStudioStore.getState().document;
    prop = document.publicProps['content'];
    if (!prop) throw new Error('Expected content public prop');
    expect(prop).toMatchObject({
      valueType: 'array',
      defaultValue: [],
      valueShape: { kind: 'array', item: { kind: 'unknown' } },
    });
    expect(document.symbols[prop.symbolId]?.valueShape).toEqual(prop.valueShape);
    expect(screen.getByLabelText('props.content item type')).toHaveValue('unknown');

    await user.selectOptions(type, 'object');
    document = useStudioStore.getState().document;
    prop = document.publicProps['content'];
    if (!prop) throw new Error('Expected content public prop');
    expect(prop).toMatchObject({
      valueType: 'object',
      defaultValue: {},
      valueShape: { kind: 'object', fields: {}, additionalProperties: true },
    });
    expect(document.symbols[prop.symbolId]?.valueShape).toEqual(prop.valueShape);
    expect(screen.getByLabelText('Object shape mode for props.content')).toHaveValue('open');
  });

  it('rejects an incompatible referenced type atomically and permits a compatible color change', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TopBar />
        <Inspector />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'priceLabel', 'string');
    fireEvent.change(screen.getByLabelText('Design value for props.priceLabel'), {
      target: { value: '₹99.00' },
    });
    const priceLabel = useStudioStore.getState().document.publicProps['priceLabel'];
    if (!priceLabel) throw new Error('Expected priceLabel public prop');

    let textId: string | null = null;
    act(() => {
      textId = useStudioStore.getState().addComponent('srijika.text');
    });
    if (!textId) throw new Error('Expected Text to be created');
    await user.selectOptions(screen.getByLabelText('Text value source'), priceLabel.symbolId);

    act(() => {
      useStudioStore.getState().selectNode(useStudioStore.getState().document.rootNodeId);
    });
    const before = useStudioStore.getState().document;
    let type = screen.getByLabelText('Type for props.priceLabel');
    await user.selectOptions(type, 'number');

    let state = useStudioStore.getState();
    expect(state.document).toBe(before);
    expect(state.document.publicProps['priceLabel']).toMatchObject({
      valueType: 'string',
      defaultValue: '₹99.00',
    });
    expect(state.document.symbols[priceLabel.symbolId]).toMatchObject({
      valueType: 'string',
      defaultValue: '₹99.00',
    });
    expect(element(textId).props['text']).toEqual({
      kind: 'reference',
      symbolId: priceLabel.symbolId,
      path: [],
    });
    expect(type).toHaveValue('string');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not apply this change');
    expect(screen.getByRole('alert')).toHaveTextContent('expects string, received number');

    type = screen.getByLabelText('Type for props.priceLabel');
    await user.selectOptions(type, 'color');
    state = useStudioStore.getState();
    expect(state.document.publicProps['priceLabel']).toMatchObject({
      valueType: 'color',
      defaultValue: '',
    });
    expect(state.document.symbols[priceLabel.symbolId]).toMatchObject({
      valueType: 'color',
      defaultValue: '',
    });
    expect(element(textId).props['text']).toMatchObject({ symbolId: priceLabel.symbolId });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('converts an unbound data prop into an editable event definition', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'onSave', 'string');

    const type = screen.getByLabelText('Type for props.onSave');
    expect(within(type).getByRole('option', { name: 'event' })).toBeInTheDocument();
    await user.selectOptions(type, 'event');

    const document = useStudioStore.getState().document;
    const prop = document.publicProps['onSave'];
    if (!prop) throw new Error('Expected onSave public prop');
    expect(prop).toMatchObject({
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(prop).not.toHaveProperty('defaultValue');
    expect(prop).not.toHaveProperty('valueShape');
    expect(document.symbols[prop.symbolId]).toMatchObject({
      provider: 'event',
      valueType: 'event',
      eventSignature: { payload: null },
    });
    expect(
      screen.getByRole('group', { name: 'Event definition for props.onSave' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Payload mode for props.onSave')).toHaveValue('none');
    expect(screen.getByLabelText('Return type for props.onSave')).toHaveValue('void');
    expect(screen.getByLabelText('Return type for props.onSave')).toHaveAttribute('readonly');
    expect(screen.getByText('Callback · () => void')).toBeInTheDocument();
  });

  it('edits and recursively mirrors an event payload signature', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'onSubmit', 'event');

    await user.selectOptions(screen.getByLabelText('Payload mode for props.onSubmit'), 'payload');
    const name = screen.getByLabelText('Event payload name for props.onSubmit');
    await user.clear(name);
    await user.type(name, 'form');
    await user.tab();
    await user.selectOptions(
      screen.getByLabelText('Event payload type for props.onSubmit'),
      'object',
    );
    await user.selectOptions(
      screen.getByLabelText('Object shape mode for Event payload for props.onSubmit'),
      'defined',
    );
    await user.type(
      screen.getByLabelText('Add field to Event payload for props.onSubmit name'),
      'email',
    );
    await user.selectOptions(
      screen.getByLabelText('Add field to Event payload for props.onSubmit type'),
      'string',
    );
    await user.click(
      screen.getByRole('button', { name: 'Add field to Event payload for props.onSubmit' }),
    );

    const document = useStudioStore.getState().document;
    const prop = document.publicProps['onSubmit'];
    if (!prop) throw new Error('Expected onSubmit public prop');
    const expectedSignature = {
      payload: {
        name: 'form',
        shape: {
          kind: 'object',
          fields: { email: { required: false, shape: { kind: 'string' } } },
          additionalProperties: false,
        },
      },
    } as const;
    expect(prop.eventSignature).toEqual(expectedSignature);
    expect(document.symbols[prop.symbolId]?.eventSignature).toEqual(expectedSignature);
    expect(document.symbols[prop.symbolId]?.eventSignature).not.toBe(prop.eventSignature);
    expect(screen.getByText('Callback · (form: object) => void')).toBeInTheDocument();
  });

  it('rolls back an incompatible event payload edit while keeping its binding', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TopBar />
        <Inspector />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'onValueChange', 'event');
    await user.selectOptions(
      screen.getByLabelText('Payload mode for props.onValueChange'),
      'payload',
    );
    await user.selectOptions(
      screen.getByLabelText('Event payload type for props.onValueChange'),
      'string',
    );
    const onValueChange = useStudioStore.getState().document.publicProps['onValueChange'];
    if (!onValueChange) throw new Error('Expected onValueChange public prop');

    let inputId: string | null = null;
    act(() => {
      inputId = useStudioStore.getState().addComponent('srijika.input');
    });
    if (!inputId) throw new Error('Expected Input to be created');
    await user.click(screen.getByRole('button', { name: 'Events' }));
    await user.selectOptions(screen.getByLabelText('On change action'), onValueChange.symbolId);

    act(() => {
      useStudioStore.getState().selectNode(useStudioStore.getState().document.rootNodeId);
    });
    await user.click(screen.getByRole('button', { name: 'Props' }));
    const before = useStudioStore.getState().document;
    await user.selectOptions(
      screen.getByLabelText('Event payload type for props.onValueChange'),
      'number',
    );

    const state = useStudioStore.getState();
    expect(state.document).toBe(before);
    expect(state.document.publicProps['onValueChange']?.eventSignature).toEqual({
      payload: { name: 'payload', shape: { kind: 'string' } },
    });
    expect(state.document.symbols[onValueChange.symbolId]?.eventSignature).toEqual({
      payload: { name: 'payload', shape: { kind: 'string' } },
    });
    expect(element(inputId).events['onChange']).toEqual({
      kind: 'reference',
      symbolId: onValueChange.symbolId,
      path: [],
    });
    expect(screen.getByLabelText('Event payload type for props.onValueChange')).toHaveValue(
      'string',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not apply this change');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Event onChange payload is incompatible with onValueChange',
    );
  });

  it('converts an unbound event back into a data prop', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'onSave', 'event');
    await user.selectOptions(screen.getByLabelText('Payload mode for props.onSave'), 'payload');
    await user.selectOptions(
      screen.getByLabelText('Event payload type for props.onSave'),
      'string',
    );

    await user.selectOptions(screen.getByLabelText('Type for props.onSave'), 'string');

    const document = useStudioStore.getState().document;
    const prop = document.publicProps['onSave'];
    if (!prop) throw new Error('Expected onSave public prop');
    expect(prop).toMatchObject({ valueType: 'string', defaultValue: '' });
    expect(prop).not.toHaveProperty('eventSignature');
    expect(document.symbols[prop.symbolId]).toMatchObject({
      provider: 'prop',
      valueType: 'string',
      defaultValue: '',
    });
    expect(document.symbols[prop.symbolId]).not.toHaveProperty('eventSignature');
    expect(screen.queryByRole('group', { name: 'Event definition for props.onSave' })).toBeNull();
    expect(screen.getByLabelText('Design value for props.onSave')).toHaveValue('');
  });

  it('rolls back a bound data-to-event conversion without disturbing the binding', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TopBar />
        <Inspector />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'titleText', 'string');
    const titleText = useStudioStore.getState().document.publicProps['titleText'];
    if (!titleText) throw new Error('Expected titleText public prop');

    let headingId: string | null = null;
    act(() => {
      headingId = useStudioStore.getState().addComponent('srijika.heading');
    });
    if (!headingId) throw new Error('Expected Heading to be created');
    await user.selectOptions(screen.getByLabelText('Text value source'), titleText.symbolId);
    act(() => {
      useStudioStore.getState().selectNode(useStudioStore.getState().document.rootNodeId);
    });

    const before = useStudioStore.getState().document;
    await user.selectOptions(screen.getByLabelText('Type for props.titleText'), 'event');

    const state = useStudioStore.getState();
    expect(state.document).toBe(before);
    expect(state.document.publicProps['titleText']).toMatchObject({
      valueType: 'string',
      defaultValue: '',
    });
    expect(state.document.publicProps['titleText']).not.toHaveProperty('eventSignature');
    expect(element(headingId).props['text']).toEqual({
      kind: 'reference',
      symbolId: titleText.symbolId,
      path: [],
    });
    expect(screen.getByLabelText('Type for props.titleText')).toHaveValue('string');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not apply this change');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'remove its component binding before changing between data and event',
    );
  });
});
