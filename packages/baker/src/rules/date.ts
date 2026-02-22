import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// minDate — v >= date (inclusive, getTime 비교). (§4.8 C — refs 함수 호출)
// ─────────────────────────────────────────────────────────────────────────────

export function minDate(date: Date): EmittableRule {
  const timestamp = date.getTime();

  const fn = (value: unknown): boolean =>
    value instanceof Date && value.getTime() >= timestamp;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(timestamp);
    return `if (!(${varName} instanceof Date) || ${varName}.getTime() < _refs[${i}]) ${ctx.fail('minDate')};`;
  };

  (fn as any).ruleName = 'minDate';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// maxDate — v <= date (inclusive, getTime 비교). (§4.8 C — refs 함수 호출)
// ─────────────────────────────────────────────────────────────────────────────

export function maxDate(date: Date): EmittableRule {
  const timestamp = date.getTime();

  const fn = (value: unknown): boolean =>
    value instanceof Date && value.getTime() <= timestamp;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(timestamp);
    return `if (!(${varName} instanceof Date) || ${varName}.getTime() > _refs[${i}]) ${ctx.fail('maxDate')};`;
  };

  (fn as any).ruleName = 'maxDate';

  return fn as EmittableRule;
}
