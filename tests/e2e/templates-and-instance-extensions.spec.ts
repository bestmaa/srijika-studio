import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function hierarchy(page: Page): Locator {
  return page.getByRole('tree', { name: 'Page content hierarchy' });
}

function designFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Sutra DOM design surface"]');
}

async function addPublicEvent(page: Page, name: string): Promise<void> {
  const pageInspector = inspector(page);
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
  await pageInspector.getByLabel('New public prop name').fill(name);
  await pageInspector.getByLabel('New public prop type').selectOption('event');
  await pageInspector.getByRole('button', { name: 'Add public prop' }).click();
  await expect(pageInspector.getByText(`props.${name}`, { exact: true })).toBeVisible();
}

test.describe('templates and per-instance React extensions', () => {
  test('loads every built-in template as an editable page document', async ({ page }) => {
    await page.goto('/');

    for (const templateName of [
      'YouTube Home',
      'Orbit Analytics',
      'Northstar Store',
      'Mira Portfolio',
      'Account Settings',
    ]) {
      await page.getByRole('button', { name: 'Templates', exact: true }).click();
      const gallery = page.getByRole('dialog', { name: 'Choose a page template' });
      expect(
        await page.locator('.template-gallery-backdrop').evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.top === 0 &&
            bounds.left === 0 &&
            bounds.right === window.innerWidth &&
            bounds.bottom === window.innerHeight
          );
        }),
      ).toBe(true);
      const templateCard = gallery.locator('.template-card').filter({ hasText: templateName });
      await expect(templateCard).toHaveCount(1);
      await templateCard.getByRole('button', { name: 'Use template' }).click();

      await expect(page.getByRole('status')).toContainText(`Loaded ${templateName} template`);
      await expect(
        page
          .getByRole('navigation', { name: 'Project pages' })
          .locator('button[aria-pressed="true"]'),
      ).toHaveCount(1);
      expect(await designFrame(page).locator('[data-sutra-node]').count()).toBeGreaterThan(20);
      expect(await hierarchy(page).getByRole('treeitem').count()).toBeGreaterThan(20);
    }
  });

  test('loads the YouTube template, keeps hierarchy selection synchronized, and saves a custom copy', async ({
    page,
  }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    const gallery = page.getByRole('dialog', { name: 'Choose a page template' });
    await expect(gallery).toBeVisible();
    await expect(gallery.locator('.template-card')).toHaveCount(5);
    const youtube = gallery.locator('.template-card').filter({ hasText: 'YouTube Home' });
    await expect(youtube).toContainText('Video navigation, search, topic chips');
    await youtube.getByRole('button', { name: 'Use template' }).click();

    await expect(designFrame(page).locator('[data-sutra-node="yt_header"]')).toBeVisible();
    await expect(designFrame(page).locator('[data-sutra-node="yt_sidebar"]')).toBeVisible();
    await expect(designFrame(page).locator('[data-sutra-node^="yt_card_"]')).toHaveCount(6);
    expect(await hierarchy(page).getByRole('treeitem').count()).toBeGreaterThan(60);

    await designFrame(page).locator('[data-sutra-node="yt_title_0"]').click();
    await expect(inspector(page).getByRole('heading', { name: 'Heading' })).toBeVisible();
    await expect(hierarchy(page).locator('.tree-row.is-selected')).toContainText('Video Title 1');

    await page.getByRole('tab', { name: 'JSX', exact: true }).click();
    const jsx = page.locator('.code-panel code');
    await expect(jsx).toContainText('export function YouTubeHomePage');
    await expect(jsx).toContainText('props.onOpenVideo?.("video-1")');
    await expect(jsx).toContainText(
      '(props.subscriptions ?? ["Sutra Creators","Design Weekly","Rust Systems"]).map((item, index)',
    );

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Save as template' }).click();
    await expect(page.getByRole('status')).toContainText('Saved YouTube Home to My templates');
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await expect(
      page.locator('.saved-template-row').filter({ hasText: 'YouTube Home' }),
    ).toHaveCount(1);
  });

  test('adds, edits and emits a typed instance prop plus an onClick event port on Text', async ({
    page,
  }) => {
    await page.goto('/');
    await addPublicEvent(page, 'onTextClick');

    await page.getByRole('button', { name: 'Text', exact: true }).click();
    const pageInspector = inspector(page);
    await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
    await pageInspector.getByLabel('New instance prop name').fill('data-testid');
    await pageInspector.getByLabel('New instance prop type').selectOption('string');
    await pageInspector.getByRole('button', { name: 'Add instance prop' }).click();
    await pageInspector.getByLabel('data-testid', { exact: true }).fill('custom-text');

    const renderedText = designFrame(page).locator('[data-testid="custom-text"]');
    await expect(renderedText).toBeVisible();
    await pageInspector.getByLabel('Instance prop type data-testid').selectOption('number');
    await expect(designFrame(page).locator('[data-testid="0"]')).toBeVisible();
    await pageInspector.getByLabel('Instance prop type data-testid').selectOption('string');
    await pageInspector.getByLabel('data-testid', { exact: true }).fill('custom-text');

    await pageInspector.getByRole('button', { name: 'Events', exact: true }).click();
    await expect(pageInspector.getByLabel('New instance event port')).toHaveValue('onClick');
    await pageInspector.getByRole('button', { name: 'Add event' }).click();
    const action = pageInspector.getByLabel('Click action');
    const eventValue = await action
      .locator('option')
      .filter({ hasText: 'onTextClick' })
      .getAttribute('value');
    if (!eventValue) throw new Error('Expected onTextClick action option');
    await action.selectOption(eventValue);
    await expect(action.locator('option:checked')).toContainText('onTextClick');

    await page.getByRole('tab', { name: 'JSX', exact: true }).click();
    const jsx = page.locator('.code-panel code');
    await expect(jsx).toContainText('"data-testid": "custom-text"');
    await expect(jsx).toContainText('onClick={() => props.onTextClick?.()}');

    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const json = page.locator('.code-panel code');
    await expect(json).toContainText('"instanceProps"');
    await expect(json).toContainText('"instanceEvents"');
    await expect(json).toContainText('"source": "click"');

    await page.getByRole('tab', { name: 'UI', exact: true }).click();
    await pageInspector.getByRole('button', { name: 'Events', exact: true }).click();
    await pageInspector.getByRole('button', { name: 'Remove event port onClick' }).click();
    await expect(pageInspector.getByLabel('Click action')).toHaveCount(0);
  });

  test('keeps the VS Code-like shell aligned at compact desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 920, height: 680 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    const gallery = page.getByRole('dialog', { name: 'Choose a page template' });
    await gallery
      .locator('.template-card')
      .filter({ hasText: 'YouTube Home' })
      .getByRole('button', { name: 'Use template' })
      .click();

    const shell = page.locator('.studio-shell');
    await expect(shell).toBeVisible();
    const metrics = await page.evaluate(() => {
      const body = document.body;
      const topbar = document.querySelector('.topbar')!.getBoundingClientRect();
      const leftRail = document.querySelector('.left-rail')!.getBoundingClientRect();
      const palette = document.querySelector('.left-panel')!.getBoundingClientRect();
      const hierarchy = document.querySelector('.hierarchy-panel')!.getBoundingClientRect();
      const inspector = document.querySelector('.inspector-panel')!.getBoundingClientRect();
      const tileRects = [...document.querySelectorAll('.component-tile')].map((element) =>
        element.getBoundingClientRect(),
      );
      const treeRowRects = [...document.querySelectorAll('.tree-row')].map((element) =>
        element.getBoundingClientRect(),
      );
      const shellColor = getComputedStyle(document.querySelector('.studio-shell')!).backgroundColor;
      return {
        horizontalOverflow: body.scrollWidth - body.clientWidth,
        leftRailLeft: leftRail.left,
        paletteChildOverflow: Math.max(
          0,
          ...tileRects.map((rect) =>
            Math.max(palette.left - rect.left, rect.right - palette.right),
          ),
        ),
        hierarchyChildOverflow: Math.max(
          0,
          ...treeRowRects.map((rect) =>
            Math.max(hierarchy.left - rect.left, rect.right - hierarchy.right),
          ),
        ),
        topbarLeft: topbar.left,
        inspectorRight: Math.round(inspector.right),
        viewportWidth: window.innerWidth,
        shellColor,
      };
    });
    expect(metrics).toMatchObject({
      horizontalOverflow: 0,
      leftRailLeft: 0,
      paletteChildOverflow: 0,
      hierarchyChildOverflow: 0,
      topbarLeft: 0,
      inspectorRight: 920,
      viewportWidth: 920,
      shellColor: 'rgb(17, 17, 17)',
    });
  });
});
