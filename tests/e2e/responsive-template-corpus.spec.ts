import { expect, test } from '@playwright/test';

import {
  RESPONSIVE_CORPUS_VIEWPORTS,
  responsiveDesignCorpus,
  type ResponsiveCorpusViewport,
} from '../fixtures/responsive-design-corpus';

const previewStorageKey = 'sutra-studio:active-document';

test('renders the ten-frame responsive corpus without page-level horizontal overflow', async ({
  page,
}) => {
  await page.goto('/');

  for (const frame of responsiveDesignCorpus) {
    const uiDocument = frame.createDocument();
    await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
      key: previewStorageKey,
      value: JSON.stringify(uiDocument),
    });

    for (const [viewportName, viewport] of Object.entries(RESPONSIVE_CORPUS_VIEWPORTS) as Array<
      [ResponsiveCorpusViewport, (typeof RESPONSIVE_CORPUS_VIEWPORTS)[ResponsiveCorpusViewport]]
    >) {
      await page.setViewportSize(viewport);
      await page.goto('/preview');
      const root = page.locator('.preview-document > main');
      await expect(root, `${frame.title} root at ${viewportName}`).toBeVisible();

      const metrics = await page.evaluate(() => {
        const rootElement = globalThis.document.documentElement;
        const body = globalThis.document.body;
        const preview = globalThis.document.querySelector('.preview-document');
        if (!(preview instanceof HTMLElement)) throw new Error('Missing responsive preview');
        const previewBounds = preview.getBoundingClientRect();
        return {
          bodyOverflow: Math.max(0, body.scrollWidth - body.clientWidth),
          documentOverflow: Math.max(0, rootElement.scrollWidth - rootElement.clientWidth),
          previewLeft: Math.round(previewBounds.left),
          previewRight: Math.round(previewBounds.right),
          viewportWidth: window.innerWidth,
        };
      });

      expect(metrics, `${frame.title} at ${viewportName}`).toMatchObject({
        bodyOverflow: 0,
        documentOverflow: 0,
        previewLeft: 0,
        previewRight: viewport.width,
        viewportWidth: viewport.width,
      });

      if (viewportName === 'mobile' || viewportName === 'wide') {
        await page.screenshot({
          animations: 'disabled',
          fullPage: true,
          path: `test-results/responsive-corpus/${frame.id}-${viewportName}.png`,
        });
      }
    }
  }
});
