import type { ValueType } from '@sutra/contracts';

export function isTypeAssignable(source: ValueType, target: ValueType): boolean {
  if (target === 'unknown' || source === target) return true;
  if (source === 'color' && target === 'string') return true;
  return false;
}
