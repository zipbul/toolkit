import { describe, it, expect, mock } from 'bun:test';
import { createRule } from './create-rule';

function makeCtx(refIndex: number = 0) {
  const addRefMock = mock((_fn: Function) => refIndex);
  const failMock = mock((code: string) => `_errors.push({path:'x',code:'${code}'})`);
  const ctx = {
    addRegex: mock((_re: RegExp) => 0),
    addRef: addRefMock,
    addExecutor: mock(() => 0),
    fail: failMock,
    collectErrors: true as const,
  };
  return { ctx, addRefMock, failMock };
}

describe('createRule', () => {
  it('should return a callable function when called with valid options', () => {
    // Arrange / Act
    const rule = createRule({ name: 'myRule', validate: () => true });
    // Assert
    expect(typeof rule).toBe('function');
  });

  it('should return true when calling the rule function and validate returns true', () => {
    // Arrange
    const validate = mock((_value: unknown) => true);
    const rule = createRule({ name: 'myRule', validate });
    // Act
    const result = rule('hello');
    // Assert
    expect(result).toBe(true);
  });

  it('should have ruleName equal to options.name when accessing fn.ruleName', () => {
    // Arrange / Act
    const rule = createRule({ name: 'customRuleName', validate: () => true });
    // Assert
    expect(rule.ruleName).toBe('customRuleName');
  });

  it('should return a string when calling fn.emit() with a varName and context', () => {
    // Arrange
    const rule = createRule({ name: 'myRule', validate: () => true });
    const { ctx } = makeCtx(0);
    // Act
    const code = rule.emit('_val', ctx as any);
    // Assert
    expect(typeof code).toBe('string');
  });

  it('should include _refs[N] in emitted code where N matches the index returned by ctx.addRef', () => {
    // Arrange
    const rule = createRule({ name: 'myRule', validate: () => true });
    const { ctx } = makeCtx(3);
    // Act
    const code = rule.emit('_val', ctx as any);
    // Assert
    expect(code).toContain('_refs[3]');
  });

  it('should include the result of ctx.fail in emitted code when calling fn.emit()', () => {
    // Arrange
    const rule = createRule({ name: 'myRule', validate: () => true });
    const { ctx, failMock } = makeCtx(0);
    // Act
    const code = rule.emit('_val', ctx as any);
    // Assert: fail was called and its return value appears in the emitted code
    expect(failMock).toHaveBeenCalledWith('myRule');
    expect(code).toContain(failMock.mock.results[0]!.value as string);
  });

  it('should return false when calling the rule function and validate returns false', () => {
    // Arrange
    const validate = mock((_value: unknown) => false);
    const rule = createRule({ name: 'myRule', validate });
    // Act
    const result = rule(42);
    // Assert
    expect(result).toBe(false);
  });

  it('should call ctx.addRef with the validate function when calling fn.emit()', () => {
    // Arrange
    const validateFn = (_v: unknown) => true;
    const rule = createRule({ name: 'myRule', validate: validateFn });
    const { ctx, addRefMock } = makeCtx(0);
    // Act
    rule.emit('_val', ctx as any);
    // Assert
    expect(addRefMock).toHaveBeenCalledWith(validateFn);
  });

  it('should include _refs[0] in emitted code when ctx.addRef returns 0', () => {
    // Arrange
    const rule = createRule({ name: 'myRule', validate: () => true });
    const { ctx } = makeCtx(0);
    // Act
    const code = rule.emit('_val', ctx as any);
    // Assert
    expect(code).toContain('_refs[0]');
  });

  it('should return independent functions when calling createRule twice with the same options', () => {
    // Arrange
    const options = { name: 'myRule', validate: () => true };
    // Act
    const rule1 = createRule(options);
    const rule2 = createRule(options);
    // Assert
    expect(rule1).not.toBe(rule2);
  });
});
