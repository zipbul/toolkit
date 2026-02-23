import { collectValidation } from '../collect';
import { isNotEmptyObject, isInstance } from '../rules/object';
import type { IsNotEmptyObjectOptions } from '../rules/object';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Object Decorators (§1.1 Object)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 빈 객체가 아님 (최소 1개의 key).
 * nullable: true이면 null/undefined 값을 가진 키를 무시.
 */
export function IsNotEmptyObject(objectOptions?: IsNotEmptyObjectOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isNotEmptyObject(objectOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** value instanceof targetType */
export function IsInstance(targetType: new (...args: any[]) => any, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isInstance(targetType),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
