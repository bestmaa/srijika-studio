import { expect, test, type Locator, type Page } from '@playwright/test';

function inspector(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Inspector' });
}

function hierarchy(page: Page): Locator {
  return page.getByRole('tree', { name: 'Page content hierarchy' });
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

test('defines a typed public event, binds Input onChange, and rejects an incompatible edit', async ({
  page,
}) => {
  await page.goto('/');

  const pageInspector = inspector(page);
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
  await pageInspector.getByLabel('New public prop name').fill('onValueChange');
  await pageInspector.getByLabel('New public prop type').selectOption('string');
  await pageInspector.getByRole('button', { name: 'Add public prop' }).click();

  const publicPropType = pageInspector.getByLabel('Type for props.onValueChange', { exact: true });
  await publicPropType.selectOption('event');
  await expect(publicPropType).toHaveValue('event');
  await expect(
    pageInspector.getByRole('group', { name: 'Event definition for props.onValueChange' }),
  ).toBeVisible();

  const payloadMode = pageInspector.getByLabel('Payload mode for props.onValueChange');
  await payloadMode.selectOption('payload');
  const payloadName = pageInspector.getByLabel('Event payload name for props.onValueChange');
  await payloadName.fill('value');
  await payloadName.press('Enter');
  const payloadType = pageInspector.getByLabel('Event payload type for props.onValueChange');
  await payloadType.selectOption('string');
  await expect(pageInspector.getByLabel('Return type for props.onValueChange')).toHaveValue('void');
  await expect(pageInspector.getByText('Callback · (value: string) => void')).toBeVisible();

  await page.getByRole('button', { name: 'Input', exact: true }).click();
  await pageInspector.getByRole('button', { name: 'Events', exact: true }).click();
  const onChangeAction = pageInspector.getByLabel('On change action');
  await selectOptionContaining(onChangeAction, 'onValueChange');
  await expect(onChangeAction.locator('option:checked')).toContainText(
    'onValueChange · (value: string) => void',
  );

  await page.getByRole('tab', { name: 'JSX', exact: true }).click();
  const jsx = page.locator('.code-panel code');
  await expect(jsx).toContainText('onValueChange?: (value: string) => void;');
  await expect(jsx).toContainText(
    'onChange={(event) => props.onValueChange?.(event.currentTarget.value)}',
  );

  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  let jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
  let document = JSON.parse(jsonText) as {
    nodes: Record<string, { componentId?: string; events?: Record<string, unknown> }>;
    publicProps: Record<
      string,
      {
        eventSignature?: unknown;
        symbolId: string;
        valueType: string;
      }
    >;
    symbols: Record<
      string,
      {
        eventSignature?: unknown;
        provider: string;
        valueType: string;
      }
    >;
  };
  const eventProp = document.publicProps['onValueChange'];
  expect(eventProp).toMatchObject({
    valueType: 'event',
    eventSignature: { payload: { name: 'value', shape: { kind: 'string' } } },
  });
  expect(document.symbols[eventProp!.symbolId]).toMatchObject({
    provider: 'event',
    valueType: 'event',
    eventSignature: { payload: { name: 'value', shape: { kind: 'string' } } },
  });
  const inputNode = Object.values(document.nodes).find(
    (node) => node.componentId === 'srijika.input',
  );
  expect(inputNode?.events?.['onChange']).toEqual({
    kind: 'reference',
    path: [],
    symbolId: eventProp!.symbolId,
  });

  await page.getByRole('tab', { name: 'UI', exact: true }).click();
  await hierarchy(page).locator('.tree-row').first().click();
  await pageInspector.getByRole('button', { name: 'Props', exact: true }).click();
  await pageInspector
    .getByLabel('Event payload type for props.onValueChange')
    .selectOption('number');
  await expect(pageInspector.getByLabel('Event payload type for props.onValueChange')).toHaveValue(
    'string',
  );
  await expect(page.getByRole('alert')).toContainText('Could not apply this change');
  await expect(page.getByRole('alert')).toContainText(
    'Event onChange payload is incompatible with onValueChange',
  );

  await page.getByRole('tab', { name: 'JSON', exact: true }).click();
  jsonText = (await page.locator('.code-panel code').textContent()) ?? '';
  document = JSON.parse(jsonText) as typeof document;
  expect(document.publicProps['onValueChange']?.eventSignature).toEqual({
    payload: { name: 'value', shape: { kind: 'string' } },
  });
  const persistedInput = Object.values(document.nodes).find(
    (node) => node.componentId === 'srijika.input',
  );
  expect(persistedInput?.events?.['onChange']).toEqual({
    kind: 'reference',
    path: [],
    symbolId: eventProp!.symbolId,
  });

  const previewPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Browser preview' }).click();
  const preview = await previewPromise;
  await preview.getByLabel('Label').fill('Srijika');
  await expect(preview.getByRole('status')).toHaveText('Event fired: onValueChange×');
  await preview.close();
});
