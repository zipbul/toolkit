import { describe, it, expect } from 'bun:test';
import { buildDeserializeCode } from './deserialize-builder';
import { isErr } from '@zipbul/result';
import { isString } from '../rules/typechecker';
import { isNumber } from '../rules/typechecker';
import { min, max } from '../rules/number';
import { minLength } from '../rules/string';
import type { RawClassMeta } from '../types';
import type { SealOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function run<T>(
  Class: new (...a: any[]) => T,
  merged: RawClassMeta,
  options?: SealOptions,
  input?: unknown,
): ReturnType<ReturnType<typeof buildDeserializeCode<T>>> {
  const exec = buildDeserializeCode<T>(Class, merged, options, false);
  return exec(input !== undefined ? input : {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDeserializeCode', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should return class instance when @IsString field receives valid string', () => {
    // Arrange
    class NameDto { name!: string; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act
    const result = run(NameDto, merged, undefined, { name: 'Alice' });
    // Assert
    expect(result).toBeInstanceOf(NameDto);
    expect((result as NameDto).name).toBe('Alice');
  });

  it('should return invalidInput error when input is null', () => {
    // Arrange
    class NullDto {}
    const merged: RawClassMeta = {};
    const exec = buildDeserializeCode(NullDto, merged, undefined, false);
    // Act
    const result = exec(null);
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].path).toBe('');
    expect(errs[0].code).toBe('invalidInput');
  });

  it('should return invalidInput error when input is an array', () => {
    // Arrange
    class ArrDto {}
    const merged: RawClassMeta = {};
    const exec = buildDeserializeCode(ArrDto, merged, undefined, false);
    // Act
    const result = exec([1, 2, 3]);
    // Assert
    expect(isErr(result)).toBe(true);
    expect((result as any).data[0].code).toBe('invalidInput');
  });

  it('should skip optional field when value is undefined (@IsOptional)', () => {
    // Arrange
    class OptDto { age?: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [{ rule: isNumber() }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    // Act
    const result = run(OptDto, merged, undefined, {});
    // Assert — success, age is not validated (undefined skipped)
    expect(result).toBeInstanceOf(OptDto);
    expect(isErr(result)).toBe(false);
  });

  it('should use class default value when exposeDefaultValues:true and key is absent from input', () => {
    // Arrange
    class DefaultDto { name: string = 'anonymous'; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(DefaultDto, merged, { exposeDefaultValues: true }, false);
    // Act — no 'name' in input
    const result = exec({});
    // Assert — uses default 'anonymous', passes isString validation
    expect(result).toBeInstanceOf(DefaultDto);
    expect((result as DefaultDto).name).toBe('anonymous');
  });

  it('should extract from mapped key when field has deserializeOnly @Expose name', () => {
    // Arrange
    class MappedDto { displayName!: string; }
    const merged: RawClassMeta = {
      displayName: {
        validation: [],
        transform: [],
        expose: [{ name: 'user_name', deserializeOnly: true }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    // Act
    const result = run(MappedDto, merged, undefined, { user_name: 'Bob' });
    // Assert
    expect((result as MappedDto).displayName).toBe('Bob');
  });

  it('should collect all errors when stopAtFirstError is false (default)', () => {
    // Arrange
    class MultiDto { name!: string; age!: number; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
      age: { validation: [{ rule: isNumber() }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(MultiDto, merged, { stopAtFirstError: false }, false);
    // Act — both fields invalid
    const result = exec({ name: 42, age: 'not-a-number' });
    // Assert — collects both errors
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });

  it('should return only first error when stopAtFirstError is true', () => {
    // Arrange
    class StopDto { name!: string; age!: number; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
      age: { validation: [{ rule: isNumber() }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(StopDto, merged, { stopAtFirstError: true }, false);
    // Act — both fields invalid
    const result = exec({ name: 42, age: 'bad' });
    // Assert — early return with 1 error
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs.length).toBe(1);
  });

  it('should validate @IsNumber + @Min + @Max and assign when all pass', () => {
    // Arrange
    class NumDto { age!: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [{ rule: isNumber() }, { rule: min(0) }, { rule: max(150) }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    // Act
    const result = run(NumDto, merged, undefined, { age: 25 });
    // Assert
    expect((result as NumDto).age).toBe(25);
  });

  it('should include sourceURL comment referencing class name in generated code', () => {
    // Arrange
    class SourceUrlDto {}
    const exec = buildDeserializeCode(SourceUrlDto, {}, undefined, false);
    // Assert — function toString contains sourceURL
    const src = exec.toString();
    expect(src).toContain('SourceUrlDto');
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should produce error with correct path and code when @IsString field is invalid', () => {
    // Arrange
    class PathDto { email!: string; }
    const merged: RawClassMeta = {
      email: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(PathDto, merged, undefined, false);
    // Act
    const result = exec({ email: 123 });
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs[0].path).toBe('email');
    expect(errs[0].code).toBe('isString');
  });

  it('should return error when required field is absent from input', () => {
    // Arrange
    class ReqDto { name!: string; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildDeserializeCode(ReqDto, merged, undefined, false);
    // Act
    const result = exec({});
    // Assert
    expect(isErr(result)).toBe(true);
    const errs = (result as any).data;
    expect(errs.some((e: any) => e.path === 'name')).toBe(true);
  });

  it('should treat @IsDefined as overriding @IsOptional (undefined still fails)', () => {
    // Arrange
    class IsDef { val!: string; }
    const merged: RawClassMeta = {
      val: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true, isDefined: true }, // IsDefined wins
      },
    };
    const exec = buildDeserializeCode(IsDef, merged, undefined, false);
    // Act — undefined should fail (no optional guard when isDefined)
    const result = exec({});
    // Assert
    expect(isErr(result)).toBe(true);
  });

  // ── Corner ─────────────────────────────────────────────────────────────────

  it('should use optional guard only (not exposeDefault guard) when @IsOptional + exposeDefaultValues', () => {
    // Arrange
    class OptDefault { name?: string; }
    const merged: RawClassMeta = {
      name: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    const exec = buildDeserializeCode(OptDefault, merged, { exposeDefaultValues: true }, false);
    // Act — key absent + isOptional → skip (not error)
    const result = exec({});
    // Assert — no error (optional guard subsumes exposeDefault guard)
    expect(isErr(result)).toBe(false);
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should return empty instance when DTO has no fields', () => {
    // Arrange
    class EmptyDto {}
    const exec = buildDeserializeCode(EmptyDto, {}, undefined, false);
    // Act
    const result = exec({});
    // Assert
    expect(result).toBeInstanceOf(EmptyDto);
    expect(isErr(result)).toBe(false);
  });
});
