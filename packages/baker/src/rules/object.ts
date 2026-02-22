import type { EmitContext, EmittableRule } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// isNotEmptyObject(options?) — 빈 객체가 아님 (최소 1개의 key)
// ─────────────────────────────────────────────────────────────────────────────

export interface IsNotEmptyObjectOptions {
  /** null/undefined 값을 가진 키를 무시할지 여부 (기본: false → 무시하지 않음) */
  nullable?: boolean;
}

export function isNotEmptyObject(options?: IsNotEmptyObjectOptions): EmittableRule {
  const fn = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value as object);
    if (options?.nullable) {
      return keys.some((k) => (value as Record<string, unknown>)[k] != null);
    }
    return keys.length > 0;
  };

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    if (options?.nullable) {
      const i = ctx.addRef(fn);
      return `if (!_refs[${i}](${varName})) ${ctx.fail('isNotEmptyObject')};`;
    }
    return `if (Object.keys(${varName}).length === 0) ${ctx.fail('isNotEmptyObject')};`;
  };
  (fn as any).ruleName = 'isNotEmptyObject';

  return fn as EmittableRule;
}

// ─────────────────────────────────────────────────────────────────────────────
// isInstance(targetType) — 특정 클래스 인스턴스인지 확인
// ─────────────────────────────────────────────────────────────────────────────

export function isInstance(targetType: new (...args: any[]) => any): EmittableRule {
  const fn = (value: unknown): boolean => value instanceof targetType;

  (fn as any).emit = (varName: string, ctx: EmitContext): string => {
    const i = ctx.addRef(targetType);
    return `if (!(${varName} instanceof _refs[${i}])) ${ctx.fail('isInstance')};`;
  };
  (fn as any).ruleName = 'isInstance';

  return fn as EmittableRule;
}
