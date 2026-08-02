import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { assertDocumentSemantics } from '@sutra/component-registry';
import { validateUiDocument } from '@sutra/contracts';
import { generateTsx } from '@sutra/react-codegen';

import { PreviewApp } from '../../apps/studio/src/app/PreviewApp';
import { componentRegistry } from '../../apps/studio/src/lib/registry';
import { createStarterDocument } from '../../apps/studio/src/lib/starter';

describe('direct typed prop and dynamic style demo', () => {
  it('builds a valid starter AST with direct declared prop bindings', () => {
    const document = createStarterDocument('page_props_demo', 'Props Demo');

    expect(validateUiDocument(document).valid).toBe(true);
    expect(() => assertDocumentSemantics(document, componentRegistry)).not.toThrow();
    expect(document.publicProps['priceLabel']).toMatchObject({
      symbolId: 'prop_price_label',
      valueType: 'string',
      defaultValue: '₹499.00',
    });
    expect(document.symbols['prop_price_label']).toMatchObject({
      provider: 'prop',
      name: 'priceLabel',
      valueType: 'string',
      defaultValue: '₹499.00',
    });
    expect(document.publicProps['cardStyle']).toMatchObject({
      symbolId: 'prop_card_style',
      valueType: 'object',
      defaultValue: {
        backgroundColor: '#fff7ed',
        borderColor: '#f97316',
        borderWidth: 2,
      },
    });

    const priceLabelHeading = document.nodes['price_label'];
    if (!priceLabelHeading || priceLabelHeading.kind !== 'element') {
      throw new Error('Expected the Price Label Heading');
    }
    expect(priceLabelHeading.name).toBe('Price Label Heading');
    expect(priceLabelHeading.props['text']).toEqual({
      kind: 'reference',
      symbolId: 'prop_price_label',
      path: [],
    });

    const hero = document.nodes['hero'];
    if (!hero || hero.kind !== 'element') throw new Error('Expected the Hero Container');
    expect(hero.props['style']).toEqual({
      kind: 'reference',
      symbolId: 'prop_card_style',
      path: [],
    });

    const jsx = generateTsx(document);
    expect(jsx).toContain("import { sutraStyle } from '@sutra/react-renderer';");
    expect(jsx).toContain('{(props.priceLabel ?? "₹499.00")}');
    expect(jsx).toContain('...sutraStyle((props.cardStyle ?? {');
    expect(jsx).not.toContain('const sutraStyle');
    expect(jsx).not.toContain("from './runtime-functions'");
    expect(jsx).not.toContain('formatPrice');
  });

  it('renders direct prop defaults and declared dynamic style in the actual preview app', () => {
    const { container } = render(<PreviewApp />);

    expect(
      screen.getByRole('heading', { name: 'Build applications visually' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '₹499.00' })).toBeInTheDocument();

    const hero = container.querySelector<HTMLElement>('.preview-document main > div');
    if (!hero) throw new Error('Expected the rendered Hero Container');
    expect(hero).toHaveStyle({
      backgroundColor: '#fff7ed',
      borderColor: '#f97316',
      borderWidth: '2px',
      boxShadow: '0 14px 30px rgba(249, 115, 22, 0.12)',
    });
  });
});
