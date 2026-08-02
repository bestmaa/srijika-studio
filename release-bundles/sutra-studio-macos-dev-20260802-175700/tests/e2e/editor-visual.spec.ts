import { expect, test } from '@playwright/test';

test('@visual editor shell remains visually stable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Project pages' })).toBeVisible();

  await expect(page).toHaveScreenshot('sutra-studio-shell.png', {
    fullPage: true,
    animations: 'disabled',
  });
});
