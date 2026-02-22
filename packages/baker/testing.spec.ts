import { describe, it, expect, afterEach } from 'bun:test';
import { unseal } from './testing';
import { seal, _resetForTesting } from './src/seal/seal';
import { RAW, SEALED } from './src/symbols';
import { globalRegistry } from './src/registry';
import { isString } from './src/rules/typechecker';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const testClasses: Function[] = [];

function registerClass(
  ctor: Function,
  raw: Record<string, unknown>,
): void {
  (ctor as any)[RAW] = raw;
  globalRegistry.add(ctor);
  testClasses.push(ctor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  for (const ctor of testClasses) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[SEALED];
    delete (ctor as any)[RAW];
  }
  testClasses.length = 0;
  _resetForTesting();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('unseal', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should remove SEALED symbol from all sealed classes', () => {
    // Arrange
    class Dto1 {}
    registerClass(Dto1, {
      name: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    });
    seal();
    expect((Dto1 as any)[SEALED]).toBeDefined();
    // Act
    unseal();
    // Assert
    expect((Dto1 as any)[SEALED]).toBeUndefined();
  });

  it('should reset sealed state so seal() can be called again', () => {
    // Arrange
    class Dto2 {}
    registerClass(Dto2, {
      x: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    });
    seal();
    unseal();
    // Act / Assert — seal should succeed (no SealError)
    expect(() => seal()).not.toThrow();
  });

  it('should not throw when called on classes that were never sealed', () => {
    // Arrange — class has no SEALED
    class Dto3 {}
    registerClass(Dto3, {});
    // Act / Assert
    expect(() => unseal()).not.toThrow();
  });

  // ── State Transition ───────────────────────────────────────────────────────

  it('should allow repeated seal → unseal → seal cycle', () => {
    // Arrange
    class Dto4 {}
    registerClass(Dto4, {
      y: { validation: [{ rule: isString }], transform: [], expose: [], exclude: null, type: null, flags: {} },
    });
    // Act — two full cycles
    seal();
    unseal();
    seal();
    unseal();
    // Assert — clean state after both cycles
    expect((Dto4 as any)[SEALED]).toBeUndefined();
    expect(() => seal()).not.toThrow();
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('should produce the same clean state when called twice', () => {
    // Arrange
    class Dto5 {}
    registerClass(Dto5, {});
    seal();
    unseal();
    unseal(); // second call — idempotent
    // Assert — still clean
    expect((Dto5 as any)[SEALED]).toBeUndefined();
  });
});
