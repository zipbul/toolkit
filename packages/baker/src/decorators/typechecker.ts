import { collectValidation } from '../collect';
import { isString, isNumber, isBoolean, isDate, isEnum, isInt, isArray, isObject } from '../rules/typechecker';
import type { IsNumberOptions } from '../rules/typechecker';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Type Checker Decorators (§1.1 Type Checkers)
// ─────────────────────────────────────────────────────────────────────────────

/** typeof value === 'string' */
export function IsString(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isString,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** typeof value === 'number' + NaN/Infinity/maxDecimalPlaces 옵션 */
export function IsNumber(numberOptions?: IsNumberOptions, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isNumber(numberOptions),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** typeof value === 'boolean' */
export function IsBoolean(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isBoolean,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** value instanceof Date && !isNaN(getTime()) */
export function IsDate(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isDate,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** Object.values(entity).indexOf(value) !== -1 */
export function IsEnum(entity: object, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isEnum(entity),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** typeof value === 'number' && Number.isInteger(value) */
export function IsInt(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isInt,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** Array.isArray(value) */
export function IsArray(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isArray,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** typeof value === 'object' && value !== null && !Array.isArray(value) */
export function IsObject(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isObject,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
