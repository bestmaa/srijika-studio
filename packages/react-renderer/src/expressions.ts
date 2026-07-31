import type { ValueExpression } from '@sutra/contracts';

export interface EvaluationScope {
  symbols: Readonly<Record<string, unknown>>;
  registeredFunctions?: Readonly<Record<string, (...args: unknown[]) => unknown>>;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function primitiveString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function evaluateExpression(expression: ValueExpression, scope: EvaluationScope): unknown {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'reference':
      return readPath(scope.symbols[expression.symbolId], expression.path);
    case 'unary': {
      const operand = evaluateExpression(expression.operand, scope);
      return expression.operator === 'not' ? !operand : -Number(operand);
    }
    case 'binary': {
      const left = evaluateExpression(expression.left, scope);
      if (expression.operator === 'and')
        return Boolean(left) && Boolean(evaluateExpression(expression.right, scope));
      if (expression.operator === 'or')
        return Boolean(left) || Boolean(evaluateExpression(expression.right, scope));
      const right = evaluateExpression(expression.right, scope);
      switch (expression.operator) {
        case 'equals':
          return Object.is(left, right);
        case 'notEquals':
          return !Object.is(left, right);
        case 'greaterThan':
          return Number(left) > Number(right);
        case 'greaterThanOrEqual':
          return Number(left) >= Number(right);
        case 'lessThan':
          return Number(left) < Number(right);
        case 'lessThanOrEqual':
          return Number(left) <= Number(right);
        case 'add':
          return typeof left === 'string' || typeof right === 'string'
            ? `${primitiveString(left)}${primitiveString(right)}`
            : Number(left) + Number(right);
        case 'subtract':
          return Number(left) - Number(right);
        case 'multiply':
          return Number(left) * Number(right);
        case 'divide':
          return Number(left) / Number(right);
        default:
          throw new Error(`Unsupported binary operator: ${String(expression.operator)}`);
      }
    }
    case 'conditional':
      return evaluateExpression(expression.condition, scope)
        ? evaluateExpression(expression.whenTrue, scope)
        : evaluateExpression(expression.whenFalse, scope);
    case 'template':
      return expression.parts
        .map((part) =>
          typeof part === 'string' ? part : primitiveString(evaluateExpression(part, scope)),
        )
        .join('');
    case 'registeredCall': {
      const registeredFunction = scope.registeredFunctions?.[expression.functionId];
      if (!registeredFunction) return undefined;
      return registeredFunction(...expression.args.map((arg) => evaluateExpression(arg, scope)));
    }
    case 'customCodeReference':
      return undefined;
  }
}
