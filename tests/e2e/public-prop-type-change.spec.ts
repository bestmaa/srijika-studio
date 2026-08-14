import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function designFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Srijika DOM design surface"]');
}

test('changes an unused prop type and atomically rejects an incompatible referenced change', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await page
    .getByRole('tree', { name: 'Page content hierarchy' })
    .locator('.tree-row')
    .first()
    .click();

  const pageInspector = inspector(page);
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();

  await pageInspector.getByLabel('New public prop name').fill('quantity');
  await pageInspector.getByLabel('New public prop type').selectOption('string');
  await pageInspector.getByRole('button', { name: 'Add public prop' }).click();

  const quantityType = pageInspector.getByLabel('Type for props.quantity');
  await quantityType.selectOption('number');
  await expect(quantityType).toHaveValue('number');
  const quantityDesignValue = pageInspector.getByLabel('Design value for props.quantity');
  await expect(quantityDesignValue).toHaveAttribute('type', 'number');
  await expect(quantityDesignValue).toHaveValue('0');

  const priceLabelType = pageInspector.getByLabel('Type for props.priceLabel');
  await priceLabelType.selectOption('number');
  await expect(priceLabelType).toHaveValue('string');
  await expect(page.getByRole('alert')).toContainText('Could not apply this change');
  await expect(page.getByRole('alert')).toContainText('expects string, received number');
  await expect(pageInspector.getByLabel('Design value for props.priceLabel')).toHaveValue(
    '₹499.00',
  );
  await expect(designFrame(page).getByText('₹499.00', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'JSX', exact: true }).click();
  const jsx = page.locator('.code-panel code');
  await expect(jsx).toContainText('quantity?: number;');
  await expect(jsx).toContainText('priceLabel?: string;');
  await expect(jsx).toContainText('{(props.priceLabel ?? "₹499.00")}');

  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  const jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
  const document = JSON.parse(jsonText) as {
    publicProps: Record<
      string,
      { defaultValue?: unknown; symbolId: string; valueShape?: unknown; valueType: string }
    >;
    symbols: Record<
      string,
      { defaultValue?: unknown; provider: string; valueShape?: unknown; valueType: string }
    >;
  };
  const quantity = document.publicProps['quantity'];
  expect(quantity).toMatchObject({ valueType: 'number', defaultValue: 0 });
  expect(quantity).not.toHaveProperty('valueShape');
  expect(document.symbols[quantity!.symbolId]).toMatchObject({
    provider: 'prop',
    valueType: 'number',
    defaultValue: 0,
  });
  expect(document.publicProps['priceLabel']).toMatchObject({
    valueType: 'string',
    defaultValue: '₹499.00',
  });
});
