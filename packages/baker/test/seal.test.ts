import { describe, it, expect, afterEach } from 'bun:test';
import { seal, SealError, IsString, IsNumber, Transform, Type, ValidateNested, createRule } from '../index';
import { unseal } from '../testing';
import { SEALED } from '../src/symbols';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class SealTestDto {
  @IsString()
  name!: string;

  @IsNumber()
  age!: number;
}

// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => unseal());

describe('seal — integration', () => {
  it('should seal registered DTOs', () => {
    seal();
    expect((SealTestDto as any)[SEALED]).toBeDefined();
    expect(typeof (SealTestDto as any)[SEALED]._deserialize).toBe('function');
    expect(typeof (SealTestDto as any)[SEALED]._serialize).toBe('function');
  });

  it('should throw SealError when sealed twice', () => {
    seal();
    expect(() => seal()).toThrow(SealError);
  });

  it('should allow re-sealing after unseal()', () => {
    seal();
    unseal();
    expect(() => seal()).not.toThrow();
  });

  it('should attach executors after seal', () => {
    seal();
    const sealed = (SealTestDto as any)[SEALED];
    expect(sealed).toHaveProperty('_deserialize');
    expect(sealed).toHaveProperty('_serialize');
  });

  it('should remove executors after unseal', () => {
    seal();
    unseal();
    expect((SealTestDto as any)[SEALED]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C1: async 아키텍처 — _isAsync / _isSerializeAsync 플래그
// ─────────────────────────────────────────────────────────────────────────────

class SyncDto {
  @IsString()
  name!: string;
}

class AsyncTransformDeserializeDto {
  @Transform(async ({ value }) => (typeof value === 'string' ? value.trim() : value), { deserializeOnly: true })
  @IsString()
  name!: string;
}

const asyncRule = createRule({
  name: 'asyncCustom',
  validate: async (v) => typeof v === 'string',
});

import { collectValidation, collectTransform } from '../src/collect';

function AsyncRule(): PropertyDecorator {
  return (target, key) => collectValidation(target as object, key as string, { rule: asyncRule });
}

class AsyncRuleDto {
  @AsyncRule()
  name!: string;
}

class AsyncTransformSerializeDto {
  @Transform(async ({ value }) => (typeof value === 'number' ? value * 100 : value), { serializeOnly: true })
  @IsNumber()
  price!: number;
}

class NestedSyncDto {
  @IsString()
  label!: string;
}

class ParentWithAsyncNestedDto {
  @ValidateNested()
  @Type(() => AsyncTransformDeserializeDto)
  child!: AsyncTransformDeserializeDto;
}

describe('C1 — async architecture (_isAsync / _isSerializeAsync)', () => {
  it('sync DTO → _isAsync === false', () => {
    seal();
    const sealed = (SyncDto as any)[SEALED];
    expect(sealed._isAsync).toBe(false);
  });

  it('async @Transform (deserialize) → _isAsync === true', () => {
    seal();
    const sealed = (AsyncTransformDeserializeDto as any)[SEALED];
    expect(sealed._isAsync).toBe(true);
  });

  it('async createRule → _isAsync === true', () => {
    seal();
    const sealed = (AsyncRuleDto as any)[SEALED];
    expect(sealed._isAsync).toBe(true);
  });

  it('nested async DTO → parent _isAsync === true', () => {
    seal();
    const sealed = (ParentWithAsyncNestedDto as any)[SEALED];
    expect(sealed._isAsync).toBe(true);
  });

  it('async @Transform (serializeOnly) → _isSerializeAsync === true', () => {
    seal();
    const sealed = (AsyncTransformSerializeDto as any)[SEALED];
    expect(sealed._isSerializeAsync).toBe(true);
  });

  it('sync DTO → _isSerializeAsync === false', () => {
    seal();
    const sealed = (SyncDto as any)[SEALED];
    expect(sealed._isSerializeAsync).toBe(false);
  });

  it('async @Transform (deserialize only) → _isSerializeAsync === false', () => {
    seal();
    const sealed = (AsyncTransformDeserializeDto as any)[SEALED];
    expect(sealed._isSerializeAsync).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M3: debug 옵션 — _source 저장
// ─────────────────────────────────────────────────────────────────────────────

describe('M3 — debug option (_source)', () => {
  it('debug: true → _source.deserialize is non-empty string', () => {
    seal({ debug: true });
    const sealed = (SealTestDto as any)[SEALED];
    expect(typeof sealed._source?.deserialize).toBe('string');
    expect(sealed._source?.deserialize.length).toBeGreaterThan(0);
  });

  it('debug: true → _source.serialize is non-empty string', () => {
    seal({ debug: true });
    const sealed = (SealTestDto as any)[SEALED];
    expect(typeof sealed._source?.serialize).toBe('string');
    expect(sealed._source?.serialize.length).toBeGreaterThan(0);
  });

  it('debug: false (default) → _source is undefined', () => {
    seal();
    const sealed = (SealTestDto as any)[SEALED];
    expect(sealed._source).toBeUndefined();
  });

  it('debug: true → _source.deserialize contains field name', () => {
    seal({ debug: true });
    const sealed = (SealTestDto as any)[SEALED];
    expect(sealed._source?.deserialize).toContain('name');
  });
});
