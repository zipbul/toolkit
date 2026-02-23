import { collectValidation } from '../collect';
import {
  arrayContains, arrayNotContains, arrayMinSize, arrayMaxSize,
  arrayUnique, arrayNotEmpty,
} from '../rules/array';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Array Decorators (§1.1 Array)
// ─────────────────────────────────────────────────────────────────────────────

/** 배열이 지정한 모든 값을 포함 */
export function ArrayContains(values: unknown[], options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: arrayContains(values),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 배열이 지정한 값을 포함하지 않음 */
export function ArrayNotContains(values: unknown[], options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: arrayNotContains(values),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 배열 최소 길이 */
export function ArrayMinSize(min: number, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: arrayMinSize(min),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 배열 최대 길이 */
export function ArrayMaxSize(max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: arrayMaxSize(max),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 배열에 중복 값 없음 */
export function ArrayUnique(identifier?: (o: unknown) => unknown, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: arrayUnique(identifier),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 배열이 비어있지 않음 */
export function ArrayNotEmpty(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: arrayNotEmpty,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
