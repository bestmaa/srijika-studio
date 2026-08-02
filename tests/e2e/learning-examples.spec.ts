import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

const exampleNames = [
  'Text & Numbers from Props',
  'Colors & Style from Props',
  'Array Loop (.map)',
  'Nested Object + Array Loop',
  'If / Else Branches',
  'Logical AND (&&)',
  'Logical OR (||)',
  'Logical NOT (!)',
  'Ternary Value (? :)',
  'Default Fallback (??)',
  'Typed Event Argument',
] as const;

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function designFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Sutra DOM design surface"]');
}

function gallery(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Working React examples' });
}

async function openLearn(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await expect(gallery(page)).toBeVisible();
  return gallery(page);
}

async function openExample(page: Page, exampleId: string, exampleName: string): Promise<void> {
  const learnGallery = await openLearn(page);
  await learnGallery
    .locator(`[data-example-id="${exampleId}"]`)
    .getByRole('button', { name: `Open ${exampleName} example` })
    .click();
}

test.describe('Learn working examples', () => {
  test('shows eleven separately named, filterable example cards', async ({ page }) => {
    await page.goto('/');
    const learnButton = page.getByRole('button', { name: 'Learn', exact: true });
    await learnButton.click();

    const learnGallery = gallery(page);
    await expect(learnGallery).toBeVisible();
    await expect(learnGallery.getByText('11 separate examples', { exact: true })).toBeVisible();
    await expect(
      learnGallery.getByRole('button', {
        name: 'Open Text & Numbers from Props example',
      }),
    ).toBeFocused();

    for (const name of exampleNames) {
      await expect(learnGallery.getByRole('article', { name })).toBeVisible();
    }
    await expect(learnGallery.locator('[data-example-id]')).toHaveCount(11);

    await learnGallery.getByRole('button', { name: 'Conditions 4', exact: true }).click();
    await expect(learnGallery.locator('[data-example-id]')).toHaveCount(4);
    await expect(learnGallery.getByRole('article', { name: 'Logical AND (&&)' })).toBeVisible();
    await expect(
      learnGallery.getByRole('article', { name: 'Text & Numbers from Props' }),
    ).toHaveCount(0);

    await learnGallery.getByRole('button', { name: 'All 11', exact: true }).click();
    await expect(learnGallery.locator('[data-example-id]')).toHaveCount(11);
  });

  test('opens independent small pages without replacing previous work', async ({ page }) => {
    await page.goto('/');
    const pages = page.getByRole('navigation', { name: 'Project pages' });
    const initialPageCount = await pages.locator('button').count();

    await openExample(page, 'nested-repeat', 'Nested Object + Array Loop');
    await expect(page.getByRole('status')).toContainText(
      'Opened Nested Object + Array Loop example',
    );
    await expect(pages.locator('button')).toHaveCount(initialPageCount + 1);
    await expect(pages.getByText('Home Page', { exact: true })).toBeVisible();
    await expect(pages.getByText('Nested Object + Array Loop', { exact: true })).toBeVisible();
    await expect(
      designFrame(page).locator('[data-sutra-node="nested_group_repeat"]'),
    ).toBeVisible();
    await expect(designFrame(page).locator('[data-sutra-node="nested_item_repeat"]')).toHaveCount(
      2,
    );

    await openExample(page, 'if-else', 'If / Else Branches');
    await expect(page.getByRole('status')).toContainText('Opened If / Else Branches example');
    await expect(pages.locator('button')).toHaveCount(initialPageCount + 2);
    await expect(pages.getByText('Nested Object + Array Loop', { exact: true })).toBeVisible();
    await expect(pages.getByText('If / Else Branches', { exact: true })).toBeVisible();
    await expect(designFrame(page).locator('[data-sutra-node="if_else_condition"]')).toBeVisible();
    await expect(
      page.getByRole('tree', { name: 'Page content hierarchy' }).getByText('Signed In If Else'),
    ).toBeVisible();
    await expect(designFrame(page).locator('[data-sutra-node="nested_group_repeat"]')).toHaveCount(
      0,
    );
  });

  test('edits the focused style example and shows only its generated pattern', async ({ page }) => {
    await page.goto('/');
    await openExample(page, 'props-style', 'Colors & Style from Props');

    const pageInspector = inspector(page);
    await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
    const themeEditor = pageInspector.getByLabel('Design value for props.theme JSON');
    await expect(themeEditor).toBeVisible();
    const theme = JSON.parse(await themeEditor.inputValue()) as {
      cardStyle: { backgroundColor: string };
    };
    theme.cardStyle.backgroundColor = '#12352c';
    await themeEditor.fill(JSON.stringify(theme, null, 2));
    await pageInspector
      .locator('.public-prop-card')
      .filter({ hasText: 'props.theme' })
      .getByRole('button', { name: 'Apply design value' })
      .click();

    await expect(designFrame(page).locator('[data-sutra-node="lesson_stage"]')).toHaveCSS(
      'background-color',
      'rgb(18, 53, 44)',
    );

    await page.getByRole('tab', { name: 'JSX', exact: true }).click();
    const jsx = page.locator('.code-panel code');
    await expect(jsx).toContainText('sutraStyle');
    await expect(jsx).not.toContainText('.map((item, index)');
    await expect(jsx).not.toContainText('props.isSignedIn');
  });

  test('keeps the compact gallery inside a mobile-sized window', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 680 });
    await page.goto('/');
    const learnGallery = await openLearn(page);

    const box = await learnGallery.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(600);
    expect(box!.y + box!.height).toBeLessThanOrEqual(680);

    const scrollMetrics = await learnGallery
      .locator('.learn-gallery-scroll')
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
    expect(scrollMetrics.scrollWidth).toBeLessThanOrEqual(scrollMetrics.clientWidth);

    await learnGallery.getByRole('button', { name: 'Events 1', exact: true }).click();
    const eventCard = learnGallery.getByRole('article', { name: 'Typed Event Argument' });
    await expect(eventCard).toBeVisible();
    await eventCard.scrollIntoViewIfNeeded();
    await expect(
      eventCard.getByRole('button', { name: 'Open Typed Event Argument example' }),
    ).toBeVisible();
  });

  test('closes with Escape and restores focus to Learn', async ({ page }) => {
    await page.goto('/');
    const learnButton = page.getByRole('button', { name: 'Learn', exact: true });
    await learnButton.click();
    await expect(gallery(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(gallery(page)).toHaveCount(0);
    await expect(learnButton).toBeFocused();
  });
});
