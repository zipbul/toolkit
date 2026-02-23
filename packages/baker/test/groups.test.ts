import { describe, it, expect, afterEach } from 'bun:test';
import { seal, deserialize, serialize, IsString, IsNumber, Expose, Exclude } from '../index';
import { unseal } from '../testing';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class AdminDto {
  @IsString()
  name!: string;

  @Expose({ groups: ['admin'] })
  @IsString()
  internalCode?: string;
}

class GroupedSerialDto {
  @IsString()
  name!: string;

  @Expose({ groups: ['public'] })
  @IsNumber()
  score?: number;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('groups — integration', () => {
  it('should deserialize group-gated field when group is provided', async () => {
    seal();
    const result = await deserialize<AdminDto>(AdminDto, { name: 'Alice', internalCode: 'XYZ' }, { groups: ['admin'] });
    expect(result.name).toBe('Alice');
    expect(result.internalCode).toBe('XYZ');
  });

  it('should skip group-gated field when group is NOT provided', async () => {
    seal();
    const result = await deserialize<AdminDto>(AdminDto, { name: 'Alice', internalCode: 'XYZ' });
    expect(result.name).toBe('Alice');
    // internalCode is group-gated — not processed without group
    expect(result.internalCode).toBeUndefined();
  });

  it('should skip group-gated field when wrong group provided', async () => {
    seal();
    const result = await deserialize<AdminDto>(AdminDto, { name: 'Bob', internalCode: 'ABC' }, { groups: ['user'] });
    expect(result.internalCode).toBeUndefined();
  });

  it('should serialize group-gated field when group matches', () => {
    seal();
    const dto = Object.assign(new GroupedSerialDto(), { name: 'Carol', score: 99 });
    const result = serialize(dto, { groups: ['public'] });
    expect(result['score']).toBe(99);
  });

  it('should omit group-gated field during serialize when no group provided', () => {
    seal();
    const dto = Object.assign(new GroupedSerialDto(), { name: 'Dave', score: 85 });
    const result = serialize(dto);
    expect(result['score']).toBeUndefined();
  });
});
