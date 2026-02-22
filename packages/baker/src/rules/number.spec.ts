import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import {
  min,
  max,
  isPositive,
  isNegative,
  isDivisibleBy,
} from './number';

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

// ─── min ─────────────────────────────────────────────────────────────────────

describe('min', () => {
  it('should return true when value equals minimum boundary', () => {
    // Arrange
    const rule = min(0);
    // Act / Assert
    expect(rule(0)).toBe(true);
  });

  it('should return true when value exceeds minimum', () => {
    // Arrange
    const rule = min(0);
    // Act / Assert
    expect(rule(5)).toBe(true);
  });

  it('should return false when value is below minimum', () => {
    // Arrange
    const rule = min(0);
    // Act / Assert
    expect(rule(-1)).toBe(false);
  });

  it('should return false when value is just below minimum', () => {
    // Arrange
    const rule = min(5);
    // Act / Assert
    expect(rule(4)).toBe(false);
  });

  it('should generate v < n check code when calling emit()', () => {
    // Arrange
    const rule = min(10);
    const { ctx, failMock } = makeCtx();
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(code).toContain('_v < 10');
    expect(failMock).toHaveBeenCalledWith('min');
  });

  it('should have ruleName min', () => {
    // Arrange
    const rule = min(0);
    // Act / Assert
    expect(rule.ruleName).toBe('min');
  });

  it('should have requiresType number', () => {
    // Arrange
    const rule = min(0);
    // Act / Assert
    expect((rule as any).requiresType).toBe('number');
  });
});

// ─── max ─────────────────────────────────────────────────────────────────────

describe('max', () => {
  it('should return true when value equals maximum boundary', () => {
    // Arrange
    const rule = max(10);
    // Act / Assert
    expect(rule(10)).toBe(true);
  });

  it('should return true when value is below maximum', () => {
    // Arrange
    const rule = max(10);
    // Act / Assert
    expect(rule(5)).toBe(true);
  });

  it('should return false when value exceeds maximum', () => {
    // Arrange
    const rule = max(10);
    // Act / Assert
    expect(rule(11)).toBe(false);
  });

  it('should return false when value is just above maximum', () => {
    // Arrange
    const rule = max(0);
    // Act / Assert
    expect(rule(1)).toBe(false);
  });

  it('should generate v > n check code when calling emit()', () => {
    // Arrange
    const rule = max(10);
    const { ctx, failMock } = makeCtx();
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(code).toContain('_v > 10');
    expect(failMock).toHaveBeenCalledWith('max');
  });

  it('should have ruleName max', () => {
    // Arrange
    const rule = max(10);
    // Act / Assert
    expect(rule.ruleName).toBe('max');
  });

  it('should have requiresType number', () => {
    // Arrange
    const rule = max(10);
    // Act / Assert
    expect((rule as any).requiresType).toBe('number');
  });
});

// ─── isPositive ───────────────────────────────────────────────────────────────

describe('isPositive', () => {
  it('should return true when value is a positive number', () => {
    // Arrange / Act / Assert
    expect(isPositive(1)).toBe(true);
  });

  it('should return true when value is a small positive decimal', () => {
    // Arrange / Act / Assert
    expect(isPositive(0.001)).toBe(true);
  });

  it('should return false when value is exactly 0', () => {
    // Arrange / Act / Assert
    expect(isPositive(0)).toBe(false);
  });

  it('should return false when value is negative', () => {
    // Arrange / Act / Assert
    expect(isPositive(-1)).toBe(false);
  });

  it('should generate v <= 0 check code and have ruleName isPositive and requiresType number', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isPositive.emit('_v', ctx);
    // Assert
    expect(code).toContain('_v <= 0');
    expect(failMock).toHaveBeenCalledWith('isPositive');
    expect(isPositive.ruleName).toBe('isPositive');
    expect((isPositive as any).requiresType).toBe('number');
  });
});

// ─── isNegative ───────────────────────────────────────────────────────────────

describe('isNegative', () => {
  it('should return true when value is a negative number', () => {
    // Arrange / Act / Assert
    expect(isNegative(-1)).toBe(true);
  });

  it('should return true when value is a small negative decimal', () => {
    // Arrange / Act / Assert
    expect(isNegative(-0.001)).toBe(true);
  });

  it('should return false when value is exactly 0', () => {
    // Arrange / Act / Assert
    expect(isNegative(0)).toBe(false);
  });

  it('should return false when value is positive', () => {
    // Arrange / Act / Assert
    expect(isNegative(1)).toBe(false);
  });

  it('should generate v >= 0 check code and have ruleName isNegative and requiresType number', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isNegative.emit('_v', ctx);
    // Assert
    expect(code).toContain('_v >= 0');
    expect(failMock).toHaveBeenCalledWith('isNegative');
    expect(isNegative.ruleName).toBe('isNegative');
    expect((isNegative as any).requiresType).toBe('number');
  });
});

// ─── isDivisibleBy ────────────────────────────────────────────────────────────

describe('isDivisibleBy', () => {
  it('should return true when value is divisible by n', () => {
    // Arrange
    const rule = isDivisibleBy(2);
    // Act / Assert
    expect(rule(10)).toBe(true);
  });

  it('should return true when value is 0 regardless of n', () => {
    // Arrange
    const rule = isDivisibleBy(3);
    // Act / Assert
    expect(rule(0)).toBe(true);
  });

  it('should return true when n is 1 and value is any integer', () => {
    // Arrange
    const rule = isDivisibleBy(1);
    // Act / Assert
    expect(rule(7)).toBe(true);
  });

  it('should return false when value is not divisible by n', () => {
    // Arrange
    const rule = isDivisibleBy(2);
    // Act / Assert
    expect(rule(5)).toBe(false);
  });

  it('should return false when remainder is non-zero', () => {
    // Arrange
    const rule = isDivisibleBy(3);
    // Act / Assert
    expect(rule(10)).toBe(false);
  });

  it('should generate v % n !== 0 check code when calling emit()', () => {
    // Arrange
    const rule = isDivisibleBy(4);
    const { ctx, failMock } = makeCtx();
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(code).toContain('_v % 4');
    expect(code).toContain('!== 0');
    expect(failMock).toHaveBeenCalledWith('isDivisibleBy');
  });

  it('should have ruleName isDivisibleBy', () => {
    // Arrange
    const rule = isDivisibleBy(2);
    // Act / Assert
    expect(rule.ruleName).toBe('isDivisibleBy');
  });

  it('should have requiresType number', () => {
    // Arrange
    const rule = isDivisibleBy(2);
    // Act / Assert
    expect((rule as any).requiresType).toBe('number');
  });

  it('should return independent rule objects on multiple factory calls', () => {
    // Arrange / Act
    const rule1 = isDivisibleBy(2);
    const rule2 = isDivisibleBy(2);
    // Assert
    expect(rule1).not.toBe(rule2);
  });
});
