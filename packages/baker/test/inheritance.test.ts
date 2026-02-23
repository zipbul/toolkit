import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, serialize, IsString, IsNumber, IsBoolean } from '../index';
import { unseal } from '../testing';

// ─── DTOs: inheritance chain ──────────────────────────────────────────────────

class BaseDto {
  @IsString()
  name!: string;
}

class ChildDto extends BaseDto {
  @IsNumber()
  age!: number;
}

class GrandChildDto extends ChildDto {
  @IsBoolean()
  active!: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('inheritance — integration', () => {
  it('should deserialize parent fields in child DTO', async () => {
    seal();
    const result = await deserialize<ChildDto>(ChildDto, { name: 'Alice', age: 25 });
    expect(result).toBeInstanceOf(ChildDto);
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(25);
  });

  it('should validate parent field rules in child DTO', async () => {
    seal();
    // name is required by BaseDto's @IsString()
    await expect(deserialize(ChildDto, { age: 25 })).rejects.toThrow();
  });

  it('should deserialize grandchild DTO with all ancestor fields', async () => {
    seal();
    const result = await deserialize<GrandChildDto>(GrandChildDto, { name: 'Bob', age: 30, active: true });
    expect(result.name).toBe('Bob');
    expect(result.age).toBe(30);
    expect(result.active).toBe(true);
  });

  it('should serialize child DTO including parent fields', () => {
    seal();
    const dto = Object.assign(new ChildDto(), { name: 'Carol', age: 40 });
    const result = serialize(dto);
    expect(result['name']).toBe('Carol');
    expect(result['age']).toBe(40);
  });

  it('should serialize grandchild DTO with all inherited fields', () => {
    seal();
    const dto = Object.assign(new GrandChildDto(), { name: 'Dave', age: 35, active: false });
    const result = serialize(dto);
    expect(result['name']).toBe('Dave');
    expect(result['age']).toBe(35);
    expect(result['active']).toBe(false);
  });
});
