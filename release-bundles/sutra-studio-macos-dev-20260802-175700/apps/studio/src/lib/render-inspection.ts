import type { UiDocument } from '@sutra/contracts';

export interface RenderViewportSize {
  width: number;
  height: number;
}

export interface RenderInspectionOptions {
  nodeIds?: readonly string[];
  includeComputedStyles?: boolean;
  maxInstances?: number;
}

interface NumericRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface DesignSurfaceHandle {
  frame: HTMLIFrameElement;
  root: HTMLElement;
  view: Window;
}

export interface RenderReadinessOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const round = (value: number): number => Math.round(value * 100) / 100;
const transparentImagePlaceholder =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function numericRect(rect: DOMRect | DOMRectReadOnly, originX = 0, originY = 0): NumericRect {
  const x = rect.left - originX;
  const y = rect.top - originY;
  return {
    x: round(x),
    y: round(y),
    width: round(rect.width),
    height: round(rect.height),
    right: round(x + rect.width),
    bottom: round(y + rect.height),
  };
}

function visualRect(element: HTMLElement): DOMRect | DOMRectReadOnly {
  const own = element.getBoundingClientRect();
  if (own.width > 0 || own.height > 0) return own;

  const descendants = [...element.querySelectorAll<HTMLElement>('[data-sutra-node]')]
    .map((child) => child.getBoundingClientRect())
    .filter((rect) => rect.width > 0 || rect.height > 0);
  if (descendants.length === 0) return own;

  const left = Math.min(...descendants.map((rect) => rect.left));
  const top = Math.min(...descendants.map((rect) => rect.top));
  const right = Math.max(...descendants.map((rect) => rect.right));
  const bottom = Math.max(...descendants.map((rect) => rect.bottom));
  return DOMRect.fromRect({ x: left, y: top, width: right - left, height: bottom - top });
}

export function resolveDesignSurface(
  hostDocument: Document = document,
): DesignSurfaceHandle | null {
  const frame = hostDocument.querySelector<HTMLIFrameElement>('iframe.design-iframe');
  const root = frame?.contentDocument?.querySelector<HTMLElement>('.sutra-edit-surface');
  const view = frame?.contentWindow;
  return frame && root && view ? { frame, root, view } : null;
}

const COMPUTED_STYLE_KEYS = [
  'display',
  'position',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'gap',
  'rowGap',
  'columnGap',
  'gridTemplateColumns',
  'gridTemplateRows',
  'overflow',
  'overflowX',
  'overflowY',
  'padding',
  'margin',
  'backgroundColor',
  'color',
  'borderWidth',
  'borderRadius',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
] as const;

function computedStyleSnapshot(style: CSSStyleDeclaration): Record<string, string> {
  return Object.fromEntries(COMPUTED_STYLE_KEYS.map((key) => [key, style[key]]));
}

export function inspectRenderedLayout(
  documentModel: UiDocument,
  viewport: RenderViewportSize,
  options: RenderInspectionOptions = {},
  surface = resolveDesignSurface(),
): Record<string, unknown> {
  if (!surface) {
    return {
      ok: false,
      code: 'render_surface_unavailable',
      message: 'The Sutra design surface is not ready. Render the page, then retry.',
    };
  }

  const includeStyles = options.includeComputedStyles ?? true;
  const maxInstances = Math.max(1, Math.min(options.maxInstances ?? 1_000, 5_000));
  const requestedNodeIds = options.nodeIds ? new Set(options.nodeIds) : null;
  const rootRect = surface.root.getBoundingClientRect();
  const instanceCounts = new Map<string, number>();
  const diagnostics: Array<Record<string, unknown>> = [];
  const allElements = [...surface.root.querySelectorAll<HTMLElement>('[data-sutra-node]')].filter(
    (element) => {
      const nodeId = element.dataset['sutraNode'];
      return Boolean(nodeId && (!requestedNodeIds || requestedNodeIds.has(nodeId)));
    },
  );

  const instances = allElements.slice(0, maxInstances).map((element) => {
    const nodeId = element.dataset['sutraNode']!;
    const instanceIndex = instanceCounts.get(nodeId) ?? 0;
    instanceCounts.set(nodeId, instanceIndex + 1);
    const style = surface.view.getComputedStyle(element);
    const rect = numericRect(visualRect(element), rootRect.left, rootRect.top);
    const isDisplayContents = style.display === 'contents';
    const zeroSize =
      !isDisplayContents && style.display !== 'none' && rect.width < 0.5 && rect.height < 0.5;
    const clippedLeft = rect.x < -0.5;
    const clippedTop = rect.y < -0.5;
    const clippedRight = rect.right > viewport.width + 0.5;
    const clippedBottom = rect.bottom > viewport.height + 0.5;
    const horizontalOverflow = element.scrollWidth > element.clientWidth + 1;
    const verticalOverflow = element.scrollHeight > element.clientHeight + 1;

    if (zeroSize) {
      diagnostics.push({
        code: 'zero-size-node',
        severity: 'warning',
        nodeId,
        instanceIndex,
        message: `Rendered node ${nodeId} has no measurable size.`,
      });
    }
    if (clippedLeft || clippedRight) {
      diagnostics.push({
        code: 'horizontal-viewport-clipping',
        severity: 'warning',
        nodeId,
        instanceIndex,
        message: `Rendered node ${nodeId} crosses the target viewport horizontally.`,
      });
    }
    if (clippedTop || clippedBottom) {
      diagnostics.push({
        code: 'vertical-viewport-clipping',
        severity: 'warning',
        nodeId,
        instanceIndex,
        message: `Rendered node ${nodeId} crosses the target viewport vertically.`,
      });
    }
    if (horizontalOverflow) {
      diagnostics.push({
        code: 'horizontal-content-overflow',
        severity: 'warning',
        nodeId,
        instanceIndex,
        message: `Rendered node ${nodeId} has horizontally overflowing content.`,
      });
    }
    if (verticalOverflow) {
      diagnostics.push({
        code: 'vertical-content-overflow',
        severity: 'warning',
        nodeId,
        instanceIndex,
        message: `Rendered node ${nodeId} has vertically overflowing content.`,
      });
    }

    const parentElement = element.parentElement?.closest<HTMLElement>('[data-sutra-node]');
    return {
      nodeId,
      instanceIndex,
      instanceKey: `${nodeId}#${instanceIndex + 1}`,
      kind: documentModel.nodes[nodeId]?.kind ?? 'unknown',
      componentId:
        documentModel.nodes[nodeId]?.kind === 'element'
          ? documentModel.nodes[nodeId].componentId
          : undefined,
      parentNodeId: parentElement?.dataset['sutraNode'] ?? null,
      rect,
      scroll: {
        width: element.scrollWidth,
        height: element.scrollHeight,
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
      },
      flags: {
        displayContents: isDisplayContents,
        zeroSize,
        clippedLeft,
        clippedTop,
        clippedRight,
        clippedBottom,
        horizontalOverflow,
        verticalOverflow,
      },
      ...(includeStyles ? { computedStyle: computedStyleSnapshot(style) } : {}),
    };
  });

  const actualWidth = surface.frame.clientWidth;
  const actualHeight = surface.frame.clientHeight;
  if (Math.abs(actualWidth - viewport.width) > 1 || Math.abs(actualHeight - viewport.height) > 1) {
    diagnostics.unshift({
      code: 'viewport-size-mismatch',
      severity: 'error',
      message: `Requested ${viewport.width}×${viewport.height}, rendered ${actualWidth}×${actualHeight}.`,
      requested: viewport,
      actual: { width: actualWidth, height: actualHeight },
    });
  }

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic['severity'] === 'error'),
    pageId: documentModel.id,
    revision: documentModel.revision,
    viewport: {
      requested: viewport,
      actual: { width: actualWidth, height: actualHeight },
      scrollWidth: surface.root.scrollWidth,
      scrollHeight: surface.root.scrollHeight,
    },
    totalInstanceCount: allElements.length,
    returnedInstanceCount: instances.length,
    truncated: allElements.length > instances.length,
    instances,
    diagnostics,
  };
}

function nextPaint(view: Window, timeoutMs = 1_000): Promise<void> {
  return new Promise((resolve) => {
    let complete = false;
    const finish = (): void => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, Math.max(1, timeoutMs));
    try {
      view.requestAnimationFrame(() => view.requestAnimationFrame(finish));
    } catch {
      finish();
    }
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForRenderedLayoutReady(
  documentModel: UiDocument,
  options: RenderReadinessOptions = {},
  resolveSurface: () => DesignSurfaceHandle | null = () => resolveDesignSurface(),
): Promise<DesignSurfaceHandle | null> {
  const timeoutMs = Math.max(50, Math.min(options.timeoutMs ?? 2_000, 10_000));
  const pollIntervalMs = Math.max(1, Math.min(options.pollIntervalMs ?? 16, 100));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const surface = resolveSurface();
    if (
      surface?.root.dataset['sutraDocumentId'] === documentModel.id &&
      surface.root.dataset['sutraRevision'] === String(documentModel.revision)
    ) {
      const remaining = Math.max(1, deadline - Date.now());
      await nextPaint(surface.view, remaining);
      const fontsReady = surface.root.ownerDocument.fonts?.ready;
      if (fontsReady !== undefined) {
        await Promise.race([
          fontsReady.then(() => undefined).catch(() => undefined),
          wait(Math.max(1, deadline - Date.now())),
        ]);
      }
      const current = resolveSurface();
      if (
        current?.root.dataset['sutraDocumentId'] === documentModel.id &&
        current.root.dataset['sutraRevision'] === String(documentModel.revision)
      ) {
        return current;
      }
    }
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  return null;
}

export async function captureRenderedPreview(
  viewport: RenderViewportSize,
  pixelRatio: number,
  surface = resolveDesignSurface(),
): Promise<{
  mimeType: 'image/png';
  data: string;
  width: number;
  height: number;
  pixelRatio: number;
}> {
  if (!surface) throw new Error('The Sutra design surface is not ready.');
  await nextPaint(surface.view);
  await surface.root.ownerDocument.fonts?.ready;

  const { toPng } = await import('html-to-image');
  surface.root.classList.add('sutra-capture-mode');
  try {
    const backgroundColor = surface.view.getComputedStyle(surface.root).backgroundColor;
    const dataUrl = await toPng(surface.root, {
      width: viewport.width,
      height: viewport.height,
      canvasWidth: Math.round(viewport.width * pixelRatio),
      canvasHeight: Math.round(viewport.height * pixelRatio),
      pixelRatio: 1,
      skipAutoScale: true,
      cacheBust: false,
      imagePlaceholder: transparentImagePlaceholder,
      // Authored remote images can be blocked by an OS webview even when the
      // live <img> is already visible. A broken asset must not prevent a clean
      // capture of the rest of the document.
      onImageErrorHandler: () => undefined,
      ...(backgroundColor ? { backgroundColor } : {}),
    });
    const marker = 'base64,';
    const markerIndex = dataUrl.indexOf(marker);
    if (markerIndex < 0) throw new Error('Preview capture did not return a PNG data URL.');
    return {
      mimeType: 'image/png',
      data: dataUrl.slice(markerIndex + marker.length),
      width: viewport.width,
      height: viewport.height,
      pixelRatio,
    };
  } finally {
    surface.root.classList.remove('sutra-capture-mode');
  }
}
