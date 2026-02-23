import { collectValidation } from '../collect';
import { minDate, maxDate } from '../rules/date';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Date Decorators (§1.1 Date)
// ─────────────────────────────────────────────────────────────────────────────

/** value >= date (inclusive, getTime 비교) */
export function MinDate(date: Date, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: minDate(date),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** value <= date (inclusive, getTime 비교) */
export function MaxDate(date: Date, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: maxDate(date),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
