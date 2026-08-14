import { compileSrijikaTsx } from '@srijika/tsx-compiler';
import { describe, expect, it } from 'vitest';

import { extractCssClassNames, srijikaJsxCompletions } from '../src/completion-model';

const source = `export interface CardUIProps {
  title: string;
  onOpen: () => void;
}

export function CardUI(props: CardUIProps) {
  return <div className="card" >{props.title}</div>;
}
`;

describe('Srijika JSX completions', () => {
  it('discovers stable project class names from authored CSS selectors', () => {
    expect(
      extractCssClassNames(`
        .hero__copy, .button--primary:hover { color: white; }
        @media (width < 720px) { .hero__copy { display: block; } }
      `),
    ).toEqual(['button--primary', 'hero__copy']);
  });

  it('offers supported props and typed event bindings inside an intrinsic opening tag', () => {
    const contract = compileSrijikaTsx('Card.ui.tsx', source).componentContract;
    const offset = source.indexOf('>{props.title}');
    const completions = srijikaJsxCompletions(source, offset, contract);

    expect(completions).toContainEqual(
      expect.objectContaining({
        label: 'onClick → props.onOpen',
        insertText: 'onClick={props.onOpen}',
        kind: 'event',
      }),
    );
    expect(completions).toContainEqual(
      expect.objectContaining({ label: 'id', insertText: 'id="${1}"', kind: 'prop' }),
    );
    expect(completions.some(({ label }) => label === 'className')).toBe(false);
  });

  it('offers a callback-prop snippet when the contract has no event yet', () => {
    const minimal = 'export function CardUI() { return <button >Open</button>; }';
    const offset = minimal.indexOf('>Open');
    const completions = srijikaJsxCompletions(minimal, offset, []);

    expect(completions).toContainEqual(
      expect.objectContaining({
        label: 'onClick',
        insertText: 'onClick={props.${1:onClick}}',
      }),
    );
  });

  it('does not offer JSX attributes outside an opening tag', () => {
    expect(srijikaJsxCompletions(source, source.indexOf('props.title'), [])).toEqual([]);
  });

  it('offers only compiler-supported HTML elements while typing a JSX tag', () => {
    const tagSource = 'export function CardUI() { return <se; }';
    const completions = srijikaJsxCompletions(tagSource, tagSource.indexOf(';'), []);

    expect(completions).toContainEqual(
      expect.objectContaining({
        label: 'section',
        insertText: 'section>${1}</section>',
        kind: 'tag',
      }),
    );
    expect(completions.some(({ label }) => label === 'select')).toBe(false);
  });

  it('offers project CSS classes inside className and replaces only the current class token', () => {
    const classSource =
      'export function CardUI() { return <div className="shell hero__">x</div>; }';
    const offset = classSource.indexOf('hero__') + 'hero__'.length;
    const completions = srijikaJsxCompletions(
      classSource,
      offset,
      [],
      ['shell', 'hero__copy', 'hero__visual', 'other'],
    );

    expect(completions).toEqual([
      expect.objectContaining({
        label: 'hero__copy',
        insertText: 'hero__copy',
        kind: 'css-class',
        replacementStart: offset - 'hero__'.length,
      }),
      expect.objectContaining({ label: 'hero__visual' }),
    ]);
  });
});
