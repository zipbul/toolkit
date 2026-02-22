import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import { isNotEmptyObject, isInstance } from './object';

function makeCtx(refIndex: number = 0) {
  const addRefMock = mock((fn: Function) => refIndex++);
  const addRegexMock = mock((re: RegExp) => refIndex++);
  const failMock = mock((code: string) => `throw new Error('${code}')`);
  const ctx: EmitContext = {
    addRegex: addRegexMock,
    addRef: addRefMock,
    addExecutor: mock(() => 0),
    fail: failMock,
    collectErrors: false,
  };
  return { ctx, addRefMock, addRegexMock, failMock };
}

// ─── isNotEmptyObject ─────────────────────────────────────────────────────────

describe('isNotEmptyObject', () => {
  it('should return true when object has at least one key', () => {
    expect(isNotEmptyObject()({ a: 1 })).toBe(true);
  });

  it('should return true when object has multiple keys', () => {
    expect(isNotEmptyObject()({ a: 1, b: 2, c: 3 })).toBe(true);
  });

  it('should return false for empty object', () => {
    expect(isNotEmptyObject()({})).toBe(false);
  });

  it('should return false for null', () => {
    expect(isNotEmptyObject()(null)).toBe(false);
  });

  it('should return false for array (not a plain object)', () => {
    expect(isNotEmptyObject()(['a', 'b'])).toBe(false);
  });

  it('should return false for non-object primitives', () => {
    expect(isNotEmptyObject()('string')).toBe(false);
    expect(isNotEmptyObject()(42)).toBe(false);
  });

  it('should generate Object.keys check code when calling emit() and have ruleName isNotEmptyObject', () => {
    const { ctx, failMock } = makeCtx(0);
    const code = isNotEmptyObject().emit('_v', ctx);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isNotEmptyObject');
    expect(isNotEmptyObject().ruleName).toBe('isNotEmptyObject');
  });

  it('should treat object with null-valued key as non-empty by default', () => {
    expect(isNotEmptyObject()({ a: null })).toBe(true);
  });
});

// ─── isInstance ───────────────────────────────────────────────────────────────

describe('isInstance', () => {
  it('should return true when value is an instance of the target class (Date)', () => {
    expect(isInstance(Date)(new Date())).toBe(true);
  });

  it('should return true when value is an instance of the target class (Map)', () => {
    expect(isInstance(Map)(new Map())).toBe(true);
  });

  it('should return false when value is an instance of a different class', () => {
    expect(isInstance(Date)(new Map())).toBe(false);
  });

  it('should return false for null', () => {
    expect(isInstance(Date)(null)).toBe(false);
  });

  it('should return false for primitive string', () => {
    expect(isInstance(Date)('2024-01-01')).toBe(false);
  });

  it('should call ctx.addRef with the target class and generate instanceof check code when calling emit()', () => {
    const { ctx, addRefMock, failMock } = makeCtx(0);
    const code = isInstance(Date).emit('_v', ctx);
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(addRefMock).toHaveBeenCalledWith(Date);
    expect(code).toBeTruthy();
    expect(failMock).toHaveBeenCalledWith('isInstance');
    expect(isInstance(Date).ruleName).toBe('isInstance');
  });
});
