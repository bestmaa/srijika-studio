import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ElementNode, ValueType } from '@sutra/contracts';
import { generateTsx } from '@sutra/react-codegen';

import { Inspector } from '../../apps/studio/src/components/Inspector';
import { defaultSymbolValues, useStudioStore } from '../../apps/studio/src/store/studio-store';

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

describe('direct typed public prop binding', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('edits mirrored primitive design values and reverses the edit', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: 'Props' }));

    await addPublicProp(user, 'priceLabel', 'string');
    await addPublicProp(user, 'price', 'number');
    await addPublicProp(user, 'featured', 'boolean');
    await addPublicProp(user, 'accent', 'color');

    fireEvent.change(screen.getByLabelText('Design value for props.priceLabel'), {
      target: { value: '₹1,299.50' },
    });
    fireEvent.change(screen.getByLabelText('Design value for props.price'), {
      target: { value: '1299.5' },
    });
    fireEvent.change(screen.getByLabelText('Design value for props.featured'), {
      target: { value: 'true' },
    });
    fireEvent.change(screen.getByLabelText('Design value for props.accent'), {
      target: { value: '#ff33aa' },
    });

    let document = useStudioStore.getState().document;
    expect(document.publicProps['priceLabel']?.defaultValue).toBe('₹1,299.50');
    expect(document.publicProps['price']?.defaultValue).toBe(1299.5);
    expect(document.publicProps['featured']?.defaultValue).toBe(true);
    expect(document.publicProps['accent']?.defaultValue).toBe('#ff33aa');
    Object.values(document.publicProps).forEach((prop) => {
      expect(document.symbols[prop.symbolId]?.defaultValue).toEqual(prop.defaultValue);
    });
    const priceLabel = document.publicProps['priceLabel'];
    if (!priceLabel) throw new Error('Expected priceLabel public prop');
    expect(defaultSymbolValues(document)[priceLabel.symbolId]).toBe('₹1,299.50');

    act(() => useStudioStore.getState().undo());
    document = useStudioStore.getState().document;
    expect(document.publicProps['accent']?.defaultValue).toBe('');
    expect(document.symbols[document.publicProps['accent']!.symbolId]?.defaultValue).toBe('');

    act(() => useStudioStore.getState().redo());
    document = useStudioStore.getState().document;
    expect(document.publicProps['accent']?.defaultValue).toBe('#ff33aa');
    expect(document.symbols[document.publicProps['accent']!.symbolId]?.defaultValue).toBe(
      '#ff33aa',
    );
    expect(screen.queryByText('Runtime functions')).not.toBeInTheDocument();
    expect(screen.queryByText(/Connector code/)).not.toBeInTheDocument();
  });

  it('binds priceLabel to Text and Heading while excluding the incompatible number prop', async () => {
    const user = userEvent.setup();
    render(<Inspector />);
    await user.click(screen.getByRole('button', { name: 'Props' }));
    await addPublicProp(user, 'priceLabel', 'string');
    await addPublicProp(user, 'price', 'number');

    const document = useStudioStore.getState().document;
    const priceLabel = document.publicProps['priceLabel'];
    const price = document.publicProps['price'];
    if (!priceLabel || !price) throw new Error('Expected typed public props');

    let textId: string | null = null;
    act(() => {
      textId = useStudioStore.getState().addComponent('sutra.text');
    });
    if (!textId) throw new Error('Expected Text to be created');
    let source = screen.getByLabelText('Text value source');
    expect(within(source).getByRole('option', { name: /priceLabel/ })).toBeInTheDocument();
    expect(within(source).queryByRole('option', { name: /^.*price$/ })).not.toBeInTheDocument();
    expect(within(source).queryByRole('group', { name: 'Runtime functions' })).toBeNull();
    await user.selectOptions(source, priceLabel.symbolId);
    expect(element(textId).props['text']).toEqual({
      kind: 'reference',
      symbolId: priceLabel.symbolId,
      path: [],
    });

    let headingId: string | null = null;
    act(() => {
      headingId = useStudioStore.getState().addComponent('sutra.heading');
    });
    if (!headingId) throw new Error('Expected Heading to be created');
    source = screen.getByLabelText('Text value source');
    expect(within(source).getByRole('option', { name: /priceLabel/ })).toBeInTheDocument();
    expect(within(source).queryByText('price', { selector: 'option' })).not.toBeInTheDocument();
    await user.selectOptions(source, priceLabel.symbolId);
    expect(element(headingId).props['text']).toEqual({
      kind: 'reference',
      symbolId: priceLabel.symbolId,
      path: [],
    });
    expect(element(headingId).props['text']).not.toMatchObject({ symbolId: price.symbolId });

    const jsx = generateTsx(useStudioStore.getState().document);
    expect(jsx.match(/\{\(props\.priceLabel \?\? ""\)\}/gu)).toHaveLength(2);
    expect(jsx).not.toContain('formatPrice');
  });
});
