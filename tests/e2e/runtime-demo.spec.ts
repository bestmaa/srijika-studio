import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function hierarchy(page: Page): Locator {
  return page.getByRole('tree', { name: 'Page content hierarchy' });
}

function designFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Srijika DOM design surface"]');
}

async function expectCardStyle(element: Locator): Promise<void> {
  await expect
    .poll(() =>
      element.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          borderWidth: style.borderWidth,
          boxShadow: style.boxShadow,
        };
      }),
    )
    .toEqual({
      backgroundColor: 'rgb(255, 247, 237)',
      borderColor: 'rgb(249, 115, 22)',
      borderWidth: '2px',
      boxShadow: 'rgba(249, 115, 22, 0.12) 0px 14px 30px 0px',
    });
}

test('Reset demo keeps direct page props, dynamic style, JSX, JSON, and preview synchronized', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Reset demo' }).click();

  await expect(designFrame(page).getByText('₹499.00', { exact: true })).toBeVisible();
  await expectCardStyle(designFrame(page).locator('[data-srijika-node="hero"]'));

  await hierarchy(page).locator('.tree-row').first().click();
  const pageInspector = inspector(page);
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();

  const priceLabelDesignValue = pageInspector.getByLabel('Design value for props.priceLabel');
  await expect(priceLabelDesignValue).toHaveValue('₹499.00');
  await priceLabelDesignValue.fill('₹1,299.00');
  await expect(designFrame(page).getByText('₹1,299.00', { exact: true })).toBeVisible();

  await hierarchy(page)
    .locator('.tree-row')
    .filter({ hasText: /^Price Label/ })
    .click();
  await expect(pageInspector.getByLabel('Layer name')).toHaveValue(/Price Label/);
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();

  const textSource = pageInspector.getByLabel('Text value source');
  await expect(textSource.locator('option:checked')).toContainText('priceLabel');
  await expect(textSource.locator('option:checked')).not.toContainText(/Function|Runtime/);
  const textProp = textSource.locator('xpath=ancestor::div[contains(@class,"prop-field")]');
  await expect(textProp.locator('.bound-value')).toHaveText('priceLabel');

  await page.getByRole('tab', { name: 'JSX', exact: true }).click();
  const jsx = page.locator('.code-panel code');
  await expect(jsx).toContainText("import { srijikaStyle } from '@srijika/react-renderer';");
  await expect(jsx).toContainText('{(props.priceLabel ?? "₹1,299.00")}');
  await expect(jsx).toContainText('srijikaStyle((props.cardStyle ?? {');
  const jsxText = (await jsx.textContent()) ?? '';
  expect(jsxText).not.toContain('registeredCall');
  expect(jsxText).not.toContain('formatPrice');
  expect(jsxText).not.toContain('runtimeFunctions');

  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  const jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
  const document = JSON.parse(jsonText) as {
    nodes: Record<
      string,
      {
        props?: Record<string, unknown>;
      }
    >;
  };
  expect(document.nodes['price_label']?.props?.['text']).toEqual({
    kind: 'reference',
    path: [],
    symbolId: 'prop_price_label',
  });
  expect(document.nodes['hero']?.props?.['style']).toEqual({
    kind: 'reference',
    path: [],
    symbolId: 'prop_card_style',
  });
  expect(jsonText).not.toContain('registeredCall');
  expect(jsonText).not.toContain('formatPrice');
  expect(jsonText).not.toContain('runtimeFunctions');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const serialized = localStorage.getItem('srijika-studio:active-document');
        if (!serialized) return null;
        const value = JSON.parse(serialized) as {
          publicProps?: { priceLabel?: { defaultValue?: unknown } };
        };
        return value.publicProps?.priceLabel?.defaultValue ?? null;
      }),
    )
    .toBe('₹1,299.00');

  await page.goto('/preview');
  await expect(page.getByText('₹1,299.00', { exact: true })).toBeVisible();
  await expectCardStyle(page.locator('.preview-document main').locator(':scope > *').first());
});
