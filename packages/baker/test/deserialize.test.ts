import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, IsString, IsNumber, IsBoolean, IsOptional } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class SimpleDto {
  @IsString()
  name!: string;

  @IsNumber()
  age!: number;
}

class OptionalFieldDto {
  @IsString()
  required!: string;

  @IsOptional()
  @IsString()
  optional?: string;
}

class BooleanDto {
  @IsBoolean()
  active!: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('deserialize — integration', () => {
  it('should deserialize plain object → DTO instance with valid input', async () => {
    seal();
    const result = await deserialize<SimpleDto>(SimpleDto, { name: 'Alice', age: 30 });
    expect(result).toBeInstanceOf(SimpleDto);
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(30);
  });

  it('should throw BakerValidationError when required string is missing', async () => {
    seal();
    await expect(deserialize(SimpleDto, { age: 30 })).rejects.toThrow();
  });

  it('should throw BakerValidationError when type mismatch (number given as string)', async () => {
    seal();
    await expect(deserialize(SimpleDto, { name: 123, age: 30 })).rejects.toThrow();
  });

  it('should accept optional field when absent', async () => {
    seal();
    const result = await deserialize<OptionalFieldDto>(OptionalFieldDto, { required: 'hello' });
    expect(result.required).toBe('hello');
    expect(result.optional).toBeUndefined();
  });

  it('should accept optional field when present with valid value', async () => {
    seal();
    const result = await deserialize<OptionalFieldDto>(OptionalFieldDto, { required: 'hi', optional: 'world' });
    expect(result.optional).toBe('world');
  });

  it('should throw when unsealed class is passed to deserialize', async () => {
    // seal() not called
    await expect(deserialize(SimpleDto, { name: 'x', age: 1 })).rejects.toThrow();
  });

  it('should deserialize boolean field', async () => {
    seal();
    const result = await deserialize<BooleanDto>(BooleanDto, { active: true });
    expect(result.active).toBe(true);
  });

  it('should throw when boolean field receives string', async () => {
    seal();
    await expect(deserialize(BooleanDto, { active: 'yes' })).rejects.toThrow();
  });
});
