import { describe, it, expect, afterEach } from 'bun:test';
import { SEALED } from '../symbols';
import { SealError } from '../errors';
import { globalRegistry } from '../registry';
import { _resetForTesting } from '../seal/seal';
import { serialize } from './serialize';
import type { RuntimeOptions } from '../interfaces';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const trackedClasses: Function[] = [];

function makeClass(name = 'TestDto'): new (...args: any[]) => any {
  const ctor = class {} as any;
  Object.defineProperty(ctor, 'name', { value: name });
  trackedClasses.push(ctor);
  return ctor;
}

function attachSealed(
  ctor: Function,
  serializeFn: (instance: unknown, opts?: RuntimeOptions) => Record<string, unknown>,
): void {
  (ctor as any)[SEALED] = {
    _deserialize: () => {},
    _serialize: serializeFn,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  for (const ctor of trackedClasses) {
    globalRegistry.delete(ctor);
    delete (ctor as any)[SEALED];
  }
  trackedClasses.length = 0;
  _resetForTesting();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('serialize', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should return Record when _serialize returns plain object', () => {
    // Arrange
    const Dto = makeClass();
    const record = { name: 'Alice' };
    attachSealed(Dto, () => record);
    const instance = new Dto();
    // Act
    const result = serialize(instance);
    // Assert
    expect(result).toBe(record);
  });

  it('should pass instance and options to _serialize when called', () => {
    // Arrange
    const Dto = makeClass();
    let capturedInstance: unknown;
    let capturedOpts: RuntimeOptions | undefined;
    attachSealed(Dto, (inst, opts) => {
      capturedInstance = inst;
      capturedOpts = opts;
      return { name: 'x' };
    });
    const instance = new Dto();
    const opts: RuntimeOptions = { groups: ['public'] };
    // Act
    serialize(instance, opts);
    // Assert
    expect(capturedInstance).toBe(instance);
    expect(capturedOpts).toBe(opts);
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should throw SealError when instance class has no [SEALED] executor', () => {
    // Arrange
    const Dto = makeClass('UnsealedDto');
    const instance = new Dto();
    // Act & Assert
    expect(() => serialize(instance)).toThrow(SealError);
  });

  it('should include class name in SealError message when not sealed', () => {
    // Arrange
    const Dto = makeClass('MySerializeDto');
    const instance = new Dto();
    let caught: SealError | undefined;
    // Act
    try {
      serialize(instance);
    } catch (e) {
      caught = e as SealError;
    }
    // Assert
    expect(caught).toBeInstanceOf(SealError);
    expect(caught!.message).toContain('MySerializeDto');
  });

  // ── Edge ──────────────────────────────────────────────────────────────────

  it('should return empty object when _serialize returns {} for instance with no registered fields', () => {
    // Arrange
    const Dto = makeClass();
    attachSealed(Dto, () => ({}));
    const instance = new Dto();
    // Act
    const result = serialize(instance);
    // Assert
    expect(result).toEqual({});
  });

  // ── State Transition ───────────────────────────────────────────────────────

  it('should work after sealed is re-attached following deletion', () => {
    // Arrange
    const Dto = makeClass();
    const record1 = { a: 1 };
    const record2 = { b: 2 };
    attachSealed(Dto, () => record1);
    const instance = new Dto();
    serialize(instance);
    // Simulate re-seal
    delete (Dto as any)[SEALED];
    attachSealed(Dto, () => record2);
    // Act
    const result = serialize(instance);
    // Assert
    expect(result).toBe(record2);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('should return identical Record on repeated calls with same instance', () => {
    // Arrange
    const Dto = makeClass();
    const record = { name: 'Bob' };
    attachSealed(Dto, () => record);
    const instance = new Dto();
    // Act
    const r1 = serialize(instance);
    const r2 = serialize(instance);
    // Assert
    expect(r1).toBe(record);
    expect(r2).toBe(record);
    expect(r1).toBe(r2);
  });
});
