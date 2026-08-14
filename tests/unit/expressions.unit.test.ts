import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import type { ValueExpression } from '@srijika/contracts';
import { evaluateExpression } from '@srijika/react-renderer';

const literal = (value: string | number | boolean | null): ValueExpression => ({
  kind: 'literal',
  value,
});

describe('expression evaluator', () => {
  it('reads safe nested symbol paths and returns undefined for missing paths', () => {
    const scope = { symbols: { user: { profile: { name: 'Ada' } } } };

    expect(
      evaluateExpression({ kind: 'reference', symbolId: 'user', path: ['profile', 'name'] }, scope),
    ).toBe('Ada');
    expect(
      evaluateExpression({ kind: 'reference', symbolId: 'user', path: ['missing', 'name'] }, scope),
    ).toBeUndefined();
  });

  it('evaluates typed unary, binary, conditional and template expressions', () => {
    const expression: ValueExpression = {
      kind: 'template',
      parts: [
        'Total: ',
        {
          kind: 'conditional',
          condition: {
            kind: 'binary',
            operator: 'greaterThan',
            left: literal(5),
            right: literal(2),
          },
          whenTrue: {
            kind: 'binary',
            operator: 'multiply',
            left: literal(6),
            right: literal(7),
          },
          whenFalse: literal(0),
        },
      ],
    };

    expect(evaluateExpression(expression, { symbols: {} })).toBe('Total: 42');
    expect(
      evaluateExpression(
        { kind: 'unary', operator: 'not', operand: literal(false) },
        { symbols: {} },
      ),
    ).toBe(true);
  });

  it('short-circuits boolean operators', () => {
    const readRight = vi.fn(() => true);
    const symbols = Object.defineProperty({}, 'right', {
      enumerable: true,
      get: readRight,
    }) as Record<string, unknown>;
    const right: ValueExpression = { kind: 'reference', symbolId: 'right', path: [] };

    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'and', left: literal(false), right },
        { symbols },
      ),
    ).toBe(false);
    expect(readRight).not.toHaveBeenCalled();

    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'or', left: literal(false), right },
        { symbols },
      ),
    ).toBe(true);
    expect(readRight).toHaveBeenCalledOnce();
  });

  it('short-circuits nullish coalescing while preserving operand values', () => {
    const readFallback = vi.fn(() => 'fallback');
    const symbols = Object.defineProperty({}, 'fallback', {
      enumerable: true,
      get: readFallback,
    }) as Record<string, unknown>;
    const fallback: ValueExpression = {
      kind: 'reference',
      symbolId: 'fallback',
      path: [],
    };

    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'coalesce', left: literal('primary'), right: fallback },
        { symbols },
      ),
    ).toBe('primary');
    expect(readFallback).not.toHaveBeenCalled();

    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'coalesce', left: literal(null), right: fallback },
        { symbols },
      ),
    ).toBe('fallback');
    expect(readFallback).toHaveBeenCalledOnce();
  });

  it('keeps custom code references inert at runtime', () => {
    expect(
      evaluateExpression(
        {
          kind: 'customCodeReference',
          moduleId: 'custom_module',
          exportName: 'run',
          args: [],
        },
        { symbols: {} },
      ),
    ).toBeUndefined();
  });

  it.each([
    ['equals', 2, 2, true],
    ['notEquals', 2, 3, true],
    ['greaterThan', 3, 2, true],
    ['greaterThanOrEqual', 3, 3, true],
    ['lessThan', 2, 3, true],
    ['lessThanOrEqual', 3, 3, true],
    ['subtract', 8, 3, 5],
    ['multiply', 6, 7, 42],
    ['divide', 84, 2, 42],
  ] as const)('evaluates the %s binary operator', (operator, left, right, expected) => {
    const expression = {
      kind: 'binary',
      operator,
      left: literal(left),
      right: literal(right),
    } satisfies ValueExpression;

    expect(evaluateExpression(expression, { symbols: {} })).toBe(expected);
  });

  it('supports string addition and numeric negation', () => {
    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'add', left: literal('Srijika '), right: literal('Studio') },
        { symbols: {} },
      ),
    ).toBe('Srijika Studio');
    expect(
      evaluateExpression(
        { kind: 'unary', operator: 'negate', operand: literal(42) },
        { symbols: {} },
      ),
    ).toBe(-42);
  });

  it('preserves arithmetic laws across generated integer inputs', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (left, right) => {
        const result = evaluateExpression(
          {
            kind: 'binary',
            operator: 'add',
            left: literal(left),
            right: literal(right),
          },
          { symbols: {} },
        );
        expect(result).toBe(left + right);
      }),
      { numRuns: 200 },
    );
  });
});
