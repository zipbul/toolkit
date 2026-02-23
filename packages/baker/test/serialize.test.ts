import { describe, it, expect, afterEach } from 'bun:test';
import { seal, serialize, IsString, IsNumber, Expose, Exclude } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class SimpleSerializeDto {
  @IsString()
  name!: string;

  @IsNumber()
  age!: number;
}

class ExposedDto {
  @Expose({ name: 'full_name' })
  @IsString()
  name!: string;

  @IsNumber()
  age!: number;
}

class ExcludedDto {
  @IsString()
  public!: string;

  @Exclude()
  @IsString()
  private!: string;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('serialize — integration', () => {
  it('should serialize DTO instance to plain object', () => {
    seal();
    const dto = Object.assign(new SimpleSerializeDto(), { name: 'Bob', age: 25 });
    const result = serialize(dto);
    expect(result).toEqual({ name: 'Bob', age: 25 });
  });

  it('should apply @Expose name when serializing', () => {
    seal();
    const dto = Object.assign(new ExposedDto(), { name: 'Carol', age: 40 });
    const result = serialize(dto);
    expect(result['full_name']).toBe('Carol');
    expect(result['name']).toBeUndefined();
  });

  it('should omit @Exclude fields', () => {
    seal();
    const dto = Object.assign(new ExcludedDto(), { public: 'visible', private: 'hidden' });
    const result = serialize(dto);
    expect(result['public']).toBe('visible');
    expect(result['private']).toBeUndefined();
  });

  it('should throw when trying to serialize instance of unsealed class', () => {
    // seal() not called
    const dto = Object.assign(new SimpleSerializeDto(), { name: 'Dave', age: 20 });
    expect(() => serialize(dto)).toThrow();
  });

  it('should return plain object (not class instance)', () => {
    seal();
    const dto = Object.assign(new SimpleSerializeDto(), { name: 'Eve', age: 28 });
    const result = serialize(dto);
    expect(typeof result).toBe('object');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});
