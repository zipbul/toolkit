import { describe, it, expect } from 'bun:test';
import { BakerValidationError, SealError } from './errors';
import type { BakerError } from './errors';

describe('BakerValidationError', () => {
  it('should be constructable when given an errors array', () => {
    // Arrange
    const errors: BakerError[] = [{ path: 'name', code: 'isString' }];
    // Act
    const err = new BakerValidationError(errors);
    // Assert
    expect(err).toBeDefined();
  });

  it("should have name 'BakerValidationError' when accessing .name", () => {
    // Arrange / Act
    const err = new BakerValidationError([]);
    // Assert
    expect(err.name).toBe('BakerValidationError');
  });

  it("should produce 'Validation failed: N error(s)' format when accessing .message", () => {
    // Arrange
    const errors: BakerError[] = [
      { path: 'name', code: 'isString' },
      { path: 'email', code: 'isEmail' },
    ];
    // Act
    const err = new BakerValidationError(errors);
    // Assert
    expect(err.message).toBe('Validation failed: 2 error(s)');
  });

  it('should expose the passed errors array when accessing .errors', () => {
    // Arrange
    const errors: BakerError[] = [{ path: 'name', code: 'isString' }];
    // Act
    const err = new BakerValidationError(errors);
    // Assert
    expect(err.errors).toBe(errors);
  });

  it("should produce 'Validation failed: 0 error(s)' when given an empty errors array", () => {
    // Arrange / Act
    const err = new BakerValidationError([]);
    // Assert
    expect(err.message).toBe('Validation failed: 0 error(s)');
  });

  it('should be instanceof Error when checking instanceof', () => {
    // Arrange / Act
    const err = new BakerValidationError([]);
    // Assert
    expect(err instanceof Error).toBe(true);
  });

  it('should allow accessing .errors after throw and catch when used with try/catch', () => {
    // Arrange
    const errors: BakerError[] = [{ path: '', code: 'invalidInput' }];
    let caught: unknown;
    // Act
    try {
      throw new BakerValidationError(errors);
    } catch (e) {
      caught = e;
    }
    // Assert
    expect(caught instanceof BakerValidationError).toBe(true);
    expect((caught as BakerValidationError).errors).toEqual(errors);
  });
});

describe('SealError', () => {
  it('should be constructable when given a message string', () => {
    // Arrange / Act
    const err = new SealError('not sealed: Foo');
    // Assert
    expect(err).toBeDefined();
  });

  it("should have name 'SealError' when accessing .name", () => {
    // Arrange / Act
    const err = new SealError('not sealed: Foo');
    // Assert
    expect(err.name).toBe('SealError');
  });

  it('should expose the passed message when accessing .message', () => {
    // Arrange
    const msg = 'already sealed: seal() must be called exactly once';
    // Act
    const err = new SealError(msg);
    // Assert
    expect(err.message).toBe(msg);
  });
});
