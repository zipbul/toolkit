import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import {
  equals,
  notEquals,
  isEmpty,
  isNotEmpty,
  isIn,
  isNotIn,
} from './common';

function makeCtx(refIndex: number = 0) {
  const addRefMock = mock((_fn: unknown) => refIndex);
  const failMock = mock((code: string) => `_errors.push({path:'x',code:'${code}'})`);
  const ctx: Partial<EmitContext> = {
    addRegex: mock((_re: RegExp) => 0),
    addRef: addRefMock,
    addExecutor: mock(() => 0),
    fail: failMock,
    collectErrors: true,
  };
  return { ctx: ctx as EmitContext, addRefMock, failMock };
}

// ─── equals ───────────────────────────────────────────────────────────────────

describe('equals', () => {
  it('should return true when value equals the same number', () => {
    // Arrange
    const rule = equals(5);
    // Act / Assert
    expect(rule(5)).toBe(true);
  });

  it('should return true when value equals the same string', () => {
    // Arrange
    const rule = equals('hello');
    // Act / Assert
    expect(rule('hello')).toBe(true);
  });

  it('should return true when value is null and comparison is null', () => {
    // Arrange
    const rule = equals(null);
    // Act / Assert
    expect(rule(null)).toBe(true);
  });

  it('should return false when value differs from comparison number', () => {
    // Arrange
    const rule = equals(5);
    // Act / Assert
    expect(rule(6)).toBe(false);
  });

  it('should return false when value is NaN and comparison is NaN', () => {
    // Arrange
    const rule = equals(NaN);
    // Act / Assert
    expect(rule(NaN)).toBe(false);
  });

  it('should call ctx.addRef and generate _refs[i] !== v check code when calling emit()', () => {
    // Arrange
    const rule = equals(5);
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(code).toContain('!==');
    expect(failMock).toHaveBeenCalledWith('equals');
  });

  it('should have ruleName equals', () => {
    // Arrange
    const rule = equals(5);
    // Act / Assert
    expect(rule.ruleName).toBe('equals');
  });
});

// ─── notEquals ────────────────────────────────────────────────────────────────

describe('notEquals', () => {
  it('should return true when value differs from comparison', () => {
    // Arrange
    const rule = notEquals(5);
    // Act / Assert
    expect(rule(6)).toBe(true);
  });

  it('should return false when value is the same as comparison', () => {
    // Arrange
    const rule = notEquals(5);
    // Act / Assert
    expect(rule(5)).toBe(false);
  });

  it('should call ctx.addRef and generate _refs[i] === v check code when calling emit()', () => {
    // Arrange
    const rule = notEquals(5);
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(code).toContain('===');
    expect(failMock).toHaveBeenCalledWith('notEquals');
  });

  it('should have ruleName notEquals', () => {
    // Arrange
    const rule = notEquals(5);
    // Act / Assert
    expect(rule.ruleName).toBe('notEquals');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    // Arrange / Act
    const rule1 = notEquals(5);
    const rule2 = notEquals(5);
    // Assert
    expect(rule1).not.toBe(rule2);
  });
});

// ─── isEmpty ──────────────────────────────────────────────────────────────────

describe('isEmpty', () => {
  it('should return true when value is undefined', () => {
    // Arrange / Act / Assert
    expect(isEmpty(undefined)).toBe(true);
  });

  it('should return true when value is null', () => {
    // Arrange / Act / Assert
    expect(isEmpty(null)).toBe(true);
  });

  it('should return true when value is an empty string', () => {
    // Arrange / Act / Assert
    expect(isEmpty('')).toBe(true);
  });

  it('should return false when value is a non-empty string', () => {
    // Arrange / Act / Assert
    expect(isEmpty('hello')).toBe(false);
  });

  it('should return false when value is number 0', () => {
    // Arrange / Act / Assert
    expect(isEmpty(0)).toBe(false);
  });

  it('should return false when value is boolean false', () => {
    // Arrange / Act / Assert
    expect(isEmpty(false)).toBe(false);
  });

  it('should generate isEmpty check code when calling emit() and have ruleName isEmpty', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isEmpty.emit('_v', ctx);
    // Assert
    expect(code).toContain('undefined');
    expect(code).toContain('null');
    expect(code).toContain("''");
    expect(failMock).toHaveBeenCalledWith('isEmpty');
    expect(isEmpty.ruleName).toBe('isEmpty');
  });
});

// ─── isNotEmpty ───────────────────────────────────────────────────────────────

describe('isNotEmpty', () => {
  it('should return true when value is a non-empty string', () => {
    // Arrange / Act / Assert
    expect(isNotEmpty('hello')).toBe(true);
  });

  it('should return true when value is number 0', () => {
    // Arrange / Act / Assert
    expect(isNotEmpty(0)).toBe(true);
  });

  it('should return false when value is undefined', () => {
    // Arrange / Act / Assert
    expect(isNotEmpty(undefined)).toBe(false);
  });

  it('should return false when value is null', () => {
    // Arrange / Act / Assert
    expect(isNotEmpty(null)).toBe(false);
  });

  it('should return false when value is an empty string', () => {
    // Arrange / Act / Assert
    expect(isNotEmpty('')).toBe(false);
  });

  it('should generate isNotEmpty check code when calling emit() and have ruleName isNotEmpty', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isNotEmpty.emit('_v', ctx);
    // Assert
    expect(code).toContain('undefined');
    expect(code).toContain('null');
    expect(code).toContain("''");
    expect(failMock).toHaveBeenCalledWith('isNotEmpty');
    expect(isNotEmpty.ruleName).toBe('isNotEmpty');
  });
});

// ─── isIn ─────────────────────────────────────────────────────────────────────

describe('isIn', () => {
  it('should return true when value is in the array', () => {
    // Arrange
    const rule = isIn([1, 2, 3]);
    // Act / Assert
    expect(rule(2)).toBe(true);
  });

  it('should return false when value is not in the array', () => {
    // Arrange
    const rule = isIn([1, 2, 3]);
    // Act / Assert
    expect(rule(4)).toBe(false);
  });

  it('should return false when array is empty', () => {
    // Arrange
    const rule = isIn([]);
    // Act / Assert
    expect(rule(1)).toBe(false);
  });

  it('should call ctx.addRef and generate indexOf === -1 check code when calling emit()', () => {
    // Arrange
    const rule = isIn([1, 2, 3]);
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(code).toContain('indexOf');
    expect(code).toContain('=== -1');
    expect(failMock).toHaveBeenCalledWith('isIn');
  });

  it('should have ruleName isIn', () => {
    // Arrange
    const rule = isIn([1, 2, 3]);
    // Act / Assert
    expect(rule.ruleName).toBe('isIn');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    // Arrange / Act
    const rule1 = isIn([1, 2]);
    const rule2 = isIn([1, 2]);
    // Assert
    expect(rule1).not.toBe(rule2);
  });
});

// ─── isNotIn ──────────────────────────────────────────────────────────────────

describe('isNotIn', () => {
  it('should return true when value is not in the array', () => {
    // Arrange
    const rule = isNotIn([1, 2, 3]);
    // Act / Assert
    expect(rule(4)).toBe(true);
  });

  it('should return true when array is empty', () => {
    // Arrange
    const rule = isNotIn([]);
    // Act / Assert
    expect(rule(1)).toBe(true);
  });

  it('should return false when value is in the array', () => {
    // Arrange
    const rule = isNotIn([1, 2, 3]);
    // Act / Assert
    expect(rule(2)).toBe(false);
  });

  it('should call ctx.addRef and generate indexOf !== -1 check code when calling emit()', () => {
    // Arrange
    const rule = isNotIn([1, 2, 3]);
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(code).toContain('indexOf');
    expect(code).toContain('!== -1');
    expect(failMock).toHaveBeenCalledWith('isNotIn');
  });

  it('should have ruleName isNotIn', () => {
    // Arrange
    const rule = isNotIn([1, 2, 3]);
    // Act / Assert
    expect(rule.ruleName).toBe('isNotIn');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    // Arrange / Act
    const rule1 = isNotIn([1, 2]);
    const rule2 = isNotIn([1, 2]);
    // Assert
    expect(rule1).not.toBe(rule2);
  });
});
