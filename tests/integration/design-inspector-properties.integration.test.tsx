import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { Inspector } from '../../apps/studio/src/components/Inspector';
import { useStudioStore } from '../../apps/studio/src/store/studio-store';

function designPropertyChooser(inspector: HTMLElement): HTMLElement {
  const dialogs = within(inspector).queryAllByRole('dialog', { name: 'Design properties' });
  const regions = within(inspector).queryAllByRole('region', { name: 'Design properties' });
  const choosers = [...dialogs, ...regions];
  expect(choosers).toHaveLength(1);
  return choosers[0]!;
}

describe('compact Design Inspector properties', () => {
  beforeEach(() => {
    useStudioStore.getState().resetProject();
  });

  it('initially renders only properties used by the selected node and its locked root facts', () => {
    render(<Inspector />);

    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    const rootSize = within(inspector).getByRole('note');

    expect(rootSize).toHaveTextContent('Width 100%');
    expect(rootSize).toHaveTextContent('Height 100%');
    expect(
      within(inspector).queryByRole('button', { name: 'Remove Width' }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).queryByRole('button', { name: 'Remove Height' }),
    ).not.toBeInTheDocument();
    expect(within(inspector).getByLabelText('Min height')).toHaveValue(720);
    expect(within(inspector).getByLabelText('Display mode')).toHaveValue('flex');
    expect(within(inspector).getByLabelText('Flex direction')).toHaveValue('column');
    expect(within(inspector).getByLabelText('Background color value')).toHaveValue('#ffffff');

    expect(within(inspector).queryByLabelText('Gap')).not.toBeInTheDocument();
    expect(within(inspector).queryByLabelText('Padding top')).not.toBeInTheDocument();
    expect(within(inspector).queryByLabelText('Box shadow')).not.toBeInTheDocument();
    expect(within(inspector).queryByLabelText('Font size')).not.toBeInTheDocument();
    expect(within(inspector).queryByText('Spacing', { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).queryByText('Typography', { exact: true })).not.toBeInTheDocument();
    expect(within(inspector).getByRole('button', { name: 'Add design property' })).toBeEnabled();
  });

  it('adds, edits, and removes an optional property while preserving required root fields', async () => {
    const user = userEvent.setup();
    render(<Inspector />);

    const inspector = screen.getByRole('complementary', { name: 'Inspector' });
    const rootId = useStudioStore.getState().document.rootNodeId;

    await user.click(within(inspector).getByRole('button', { name: 'Add design property' }));
    const chooser = designPropertyChooser(inspector);
    expect(within(chooser).getByRole('button', { name: 'Add Gap' })).toBeEnabled();
    expect(
      within(chooser).queryByRole('button', { name: 'Add Background' }),
    ).not.toBeInTheDocument();
    expect(within(chooser).queryByRole('button', { name: 'Add Display' })).not.toBeInTheDocument();
    await user.click(within(chooser).getByRole('button', { name: 'Add Gap' }));

    const gap = within(inspector).getByLabelText('Gap');
    await user.clear(gap);
    await user.type(gap, '24');

    expect(useStudioStore.getState().document.nodes[rootId]).toMatchObject({
      kind: 'element',
      style: { base: { gap: 24 } },
    });

    await user.click(within(inspector).getByRole('button', { name: 'Remove Gap' }));

    expect(within(inspector).queryByLabelText('Gap')).not.toBeInTheDocument();
    const root = useStudioStore.getState().document.nodes[rootId];
    expect(root?.kind).toBe('element');
    if (root?.kind !== 'element') throw new Error('Expected the Page root element');
    expect(root.style.base).not.toHaveProperty('gap');

    const rootSize = within(inspector).getByRole('note');
    expect(rootSize).toHaveTextContent('Width 100%');
    expect(rootSize).toHaveTextContent('Height 100%');
    expect(within(inspector).getByLabelText('Display mode')).toHaveValue('flex');
    expect(within(inspector).getByLabelText('Min height')).toHaveValue(720);
  });
});
