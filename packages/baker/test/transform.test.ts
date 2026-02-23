import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, serialize, IsString, IsNumber, Transform, Expose } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class TrimmedDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  name!: string;
}

class ToUpperDto {
  @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  @IsString()
  code!: string;
}

class MultiTransformDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @Transform(({ value }) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsString()
  email!: string;
}

class SerializeTransformDto {
  @Expose()
  @Transform(({ value }) => typeof value === 'number' ? value * 100 : value, { serializeOnly: true })
  @IsNumber()
  price!: number;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('transform — integration', () => {
  it('should apply transform function during deserialization', async () => {
    seal();
    const result = await deserialize<TrimmedDto>(TrimmedDto, { name: '  Alice  ' });
    expect(result.name).toBe('Alice');
  });

  it('should apply uppercase transform during deserialization', async () => {
    seal();
    const result = await deserialize<ToUpperDto>(ToUpperDto, { code: 'abc' });
    expect(result.code).toBe('ABC');
  });

  it('should apply serialize-only transform only during serialize', () => {
    seal();
    const dto = Object.assign(new SerializeTransformDto(), { price: 9 });
    const result = serialize(dto);
    expect(result['price']).toBe(900);
  });

  it('should not apply serialize-only transform during deserialize', async () => {
    seal();
    const result = await deserialize<SerializeTransformDto>(SerializeTransformDto, { price: 9 });
    expect(result.price).toBe(9); // transform not applied during deserialize
  });
});
