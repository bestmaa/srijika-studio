import { expect, test } from '@playwright/test';

test('@visual editor shell remains visually stable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Srijika Studio', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Explore Srijika without touching your files.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Demo Project' })).toBeVisible();

  await expect(page).toHaveScreenshot('srijika-studio-shell.png', {
    fullPage: true,
    animations: 'disabled',
  });
});
