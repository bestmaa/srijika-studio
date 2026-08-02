import { expect, test, type Locator, type Page } from '@playwright/test';

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
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

test('maps a Button click to a typed number argument in JSON, JSX, and preview', async ({
  page,
}) => {
  await page.goto('/');

  const pageInspector = inspector(page);
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
  await pageInspector.getByLabel('New public prop name').fill('onCount');
  await pageInspector.getByLabel('New public prop type').selectOption('event');
  await pageInspector.getByRole('button', { name: 'Add public prop' }).click();
  await pageInspector.getByLabel('Payload mode for props.onCount').selectOption('payload');
  const payloadName = pageInspector.getByLabel('Event payload name for props.onCount');
  await payloadName.fill('count');
  await payloadName.press('Enter');
  await pageInspector.getByLabel('Event payload type for props.onCount').selectOption('number');

  await page.getByRole('button', { name: 'Button', exact: true }).click();
  await pageInspector.getByRole('button', { name: 'Events', exact: true }).click();

  const action = pageInspector.getByLabel('On click action');
  await selectOptionContaining(action, 'onCount');
  const source = pageInspector.getByLabel('On click argument source');
  await expect(source).toHaveValue('literal');
  await expect(source.getByRole('option', { name: 'Emitted event value' })).toBeDisabled();
  await expect(pageInspector.getByText('On click emits no value.')).toBeVisible();

  const literalArgument = pageInspector.getByLabel('On click literal argument');
  await expect(literalArgument).toHaveValue('0');
  await literalArgument.fill('5');
  await expect(literalArgument).toHaveValue('5');

  await page.getByRole('tab', { name: 'JSX', exact: true }).click();
  const jsx = page.locator('.code-panel code');
  await expect(jsx).toContainText('onCount?: (count: number) => void;');
  await expect(jsx).toContainText('onClick={() => props.onCount?.(5)}');

  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  const jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
  const document = JSON.parse(jsonText) as {
    nodes: Record<
      string,
      {
        componentId?: string;
        eventArguments?: Record<string, unknown>;
        events?: Record<string, unknown>;
      }
    >;
    publicProps: Record<string, { eventSignature?: unknown; symbolId: string }>;
  };
  const onCount = document.publicProps['onCount'];
  expect(onCount?.eventSignature).toEqual({
    payload: { name: 'count', shape: { kind: 'number' } },
  });
  const button = Object.values(document.nodes).find((node) => node.componentId === 'sutra.button');
  expect(button?.events?.['onClick']).toEqual({
    kind: 'reference',
    path: [],
    symbolId: onCount!.symbolId,
  });
  expect(button?.eventArguments?.['onClick']).toEqual({
    kind: 'expression',
    expression: { kind: 'literal', value: 5 },
  });

  const previewPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Browser preview' }).click();
  const preview = await previewPromise;
  await preview.getByRole('button', { name: 'Button' }).click();
  await expect(preview.getByRole('status')).toContainText('Event fired: onCount');
  await preview.close();
});
