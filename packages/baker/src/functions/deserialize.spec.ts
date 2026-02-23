import { describe, it, expect, afterEach, mock } from 'bun:test';
import { err } from '@zipbul/result';
import { SEALED } from '../symbols';
import { BakerValidationError, SealError } from '../errors';
import { globalRegistry } from '../registry';
import { _resetForTesting } from '../seal/seal';
// SUT을 동적으로 import — 모듈 레벨에서 테스트 더블 설정 후 import
// 간단 구현이므로 직접 import 사용
import { deserialize } from './deserialize';
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
  deserializeFn: (input: unknown, opts?: RuntimeOptions) => unknown,
  serializeFn: (instance: unknown, opts?: RuntimeOptions) => Record<string, unknown> = () => ({}),
): void {
  (ctor as any)[SEALED] = {
    _deserialize: deserializeFn,
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

describe('deserialize', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should return T instance when _deserialize returns valid value', async () => {
    // Arrange
    const Dto = makeClass();
    const instance = new Dto();
    attachSealed(Dto, () => instance);
    // Act
    const result = await deserialize(Dto, { name: 'Alice' });
    // Assert
    expect(result).toBe(instance);
  });

  it('should pass options to _deserialize when RuntimeOptions provided', async () => {
    // Arrange
    const Dto = makeClass();
    const instance = new Dto();
    let capturedOpts: RuntimeOptions | undefined;
    attachSealed(Dto, (_input, opts) => {
      capturedOpts = opts;
      return instance;
    });
    const opts: RuntimeOptions = { groups: ['admin'] };
    // Act
    await deserialize(Dto, {}, opts);
    // Assert
    expect(capturedOpts).toBe(opts);
  });

  it('should pass input to _deserialize when called with object input', async () => {
    // Arrange
    const Dto = makeClass();
    const instance = new Dto();
    let capturedInput: unknown;
    attachSealed(Dto, (input) => {
      capturedInput = input;
      return instance;
    });
    const payload = { name: 'Bob', extra: 'ignored' };
    // Act
    await deserialize(Dto, payload);
    // Assert
    expect(capturedInput).toBe(payload);
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should throw SealError when class has no [SEALED] executor', async () => {
    // Arrange
    const Dto = makeClass('UnsealedDto');
    // Act & Assert
    await expect(deserialize(Dto, {})).rejects.toThrow(SealError);
  });

  it('should include class name in SealError message when not sealed', async () => {
    // Arrange
    const Dto = makeClass('MyDto');
    let caught: SealError | undefined;
    // Act
    try {
      await deserialize(Dto, {});
    } catch (e) {
      caught = e as SealError;
    }
    // Assert
    expect(caught).toBeInstanceOf(SealError);
    expect(caught!.message).toContain('MyDto');
  });

  it('should throw BakerValidationError when _deserialize returns Err', async () => {
    // Arrange
    const Dto = makeClass();
    const errors = [{ path: 'name', code: 'isString' }];
    attachSealed(Dto, () => err(errors));
    // Act & Assert
    await expect(deserialize(Dto, { name: 42 })).rejects.toThrow(BakerValidationError);
  });

  it('should attach errors array to BakerValidationError when _deserialize fails', async () => {
    // Arrange
    const Dto = makeClass();
    const errors = [{ path: 'name', code: 'isString' }, { path: 'email', code: 'isEmail' }];
    attachSealed(Dto, () => err(errors));
    let caught: BakerValidationError | undefined;
    // Act
    try {
      await deserialize(Dto, {});
    } catch (e) {
      caught = e as BakerValidationError;
    }
    // Assert
    expect(caught).toBeInstanceOf(BakerValidationError);
    expect(caught!.errors).toEqual(errors);
  });

  it('should throw BakerValidationError(code:invalidInput) when _deserialize returns invalidInput error', async () => {
    // Arrange
    const Dto = makeClass();
    attachSealed(Dto, () => err([{ path: '', code: 'invalidInput' }]));
    let caught: BakerValidationError | undefined;
    // Act
    try {
      await deserialize(Dto, null);
    } catch (e) {
      caught = e as BakerValidationError;
    }
    // Assert
    expect(caught).toBeInstanceOf(BakerValidationError);
    expect(caught!.errors[0].code).toBe('invalidInput');
  });

  it('should throw BakerValidationError when _deserialize returns Err for array input', async () => {
    // Arrange
    const Dto = makeClass();
    attachSealed(Dto, () => err([{ path: '', code: 'invalidInput' }]));
    // Act & Assert
    await expect(deserialize(Dto, [1, 2, 3])).rejects.toThrow(BakerValidationError);
  });

  // ── Edge ──────────────────────────────────────────────────────────────────

  it('should return T when _deserialize succeeds with empty {} input for class with no fields', async () => {
    // Arrange
    const Dto = makeClass();
    const instance = new Dto();
    attachSealed(Dto, () => instance);
    // Act
    const result = await deserialize(Dto, {});
    // Assert
    expect(result).toBe(instance);
  });

  // ── State Transition ───────────────────────────────────────────────────────

  it('should work again when [SEALED] is re-attached after being deleted', async () => {
    // Arrange
    const Dto = makeClass();
    const instance1 = new Dto();
    const instance2 = new Dto();
    attachSealed(Dto, () => instance1);
    await deserialize(Dto, {});
    // Simulate unseal: remove SEALED
    delete (Dto as any)[SEALED];
    // Simulate re-seal: re-attach SEALED
    attachSealed(Dto, () => instance2);
    // Act
    const result = await deserialize(Dto, {});
    // Assert
    expect(result).toBe(instance2);
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('should return independent T instances on repeated calls with same input', async () => {
    // Arrange
    const Dto = makeClass();
    let idx = 0;
    const instances = [new Dto(), new Dto()];
    attachSealed(Dto, () => instances[idx++]);
    const input = { name: 'Alice' };
    // Act
    const r1 = await deserialize(Dto, input);
    const r2 = await deserialize(Dto, input);
    // Assert
    expect(r1).toBe(instances[0]);
    expect(r2).toBe(instances[1]);
  });
});
