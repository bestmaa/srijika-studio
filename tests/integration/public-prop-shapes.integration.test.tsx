import { act, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ElementNode, ValueShape } from '@sutra/contracts';
import { generateTsx } from '@sutra/react-codegen';

import { Inspector } from '../../apps/studio/src/components/Inspector';
import { TopBar } from '../../apps/studio/src/components/TopBar';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

async function openPageProps(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Props' }));
}

async function addPublicProp(
  user: UserEvent,
  name: string,
  type: 'array' | 'object',
): Promise<void> {
  await user.type(screen.getByLabelText('New public prop name'), name);
  await user.selectOptions(screen.getByLabelText('New public prop type'), type);
  await user.click(screen.getByRole('button', { name: 'Add public prop' }));
}

async function addShapeField(
  user: UserEvent,
  owner: string,
  name: string,
  type: ValueShape['kind'],
): Promise<void> {
  await user.type(screen.getByLabelText(`Add field to ${owner} name`), name);
  await user.selectOptions(screen.getByLabelText(`Add field to ${owner} type`), type);
  await user.click(screen.getByRole('button', { name: `Add field to ${owner}` }));
}

function element(nodeId: string): ElementNode {
  const node = useStudioStore.getState().document.nodes[nodeId];
  if (!node || node.kind !== 'element') throw new Error(`Expected element ${nodeId}`);
  return node;
}

describe('recursive public prop shapes in the Inspector', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('builds nested object fields, mirrors their shape, and binds a Heading to a nested path', async () => {
    const user = userEvent.setup();
    render(<Inspector />);

    await openPageProps(user);
    await addPublicProp(user, 'profile', 'object');
    await user.selectOptions(
      screen.getByLabelText('Object shape mode for props.profile'),
      'defined',
    );
    await addShapeField(user, 'props.profile', 'displayName', 'string');
    await addShapeField(user, 'props.profile', 'preferences', 'object');
    await user.selectOptions(
      screen.getByLabelText('Object shape mode for props.profile.preferences'),
      'defined',
    );
    await addShapeField(user, 'props.profile.preferences', 'subscribed', 'boolean');

    const expectedShape: ValueShape = {
      kind: 'object',
      fields: {
        displayName: { required: false, shape: { kind: 'string' } },
        preferences: {
          required: false,
          shape: {
            kind: 'object',
            fields: {
              subscribed: { required: false, shape: { kind: 'boolean' } },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };
    let document = useStudioStore.getState().document;
    const profile = document.publicProps['profile'];
    if (!profile) throw new Error('Expected profile public prop');
    expect(profile.valueShape).toEqual(expectedShape);
    expect(document.symbols[profile.symbolId]?.valueShape).toEqual(expectedShape);
    expect(document.symbols[profile.symbolId]?.valueShape).not.toBe(profile.valueShape);

    let headingId: string | null = null;
    act(() => {
      headingId = useStudioStore.getState().addComponent('sutra.heading');
    });
    if (!headingId) throw new Error('Expected Heading to be created');

    const nestedBinding = JSON.stringify([profile.symbolId, ['displayName']]);
    const source = screen.getByLabelText('Text value source');
    expect(
      within(source).getByRole('option', { name: /profile\.displayName/ }),
    ).toBeInTheDocument();
    await user.selectOptions(source, nestedBinding);

    document = useStudioStore.getState().document;
    expect(element(headingId).props['text']).toEqual({
      kind: 'reference',
      symbolId: profile.symbolId,
      path: ['displayName'],
    });
    expect(generateTsx(document)).toContain('{(props.profile ?? {})?.["displayName"]}');
  });

  it('offers a typed Repeat item field only to components inside that Repeat template', async () => {
    const user = userEvent.setup();
    render(<Inspector />);

    await openPageProps(user);
    await addPublicProp(user, 'items', 'array');
    await user.selectOptions(screen.getByLabelText('props.items item type'), 'object');
    await addShapeField(user, 'props.items item', 'label', 'string');

    let document = useStudioStore.getState().document;
    const items = document.publicProps['items'];
    if (!items) throw new Error('Expected items public prop');
    expect(items.valueShape).toEqual({
      kind: 'array',
      item: {
        kind: 'object',
        fields: { label: { required: false, shape: { kind: 'string' } } },
        additionalProperties: false,
      },
    });
    expect(document.symbols[items.symbolId]?.valueShape).toEqual(items.valueShape);

    const rootId = document.rootNodeId;
    let repeatId: string | null = null;
    act(() => {
      repeatId = useStudioStore.getState().addRepeatNode(rootId);
    });
    if (!repeatId) throw new Error('Expected Repeat to be created');
    await user.selectOptions(
      screen.getByLabelText('Repeat collection source'),
      `reference:${items.symbolId}`,
    );

    document = useStudioStore.getState().document;
    const repeat = document.nodes[repeatId];
    if (!repeat || repeat.kind !== 'repeat') throw new Error('Expected Repeat AST node');
    expect(repeat.source).toEqual({
      kind: 'reference',
      symbolId: items.symbolId,
      path: [],
    });

    let insideId: string | null = null;
    let outsideId: string | null = null;
    act(() => {
      insideId = useStudioStore.getState().addComponent('sutra.text', repeatId!);
      outsideId = useStudioStore.getState().addComponent('sutra.text', rootId);
    });
    if (!insideId || !outsideId) throw new Error('Expected inside and outside Text components');

    const itemFieldBinding = JSON.stringify([repeat.itemSymbolId, ['label']]);
    let source = screen.getByLabelText('Text value source');
    expect(within(source).queryByRole('option', { name: /item\.label/ })).not.toBeInTheDocument();

    act(() => {
      useStudioStore.getState().selectNode(insideId!);
    });
    source = screen.getByLabelText('Text value source');
    expect(within(source).getByRole('option', { name: /item\.label/ })).toBeInTheDocument();
    await user.selectOptions(source, itemFieldBinding);

    expect(element(insideId).props['text']).toEqual({
      kind: 'reference',
      symbolId: repeat.itemSymbolId,
      path: ['label'],
    });
    expect(element(outsideId).props['text']).toEqual({ kind: 'literal', value: 'Text' });
    expect(generateTsx(useStudioStore.getState().document)).toContain('{item?.["label"]}');
  });

  it('rejects removing or changing a referenced nested field atomically and shows an error notice', async () => {
    const user = userEvent.setup();
    render(
      <>
        <TopBar />
        <Inspector />
      </>,
    );

    await openPageProps(user);
    await addPublicProp(user, 'profile', 'object');
    await user.selectOptions(
      screen.getByLabelText('Object shape mode for props.profile'),
      'defined',
    );
    await addShapeField(user, 'props.profile', 'displayName', 'string');

    const profile = useStudioStore.getState().document.publicProps['profile'];
    if (!profile) throw new Error('Expected profile public prop');
    let headingId: string | null = null;
    act(() => {
      headingId = useStudioStore.getState().addComponent('sutra.heading');
    });
    if (!headingId) throw new Error('Expected Heading to be created');
    await user.selectOptions(
      screen.getByLabelText('Text value source'),
      JSON.stringify([profile.symbolId, ['displayName']]),
    );

    act(() => {
      useStudioStore.getState().selectNode(useStudioStore.getState().document.rootNodeId);
    });
    const beforeRemoval = useStudioStore.getState().document;
    await user.click(screen.getByRole('button', { name: 'Remove props.profile.displayName' }));

    expect(useStudioStore.getState().document).toBe(beforeRemoval);
    expect(useStudioStore.getState().document.publicProps['profile']?.valueShape).toEqual(
      beforeRemoval.publicProps['profile']?.valueShape,
    );
    expect(element(headingId).props['text']).toEqual({
      kind: 'reference',
      symbolId: profile.symbolId,
      path: ['displayName'],
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not apply this change');

    const beforeTypeChange = useStudioStore.getState().document;
    await user.selectOptions(screen.getByLabelText('props.profile.displayName type'), 'boolean');

    expect(useStudioStore.getState().document).toBe(beforeTypeChange);
    expect(useStudioStore.getState().document.publicProps['profile']?.valueShape).toEqual(
      beforeTypeChange.publicProps['profile']?.valueShape,
    );
    expect(screen.getByLabelText('props.profile.displayName type')).toHaveValue('string');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not apply this change');
  });

  it('keeps Page root width and height at 100% when setStyle is called directly', () => {
    render(
      <>
        <TopBar />
        <Inspector />
      </>,
    );

    const rootId = useStudioStore.getState().document.rootNodeId;
    const before = useStudioStore.getState().document;
    act(() => {
      useStudioStore
        .getState()
        .setStyle(rootId, 'width', { mode: 'fixed', value: 320, unit: 'px' });
      useStudioStore.getState().setStyle(rootId, 'height', { mode: 'auto' });
    });

    const after = useStudioStore.getState().document;
    expect(after).toBe(before);
    expect(element(rootId).style.base.width).toEqual({ mode: 'percent', value: 100 });
    expect(element(rootId).style.base.height).toEqual({ mode: 'percent', value: 100 });
    expect(screen.getByRole('note')).toHaveTextContent('Width 100%');
    expect(screen.getByRole('note')).toHaveTextContent('Height 100%');
    expect(screen.queryByLabelText('Width sizing mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Height sizing mode')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The Page root is locked to 100% width and height',
    );
  });
});
