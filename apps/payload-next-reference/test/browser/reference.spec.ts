import { expect, test } from '@playwright/test';

test('renders server-loaded list and detail routes without a database', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Payload + Next.js reference' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Server-owned content, pure UI' })).toBeVisible();
  await expect(page.locator('article').first()).toHaveAttribute(
    'data-srijika-source',
    /src\/features\/posts\/Posts\.ui\.tsx:\d+:\d+/u,
  );
  await page.getByRole('link', { name: 'Server-owned content, pure UI' }).click();
  await expect(page).toHaveURL(/\/posts\/server-owned-content$/u);
  await expect(page.getByRole('heading', { name: 'Server-owned content, pure UI' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to posts' })).toBeVisible();
});
