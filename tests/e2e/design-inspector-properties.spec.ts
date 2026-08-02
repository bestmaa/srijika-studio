import { expect, test, type Page } from '@playwright/test';

function inspector(page: Page) {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function pageRoot(page: Page) {
  return page
    .frameLocator('iframe[title="Sutra DOM design surface"]')
    .locator('[data-sutra-component="sutra.page"]');
}

test('keeps design fields compact and supports an add, edit, and remove lifecycle', async ({
  page,
}) => {
  await page.goto('/');

  const pageInspector = inspector(page);
  const rootSize = pageInspector.getByRole('note');

  await expect(rootSize).toContainText('Width 100%');
  await expect(rootSize).toContainText('Height 100%');
  await expect(pageInspector.getByLabel('Min height', { exact: true })).toHaveValue('720');
  await expect(pageInspector.getByLabel('Display mode')).toHaveValue('flex');
  await expect(pageInspector.getByLabel('Background color value')).toHaveValue('#ffffff');
  await expect(pageInspector.getByLabel('Gap', { exact: true })).toHaveCount(0);
  await expect(pageInspector.getByLabel('Box shadow')).toHaveCount(0);
  await expect(pageInspector.getByText('Spacing', { exact: true })).toHaveCount(0);
  await expect(pageInspector.getByText('Typography', { exact: true })).toHaveCount(0);

  await pageInspector.getByRole('button', { name: 'Add design property' }).click();
  await pageInspector
    .getByLabel('Design properties')
    .getByRole('button', { name: 'Add Gap', exact: true })
    .click();

  await pageInspector.getByLabel('Gap', { exact: true }).fill('24');
  await expect(pageRoot(page)).toHaveCSS('gap', '24px');

  await pageInspector.getByRole('button', { name: 'Remove Gap' }).click();
  await expect(pageInspector.getByLabel('Gap', { exact: true })).toHaveCount(0);
  await expect(pageRoot(page)).toHaveCSS('gap', 'normal');
  await expect(rootSize).toContainText('Width 100%');
  await expect(rootSize).toContainText('Height 100%');
  await expect(pageInspector.getByLabel('Display mode')).toHaveValue('flex');
  await expect(pageInspector.getByLabel('Min height', { exact: true })).toHaveValue('720');
});
