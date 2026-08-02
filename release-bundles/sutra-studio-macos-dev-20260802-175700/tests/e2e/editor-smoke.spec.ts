import AxeBuilder from '@axe-core/playwright';
import { expect, test, type FrameLocator, type Locator, type Page } from '@playwright/test';

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function projectPages(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Project pages' });
}

function hierarchy(page: Page): Locator {
  return page.getByRole('tree', { name: 'Page content hierarchy' });
}

function designFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="Sutra DOM design surface"]');
}

function pageRoot(page: Page): Locator {
  return designFrame(page).locator('[data-sutra-component="sutra.page"]');
}

function component(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

async function selectPageRoot(page: Page): Promise<void> {
  await hierarchy(page).locator('.tree-row').first().click();
}

async function addPublicProp(page: Page, name: string, type: string): Promise<void> {
  const pageInspector = inspector(page);
  await pageInspector.getByLabel('New public prop name').fill(name);
  await pageInspector.getByLabel('New public prop type').selectOption(type);
  await pageInspector.getByRole('button', { name: 'Add public prop' }).click();
  await expect(pageInspector.getByText(`props.${name}`, { exact: true })).toBeVisible();
}

async function addDesignProperty(page: Page, label: string): Promise<void> {
  const pageInspector = inspector(page);
  await pageInspector.getByRole('button', { name: 'Add design property' }).click();
  await pageInspector
    .getByLabel('Design properties')
    .getByRole('button', { name: `Add ${label}`, exact: true })
    .click();
}

async function selectOptionContaining(select: Locator, text: string): Promise<void> {
  const value = await select
    .locator('option')
    .filter({ hasText: text })
    .first()
    .getAttribute('value');
  if (value === null) throw new Error(`Expected an option containing ${JSON.stringify(text)}`);
  await select.selectOption(value);
}

async function pointerDragTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox, 'The palette source must have a visible bounding box').not.toBeNull();
  expect(targetBox, 'The canvas target must have a visible bounding box').not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 12, sourceBox!.y + 8, {
    steps: 3,
  });
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, {
    steps: 18,
  });
  await page.mouse.up();
}

test.describe('Sutra Studio canonical React UI builder', () => {
  test('starts with a blank Home Page, shows its locked Page inspector, and isolates pages', async ({
    page,
  }) => {
    await page.goto('/');

    const homePage = projectPages(page).getByRole('button', { name: /Home Page/ });
    await expect(homePage).toHaveAttribute('aria-pressed', 'true');
    await expect(hierarchy(page).getByRole('treeitem')).toHaveCount(1);
    await expect(pageRoot(page)).toHaveAttribute('data-sutra-empty-container', 'true');
    await expect(inspector(page).getByRole('heading', { name: 'Home Page' })).toBeVisible();
    await expect(inspector(page).getByText('Page identity', { exact: true })).toBeVisible();
    await expect(inspector(page).locator('.page-root-facts')).toContainText('Width 100%');
    await expect(inspector(page).locator('.page-root-facts')).toContainText('Height 100%');
    await expect(inspector(page).locator('.page-root-facts')).toContainText('Root Locked');

    await component(page, 'Container').click();
    await expect(designFrame(page).locator('[data-sutra-component="sutra.container"]')).toHaveCount(
      1,
    );

    await page.getByRole('button', { name: 'New page' }).click();
    await page.getByLabel('New page name').fill('Dashboard Page');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const dashboardPage = projectPages(page).getByRole('button', { name: /Dashboard Page/ });
    await expect(dashboardPage).toHaveAttribute('aria-pressed', 'true');
    await expect(hierarchy(page).getByRole('treeitem')).toHaveCount(1);
    await expect(pageRoot(page)).toHaveAttribute('data-sutra-empty-container', 'true');
    await expect(inspector(page).getByRole('heading', { name: 'Dashboard Page' })).toBeVisible();

    await homePage.click();
    await expect(homePage).toHaveAttribute('aria-pressed', 'true');
    await expect(designFrame(page).locator('[data-sutra-component="sutra.container"]')).toHaveCount(
      1,
    );
    await expect(hierarchy(page).getByRole('treeitem')).toHaveCount(2);
  });

  test('supports palette click and pointer drag into the deepest Container with synchronized selection', async ({
    page,
  }) => {
    await page.goto('/');

    await component(page, 'Container').click();
    const containers = designFrame(page).locator('[data-sutra-component="sutra.container"]');
    await expect(containers).toHaveCount(1);
    const outerContainer = containers.first();

    await pointerDragTo(page, component(page, 'Container'), outerContainer);
    await expect(containers).toHaveCount(2);
    const nestedContainer = containers.nth(1);
    await expect(nestedContainer).toHaveAttribute('data-sutra-selected', 'true');
    await expect(inspector(page).getByRole('heading', { name: 'Container' })).toBeVisible();
    await expect(
      hierarchy(page)
        .locator('.tree-row.is-selected')
        .filter({ hasText: /^Container/ }),
    ).toHaveCount(1);

    await inspector(page).getByLabel('Width sizing mode').selectOption('px');
    await inspector(page).getByLabel('Width value').fill('640');
    await addDesignProperty(page, 'Height');
    await inspector(page).getByLabel('Height sizing mode').selectOption('px');
    await inspector(page).getByLabel('Height value').fill('180');
    await inspector(page).getByLabel('Flex direction').selectOption('row');
    await addDesignProperty(page, 'Align items');
    await inspector(page).getByLabel('Align items', { exact: true }).selectOption('center');
    await inspector(page).getByLabel('Gap', { exact: true }).fill('20');

    await expect
      .poll(() =>
        nestedContainer.evaluate((element) => ({
          width: (element as HTMLElement).style.width,
          height: (element as HTMLElement).style.height,
          direction: (element as HTMLElement).style.flexDirection,
          align: (element as HTMLElement).style.alignItems,
          gap: (element as HTMLElement).style.gap,
        })),
      )
      .toEqual({
        width: '640px',
        height: '180px',
        direction: 'row',
        align: 'center',
        gap: '20px',
      });

    await pointerDragTo(page, component(page, 'Text'), nestedContainer);
    const nestedText = nestedContainer.locator(':scope > [data-sutra-component="sutra.text"]');
    await expect(nestedText).toHaveCount(1);
    await expect(
      outerContainer.locator(':scope > [data-sutra-component="sutra.text"]'),
    ).toHaveCount(0);
    await nestedText.click();
    await expect(nestedText).toHaveAttribute('data-sutra-selected', 'true');
    await expect(inspector(page).getByRole('heading', { name: 'Text' })).toBeVisible();
    await expect(
      hierarchy(page).locator('.tree-row.is-selected').filter({ hasText: /^Text/ }),
    ).toHaveCount(1);
  });

  test('binds declared props to Heading and Text and keeps UI, JSX, and JSON synchronized', async ({
    page,
  }) => {
    await page.goto('/');

    const pageInspector = inspector(page);
    await pageInspector.getByLabel('Page name').fill('Landing Page');
    await pageInspector.getByLabel('Page name').press('Enter');
    await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
    await addPublicProp(page, 'title', 'string');

    await component(page, 'Container').click();
    await component(page, 'Heading').click();
    await pageInspector.getByLabel('Level').selectOption('1');
    await selectOptionContaining(pageInspector.getByLabel('Text value source'), 'title');

    await component(page, 'Text').click();
    await selectOptionContaining(pageInspector.getByLabel('Text value source'), 'title');

    const renderedHeading = designFrame(page).locator('h1[data-sutra-component="sutra.heading"]');
    const renderedText = designFrame(page).locator('p[data-sutra-component="sutra.text"]');
    await expect(renderedHeading).toHaveCount(1);
    await expect(renderedText).toHaveCount(1);

    await page.getByRole('tab', { name: 'JSX', exact: true }).click();
    const jsx = page.locator('.code-panel code');
    await expect(jsx).toContainText('export interface LandingPageProps');
    await expect(jsx).toContainText('title?: string');
    await expect(jsx).toContainText('<h1');
    await expect(jsx).toContainText('{(props.title ?? "")}');
    expect((await jsx.textContent())?.match(/\{\(props\.title \?\? ""\)\}/gu)).toHaveLength(2);

    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const json = page.locator('.code-panel code');
    await expect(json).toContainText('"name": "Landing Page"');
    await expect(json).toContainText('"name": "title"');
    await expect(json).toContainText('"kind": "reference"');
    await expect(json).toContainText('"componentId": "sutra.heading"');
    await expect(json).toContainText('"componentId": "sutra.text"');

    await page.getByRole('tab', { name: 'UI', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'UI', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(renderedHeading).toHaveCount(1);
    await expect(renderedText).toHaveCount(1);
    await selectPageRoot(page);
    await expect(pageInspector.getByRole('heading', { name: 'Landing Page' })).toBeVisible();
  });

  test('authors a recursive object prop and binds nested fields in JSX conditions and content', async ({
    page,
  }) => {
    await page.goto('/');

    const pageInspector = inspector(page);
    await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
    await addPublicProp(page, 'profile', 'object');
    await pageInspector.getByLabel('Object shape mode for props.profile').selectOption('defined');

    await pageInspector.getByLabel('Add field to props.profile name').fill('displayName');
    await pageInspector.getByRole('button', { name: 'Add field to props.profile' }).click();
    await pageInspector.getByLabel('Add field to props.profile name').fill('preferences');
    await pageInspector.getByLabel('Add field to props.profile type').selectOption('object');
    await pageInspector.getByRole('button', { name: 'Add field to props.profile' }).click();
    await pageInspector
      .getByLabel('Object shape mode for props.profile.preferences')
      .selectOption('defined');
    await pageInspector.getByLabel('Add field to props.profile.preferences name').fill('darkMode');
    await pageInspector
      .getByLabel('Add field to props.profile.preferences type')
      .selectOption('boolean');
    await pageInspector
      .getByRole('button', { name: 'Add field to props.profile.preferences' })
      .click();

    await component(page, 'Heading').click();
    await selectOptionContaining(
      pageInspector.getByLabel('Text value source'),
      'profile.displayName',
    );
    await component(page, 'If / Else Conditional JSX branch').click();
    await selectOptionContaining(
      pageInspector.getByLabel('Condition expression source'),
      'profile.preferences.darkMode',
    );

    await page.getByRole('tab', { name: 'JSX', exact: true }).click();
    const jsx = page.locator('.code-panel code');
    await expect(jsx).toContainText('profile?: {');
    await expect(jsx).toContainText('displayName?: string');
    await expect(jsx).toContainText('preferences?: {');
    await expect(jsx).toContainText('darkMode?: boolean');
    await expect(jsx).toContainText('(props.profile ?? {})?.["displayName"]');
    await expect(jsx).toContainText('(props.profile ?? {})?.["preferences"]?.["darkMode"] ?');
  });

  test('models boolean conditions and array repeats with explicit Then, Else, and Template hierarchy slots', async ({
    page,
  }) => {
    await page.goto('/');

    const pageInspector = inspector(page);
    await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
    await addPublicProp(page, 'showDetails', 'boolean');
    await addPublicProp(page, 'items', 'array');

    await component(page, 'If / Else Conditional JSX branch').click();
    await selectOptionContaining(
      pageInspector.getByLabel('Condition expression source'),
      'showDetails',
    );

    const thenSlot = hierarchy(page).locator('.tree-slot-row').filter({ hasText: /^Then/ });
    const elseSlot = hierarchy(page).locator('.tree-slot-row').filter({ hasText: /^Else/ });
    await expect(thenSlot).toContainText('0');
    await expect(elseSlot).toContainText('0');
    await component(page, 'Text').click();
    await expect(thenSlot).toContainText('1');

    await elseSlot.click();
    await component(page, 'Heading').click();
    await expect(elseSlot).toContainText('1');

    await selectPageRoot(page);
    await component(page, 'Repeat Typed collection map').click();
    await selectOptionContaining(pageInspector.getByLabel('Repeat collection source'), 'items');
    const templateSlot = hierarchy(page)
      .locator('.tree-slot-row')
      .filter({ hasText: /^Template/ });
    await expect(templateSlot).toContainText('0');
    await component(page, 'Text').click();
    await expect(templateSlot).toContainText('1');

    await page.getByRole('tab', { name: 'JSX', exact: true }).click();
    const jsxText = (await page.locator('.code-panel code').textContent()) ?? '';
    expect(jsxText).toContain('props.showDetails ?');
    expect(jsxText).toContain('(props.items ?? []).map((item, index)');
    expect(jsxText).toContain('<Fragment key={index}>');

    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
    expect(jsonText).toContain('"whenTrue"');
    expect(jsonText).toContain('"whenFalse"');
    expect(jsonText).toContain('"kind": "repeat"');
    expect(jsonText).toContain('"name": "showDetails"');
    expect(jsonText).toContain('"name": "items"');
  });

  test('deletes the selected Container subtree and returns selection to the Page', async ({
    page,
  }) => {
    await page.goto('/');

    await component(page, 'Container').click();
    await component(page, 'Heading').click();
    await component(page, 'Text').click();
    await expect(designFrame(page).locator('[data-sutra-node]')).toHaveCount(4);

    await hierarchy(page)
      .locator('.tree-row')
      .filter({ hasText: /^Container/ })
      .click();
    await expect(inspector(page).getByRole('heading', { name: 'Container' })).toBeVisible();
    await inspector(page).getByRole('button', { name: 'Delete Container' }).click();

    await expect(designFrame(page).locator('[data-sutra-node]')).toHaveCount(1);
    await expect(hierarchy(page).getByRole('treeitem')).toHaveCount(1);
    await expect(inspector(page).getByRole('heading', { name: 'Home Page' })).toBeVisible();
    await expect(pageRoot(page)).toHaveAttribute('data-sutra-empty-container', 'true');

    await page.getByRole('tab', { name: 'JSON', exact: true }).click();
    const jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
    expect(jsonText).not.toContain('sutra.container');
    expect(jsonText).not.toContain('sutra.heading');
    expect(jsonText).not.toContain('sutra.text');
  });

  test('renders the complete editor interface in English', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Components' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Hierarchy' })).toBeVisible();
    await expect(page.getByText('Page identity', { exact: true })).toBeVisible();
    await inspector(page).getByRole('button', { name: 'Props', exact: true }).click();
    await expect(
      page.getByText('Define a page prop before binding it to component content.'),
    ).toBeVisible();

    const interfaceText = await page.locator('body').innerText();
    expect(interfaceText).not.toMatch(/[\u0900-\u097f]/u);
  });

  test('shows a clean fullscreen canvas and opens the live browser preview', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Enter fullscreen preview' }).click();
    const fullscreen = page.getByRole('dialog', { name: 'Fullscreen design preview' });
    await expect(fullscreen).toBeVisible();
    await expect(fullscreen).toHaveCSS('position', 'fixed');
    const bounds = await fullscreen.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).toEqual({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });
    await expect(page.getByRole('button', { name: 'Exit fullscreen preview' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(fullscreen).toBeHidden();

    const previewPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Browser preview' }).click();
    const preview = await previewPromise;
    await expect(preview).toHaveURL(/\/preview$/u);
    await expect(preview.getByText('Sutra live preview')).toBeVisible();
    const browserPreviewStage = preview.locator('.browser-preview-stage');
    await expect(browserPreviewStage).toHaveAttribute('data-preview-sizing', 'responsive');
    await expect(preview.getByRole('button', { name: 'Responsive' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await preview.getByRole('button', { name: 'Exact design' }).click();
    await expect(browserPreviewStage).toHaveAttribute('data-preview-sizing', 'exact');
    await expect(browserPreviewStage).toHaveAttribute('data-viewport-width', '1180');
    await expect(browserPreviewStage).toHaveAttribute('data-viewport-height', '820');
    await expect(preview.getByRole('button', { name: 'Exact design' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await preview.close();
  });

  test('keeps native Text spacing identical in the editor and Browser preview', async ({
    page,
  }) => {
    await page.goto('/');
    await component(page, 'Text').click();
    await component(page, 'Heading').click();

    const editorText = designFrame(page).locator('[data-sutra-component="sutra.text"]');
    const editorHeading = designFrame(page).locator('[data-sutra-component="sutra.heading"]');
    await expect(editorText).toHaveCount(1);
    await expect(editorHeading).toHaveCount(1);
    await expect(editorText).toHaveCSS('margin', '0px');
    await expect(editorHeading).toHaveCSS('margin', '0px');

    const previewPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Browser preview' }).click();
    const preview = await previewPromise;
    const previewText = preview.locator('main p');
    const previewHeading = preview.locator('main h2');

    await expect(previewText).toHaveCount(1);
    await expect(previewHeading).toHaveCount(1);
    await expect(previewText).toHaveCSS('margin', '0px');
    await expect(previewHeading).toHaveCSS('margin', '0px');
    await preview.close();
  });

  test('@a11y has no automatically detectable serious or critical accessibility violations', async ({
    page,
  }) => {
    await page.goto('/');
    await component(page, 'Container').click();
    await component(page, 'Heading').click();
    await component(page, 'Button').click();

    const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();
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
