import { expect, test } from '@playwright/test';

import { loadOrbitFidelityDocument } from '../fixtures/orbit-fidelity';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

test('@orbit recreates the complete Orbit page at its exact source viewport', async ({
  page,
}, testInfo) => {
  // Keep the complete 1586px design iframe inside Chromium's painted viewport so
  // an element screenshot cannot expose the transparent Studio shell behind it.
  await page.setViewportSize({ width: 2_320, height: 1_280 });
  await page.goto('/');
  const document = loadOrbitFidelityDocument();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'orbit-fidelity.sutra.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });

  await expect(page.getByRole('button', { name: 'Orbit Fidelity React page' })).toBeVisible();
  await page.getByLabel('Viewport width').fill('1586');
  await page.getByLabel('Viewport height').fill('992');
  await page.getByLabel('Viewport height').press('Enter');

  const iframe = page.getByTestId('design-iframe');
  await expect(iframe).toHaveAttribute('width', '1586');
  await expect(iframe).toHaveAttribute('height', '992');
  const frame = page.frameLocator('iframe[title="Sutra DOM design surface"]');
  const surface = frame.locator('.sutra-edit-surface');
  await expect(surface).toBeVisible();
  await expect.poll(() => frame.locator('[data-sutra-node="stat_card_template"]').count()).toBe(4);

  await surface.evaluate(async (element) => {
    element.classList.add('sutra-capture-mode');
    await Promise.all(
      [...element.querySelectorAll('img')]
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
    );
  });

  const viewport = await frame.locator('body').evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(viewport).toEqual({ width: 1586, height: 992 });

  const rect = (nodeId: string): Promise<Rect> =>
    frame
      .locator(`[data-sutra-node="${nodeId}"]`)
      .first()
      .evaluate((element) => {
        const value = element.getBoundingClientRect();
        return {
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
          right: value.right,
          bottom: value.bottom,
        };
      });

  await expect(rect('sidebar')).resolves.toMatchObject({ x: 0, width: 264, height: 992 });
  await expect(rect('top_header')).resolves.toMatchObject({ x: 264, y: 0, height: 77 });
  const statRects = await frame
    .locator('[data-sutra-node="stat_card_template"]')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const value = element.getBoundingClientRect();
        return { x: value.x, y: value.y, width: value.width, height: value.height };
      }),
    );
  expect(statRects).toHaveLength(4);
  expect(new Set(statRects.map(({ y }) => Math.round(y))).size).toBe(1);
  expect(statRects.every(({ width }) => width > 295 && width < 310)).toBe(true);
  expect(statRects[3]!.x).toBeGreaterThan(1_240);
  expect(statRects).toEqual([
    { x: 289, y: 208, width: 303.75, height: 124 },
    { x: 610.75, y: 208, width: 303.75, height: 124 },
    { x: 932.5, y: 208, width: 303.75, height: 124 },
    { x: 1_254.25, y: 208, width: 303.75, height: 124 },
  ]);

  const charts = await rect('charts_grid');
  const bottom = await rect('bottom_grid');
  expect(charts).toEqual({ x: 289, y: 346, width: 1_269, height: 277, right: 1_558, bottom: 623 });
  expect(bottom).toEqual({ x: 289, y: 638, width: 1_269, height: 317, right: 1_558, bottom: 955 });
  await expect(rect('storage_card')).resolves.toEqual({
    x: 15,
    y: 656,
    width: 232,
    height: 172,
    right: 247,
    bottom: 828,
  });
  await expect(rect('profile_card')).resolves.toEqual({
    x: 15,
    y: 853,
    width: 232,
    height: 103,
    right: 247,
    bottom: 956,
  });
  await expect(rect('donut_ring')).resolves.toEqual({
    x: 954.5,
    y: 388,
    width: 230,
    height: 230,
    right: 1_184.5,
    bottom: 618,
  });
  await expect(rect('progress_legend')).resolves.toEqual({
    x: 1_222.5,
    y: 418,
    width: 312.5,
    height: 170,
    right: 1_535,
    bottom: 588,
  });

  await surface.screenshot({
    path: testInfo.outputPath('orbit-fidelity-current.png'),
    animations: 'disabled',
  });
});
