import { describe, expect, it } from 'vitest';

import { createBlankDocument, createElementNode } from '@sutra/contracts';

import {
  inspectRenderedLayout,
  waitForRenderedLayoutReady,
} from '../../apps/studio/src/lib/render-inspection';

function mockRect(element: HTMLElement, x: number, y: number, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    x,
    y,
    left: x,
    top: y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  });
}

function numericProperty(element: HTMLElement, name: string, value: number): void {
  Object.defineProperty(element, name, { configurable: true, value });
}

describe('rendered layout inspection', () => {
  it('waits for the requested document revision and a paint before returning a surface', async () => {
    const documentModel = createBlankDocument('page_ready', 'Ready');
    documentModel.revision = 4;
    const root = document.createElement('div');
    root.dataset['sutraDocumentId'] = documentModel.id;
    root.dataset['sutraRevision'] = '3';
    const frame = document.createElement('iframe');
    const view = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        queueMicrotask(() => callback(0));
        return 1;
      },
    } as unknown as Window;
    const surface = { frame, root, view };
    setTimeout(() => {
      root.dataset['sutraRevision'] = '4';
    }, 5);

    await expect(
      waitForRenderedLayoutReady(
        documentModel,
        { timeoutMs: 200, pollIntervalMs: 1 },
        () => surface,
      ),
    ).resolves.toBe(surface);
  });

  it('returns stable repeat instance indexes, exact bounds, styles, and overflow diagnostics', () => {
    const documentModel = createBlankDocument('page_layout', 'Layout');
    documentModel.nodes['card'] = createElementNode('card', 'sutra.container', 'Card');

    const root = document.createElement('div');
    root.className = 'sutra-edit-surface';
    mockRect(root, 0, 0, 400, 300);
    numericProperty(root, 'scrollWidth', 400);
    numericProperty(root, 'scrollHeight', 300);

    for (const x of [0, 200]) {
      const card = document.createElement('section');
      card.dataset['sutraNode'] = 'card';
      card.style.display = 'flex';
      card.style.gap = '12px';
      mockRect(card, x, 20, 180, 60);
      numericProperty(card, 'clientWidth', 180);
      numericProperty(card, 'clientHeight', 60);
      numericProperty(card, 'scrollWidth', x === 0 ? 220 : 180);
      numericProperty(card, 'scrollHeight', 60);
      root.append(card);
    }

    const frame = document.createElement('iframe');
    numericProperty(frame, 'clientWidth', 400);
    numericProperty(frame, 'clientHeight', 300);
    const result = inspectRenderedLayout(
      documentModel,
      { width: 400, height: 300 },
      { nodeIds: ['card'], includeComputedStyles: true, maxInstances: 10 },
      { frame, root, view: window },
    );

    expect(result).toMatchObject({
      ok: true,
      totalInstanceCount: 2,
      returnedInstanceCount: 2,
      truncated: false,
      instances: [
        {
          nodeId: 'card',
          instanceIndex: 0,
          instanceKey: 'card#1',
          rect: { x: 0, y: 20, width: 180, height: 60 },
          flags: { horizontalOverflow: true },
          computedStyle: { display: 'flex', gap: '12px' },
        },
        {
          nodeId: 'card',
          instanceIndex: 1,
          instanceKey: 'card#2',
          rect: { x: 200, y: 20, width: 180, height: 60 },
          flags: { horizontalOverflow: false },
        },
      ],
      diagnostics: [
        expect.objectContaining({
          code: 'horizontal-content-overflow',
          nodeId: 'card',
          instanceIndex: 0,
        }),
      ],
    });
  });

  it('reports a hard error when the iframe does not match the requested viewport', () => {
    const documentModel = createBlankDocument('page_mismatch', 'Mismatch');
    const root = document.createElement('div');
    mockRect(root, 0, 0, 390, 300);
    numericProperty(root, 'scrollWidth', 390);
    numericProperty(root, 'scrollHeight', 300);
    const frame = document.createElement('iframe');
    numericProperty(frame, 'clientWidth', 390);
    numericProperty(frame, 'clientHeight', 300);

    expect(
      inspectRenderedLayout(
        documentModel,
        { width: 400, height: 300 },
        {},
        { frame, root, view: window },
      ),
    ).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'viewport-size-mismatch', severity: 'error' })],
    });
  });
});
