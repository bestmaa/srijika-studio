import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';

import type { ValueExpression } from '@sutra/contracts';
import { evaluateExpression } from '@sutra/react-renderer';

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
    const right = vi.fn(() => true);
    const registeredCall: ValueExpression = {
      kind: 'registeredCall',
      functionId: 'right',
      args: [],
    };

    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'and', left: literal(false), right: registeredCall },
        { symbols: {}, registeredFunctions: { right } },
      ),
    ).toBe(false);
    expect(right).not.toHaveBeenCalled();

    expect(
      evaluateExpression(
        { kind: 'binary', operator: 'or', left: literal(false), right: registeredCall },
        { symbols: {}, registeredFunctions: { right } },
      ),
    ).toBe(true);
    expect(right).toHaveBeenCalledOnce();
  });

  it('keeps registered calls allowlisted and custom code inert at runtime', () => {
    const add = vi.fn((left: unknown, right: unknown) => Number(left) + Number(right));
    const expression: ValueExpression = {
      kind: 'registeredCall',
      functionId: 'add',
      args: [literal(20), literal(22)],
    };

    expect(evaluateExpression(expression, { symbols: {}, registeredFunctions: { add } })).toBe(42);
    expect(evaluateExpression(expression, { symbols: {} })).toBeUndefined();
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
        { kind: 'binary', operator: 'add', left: literal('Sutra '), right: literal('Studio') },
        { symbols: {} },
      ),
    ).toBe('Sutra Studio');
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
