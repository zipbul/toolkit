import { describe, it, expect, mock } from 'bun:test';
import { buildSerializeCode } from './serialize-builder';
import { isString } from '../rules/typechecker';
import type { RawClassMeta } from '../types';
import type { SealOptions } from '../interfaces';
import type { RuntimeOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSerializeCode', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should assign simple field value to output object', () => {
    // Arrange
    class SimpleDto { name = 'Alice'; }
    const merged: RawClassMeta = {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    const exec = buildSerializeCode(SimpleDto, merged, undefined);
    const instance = new SimpleDto();
    // Act
    const result = exec(instance);
    // Assert
    expect(result.name).toBe('Alice');
  });

  it('should omit field from output when @IsOptional field is undefined', () => {
    // Arrange
    class OptDto { age?: number; }
    const merged: RawClassMeta = {
      age: {
        validation: [],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    const exec = buildSerializeCode(OptDto, merged, undefined);
    const instance = new OptDto(); // age is undefined
    // Act
    const result = exec(instance);
    // Assert
    expect('age' in result).toBe(false);
  });

  it('should map field to @Expose name when serializeOnly name is set', () => {
    // Arrange
    class ExposedDto { displayName = 'Bob'; }
    const merged: RawClassMeta = {
      displayName: {
        validation: [],
        transform: [],
        expose: [{ name: 'userName', serializeOnly: true }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(ExposedDto, merged, undefined);
    const instance = new ExposedDto();
    // Act
    const result = exec(instance);
    // Assert — output key is 'userName', not 'displayName'
    expect(result['userName']).toBe('Bob');
    expect('displayName' in result).toBe(false);
  });

  it('should skip field when @Exclude(serializeOnly) is set', () => {
    // Arrange
    class ExclDto { secret = 'hidden'; }
    const merged: RawClassMeta = {
      secret: {
        validation: [],
        transform: [],
        expose: [],
        exclude: { serializeOnly: true },
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(ExclDto, merged, undefined);
    const instance = new ExclDto();
    // Act
    const result = exec(instance);
    // Assert
    expect('secret' in result).toBe(false);
  });

  it('should include admin-guarded field when groups includes admin', () => {
    // Arrange
    class GroupDto { adminField = 'adminVal'; }
    const merged: RawClassMeta = {
      adminField: {
        validation: [],
        transform: [],
        expose: [{ groups: ['admin'] }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(GroupDto, merged, undefined);
    const instance = new GroupDto();
    const opts: RuntimeOptions = { groups: ['admin'] };
    // Act
    const result = exec(instance, opts);
    // Assert
    expect(result.adminField).toBe('adminVal');
  });

  it('should exclude admin-guarded field when no groups provided', () => {
    // Arrange
    class GroupDto2 { adminField = 'adminVal'; }
    const merged: RawClassMeta = {
      adminField: {
        validation: [],
        transform: [],
        expose: [{ groups: ['admin'] }],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(GroupDto2, merged, undefined);
    const instance = new GroupDto2();
    // Act — no groups in opts
    const result = exec(instance, {});
    // Assert
    expect('adminField' in result).toBe(false);
  });

  it('should call @Transform function and use its result', () => {
    // Arrange
    class TransDto { name = 'alice'; }
    const transformFn = mock(({ value }: any) => (value as string).toUpperCase());
    const merged: RawClassMeta = {
      name: {
        validation: [],
        transform: [{ fn: transformFn, options: { serializeOnly: true } }],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(TransDto, merged, undefined);
    const instance = new TransDto();
    // Act
    const result = exec(instance);
    // Assert
    expect(result.name).toBe('ALICE');
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should return empty object when DTO has no fields', () => {
    // Arrange
    class NoFields {}
    const exec = buildSerializeCode(NoFields, {}, undefined);
    // Act
    const result = exec(new NoFields());
    // Assert
    expect(result).toEqual({});
  });

  it('should include field in output when it has validation only (no @Expose needed)', () => {
    // Arrange
    class ValidationOnlyDto { score = 42; }
    const merged: RawClassMeta = {
      score: {
        validation: [{ rule: isString }],
        transform: [],
        expose: [],
        exclude: null,
        type: null,
        flags: {},
      },
    };
    const exec = buildSerializeCode(ValidationOnlyDto, merged, undefined);
    const instance = new ValidationOnlyDto();
    // Act
    const result = exec(instance);
    // Assert — baker registers field if any decorator present
    expect(result.score).toBe(42);
  });

  // ── Corner ─────────────────────────────────────────────────────────────────

  it('should combine @Expose serializeOnly name with @IsOptional wrap', () => {
    // Arrange
    class ComboDto { alias?: string; }
    const merged: RawClassMeta = {
      alias: {
        validation: [],
        transform: [],
        expose: [{ name: 'aliasOut', serializeOnly: true }],
        exclude: null,
        type: null,
        flags: { isOptional: true },
      },
    };
    const exec = buildSerializeCode(ComboDto, merged, undefined);
    const defInstance = new ComboDto(); // alias is undefined
    const valInstance = Object.assign(new ComboDto(), { alias: 'hello' });
    // Act
    const defResult = exec(defInstance); // undefined → omit
    const valResult = exec(valInstance); // 'hello' → map to 'aliasOut'
    // Assert
    expect('aliasOut' in defResult).toBe(false);
    expect(valResult['aliasOut']).toBe('hello');
  });
});
