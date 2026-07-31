import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('Sutra Studio editor smoke', () => {
  test('adds a component and keeps Inspector, JSON, TSX and DOM synchronized', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/');
    await expect(page.getByLabel('Sutra Studio')).toBeVisible();
    await expect(page.getByRole('tree', { name: 'UI hierarchy' })).toBeVisible();

    await page.getByRole('button', { name: 'Button', exact: true }).click();
    const inspector = page.locator('aside.inspector-panel');
    await expect(inspector.getByRole('heading', { name: 'Button' })).toBeVisible();

    await inspector.getByRole('button', { name: 'Props' }).click();
    const labelField = inspector.locator('.prop-field').filter({ hasText: 'Label' });
    await labelField.getByRole('textbox').fill('E2E action');

    const designFrame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
    await expect(designFrame.getByRole('button', { name: 'E2E action' })).toBeVisible();

    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await expect(page.getByText('Canonical UI document')).toBeVisible();
    await expect(page.locator('.code-panel code')).toContainText('E2E action');

    await page.getByRole('button', { name: 'TSX', exact: true }).click();
    await expect(page.getByText('Generated TypeScript / TSX')).toBeVisible();
    await expect(page.locator('.code-panel code')).toContainText('E2E action');
    expect(pageErrors).toEqual([]);
  });

  test('keeps a standalone browser preview synchronized with editor changes', async ({ page }) => {
    const editorErrors: Error[] = [];
    const previewErrors: Error[] = [];
    page.on('pageerror', (error) => editorErrors.push(error));

    await page.goto('/');
    await page.getByRole('button', { name: 'Button', exact: true }).click();

    const inspector = page.locator('aside.inspector-panel');
    await inspector.getByRole('button', { name: 'Props' }).click();
    const labelField = inspector.locator('.prop-field').filter({ hasText: 'Label' });
    await labelField.getByRole('textbox').fill('Initial preview action');

    const preview = await page.context().newPage();
    preview.on('pageerror', (error) => previewErrors.push(error));
    await preview.goto('/preview');
    await expect(preview.getByRole('button', { name: 'Initial preview action' })).toBeVisible();

    await preview.getByRole('button', { name: 'Start building' }).click();
    await expect(preview.getByRole('status')).toContainText('Event fired: On get started');

    await labelField.getByRole('textbox').fill('Broadcast preview action');
    await expect(preview.getByRole('button', { name: 'Broadcast preview action' })).toBeVisible();
    await expect(preview.getByText('Synced')).toBeVisible();

    expect(editorErrors).toEqual([]);
    expect(previewErrors).toEqual([]);
  });

  test('keeps the starter heading inside the mobile design viewport', async ({ page }) => {
    await page.goto('/');
    await page.getByTitle('Mobile').click();

    const designFrame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
    const heading = designFrame.locator('[data-sutra-node="hero_heading"]');
    await expect(heading).toBeVisible();

    const bounds = await heading.evaluate((element) => {
      const rectangle = element.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: rectangle.left,
        right: rectangle.right,
        viewportWidth: element.ownerDocument.documentElement.clientWidth,
      };
    });

    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  });

  test('authors an inactive If branch without changing its runtime condition', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'If / Else Conditional JSX branch', exact: true })
      .click();

    const inspector = page.locator('aside.inspector-panel');
    await inspector.getByRole('button', { name: 'False branch · 0' }).click();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await inspector.getByRole('button', { name: 'Props' }).click();
    await inspector.getByRole('textbox', { name: 'Text', exact: true }).fill('False branch UI');

    const designFrame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
    await expect(designFrame.getByText('IF · FALSE BRANCH')).toBeVisible();
    await expect(designFrame.getByText('False branch UI')).toBeVisible();

    await page.getByRole('button', { name: 'JSON', exact: true }).click();
    await expect(page.locator('.code-panel code')).toContainText('"value": "False branch UI"');
    await expect(page.getByText('Document valid')).toBeVisible();
  });

  test('@drag drops a palette component into the actual DOM design surface', async ({ page }) => {
    await page.goto('/');
    const source = page.getByRole('button', { name: 'Container', exact: true });
    const designFrame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
    const target = designFrame.locator('[data-sutra-node="hero"]');

    await source.dragTo(target);

    await expect(designFrame.locator('[data-sutra-component="sutra.container"]')).toHaveCount(2);
    await expect(page.getByRole('treeitem', { name: /^Container/ })).toBeVisible();
  });

  test('@a11y has no automatically detectable serious accessibility violations', async ({
    page,
  }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .exclude('iframe[title="Sutra DOM design surface"]')
      .disableRules(['color-contrast'])
      .analyze();
    const seriousViolations = results.violations.filter((violation) =>
      ['serious', 'critical'].includes(violation.impact ?? ''),
    );

    expect(
      seriousViolations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        affectedNodes: violation.nodes.length,
      })),
    ).toEqual([]);
  });
});
