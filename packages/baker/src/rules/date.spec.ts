import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import { minDate, maxDate } from './date';

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

// ─── minDate ──────────────────────────────────────────────────────────────────

describe('minDate', () => {
  it('should return true when date is after minimum date', () => {
    // Arrange
    const rule = minDate(new Date('2020-01-01'));
    // Act / Assert
    expect(rule(new Date('2021-01-01'))).toBe(true);
  });

  it('should return true when date is exactly equal to minimum date', () => {
    // Arrange
    const boundary = new Date('2020-06-15');
    const rule = minDate(boundary);
    // Act / Assert
    expect(rule(new Date('2020-06-15'))).toBe(true);
  });

  it('should return false when date is before minimum date', () => {
    // Arrange
    const rule = minDate(new Date('2020-01-01'));
    // Act / Assert
    expect(rule(new Date('2019-12-31'))).toBe(false);
  });

  it('should return false when value is not a Date object', () => {
    // Arrange
    const rule = minDate(new Date('2020-01-01'));
    // Act / Assert
    expect(rule('2021-01-01')).toBe(false);
  });

  it('should return false when value is null', () => {
    // Arrange
    const rule = minDate(new Date('2020-01-01'));
    // Act / Assert
    expect(rule(null)).toBe(false);
  });

  it('should call ctx.addRef and generate date comparison code when calling emit()', () => {
    // Arrange
    const rule = minDate(new Date('2020-01-01'));
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(failMock).toHaveBeenCalledWith('minDate');
  });

  it('should have ruleName minDate', () => {
    // Arrange
    const rule = minDate(new Date('2020-01-01'));
    // Act / Assert
    expect(rule.ruleName).toBe('minDate');
  });
});

// ─── maxDate ──────────────────────────────────────────────────────────────────

describe('maxDate', () => {
  it('should return true when date is before maximum date', () => {
    // Arrange
    const rule = maxDate(new Date('2025-01-01'));
    // Act / Assert
    expect(rule(new Date('2024-01-01'))).toBe(true);
  });

  it('should return true when date is exactly equal to maximum date', () => {
    // Arrange
    const boundary = new Date('2025-06-15');
    const rule = maxDate(boundary);
    // Act / Assert
    expect(rule(new Date('2025-06-15'))).toBe(true);
  });

  it('should return false when date is after maximum date', () => {
    // Arrange
    const rule = maxDate(new Date('2025-01-01'));
    // Act / Assert
    expect(rule(new Date('2026-01-01'))).toBe(false);
  });

  it('should return false when value is not a Date object', () => {
    // Arrange
    const rule = maxDate(new Date('2025-01-01'));
    // Act / Assert
    expect(rule('2024-01-01')).toBe(false);
  });

  it('should call ctx.addRef and generate date comparison code when calling emit()', () => {
    // Arrange
    const rule = maxDate(new Date('2025-01-01'));
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('_refs[0]');
    expect(failMock).toHaveBeenCalledWith('maxDate');
  });

  it('should have ruleName maxDate', () => {
    // Arrange
    const rule = maxDate(new Date('2025-01-01'));
    // Act / Assert
    expect(rule.ruleName).toBe('maxDate');
  });
});
