import { collectValidation, ensureMeta } from '../collect';
import { equals, notEquals, isEmpty, isNotEmpty, isIn, isNotIn } from '../rules/common';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Flag-based decorators — flags에 직접 저장 (§3.2, §2.1 PropertyFlags)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * undefined/null 불허. groups를 무시하고 항상 적용.
 * @IsDefined와 @IsOptional 동시 선언 시 @IsDefined 우선 (optional 가드 생략).
 */
export function IsDefined(_options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta((target as any).constructor, key as string);
    meta.flags.isDefined = true;
  };
}

/**
 * undefined/null 허용 — 해당 필드의 전체 validation을 skip.
 * @IsDefined와 동시 선언 시 @IsDefined 우선.
 */
export function IsOptional(_options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta((target as any).constructor, key as string);
    meta.flags.isOptional = true;
  };
}

/**
 * 조건이 false일 때 해당 필드의 전체 검증을 skip.
 * 조건 함수는 원본 input 객체를 인자로 받는다.
 */
export function ValidateIf(condition: (obj: any) => boolean): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta((target as any).constructor, key as string);
    meta.flags.validateIf = condition;
  };
}

/**
 * 중첩 DTO 재귀 검증 트리거. @Type과 함께 사용해야 한다.
 * builder 트리거 조건: meta.type !== null && meta.flags.validateNested === true
 */
export function ValidateNested(_options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta((target as any).constructor, key as string);
    meta.flags.validateNested = true;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule-based decorators — collectValidation으로 등록 (§3.2)
// ─────────────────────────────────────────────────────────────────────────────

/** value === comparison (strict equality) */
export function Equals(comparison: unknown, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: equals(comparison),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** value !== comparison (strict inequality) */
export function NotEquals(comparison: unknown, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: notEquals(comparison),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** value === undefined | null | '' */
export function IsEmpty(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isEmpty,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** value !== undefined && value !== null && value !== '' */
export function IsNotEmpty(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isNotEmpty,
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** array.indexOf(value) !== -1 */
export function IsIn(array: readonly unknown[], options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isIn(array as unknown[]),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** array.indexOf(value) === -1 */
export function IsNotIn(array: readonly unknown[], options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isNotIn(array as unknown[]),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
