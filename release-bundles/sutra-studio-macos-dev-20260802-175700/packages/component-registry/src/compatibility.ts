import type { EventSignature, LiteralValue, ValueShape, ValueType } from '@sutra/contracts';

export function isTypeAssignable(source: ValueType, target: ValueType): boolean {
  if (target === 'unknown' || source === target) return true;
  if (source === 'color' && target === 'string') return true;
  return false;
}

export function isValueShapeAssignable(source: ValueShape, target: ValueShape): boolean {
  if (target.kind === 'unknown') return true;
  if (source.kind === 'color' && target.kind === 'string') return true;
  if (source.kind !== target.kind) return false;

  if (source.kind === 'array' && target.kind === 'array') {
    return isValueShapeAssignable(source.item, target.item);
  }
  if (source.kind === 'object' && target.kind === 'object') {
    return Object.entries(target.fields).every(([name, targetField]) => {
      const sourceField = source.fields[name];
      if (!sourceField) return !targetField.required;
      if (targetField.required && !sourceField.required) return false;
      return isValueShapeAssignable(sourceField.shape, targetField.shape);
    });
  }
  return true;
}

/** Returns whether a JSON literal can be used where the declared shape is expected. */
export function literalMatchesValueShape(value: LiteralValue, target: ValueShape): boolean {
  switch (target.kind) {
    case 'unknown':
      return true;
    case 'string':
    case 'color':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return (
        Array.isArray(value) && value.every((item) => literalMatchesValueShape(item, target.item))
      );
    case 'object': {
      if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
      if (
        !target.additionalProperties &&
        Object.keys(value).some((name) => !Object.hasOwn(target.fields, name))
      ) {
        return false;
      }
      return Object.entries(target.fields).every(([name, field]) => {
        if (!Object.hasOwn(value, name)) return !field.required;
        const fieldValue = (value as Record<string, LiteralValue>)[name];
        return fieldValue !== undefined && literalMatchesValueShape(fieldValue, field.shape);
      });
    }
  }
}

function coarseShape(valueType: ValueType): ValueShape | undefined {
  switch (valueType) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'color':
    case 'unknown':
      return { kind: valueType };
    case 'array':
      return { kind: 'array', item: { kind: 'unknown' } };
    case 'object':
      return { kind: 'object', fields: {}, additionalProperties: true };
    case 'event':
      return undefined;
  }
}

/** Shared rule used by the analyzer and Inspector when offering page-prop arguments. */
export function isValueDeclarationAssignableToShape(
  valueType: ValueType,
  valueShape: ValueShape | undefined,
  target: ValueShape,
): boolean {
  if (valueType === 'event') return false;
  if (target.kind === 'unknown') return true;
  const source = valueShape ?? coarseShape(valueType);
  return source !== undefined && isValueShapeAssignable(source, target);
}

export function isEventSignatureAssignable(
  source: EventSignature,
  receiver: EventSignature,
): boolean {
  if (receiver.payload === null) return true;
  if (source.payload === null) return false;
  return isValueShapeAssignable(source.payload.shape, receiver.payload.shape);
}
