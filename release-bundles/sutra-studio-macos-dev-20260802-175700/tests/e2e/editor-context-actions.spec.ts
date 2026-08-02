import { expect, test, type Page } from '@playwright/test';

async function selectPageRoot(page: Page): Promise<void> {
  await page
    .getByRole('tree', { name: 'Page content hierarchy' })
    .getByRole('treeitem', { name: /Home Page/ })
    .first()
    .click();
}

async function addNamedContainer(page: Page, name: string): Promise<void> {
  await selectPageRoot(page);
  await page.getByRole('button', { name: 'Container', exact: true }).click();
  await page.getByLabel('Layer name').fill(name);
}

function hierarchyRow(page: Page, name: string) {
  return page
    .locator('.tree-name', { hasText: name })
    .filter({ hasText: name })
    .last()
    .locator('..');
}

test('promotes a canvas literal to a page prop and restores it with Undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Heading', exact: true }).click();

  const frame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
  await frame.getByText('Text', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move text to props.headingText', exact: true }).click();

  await selectPageRoot(page);
  await page.getByRole('button', { name: 'Props', exact: true }).click();
  await expect(page.getByText('props.headingText', { exact: true })).toBeVisible();
  await expect(page.getByText('Design value · "Text"', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'JSX', exact: true }).click();
  await expect(page.locator('.code-panel code')).toContainText('(props.headingText ?? "Text")');
  await page.getByRole('tab', { name: 'UI', exact: true }).click();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('props.headingText', { exact: true })).toHaveCount(0);
  await expect(frame.getByText('Text', { exact: true })).toBeVisible();
});

test('reorders sibling containers from both the hierarchy and canvas', async ({ page }) => {
  await page.goto('/');
  await addNamedContainer(page, 'First Container');
  await addNamedContainer(page, 'Second Container');
  await addNamedContainer(page, 'Third Container');

  const firstRow = hierarchyRow(page, 'First Container');
  const secondRow = hierarchyRow(page, 'Second Container');
  const bounds = await secondRow.boundingBox();
  if (!bounds) throw new Error('Expected a visible Second Container row');
  await firstRow.dragTo(secondRow, {
    targetPosition: { x: Math.round(bounds.width / 2), y: Math.max(1, bounds.height - 2) },
  });

  const topLevelNames = page.locator(
    '.tree > .tree-node > [role="group"] > .tree-node > .tree-row > .tree-name',
  );
  await expect(topLevelNames).toHaveText([
    'Second Container',
    'First Container',
    'Third Container',
  ]);

  const frame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
  const canvasSiblings = frame.locator('main[data-sutra-node] > [data-sutra-node]');
  await expect(canvasSiblings).toHaveCount(3);
  const firstContainerBounds = await canvasSiblings.nth(1).boundingBox();
  const secondContainerBounds = await canvasSiblings.nth(0).boundingBox();
  if (!firstContainerBounds || !secondContainerBounds) {
    throw new Error('Expected visible canvas containers');
  }
  await canvasSiblings.nth(1).click();
  const moveHandle = frame.getByRole('button', {
    name: 'Move First Container',
    exact: true,
  });
  await expect(moveHandle).toBeVisible();
  const moveHandleBounds = await moveHandle.boundingBox();
  if (!moveHandleBounds) throw new Error('Expected the canvas Move handle');
  await page.mouse.move(
    moveHandleBounds.x + moveHandleBounds.width / 2,
    moveHandleBounds.y + moveHandleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondContainerBounds.x + secondContainerBounds.width / 2,
    secondContainerBounds.y + 2,
    { steps: 8 },
  );
  await expect(frame.locator('[data-sutra-drop-intent="before"]')).toHaveCount(1);
  await expect(page.getByText('Move before Second Container', { exact: true })).toBeVisible();
  await page.mouse.up();

  await expect(topLevelNames).toHaveText([
    'First Container',
    'Second Container',
    'Third Container',
  ]);
});

test('moves a selected canvas sibling with the directional toolbar controls', async ({ page }) => {
  await page.goto('/');
  await addNamedContainer(page, 'First Container');
  await addNamedContainer(page, 'Second Container');
  await addNamedContainer(page, 'Third Container');

  const frame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
  const canvasSiblings = frame.locator('main[data-sutra-node] > [data-sutra-node]');
  const topLevelNames = page.locator(
    '.tree > .tree-node > [role="group"] > .tree-node > .tree-row > .tree-name',
  );
  await expect(canvasSiblings).toHaveCount(3);
  await canvasSiblings.nth(1).click();

  const directionGroup = frame.getByRole('group', {
    name: 'Move Second Container by direction',
  });
  const up = directionGroup.getByRole('button', { name: 'Move Second Container up' });
  const right = directionGroup.getByRole('button', { name: 'Move Second Container right' });
  const down = directionGroup.getByRole('button', { name: 'Move Second Container down' });
  const left = directionGroup.getByRole('button', { name: 'Move Second Container left' });
  await expect(up).toBeEnabled();
  await expect(down).toBeEnabled();
  await expect(left).toBeDisabled();
  await expect(right).toBeDisabled();

  await canvasSiblings.nth(1).press('ArrowUp');
  await expect(topLevelNames).toHaveText([
    'Second Container',
    'First Container',
    'Third Container',
  ]);
  await expect(hierarchyRow(page, 'Second Container')).toHaveAttribute('aria-selected', 'true');
  await expect(canvasSiblings.nth(0)).toHaveAttribute('data-sutra-selected', 'true');
  await expect(page.getByText('Moved Second Container up', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(topLevelNames).toHaveText([
    'First Container',
    'Second Container',
    'Third Container',
  ]);
  await expect(canvasSiblings.nth(1)).toHaveAttribute('data-sutra-selected', 'true');

  await selectPageRoot(page);
  await page.getByLabel('Flex direction').selectOption('row');
  await canvasSiblings.nth(1).click();
  await expect(left).toBeEnabled();
  await expect(right).toBeEnabled();
  await expect(up).toBeDisabled();
  await expect(down).toBeDisabled();

  await canvasSiblings.nth(1).press('ArrowRight');
  await expect(topLevelNames).toHaveText([
    'First Container',
    'Third Container',
    'Second Container',
  ]);
  await expect(canvasSiblings.nth(2)).toHaveAttribute('data-sutra-selected', 'true');
  await expect(page.getByText('Moved Second Container right', { exact: true })).toBeVisible();

  await frame.getByRole('button', { name: 'Edit Second Container', exact: true }).click();
  const quickEdit = frame.getByRole('dialog', { name: 'Edit Second Container', exact: true });
  await quickEdit.getByLabel('Layer name', { exact: true }).press('ArrowLeft');
  await expect(topLevelNames).toHaveText([
    'First Container',
    'Third Container',
    'Second Container',
  ]);
});

test('edits and deletes the selected canvas node from its contextual toolbar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Text', exact: true }).click();

  const frame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
  const text = frame.locator('[data-sutra-component="sutra.text"]');
  await text.click();
  const toolbar = frame.getByRole('toolbar', { name: 'Text actions' });
  await expect(toolbar).toBeVisible();
  await frame.getByRole('button', { name: 'Edit Text' }).click();
  const quickEdit = frame.getByRole('dialog', { name: 'Edit Text' });
  await quickEdit.getByLabel('Text').fill('Canvas quick edit');
  await quickEdit.getByRole('button', { name: 'Bold' }).click();
  await quickEdit.getByRole('button', { name: 'Align center' }).click();

  await expect(frame.getByText('Canvas quick edit', { exact: true })).toHaveCSS(
    'font-weight',
    '700',
  );
  await expect(frame.getByText('Canvas quick edit', { exact: true })).toHaveCSS(
    'text-align',
    'center',
  );
  await expect(page.getByRole('treeitem', { name: /Text/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await frame.getByRole('button', { name: 'Delete Text' }).click();
  await expect(frame.getByText('Canvas quick edit', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Deleted Text', { exact: true })).toBeVisible();
});
