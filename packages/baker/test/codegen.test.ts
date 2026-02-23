import { describe, it, expect, afterEach } from 'bun:test';
import { isErr } from '@zipbul/result';
import { seal, IsString, IsNumber, IsBoolean, IsOptional, Transform } from '../index';
import { unseal } from '../testing';
import { SEALED } from '../src/symbols';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class CodegenSimpleDto {
  @IsString()
  name!: string;

  @IsNumber()
  value!: number;
}

class CodegenOptionalDto {
  @IsString()
  required!: string;

  @IsOptional()
  @IsBoolean()
  flag?: boolean;
}

class CodegenTransformDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  text!: string;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('codegen — integration', () => {
  it('should generate _deserialize and _serialize functions after seal()', () => {
    seal();
    const sealed = (CodegenSimpleDto as any)[SEALED];
    expect(sealed).toBeDefined();
    expect(typeof sealed._deserialize).toBe('function');
    expect(typeof sealed._serialize).toBe('function');
  });

  it('_deserialize should accept valid input and return instance', async () => {
    seal();
    const sealed = (CodegenSimpleDto as any)[SEALED];
    const result = await sealed._deserialize({ name: 'Alice', value: 42 });
    expect(isErr(result)).toBe(false);
    expect((result as any).name).toBe('Alice');
    expect((result as any).value).toBe(42);
  });

  it('_deserialize should return error Result for invalid input', async () => {
    seal();
    const sealed = (CodegenSimpleDto as any)[SEALED];
    const result = await sealed._deserialize({ name: 123, value: 'wrong' });
    expect(isErr(result)).toBe(true);
  });

  it('_serialize should return plain object', () => {
    seal();
    const sealed = (CodegenSimpleDto as any)[SEALED];
    const instance = Object.assign(new CodegenSimpleDto(), { name: 'Bob', value: 7 });
    const result = sealed._serialize(instance);
    expect(result).toEqual({ name: 'Bob', value: 7 });
  });

  it('optional field should not cause error when absent', async () => {
    seal();
    const sealed = (CodegenOptionalDto as any)[SEALED];
    const result = await sealed._deserialize({ required: 'hello' });
    expect(isErr(result)).toBe(false);
  });

  it('optional field deserialized value should have required field', async () => {
    seal();
    const sealed = (CodegenOptionalDto as any)[SEALED];
    const result = await sealed._deserialize({ required: 'hello' });
    if (!isErr(result)) {
      expect((result as CodegenOptionalDto).required).toBe('hello');
    }
  });

  it('transform should be applied in generated deserialize code', async () => {
    seal();
    const sealed = (CodegenTransformDto as any)[SEALED];
    const result = await sealed._deserialize({ text: '  trimmed  ' });
    expect(isErr(result)).toBe(false);
    expect((result as any).text).toBe('trimmed');
  });
});
