import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, BakerValidationError, SealError, IsString, IsNumber, IsEmail, Min } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class ErrorDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  age!: number;

  @IsEmail()
  email!: string;
}

class MultiFieldErrorDto {
  @IsString()
  a!: string;

  @IsString()
  b!: string;

  @IsString()
  c!: string;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('error — integration', () => {
  it('should throw BakerValidationError on invalid input', async () => {
    seal();
    await expect(deserialize(ErrorDto, { name: 123, age: 25, email: 'x@y.com' })).rejects.toThrow(BakerValidationError);
  });

  it('BakerValidationError should have errors array', async () => {
    seal();
    try {
      await deserialize(ErrorDto, { name: 123, age: 25, email: 'x@y.com' });
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      expect((e as BakerValidationError).errors).toBeArray();
      expect((e as BakerValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it('BakerValidationError.errors should include path and code', async () => {
    seal();
    try {
      await deserialize(ErrorDto, { age: 25, email: 'x@y.com' }); // missing required name
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      const errors = (e as BakerValidationError).errors;
      expect(errors.some(err => err.path === 'name')).toBe(true);
    }
  });

  it('should collect all errors when multiple fields invalid', async () => {
    seal();
    try {
      await deserialize(MultiFieldErrorDto, { a: 1, b: 2, c: 3 }); // all invalid
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      expect((e as BakerValidationError).errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('should throw SealError when sealing twice', () => {
    seal();
    expect(() => seal()).toThrow(SealError);
  });

  it('should throw SealError with meaningful message', () => {
    seal();
    try {
      seal();
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(SealError);
      expect((e as SealError).message).toContain('sealed');
    }
  });

  it('should respect stopAtFirstError seal option', async () => {
    seal({ stopAtFirstError: true });
    try {
      await deserialize(MultiFieldErrorDto, { a: 1, b: 2, c: 3 });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      // stopAtFirstError: collecting stopped at first error
      expect((e as BakerValidationError).errors.length).toBe(1);
    }
  });

  // ─── DX-2: BakerValidationError should include class name in message ───────

  it('should include class name in BakerValidationError.message', async () => {
    seal();
    try {
      await deserialize(ErrorDto, { name: 123, age: 25, email: 'x@y.com' });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(BakerValidationError);
      expect((e as BakerValidationError).message).toContain('ErrorDto');
      expect((e as BakerValidationError).message).toMatch(/Validation failed for ErrorDto: \d+ error/);
      expect((e as BakerValidationError).className).toBe('ErrorDto');
    }
  });
});
