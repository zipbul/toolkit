import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// isString — typeof 체크 (§4.8 A: 연산자 인라인)
// ─────────────────────────────────────────────────────────────────────────────

const _isString = (value: unknown): boolean => typeof value === 'string';

(_isString as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (typeof ${varName} !== 'string') ${ctx.fail('isString')};`;

(_isString as any).ruleName = 'isString';
// requiresType은 undefined — 자체 typeof 포함 (§4.7)

export const isString = _isString as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isNumber — typeof + NaN/Infinity/maxDecimalPlaces 옵션 (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

export interface IsNumberOptions {
  allowNaN?: boolean;
  allowInfinity?: boolean;
  maxDecimalPlaces?: number;
}

export function isNumber(options?: IsNumberOptions): EmittableRule {
  const allowNaN = options?.allowNaN ?? false;
  const allowInfinity = options?.allowInfinity ?? false;
  const maxDecimalPlaces = options?.maxDecimalPlaces;

  const fn = (value: unknown): boolean => {
    if (typeof value !== 'number') return false;
    // NaN 먼저 체크 — isFinite(NaN)도 false이므로 순서가 중요
    if (isNaN(value)) return allowNaN;
    // NaN이 아닌 비유한수 (Infinity / -Infinity)
    if (!isFinite(value)) return allowInfinity;
    if (maxDecimalPlaces !== undefined) {
      const str = value.toString();
      const dotIdx = str.indexOf('.');
      if (dotIdx !== -1 && str.length - dotIdx - 1 > maxDecimalPlaces) return false;
    }
    return true;
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    let code = `if (typeof ${varName} !== 'number') ${ctx.fail('isNumber')};`;
    if (!allowNaN) {
      code += `\nelse if (isNaN(${varName})) ${ctx.fail('isNumber')};`;
    }
    if (!allowInfinity) {
      // !isFinite 대신 명시적 Infinity 체크 — isNaN(NaN)=false지만 !isFinite(NaN)=true이므로 분리 필요
      code += `\nelse if (${varName} === Infinity || ${varName} === -Infinity) ${ctx.fail('isNumber')};`;
    }
    if (maxDecimalPlaces !== undefined) {
      code += `\nelse { var _s=${varName}.toString(); var _d=_s.indexOf('.'); if(_d!==-1&&_s.length-_d-1>${maxDecimalPlaces}) ${ctx.fail('isNumber')}; }`;
    }
    return code;
  };

  (fn as any).ruleName = 'isNumber';
  // requiresType은 undefined — 자체 typeof 포함

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// isBoolean — typeof 체크 (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

const _isBoolean = (value: unknown): boolean => typeof value === 'boolean';

(_isBoolean as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (typeof ${varName} !== 'boolean') ${ctx.fail('isBoolean')};`;

(_isBoolean as any).ruleName = 'isBoolean';

export const isBoolean = _isBoolean as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isDate — instanceof Date + getTime() NaN 체크 (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

const _isDate = (value: unknown): boolean =>
  value instanceof Date && !isNaN((value as Date).getTime());

(_isDate as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (!(${varName} instanceof Date) || isNaN(${varName}.getTime())) ${ctx.fail('isDate')};`;

(_isDate as any).ruleName = 'isDate';

export const isDate = _isDate as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isEnum — factory: Object.values 배열로 indexOf 검사 (§4.8 C)
// ─────────────────────────────────────────────────────────────────────────────

export function isEnum(entity: object): EmittableRule {
  const values = Object.values(entity);

  const fn = (value: unknown): boolean => values.indexOf(value) !== -1;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(values);
    return `if (_refs[${i}].indexOf(${varName}) === -1) ${ctx.fail('isEnum')};`;
  };

  (fn as any).ruleName = 'isEnum';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// isInt — typeof + Number.isInteger 체크 (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

const _isInt = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value);

(_isInt as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (typeof ${varName} !== 'number' || !Number.isInteger(${varName})) ${ctx.fail('isInt')};`;

(_isInt as any).ruleName = 'isInt';

export const isInt = _isInt as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isArray — Array.isArray 체크 (§4.8 A: 연산자 인라인)
// ─────────────────────────────────────────────────────────────────────────────

const _isArray = (value: unknown): boolean => Array.isArray(value);

(_isArray as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (!Array.isArray(${varName})) ${ctx.fail('isArray')};`;

(_isArray as any).ruleName = 'isArray';
// requiresType은 undefined — 자체 Array.isArray 체크 포함

export const isArray = _isArray as EmittableRule;

// ─────────────────────────────────────────────────────────────────────────────
// isObject — typeof object + non-null + non-array (§4.8 A)
// ─────────────────────────────────────────────────────────────────────────────

const _isObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

(_isObject as any).emit = (varName: string, ctx: EmitContext): string =>
  `if (typeof ${varName} !== 'object' || ${varName} === null || Array.isArray(${varName})) ${ctx.fail('isObject')};`;

(_isObject as any).ruleName = 'isObject';
// requiresType은 undefined — 자체 typeof + null + Array.isArray 체크 포함

export const isObject = _isObject as EmittableRule;
