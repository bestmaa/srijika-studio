import { expect, test, type Page } from '@playwright/test';

const appearanceStorageKey = 'srijika-studio:appearance.v1';

async function openWithEmptyAppearance(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((key) => window.localStorage.removeItem(key), appearanceStorageKey);
  await page.reload();
}

async function expectDocumentIdUsesThemeSurface(page: Page): Promise<void> {
  const colors = await page.getByLabel('Page document ID').evaluate((element) => {
    const rootStyle = getComputedStyle(document.documentElement);
    const probe = document.createElement('span');
    probe.style.backgroundColor = rootStyle.getPropertyValue('--chrome-surface').trim();
    document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  });
  expect(colors.actual).toBe(colors.expected);
}

test('applies and persists Srijika dark, Light, and custom appearance without changing the page', async ({
  page,
}) => {
  await openWithEmptyAppearance(page);

  await expect(page.locator('html')).toHaveAttribute('data-studio-color-scheme', 'dark');
  const initialTokens = await page.locator('html').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      accent: style.getPropertyValue('--studio-accent').trim(),
      background: style.getPropertyValue('--studio-background').trim(),
      foreground: style.getPropertyValue('--studio-foreground').trim(),
    };
  });
  expect(initialTokens).toEqual({
    accent: '#77767b',
    background: '#111111',
    foreground: '#fcfcfc',
  });
  await expectDocumentIdUsesThemeSurface(page);

  const frame = page.frameLocator('iframe[title="Srijika DOM design surface"]');
  const authoredRoot = frame.locator('main[data-srijika-node]');
  const authoredBefore = await authoredRoot.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, fontFamily: style.fontFamily };
  });
  const revisionBefore = await frame
    .locator('[data-srijika-document-id]')
    .getAttribute('data-srijika-revision');

  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  expect(
    await page.locator('.settings-backdrop').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.top === 0 &&
        bounds.left === 0 &&
        bounds.right === window.innerWidth &&
        bounds.bottom === window.innerHeight
      );
    }),
  ).toBe(true);
  await expect(dialog.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Done' }).focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  expect(
    await dialog.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
    ),
  ).toBe(true);

  await dialog.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-studio-color-scheme', 'light');
  await expect(dialog.getByLabel('Theme preset')).toHaveValue('srijika');
  await expect(dialog.getByLabel('Theme preset').locator('option:checked')).toHaveText('Srijika');
  await expect(dialog.getByRole('option', { name: 'Codex' })).toHaveCount(0);
  await expectDocumentIdUsesThemeSurface(page);

  const accent = dialog.getByLabel('Accent', { exact: true });
  await accent.fill('#229955');
  await accent.press('Tab');
  await expect(dialog.getByLabel('Theme preset')).toHaveValue('custom');
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--studio-accent').trim(),
        ),
    )
    .toBe('#229955');

  const background = dialog.getByLabel('Background', { exact: true });
  await background.fill('#e5e5e7');
  await background.press('Tab');
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--studio-background').trim(),
        ),
    )
    .toBe('#e5e5e7');
  await expectDocumentIdUsesThemeSurface(page);

  await dialog.getByRole('switch', { name: 'Translucent sidebar' }).click();
  await dialog.getByRole('slider', { name: 'Contrast' }).evaluate((element) => {
    const slider = element as HTMLInputElement;
    slider.value = '68';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  const authoredAfter = await authoredRoot.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, color: style.color, fontFamily: style.fontFamily };
  });
  expect(authoredAfter).toEqual(authoredBefore);
  await expect(frame.locator('[data-srijika-document-id]')).toHaveAttribute(
    'data-srijika-revision',
    revisionBefore ?? '0',
  );

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-studio-color-scheme', 'light');
  await expectDocumentIdUsesThemeSurface(page);
  await expect
    .poll(() =>
      page
        .locator('html')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--studio-accent').trim(),
        ),
    )
    .toBe('#229955');
});

test('System follows the OS while the requested default remains Dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openWithEmptyAppearance(page);
  await expect(page.locator('html')).toHaveAttribute('data-studio-color-scheme', 'dark');

  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('radio', { name: 'System' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-studio-color-scheme', 'light');

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-studio-color-scheme', 'dark');
  await expect(dialog.getByRole('radio', { name: 'System' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('keeps authored form-control styling identical in canvas and fullscreen preview', async ({
  page,
}) => {
  await openWithEmptyAppearance(page);
  await page.getByRole('button', { name: 'Input', exact: true }).click();

  const canvasInput = page
    .frameLocator('iframe[title="Srijika DOM design surface"]')
    .locator('input')
    .first();
  await expect(canvasInput).toBeVisible();
  const canvasStyle = await canvasInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      color: style.color,
    };
  });

  await page.getByRole('button', { name: 'Enter fullscreen preview' }).click();
  const fullscreenInput = page.locator('.fullscreen-preview-document input').first();
  await expect(fullscreenInput).toBeVisible();
  const fullscreenStyle = await fullscreenInput.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      color: style.color,
    };
  });

  expect(fullscreenStyle).toEqual(canvasStyle);
});
