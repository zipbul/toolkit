import { describe, it, expect, afterEach } from 'bun:test';
import { seal, SealError, IsString, IsNumber } from '../index';
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
