import { describe, expect, it } from 'vitest';

import { createBlankDocument, validateUiDocument, type StyleProperties } from '@sutra/contracts';
import { createCoreComponentRegistry } from '@sutra/core-components';
import { generateTsx } from '@sutra/react-codegen';
import { stylePropertiesToCss } from '@sutra/react-renderer';
import { toolInputs } from '../../packages/mcp-server/src/tool-schemas';

describe('extended desktop layout styles', () => {
  it('validates, renders and generates alignment, flex-item, position and typography controls', () => {
    const style: StyleProperties = {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: { mode: 'fixed', value: 264, unit: 'px' },
      order: 2,
      alignItems: 'center',
      alignContent: 'space-between',
      alignSelf: 'end',
      justifyContent: 'space-evenly',
      justifySelf: 'center',
      placeItems: 'center',
      gridTemplateColumns: '264px minmax(0, 1fr)',
      gridTemplateRows: '77px minmax(0, 1fr)',
      gridColumn: '1 / span 2',
      gridRow: '2',
      rowGap: 18,
      columnGap: 20,
      position: 'sticky',
      top: 8,
      zIndex: 4,
      boxShadow: '0 12px 32px rgba(0,0,0,.18)',
      opacity: 0.9,
      cursor: 'pointer',
      aspectRatio: '16 / 9',
      objectFit: 'cover',
      objectPosition: 'center top',
      backgroundImage: 'linear-gradient(135deg, #111820, #090d14)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      borderStyle: 'dashed',
      fontFamily: 'Inter, sans-serif',
      fontStyle: 'italic',
      lineHeight: 1.4,
      letterSpacing: 0.2,
      textTransform: 'uppercase',
      textDecoration: 'underline',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
      overflowX: 'hidden',
      overflowY: 'auto',
      transform: 'translateY(2px)',
      transformOrigin: 'center',
      filter: 'saturate(1.1)',
      backdropFilter: 'blur(12px)',
      pointerEvents: 'auto',
      visibility: 'visible',
    };
    expect(stylePropertiesToCss(style)).toMatchObject({
      flexWrap: 'wrap',
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: '264px',
      order: 2,
      alignItems: 'center',
      alignContent: 'space-between',
      alignSelf: 'flex-end',
      justifyContent: 'space-evenly',
      gridTemplateColumns: '264px minmax(0, 1fr)',
      rowGap: 18,
      backgroundImage: 'linear-gradient(135deg, #111820, #090d14)',
      borderStyle: 'dashed',
      fontFamily: 'Inter, sans-serif',
      textTransform: 'uppercase',
      transform: 'translateY(2px)',
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 8,
      zIndex: 4,
      opacity: 0.9,
      lineHeight: 1.4,
      textOverflow: 'ellipsis',
    });

    const registry = createCoreComponentRegistry();
    const document = createBlankDocument('page_style_controls', 'Style Controls');
    const container = registry.require('sutra.container').createNode('subject');
    if (container.kind !== 'element') throw new Error('Expected Container element');
    container.style.base = style;
    document.nodes[container.id] = container;
    const root = document.nodes[document.rootNodeId];
    if (!root || root.kind !== 'element') throw new Error('Expected Page root');
    root.slots['children']!.push(container.id);

    expect(validateUiDocument(document).valid).toBe(true);
    const output = generateTsx(document);
    expect(output).toContain('flexWrap: "wrap"');
    expect(output).toContain('flexGrow: 1');
    expect(output).toContain('flexBasis: "264px"');
    expect(output).toContain('gridTemplateColumns: "264px minmax(0, 1fr)"');
    expect(output).toContain('backgroundImage: "linear-gradient(135deg, #111820, #090d14)"');
    expect(output).toContain('borderStyle: "dashed"');
    expect(output).toContain('alignSelf: "flex-end"');
    expect(output).toContain('justifyContent: "space-evenly"');
    expect(output).toContain('position: "sticky"');
    expect(output).toContain('boxShadow: "0 12px 32px rgba(0,0,0,.18)"');
  });

  it('accepts the same rich style surface through the strict MCP operation schema', () => {
    const parsed = toolInputs.applyOperations.operations.parse([
      {
        kind: 'setStyle',
        nodeId: 'dashboard_grid',
        style: {
          display: 'grid',
          gridTemplateColumns: '264px minmax(0, 1fr)',
          gridTemplateRows: '77px minmax(0, 1fr)',
          rowGap: 18,
          columnGap: 20,
          backgroundImage: 'radial-gradient(circle at top, #172033, #090d14)',
          aspectRatio: '16 / 9',
          transform: 'translateZ(0)',
          backdropFilter: 'blur(12px)',
          visibility: 'visible',
        },
      },
    ]);

    expect(parsed[0]).toMatchObject({
      kind: 'setStyle',
      style: {
        gridTemplateColumns: '264px minmax(0, 1fr)',
        backdropFilter: 'blur(12px)',
      },
    });
  });

  it('omits undefined longhands so they cannot clear intentional CSS shorthands', () => {
    const css = stylePropertiesToCss({ gap: 16, overflow: 'hidden' });

    expect(css).toMatchObject({ gap: 16, overflow: 'hidden', boxSizing: 'border-box' });
    expect(css).not.toHaveProperty('rowGap');
    expect(css).not.toHaveProperty('columnGap');
    expect(css).not.toHaveProperty('overflowX');
    expect(css).not.toHaveProperty('overflowY');
  });
});
