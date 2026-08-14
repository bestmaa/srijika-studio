import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createBlankDocument } from '@srijika/contracts';
import { createCoreComponentRegistry } from '@srijika/core-components';
import { SrijikaRenderer } from '@srijika/react-renderer';

describe('responsive renderer', () => {
  it('evaluates the same canonical document at desktop, tablet, mobile and wide widths', () => {
    const document = createBlankDocument('page_responsive', 'Responsive page');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    root.style = {
      base: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 24,
        width: { mode: 'percent', value: 100 },
      },
      breakpoints: {
        tablet: {
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 16,
        },
        mobile: {
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 10,
        },
        wide: {
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 32,
        },
      },
    };
    const registry = createCoreComponentRegistry();

    const { container, rerender } = render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        viewportWidth={1180}
      />,
    );
    const page = container.querySelector('main');
    expect(page).toHaveStyle({
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: '24px',
    });

    rerender(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        viewportWidth={800}
      />,
    );
    expect(page).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '16px',
    });

    rerender(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        viewportWidth={390}
      />,
    );
    expect(page).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)', gap: '10px' });

    rerender(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        viewportWidth={1600}
      />,
    );
    expect(page).toHaveStyle({
      gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
      gap: '32px',
    });
  });

  it('lets responsive grid tracks override the component column fallback', () => {
    const document = createBlankDocument('page_responsive_grid', 'Responsive grid');
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected root element');
    const registry = createCoreComponentRegistry();
    const grid = registry.require('srijika.grid').createNode('cards');
    if (grid.kind !== 'element') throw new Error('Expected grid element');
    grid.props['columnsTemplate'] = {
      kind: 'literal',
      value: 'repeat(4, minmax(0, 1fr))',
    };
    grid.style.base.gridTemplateColumns = 'repeat(4, minmax(0, 1fr))';
    grid.style.breakpoints = {
      mobile: { gridTemplateColumns: 'minmax(0, 1fr)' },
    };
    root.slots['children'] = [grid.id];
    document.nodes[grid.id] = grid;

    const { container } = render(
      <SrijikaRenderer
        document={document}
        registry={registry}
        mode="preview"
        viewportWidth={390}
      />,
    );

    expect(container.querySelector('main > div')).toHaveStyle({
      gridTemplateColumns: 'minmax(0, 1fr)',
    });
  });
});
