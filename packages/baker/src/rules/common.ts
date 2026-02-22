import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// equals — strict equality (===). refs로 비교값 전달 (§4.8 C)
// ─────────────────────────────────────────────────────────────────────────────

export function equals(comparison: unknown): EmittableRule {
  const fn = (value: unknown): boolean => value === comparison;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(comparison);
    return `if (${varName} !== _refs[${i}]) ${ctx.fail('equals')};`;
  };

  (fn as any).ruleName = 'equals';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// notEquals — strict inequality (!==). refs로 비교값 전달
// ─────────────────────────────────────────────────────────────────────────────

export function notEquals(comparison: unknown): EmittableRule {
  const fn = (value: unknown): boolean => value !== comparison;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(comparison);
    return `if (${varName} === _refs[${i}]) ${ctx.fail('notEquals')};`;
  };

  (fn as any).ruleName = 'notEquals';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// isEmpty — undefined | null | '' 만 empty로 취급 (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

const _isEmpty = (value: unknown): boolean =>
  value === undefined || value === null || value === '';

(_isEmpty as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (${varName} !== undefined && ${varName} !== null && ${varName} !== '') ${ctx.fail('isEmpty')};`;

(_isEmpty as any).ruleName = 'isEmpty';

export const isEmpty = _isEmpty as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isNotEmpty — undefined | null | '' 이외의 값 (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

const _isNotEmpty = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';

(_isNotEmpty as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (${varName} === undefined || ${varName} === null || ${varName} === '') ${ctx.fail('isNotEmpty')};`;

(_isNotEmpty as any).ruleName = 'isNotEmpty';

export const isNotEmpty = _isNotEmpty as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isIn — 배열 내 포함 여부. refs로 배열 전달 (§4.8 C)
// ─────────────────────────────────────────────────────────────────────────────

export function isIn(array: unknown[]): EmittableRule {
  const fn = (value: unknown): boolean => array.indexOf(value) !== -1;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(array);
    return `if (_refs[${i}].indexOf(${varName}) === -1) ${ctx.fail('isIn')};`;
  };

  (fn as any).ruleName = 'isIn';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// isNotIn — 배열 외 여부. refs로 배열 전달 (§4.8 C)
// ─────────────────────────────────────────────────────────────────────────────

export function isNotIn(array: unknown[]): EmittableRule {
  const fn = (value: unknown): boolean => array.indexOf(value) === -1;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(array);
    return `if (_refs[${i}].indexOf(${varName}) !== -1) ${ctx.fail('isNotIn')};`;
  };

  (fn as any).ruleName = 'isNotIn';

  return fn as EmittableRule;
}
