import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// arrayContains(values) — 배열이 지정한 모든 값을 포함
// ─────────────────────────────────────────────────────────────────────────────

export function arrayContains(values: unknown[]): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false;
    return values.every((v) => value.includes(v));
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(values);
    return `if (!_refs[${i}].every(function(v){return ${varName}.indexOf(v)!==-1;})) ${ctx.fail('arrayContains')};`;
  };
  (fn as any).ruleName = 'arrayContains';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// arrayNotContains(values) — 배열이 지정한 값을 포함하지 않음
// ─────────────────────────────────────────────────────────────────────────────

export function arrayNotContains(values: unknown[]): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false;
    return values.every((v) => !value.includes(v));
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(values);
    return `if (_refs[${i}].some(function(v){return ${varName}.indexOf(v)!==-1;})) ${ctx.fail('arrayNotContains')};`;
  };
  (fn as any).ruleName = 'arrayNotContains';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// arrayMinSize(min) — 배열 최소 길이
// ─────────────────────────────────────────────────────────────────────────────

export function arrayMinSize(min: number): EmittableRule {
  const fn = (value: unknown): boolean =>
    Array.isArray(value) && value.length >= min;

  (fn as any).emit = (varName: string, ctx: EmitContext): string =>
    `if (${varName}.length < ${min}) ${ctx.fail('arrayMinSize')};`;
  (fn as any).ruleName = 'arrayMinSize';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// arrayMaxSize(max) — 배열 최대 길이
// ─────────────────────────────────────────────────────────────────────────────

export function arrayMaxSize(max: number): EmittableRule {
  const fn = (value: unknown): boolean =>
    Array.isArray(value) && value.length <= max;

  (fn as any).emit = (varName: string, ctx: EmitContext): string =>
    `if (${varName}.length > ${max}) ${ctx.fail('arrayMaxSize')};`;
  (fn as any).ruleName = 'arrayMaxSize';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// arrayUnique(identifier?) — 배열 내 중복 없음
// ─────────────────────────────────────────────────────────────────────────────

export function arrayUnique(identifier?: (val: unknown) => unknown): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false;
    if (identifier) {
      const keys = value.map(identifier);
      return new Set(keys).size === keys.length;
    }
    return new Set(value).size === value.length;
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (identifier) {
      const i = ctx.addRef(identifier);
      return `{var _keys=${varName}.map(_refs[${i}]);if(new Set(_keys).size!==_keys.length)${ctx.fail('arrayUnique')};}`;
    }
    return `if(new Set(${varName}).size!==${varName}.length)${ctx.fail('arrayUnique')};`;
  };
  (fn as any).ruleName = 'arrayUnique';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// arrayNotEmpty — 배열이 비어있지 않음 (singleton)
// ─────────────────────────────────────────────────────────────────────────────

const _arrayNotEmpty = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0;

(_arrayNotEmpty as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (${varName}.length === 0) ${ctx.fail('arrayNotEmpty')};`;
(_arrayNotEmpty as any).ruleName = 'arrayNotEmpty';
export const arrayNotEmpty = _arrayNotEmpty as EmittableRule;
