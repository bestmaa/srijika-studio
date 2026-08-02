import { expect, test } from '@playwright/test';

import { createCoreComponentRegistry } from '@sutra/core-components';
import { createBlankDocument, literal, type IfNode, type RepeatNode } from '@sutra/contracts';

function structuralLayoutDocument() {
  const registry = createCoreComponentRegistry();
  const document = createBlankDocument('page_structural_layout', 'Structural Layout');
  const root = document.nodes[document.rootNodeId];
  if (!root || root.kind !== 'element') throw new Error('Expected Page root');
  root.style.base.height = { mode: 'percent', value: 100 };
  root.style.base.gap = 24;
  root.style.base.padding = { top: 20, right: 20, bottom: 20, left: 20 };

  const grid = registry.require('sutra.grid').createNode('metric_grid');
  const card = registry.require('sutra.container').createNode('metric_card');
  const row = registry.require('sutra.stack').createNode('action_row');
  const conditionalAction = registry.require('sutra.button').createNode('conditional_action');
  const siblingAction = registry.require('sutra.button').createNode('sibling_action');
  if (
    grid.kind !== 'element' ||
    card.kind !== 'element' ||
    row.kind !== 'element' ||
    conditionalAction.kind !== 'element' ||
    siblingAction.kind !== 'element'
  ) {
    throw new Error('Expected visual component elements');
  }

  grid.props['columns'] = literal(4);
  grid.style.base.width = { mode: 'fixed', value: 800, unit: 'px' };
  card.style.base.minHeight = 80;
  const repeat: RepeatNode = {
    kind: 'repeat',
    id: 'metric_repeat',
    name: 'Metric cards',
    source: literal([{}, {}, {}, {}]),
    itemSymbolId: 'metric_item',
    indexSymbolId: 'metric_index',
    children: [card.id],
  };
  document.symbols[repeat.itemSymbolId] = {
    id: repeat.itemSymbolId,
    name: 'metric',
    displayName: 'Metric',
    provider: 'repeatItem',
    valueType: 'object',
    valueShape: { kind: 'object', fields: {}, additionalProperties: true },
    required: true,
  };
  document.symbols[repeat.indexSymbolId] = {
    id: repeat.indexSymbolId,
    name: 'metricIndex',
    displayName: 'Metric index',
    provider: 'repeatIndex',
    valueType: 'number',
    required: true,
  };

  row.style.base.flexDirection = 'row';
  row.style.base.width = { mode: 'fixed', value: 800, unit: 'px' };
  const condition: IfNode = {
    kind: 'if',
    id: 'action_condition',
    name: 'Action condition',
    condition: literal(true),
    whenTrue: [conditionalAction.id],
    whenFalse: [],
  };

  root.slots['children'] = [grid.id, row.id];
  grid.slots['children'] = [repeat.id];
  row.slots['children'] = [condition.id, siblingAction.id];
  Object.assign(document.nodes, {
    [grid.id]: grid,
    [card.id]: card,
    [repeat.id]: repeat,
    [row.id]: row,
    [condition.id]: condition,
    [conditionalAction.id]: conditionalAction,
    [siblingAction.id]: siblingAction,
  });
  return document;
}

test('keeps structural AST nodes transparent in a true 1180 by 820 design viewport', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'structural-layout.sutra.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(structuralLayoutDocument())),
  });

  const frame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
  const cards = frame.locator('[data-sutra-node="metric_card"]');
  await expect(cards).toHaveCount(4);

  const viewport = await frame.locator('html').evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(viewport).toEqual({ width: 1180, height: 820 });

  const repeatDisplay = await frame
    .locator('[data-sutra-node="metric_repeat"]')
    .evaluate((element) => getComputedStyle(element).display);
  expect(repeatDisplay).toBe('contents');

  const cardRects = await cards.evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width };
    }),
  );
  expect(new Set(cardRects.map((bounds) => Math.round(bounds.y))).size).toBe(1);
  expect(cardRects.every((bounds) => Math.abs(bounds.width - cardRects[0]!.width) < 0.5)).toBe(
    true,
  );
  expect(cardRects.map((bounds) => bounds.x)).toEqual(
    [...cardRects].map((bounds) => bounds.x).sort((left, right) => left - right),
  );
  expect(new Set(cardRects.map((bounds) => Math.round(bounds.x))).size).toBe(4);

  const conditionDisplay = await frame
    .locator('[data-sutra-node="action_condition"]')
    .evaluate((element) => getComputedStyle(element).display);
  expect(conditionDisplay).toBe('contents');
  const actionRects = await frame
    .locator('[data-sutra-node="conditional_action"], [data-sutra-node="sibling_action"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y };
      }),
    );
  expect(actionRects).toHaveLength(2);
  expect(Math.abs(actionRects[0]!.y - actionRects[1]!.y)).toBeLessThan(0.5);
  expect(actionRects[1]!.x).toBeGreaterThan(actionRects[0]!.x);
});
