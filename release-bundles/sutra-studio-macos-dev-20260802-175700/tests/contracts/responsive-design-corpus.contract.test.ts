import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@sutra/component-registry';
import {
  resolveResponsiveStyle,
  validateUiDocument,
  type StyleProperties,
  type UiDocument,
} from '@sutra/contracts';
import { assertValidDocumentGraph } from '@sutra/document-engine';
import { generateTsx } from '@sutra/react-codegen';

import { componentRegistry } from '../../apps/studio/src/lib/registry';
import {
  RESPONSIVE_CORPUS_VIEWPORTS,
  responsiveDesignCorpus,
  type ResponsiveCorpusViewport,
} from '../fixtures/responsive-design-corpus';

function explicitColumnCount(template: string | undefined): number {
  if (!template) return 1;
  const repeat = template.match(/^repeat\(\s*(\d+)/);
  if (repeat?.[1]) return Number(repeat[1]);
  if (template.trim() === 'minmax(0, 1fr)' || template.trim() === '1fr') return 1;
  return template
    .trim()
    .split(/\s+(?![^()]*\))/)
    .filter(Boolean).length;
}

function visibleResolvedStyles(document: UiDocument, viewportWidth: number): StyleProperties[] {
  return Object.values(document.nodes).flatMap((node) => {
    if (node.kind !== 'element') return [];
    const style = resolveResponsiveStyle(node.style, viewportWidth);
    return style.display === 'none' || style.visibility === 'hidden' ? [] : [style];
  });
}

describe('responsive design reference corpus', () => {
  it('covers ten honestly-labelled Figma-style archetypes without claiming Figma import', () => {
    expect(responsiveDesignCorpus).toHaveLength(10);
    expect(new Set(responsiveDesignCorpus.map((frame) => frame.id)).size).toBe(10);
    expect(new Set(responsiveDesignCorpus.map((frame) => frame.archetype))).toEqual(
      new Set([
        'dashboard',
        'video-feed',
        'inbox',
        'commerce',
        'settings',
        'kanban',
        'finance',
        'social',
        'mobile-banking',
        'landing',
      ]),
    );
    expect(
      responsiveDesignCorpus.filter((frame) => frame.source === 'built-in-reference'),
    ).toHaveLength(5);
    expect(
      responsiveDesignCorpus.filter((frame) => frame.source === 'derived-stress-fixture'),
    ).toHaveLength(5);
  });

  it('keeps all ten documents valid, connected and code-generatable', () => {
    for (const frame of responsiveDesignCorpus) {
      const document = frame.createDocument();
      expect(validateUiDocument(document).valid, frame.title).toBe(true);
      expect(() => assertValidDocumentGraph(document), frame.title).not.toThrow();
      expect(() => assertDocumentSemantics(document, componentRegistry), frame.title).not.toThrow();
      expect(generateTsx(document), frame.title).toContain('export function');
    }
  });

  it('preserves source-frame base geometry at 1180 px', () => {
    for (const frame of responsiveDesignCorpus) {
      const document = frame.createDocument();
      for (const node of Object.values(document.nodes)) {
        if (node.kind !== 'element') continue;
        expect(resolveResponsiveStyle(node.style, 1180), `${frame.title}: ${node.name}`).toEqual(
          node.style.base,
        );
      }
    }
  });

  it('resolves every frame at mobile, tablet, desktop and wide without unsafe widths', () => {
    for (const frame of responsiveDesignCorpus) {
      const document = frame.createDocument();
      for (const [viewportName, viewport] of Object.entries(RESPONSIVE_CORPUS_VIEWPORTS) as Array<
        [ResponsiveCorpusViewport, (typeof RESPONSIVE_CORPUS_VIEWPORTS)[ResponsiveCorpusViewport]]
      >) {
        const layoutNode = document.nodes[frame.layoutNodeId];
        expect(layoutNode?.kind, `${frame.title}: ${frame.layoutNodeId}`).toBe('element');
        if (!layoutNode || layoutNode.kind !== 'element') continue;
        const layout = resolveResponsiveStyle(layoutNode.style, viewport.width);
        const declaredColumns = layoutNode.props['columns'];
        const fallbackColumns =
          declaredColumns?.kind === 'literal' && typeof declaredColumns.value === 'number'
            ? declaredColumns.value
            : 1;
        expect(
          layout.gridTemplateColumns
            ? explicitColumnCount(layout.gridTemplateColumns)
            : fallbackColumns,
          `${frame.title} at ${viewportName}`,
        ).toBe(frame.expectedColumns[viewportName]);

        for (const style of visibleResolvedStyles(document, viewport.width)) {
          if (style.width?.mode === 'fixed' && style.width.unit === 'px') {
            expect(
              style.width.value,
              `${frame.title} has a fixed width wider than ${viewportName}`,
            ).toBeLessThanOrEqual(viewport.width);
          }
          if (style.minWidth !== undefined) {
            expect(
              style.minWidth,
              `${frame.title} has a min-width wider than ${viewportName}`,
            ).toBeLessThanOrEqual(viewport.width);
          }
          if (style.padding) {
            expect(
              style.padding.left + style.padding.right,
              `${frame.title} padding consumes ${viewportName}`,
            ).toBeLessThan(viewport.width);
          }
        }
      }
    }
  });
});
