import { describe, it, expect, mock } from 'bun:test';
import type { EmitContext } from '../types';
import {
  isString,
  isNumber,
  isBoolean,
  isDate,
  isEnum,
  isInt,
} from './typechecker';

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

// ─── isString ────────────────────────────────────────────────────────────────

describe('isString', () => {
  it('should return true when value is a non-empty string', () => {
    // Arrange / Act / Assert
    expect(isString('hello')).toBe(true);
  });

  it('should return true when value is an empty string', () => {
    // Arrange / Act / Assert
    expect(isString('')).toBe(true);
  });

  it('should return false when value is a number', () => {
    // Arrange / Act / Assert
    expect(isString(42)).toBe(false);
  });

  it('should return false when value is null', () => {
    // Arrange / Act / Assert
    expect(isString(null)).toBe(false);
  });

  it('should return false when value is an object', () => {
    // Arrange / Act / Assert
    expect(isString({})).toBe(false);
  });

  it('should generate typeof !== string check code when calling emit()', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isString.emit('_v', ctx);
    // Assert
    expect(code).toContain(`typeof _v !== 'string'`);
    expect(failMock).toHaveBeenCalledWith('isString');
  });

  it('should have ruleName isString and requiresType undefined', () => {
    // Arrange / Act / Assert
    expect(isString.ruleName).toBe('isString');
    expect((isString as any).requiresType).toBeUndefined();
  });
});

// ─── isNumber ─────────────────────────────────────────────────────────────────

describe('isNumber', () => {
  it('should return true when value is a positive integer', () => {
    // Arrange
    const rule = isNumber();
    // Act / Assert
    expect(rule(42)).toBe(true);
  });

  it('should return true when value is a decimal', () => {
    // Arrange
    const rule = isNumber();
    // Act / Assert
    expect(rule(3.14)).toBe(true);
  });

  it('should return true when value is 0', () => {
    // Arrange
    const rule = isNumber();
    // Act / Assert
    expect(rule(0)).toBe(true);
  });

  it('should return true when value is NaN and allowNaN is true', () => {
    // Arrange
    const rule = isNumber({ allowNaN: true });
    // Act / Assert
    expect(rule(NaN)).toBe(true);
  });

  it('should return true when value is Infinity and allowInfinity is true', () => {
    // Arrange
    const rule = isNumber({ allowInfinity: true });
    // Act / Assert
    expect(rule(Infinity)).toBe(true);
  });

  it('should return true when decimal places are within maxDecimalPlaces', () => {
    // Arrange
    const rule = isNumber({ maxDecimalPlaces: 2 });
    // Act / Assert
    expect(rule(1.5)).toBe(true);
  });

  it('should return false when value is a string', () => {
    // Arrange
    const rule = isNumber();
    // Act / Assert
    expect(rule('42')).toBe(false);
  });

  it('should return false when value is NaN and allowNaN is false by default', () => {
    // Arrange
    const rule = isNumber();
    // Act / Assert
    expect(rule(NaN)).toBe(false);
  });

  it('should return false when decimal places exceed maxDecimalPlaces', () => {
    // Arrange
    const rule = isNumber({ maxDecimalPlaces: 1 });
    // Act / Assert
    expect(rule(3.14)).toBe(false);
  });

  it('should generate typeof check code and have ruleName isNumber when calling emit()', () => {
    // Arrange
    const rule = isNumber();
    const { ctx, failMock } = makeCtx();
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(code).toContain(`typeof _v !== 'number'`);
    expect(failMock).toHaveBeenCalledWith('isNumber');
    expect(rule.ruleName).toBe('isNumber');
    expect((rule as any).requiresType).toBeUndefined();
  });
});

// ─── isBoolean ────────────────────────────────────────────────────────────────

describe('isBoolean', () => {
  it('should return true when value is boolean true', () => {
    // Arrange / Act / Assert
    expect(isBoolean(true)).toBe(true);
  });

  it('should return true when value is boolean false', () => {
    // Arrange / Act / Assert
    expect(isBoolean(false)).toBe(true);
  });

  it('should return false when value is string true', () => {
    // Arrange / Act / Assert
    expect(isBoolean('true')).toBe(false);
  });

  it('should return false when value is number 1', () => {
    // Arrange / Act / Assert
    expect(isBoolean(1)).toBe(false);
  });

  it('should generate typeof boolean check code and have ruleName isBoolean when calling emit()', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isBoolean.emit('_v', ctx);
    // Assert
    expect(code).toContain(`typeof _v !== 'boolean'`);
    expect(failMock).toHaveBeenCalledWith('isBoolean');
    expect(isBoolean.ruleName).toBe('isBoolean');
    expect((isBoolean as any).requiresType).toBeUndefined();
  });
});

// ─── isDate ───────────────────────────────────────────────────────────────────

describe('isDate', () => {
  it('should return true when value is a valid Date object', () => {
    // Arrange / Act / Assert
    expect(isDate(new Date('2024-01-01'))).toBe(true);
  });

  it('should return true when value is epoch date new Date(0)', () => {
    // Arrange / Act / Assert
    expect(isDate(new Date(0))).toBe(true);
  });

  it('should return false when value is an invalid Date', () => {
    // Arrange / Act / Assert
    expect(isDate(new Date('invalid'))).toBe(false);
  });

  it('should return false when value is a string', () => {
    // Arrange / Act / Assert
    expect(isDate('2024-01-01')).toBe(false);
  });

  it('should return false when value is null', () => {
    // Arrange / Act / Assert
    expect(isDate(null)).toBe(false);
  });

  it('should generate instanceof Date and valid date check code when calling emit()', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isDate.emit('_v', ctx);
    // Assert
    expect(code).toContain('instanceof Date');
    expect(code).toContain('isNaN');
    expect(failMock).toHaveBeenCalledWith('isDate');
    expect(isDate.ruleName).toBe('isDate');
    expect((isDate as any).requiresType).toBeUndefined();
  });
});

// ─── isEnum ───────────────────────────────────────────────────────────────────

describe('isEnum', () => {
  enum Direction { Up = 'UP', Down = 'DOWN' }
  enum Status { Active = 1, Inactive = 0 }

  it('should return true when value is a string enum member', () => {
    // Arrange
    const rule = isEnum(Direction);
    // Act / Assert
    expect(rule('UP')).toBe(true);
  });

  it('should return true when value is a numeric enum member', () => {
    // Arrange
    const rule = isEnum(Status);
    // Act / Assert
    expect(rule(1)).toBe(true);
  });

  it('should return false when value is not in enum', () => {
    // Arrange
    const rule = isEnum(Direction);
    // Act / Assert
    expect(rule('LEFT')).toBe(false);
  });

  it('should return false when value is null', () => {
    // Arrange
    const rule = isEnum(Direction);
    // Act / Assert
    expect(rule(null)).toBe(false);
  });

  it('should return independent rule objects on multiple factory calls', () => {
    // Arrange / Act
    const rule1 = isEnum(Direction);
    const rule2 = isEnum(Direction);
    // Assert
    expect(rule1).not.toBe(rule2);
  });

  it('should call ctx.addRef and generate indexOf check code when calling emit()', () => {
    // Arrange
    const rule = isEnum(Direction);
    const { ctx, addRefMock, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_v', ctx);
    // Assert
    expect(addRefMock).toHaveBeenCalledTimes(1);
    expect(code).toContain('indexOf(_v)');
    expect(code).toContain('=== -1');
    expect(failMock).toHaveBeenCalledWith('isEnum');
  });

  it('should have ruleName isEnum', () => {
    // Arrange
    const rule = isEnum(Direction);
    // Act / Assert
    expect(rule.ruleName).toBe('isEnum');
  });

  it('should return same result when called multiple times with same input', () => {
    // Arrange
    const rule = isEnum(Direction);
    // Act
    const r1 = rule('UP');
    const r2 = rule('UP');
    // Assert
    expect(r1).toBe(r2);
  });
});

// ─── isInt ────────────────────────────────────────────────────────────────────

describe('isInt', () => {
  it('should return true when value is a positive integer', () => {
    // Arrange / Act / Assert
    expect(isInt(5)).toBe(true);
  });

  it('should return true when value is 0', () => {
    // Arrange / Act / Assert
    expect(isInt(0)).toBe(true);
  });

  it('should return true when value is a negative integer', () => {
    // Arrange / Act / Assert
    expect(isInt(-3)).toBe(true);
  });

  it('should return false when value is a decimal', () => {
    // Arrange / Act / Assert
    expect(isInt(1.5)).toBe(false);
  });

  it('should return false when value is NaN', () => {
    // Arrange / Act / Assert
    expect(isInt(NaN)).toBe(false);
  });

  it('should return false when value is a string', () => {
    // Arrange / Act / Assert
    expect(isInt('1')).toBe(false);
  });

  it('should generate typeof and Number.isInteger check code when calling emit()', () => {
    // Arrange
    const { ctx, failMock } = makeCtx();
    // Act
    const code = isInt.emit('_v', ctx);
    // Assert
    expect(code).toContain(`typeof _v !== 'number'`);
    expect(code).toContain('Number.isInteger');
    expect(failMock).toHaveBeenCalledWith('isInt');
    expect(isInt.ruleName).toBe('isInt');
    expect((isInt as any).requiresType).toBeUndefined();
  });
});
