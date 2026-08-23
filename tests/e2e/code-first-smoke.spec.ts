import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Srijika code-first authoring', () => {
  test('@visual keeps the code-first shell visually stable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.evaluate(() => window.localStorage.removeItem('srijika-studio:appearance.v1'));
    await page.reload();
    await page.getByRole('button', { name: 'Create Demo Project', exact: true }).click();

    await expect(page.getByText('Srijika contract valid', { exact: true })).toBeVisible();
    await expect(
      page.frameLocator('iframe[title="Styled Srijika UI preview"]').getByRole('heading', {
        name: 'Build React interfaces with a clear thread from code to canvas.',
        exact: true,
      }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot('srijika-code-first-shell.png', { fullPage: false });
  });

  test('applies Settings accent and Srijika dark colors across the code-first shell', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.removeItem('srijika-studio:appearance.v1'));
    await page.reload();
    await page.getByRole('button', { name: 'Create Demo Project', exact: true }).click();

    const shell = page.locator('.code-first-shell');
    const activeContractTab = page
      .getByRole('complementary', { name: 'Srijika source Inspector' })
      .getByRole('tab', { name: /Props/ })
      .first();
    await expect(shell).toBeVisible();
    await expect
      .poll(() =>
        shell.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--code-first-accent').trim(),
        ),
      )
      .toBe('#77767b');
    expect(
      await activeContractTab.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toContain('99, 102, 241');

    await page.getByRole('button', { name: 'Open settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const accent = dialog.getByLabel('Accent', { exact: true });
    await accent.fill('#229955');
    await accent.press('Tab');

    await expect
      .poll(() =>
        shell.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--code-first-accent').trim(),
        ),
      )
      .toBe('#229955');
    await expect(dialog.getByLabel('Theme preset')).toHaveValue('custom');
    expect(
      await activeContractTab.evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toContain('34, 153, 85');

    await dialog.getByRole('radio', { name: 'Light' }).click();
    await dialog.getByLabel('Theme preset').selectOption('srijika');
    await expect(dialog.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect
      .poll(() =>
        shell.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--code-first-accent').trim(),
        ),
      )
      .toBe('#77767b');
  });

  test('keeps manual coding read-only while a validated Inspector edit updates TSX', async ({
    page,
  }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { name: 'Explore Srijika without touching your files.' }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Create Demo Project' })).toBeVisible();
    await expect(page.getByLabel('Srijika TSX source')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Derived UI preview' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Srijika source Inspector' })).toHaveCount(
      0,
    );

    await page.getByRole('button', { name: 'Create Demo Project', exact: true }).click();
    const source = page.getByLabel('Srijika TSX source');
    const previewFrame = page.frameLocator('iframe[title="Styled Srijika UI preview"]');
    const inspector = page.getByRole('complementary', { name: 'Srijika source Inspector' });

    await expect(source).toHaveValue(/export function HomeUI/);
    await expect(inspector.getByRole('region', { name: 'Component contract' })).toBeVisible();
    await expect(page.getByText('Srijika contract valid', { exact: true })).toBeVisible();
    await expect(source).toHaveAttribute('readonly', '');

    const explorer = page.getByRole('region', { name: 'Project Explorer' });
    await expect(explorer.getByText('package.json', { exact: true })).toBeVisible();
    await expect(
      explorer
        .getByRole('region', { name: 'UI Sources' })
        .getByRole('button', { name: /Home\.ui\.tsx/ }),
    ).toBeVisible();
    await expect(
      previewFrame.getByRole('heading', {
        name: 'Build React interfaces with a clear thread from code to canvas.',
        exact: true,
      }),
    ).toBeVisible();

    await previewFrame
      .getByRole('heading', {
        name: 'Build React interfaces with a clear thread from code to canvas.',
        exact: true,
      })
      .click();
    const textValue = inspector.getByLabel('Visual text override (AST-safe TSX edit)');
    await expect(textValue).toHaveValue(
      'Build React interfaces with a clear thread from code to canvas.',
    );
    await textValue.fill('Updated in Studio');
    await inspector.getByRole('button', { name: 'Apply validated visual edit' }).click();

    await expect(source).toHaveValue(/<h1>Updated in Studio<\/h1>/);
    await expect(
      previewFrame.getByRole('heading', { name: 'Updated in Studio', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Srijika contract valid', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save visual edits' })).toBeEnabled();

    const uiNodes = page.getByRole('region', { name: 'UI Nodes' });
    await uiNodes.getByRole('button', { name: /section 1.*Section/i }).click();
    const className = inspector.getByLabel('className prop value', { exact: true });
    await expect(className).toHaveValue('hero');
    await className.fill('hero updated-hero');
    await inspector.getByRole('button', { name: 'Apply className to TSX' }).click();
    await expect(source).toHaveValue(/className=\{"hero updated-hero"\}/);

    const components = page.getByRole('region', { name: 'UI Components' });
    await components.getByRole('button', { name: 'Container', exact: true }).click();
    await expect(source).toHaveValue(/className=\{"srijika-container"\}/);
    await components.getByRole('button', { name: 'Email input', exact: true }).click();
    await expect(source).toHaveValue(/<input type=\{"email"\}/);
    await expect(previewFrame.getByRole('textbox', { name: 'email input' })).toBeVisible();
    await expect(inspector.getByLabel('type prop value')).toHaveValue('email');

    const uiNodesPanel = page.getByRole('region', { name: 'UI Nodes' });
    await uiNodesPanel.getByRole('button', { name: 'Collapse UI Nodes panel' }).click();
    await expect(uiNodesPanel.getByRole('tree')).toHaveCount(0);
    await uiNodesPanel.getByRole('button', { name: 'Expand UI Nodes panel' }).click();
    await expect(uiNodesPanel.getByRole('tree')).toBeVisible();
  });

  test('creates optional Connectors and switches source, preview, Inspector, and UI Nodes together', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1432, height: 833 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create Demo Project', exact: true }).click();

    const explorer = page.getByRole('region', { name: 'Project Explorer' });
    await explorer.getByRole('button', { name: 'New UI' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create UI page' });
    await dialog.getByLabel('Name', { exact: true }).fill('PricingPage');
    await expect(dialog.getByText('src/pages/PricingPage.ui.tsx', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Create UI page', exact: true }).click();

    const source = page.getByLabel('Srijika TSX source');
    const preview = page.getByRole('region', { name: 'Derived UI preview' });
    const previewFrame = page.frameLocator('iframe[title="Styled Srijika UI preview"]');
    const inspector = page.getByRole('complementary', { name: 'Srijika source Inspector' });
    await expect(source).toHaveValue(/export function PricingPageUI/);
    await expect(previewFrame.getByRole('heading', { name: 'title', exact: true })).toBeVisible();
    await expect(inspector.getByText('description', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('tree', { name: 'PricingPageUI UI nodes', exact: true }),
    ).toBeVisible();

    const uiSources = explorer.getByRole('region', { name: 'UI Sources' });
    await uiSources.getByRole('button', { name: /Home\.ui\.tsx/ }).click();
    await expect(source).toHaveValue(/export function HomeUI/);
    await expect(
      previewFrame.getByRole('heading', {
        name: 'Build React interfaces with a clear thread from code to canvas.',
        exact: true,
      }),
    ).toBeVisible();
    await expect(preview.getByText('CSS 1', { exact: true })).toHaveAttribute(
      'title',
      'src/styles.css',
    );
    await expect(previewFrame.locator('.hero')).toHaveCSS('display', 'grid');
    await expect(previewFrame.locator('.srijika-home')).toHaveCSS('min-height', /\d+px/);
    expect(
      await previewFrame.getByRole('img', { name: 'Srijika Studio' }).getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);
    await expect(page.getByRole('tree', { name: 'HomeUI UI nodes', exact: true })).toBeVisible();
    const homeRoot = page
      .getByRole('tree', { name: 'HomeUI UI nodes', exact: true })
      .getByRole('button', { name: /main.*Main/i });
    await expect(homeRoot).toBeVisible();
    await homeRoot.click();
    await expect(inspector.getByRole('region', { name: 'UI identity' })).toContainText('HomeUI');
    const componentContract = inspector.getByRole('region', { name: 'Component contract' });
    await componentContract.getByRole('tab', { name: /Structure/ }).click();
    await expect(componentContract).toContainText('navigationSlot');
    await expect(inspector.getByRole('region', { name: 'Selected node summary' })).toContainText(
      'Selected root',
    );
    await expect(inspector.getByRole('region', { name: 'Node props' })).toBeVisible();

    await expect(explorer.getByRole('button', { name: 'New feature' })).toBeDisabled();
    await expect(
      explorer.getByRole('button', { name: 'Add capability inside src/features/home' }),
    ).toHaveCount(0);

    for (const viewport of [
      { width: 1432, height: 833 },
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        navigatorWidth:
          document.querySelector('.code-first-navigator')?.getBoundingClientRect().width ?? 0,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      if (viewport.width >= 1280) expect(layout.navigatorWidth).toBeGreaterThanOrEqual(260);
    }
  });

  test('@a11y has no serious accessibility violations in the code-first shell', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Explore Srijika without touching your files.' }),
    ).toBeVisible({ timeout: 20_000 });
    expect(
      await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ).toMatchObject({ clientWidth: 390, scrollWidth: 390 });
    const welcomeResult = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])
      .analyze();
    expect(welcomeResult.violations).toEqual([]);

    await page.setViewportSize({ width: 1432, height: 833 });
    await page.getByRole('button', { name: 'Create Demo Project', exact: true }).click();
    await expect(page.getByRole('region', { name: 'UI Nodes' })).toBeVisible();
    await expect(
      page.getByRole('complementary', { name: 'Srijika source Inspector' }),
    ).toBeVisible();
    const editorResult = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .disableRules(['color-contrast'])
      .exclude('iframe[title="Styled Srijika UI preview"]')
      .analyze();
    expect(editorResult.violations).toEqual([]);
  });
});
