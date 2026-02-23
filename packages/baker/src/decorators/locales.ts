import { collectValidation } from '../collect';
import {
  isMobilePhone,
  isPostalCode,
  isIdentityCard,
  isPassportNumber,
} from '../rules/locales';
import type { ValidationOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Locale Decorators (§1.1 Phase 6)
// ─────────────────────────────────────────────────────────────────────────────

/** 로케일별 모바일 전화번호 */
export function IsMobilePhone(locale: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isMobilePhone(locale),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 로케일별 우편번호 */
export function IsPostalCode(locale: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isPostalCode(locale),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 로케일별 신분증 번호 */
export function IsIdentityCard(locale: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isIdentityCard(locale),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}

/** 로케일별 여권 번호 */
export function IsPassportNumber(locale: string, options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target as object, key as string, {
      rule: isPassportNumber(locale),
      each: options?.each,
      groups: options?.groups,
      message: options?.message,
      context: options?.context,
    });
  };
}
