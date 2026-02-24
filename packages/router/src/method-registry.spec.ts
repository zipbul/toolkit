import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { RouterErrData } from './types';

import { MethodRegistry } from './method-registry';

describe('MethodRegistry', () => {
  // ── HP: Happy Path ──

  describe('happy path', () => {
    it('should return correct offsets for all 7 default methods', () => {
      const reg = new MethodRegistry();
      const defaults: Array<[string, number]> = [
        ['GET', 0], ['POST', 1], ['PUT', 2], ['PATCH', 3],
        ['DELETE', 4], ['OPTIONS', 5], ['HEAD', 6],
      ];

      for (const [method, expected] of defaults) {
        const result = reg.getOrCreate(method);
        expect(result).toBe(expected);
      }
    });

    it('should assign next offset when registering new custom method', () => {
      const reg = new MethodRegistry();
      const result = reg.getOrCreate('PROPFIND');

      expect(isErr(result)).toBe(false);
      expect(result).toBe(7);
    });

    it('should assign consecutive offsets for multiple custom methods', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('PROPFIND')).toBe(7);
      expect(reg.getOrCreate('LOCK')).toBe(8);
      expect(reg.getOrCreate('UNLOCK')).toBe(9);
    });

    it('should return offset via get() for registered custom method', () => {
      const reg = new MethodRegistry();
      reg.getOrCreate('PROPFIND');

      expect(reg.get('PROPFIND')).toBe(7);
    });

    it('should return 7 for size on fresh instance', () => {
      const reg = new MethodRegistry();

      expect(reg.size).toBe(7);
    });

    it('should increase size after custom method registration', () => {
      const reg = new MethodRegistry();
      reg.getOrCreate('PROPFIND');

      expect(reg.size).toBe(8);
    });
  });

  // ── ED: Edge ──

  describe('edge cases', () => {
    it('should assign offset for empty string method name', () => {
      const reg = new MethodRegistry();
      const result = reg.getOrCreate('');

      expect(isErr(result)).toBe(false);
      expect(result).toBe(7);
    });

    it('should return undefined from get() for non-existent method', () => {
      const reg = new MethodRegistry();

      expect(reg.get('NONEXISTENT')).toBeUndefined();
    });

    it('should assign offset for very long method name', () => {
      const reg = new MethodRegistry();
      const longName = 'X'.repeat(1000);
      const result = reg.getOrCreate(longName);

      expect(isErr(result)).toBe(false);
      expect(result).toBe(7);
    });

    it('should allow exactly 32 methods and all be accessible via get()', () => {
      const reg = new MethodRegistry();

      // 7 defaults + 25 customs = 32
      for (let i = 0; i < 25; i++) {
        const result = reg.getOrCreate(`CUSTOM_${i}`);
        expect(isErr(result)).toBe(false);
      }

      expect(reg.size).toBe(32);

      // All accessible
      expect(reg.get('GET')).toBe(0);
      expect(reg.get('CUSTOM_0')).toBe(7);
      expect(reg.get('CUSTOM_24')).toBe(31);
    });

    it('should assign offset 31 for the 32nd method (boundary)', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 24; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }

      // 32nd method (7 defaults + 24 = 31, so next = 25th custom = index 31)
      const result = reg.getOrCreate('CUSTOM_24');
      expect(result).toBe(31);
    });

    it('should treat methods as case-sensitive (\'get\' ≠ \'GET\')', () => {
      const reg = new MethodRegistry();

      expect(reg.get('GET')).toBe(0);
      expect(reg.get('get')).toBeUndefined();

      const result = reg.getOrCreate('get');
      expect(result).toBe(7); // New method, not the default 'GET'
    });
  });

  // ── NE: Negative / Error ──

  describe('negative / error', () => {
    function fillToMax(reg: MethodRegistry): void {
      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }
    }

    it('should return err with kind=\'method-limit\' when exceeding 32 methods', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);

      const result = reg.getOrCreate('OVERFLOW');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('method-limit');
      }
    });

    it('should include message in limit error', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);

      const result = reg.getOrCreate('OVERFLOW');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(typeof result.data.message).toBe('string');
        expect(result.data.message.length).toBeGreaterThan(0);
      }
    });

    it('should include method field in limit error matching rejected method', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);

      const result = reg.getOrCreate('REJECTED_METHOD');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.method).toBe('REJECTED_METHOD');
      }
    });

    it('should allow get() for existing methods after limit error', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);
      reg.getOrCreate('OVERFLOW'); // trigger error

      expect(reg.get('GET')).toBe(0);
      expect(reg.get('CUSTOM_0')).toBe(7);
      expect(reg.get('CUSTOM_24')).toBe(31);
    });

    it('should allow getOrCreate() for existing methods after limit error', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);
      reg.getOrCreate('OVERFLOW'); // trigger error

      const result = reg.getOrCreate('GET');
      expect(isErr(result)).toBe(false);
      expect(result).toBe(0);

      const customResult = reg.getOrCreate('CUSTOM_0');
      expect(isErr(customResult)).toBe(false);
      expect(customResult).toBe(7);
    });

    it('should return undefined from get() for method that caused limit error', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);
      reg.getOrCreate('OVERFLOW');

      expect(reg.get('OVERFLOW')).toBeUndefined();
    });

    it('should not change size after limit error', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);

      expect(reg.size).toBe(32);

      reg.getOrCreate('OVERFLOW');
      expect(reg.size).toBe(32);
    });
  });

  // ── CO: Corner ──

  describe('corner cases', () => {
    it('should return existing offset via getOrCreate when at max capacity', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }

      // At max, but requesting existing
      const result = reg.getOrCreate('GET');
      expect(isErr(result)).toBe(false);
      expect(result).toBe(0);
    });

    it('should not double-count when same custom method registered twice', () => {
      const reg = new MethodRegistry();

      reg.getOrCreate('PROPFIND');
      const offsetBefore = reg.getOrCreate('PROPFIND');
      const sizeBefore = reg.size;

      reg.getOrCreate('PROPFIND');

      expect(reg.getOrCreate('PROPFIND')).toBe(offsetBefore);
      expect(reg.size).toBe(sizeBefore);
    });

    it('should keep two MethodRegistry instances fully independent', () => {
      const reg1 = new MethodRegistry();
      const reg2 = new MethodRegistry();

      reg1.getOrCreate('PROPFIND');

      expect(reg1.get('PROPFIND')).toBe(7);
      expect(reg2.get('PROPFIND')).toBeUndefined();
      expect(reg1.size).toBe(8);
      expect(reg2.size).toBe(7);
    });

    it('should handle mixed: add custom → hit limit → getOrCreate existing → ok', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }

      // Hit limit
      const limitResult = reg.getOrCreate('NEW');
      expect(isErr(limitResult)).toBe(true);

      // Existing custom still works
      const existingResult = reg.getOrCreate('CUSTOM_12');
      expect(isErr(existingResult)).toBe(false);
      expect(existingResult).toBe(7 + 12);
    });
  });

  // ── ST: State Transition ──

  describe('state transition', () => {
    it('should complete full lifecycle: construct → fill to 32 → hit limit → reads ok', () => {
      const reg = new MethodRegistry();

      // Phase 1: verify initial state
      expect(reg.size).toBe(7);

      // Phase 2: fill to capacity
      for (let i = 0; i < 25; i++) {
        const result = reg.getOrCreate(`M_${i}`);
        expect(isErr(result)).toBe(false);
        expect(result).toBe(7 + i);
      }

      expect(reg.size).toBe(32);

      // Phase 3: hit limit
      const errResult = reg.getOrCreate('OVER');
      expect(isErr(errResult)).toBe(true);

      // Phase 4: reads still work
      expect(reg.get('GET')).toBe(0);
      expect(reg.get('HEAD')).toBe(6);
      expect(reg.get('M_0')).toBe(7);
      expect(reg.get('M_24')).toBe(31);
    });

    it('should preserve default offsets after adding custom methods', () => {
      const reg = new MethodRegistry();

      reg.getOrCreate('CUSTOM_A');
      reg.getOrCreate('CUSTOM_B');

      expect(reg.getOrCreate('GET')).toBe(0);
      expect(reg.getOrCreate('POST')).toBe(1);
      expect(reg.getOrCreate('HEAD')).toBe(6);
    });

    it('should remain consistent after error (get/getOrCreate still work)', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`C_${i}`);
      }

      // Error
      reg.getOrCreate('FAIL_1');
      reg.getOrCreate('FAIL_2');

      // Still consistent
      expect(reg.size).toBe(32);
      expect(reg.get('GET')).toBe(0);
      expect(reg.get('C_0')).toBe(7);
      expect(reg.getOrCreate('C_0')).toBe(7);
    });

    it('should transition get() from undefined to offset after getOrCreate', () => {
      const reg = new MethodRegistry();

      expect(reg.get('TRACE')).toBeUndefined();

      reg.getOrCreate('TRACE');

      expect(reg.get('TRACE')).toBe(7);
    });
  });

  // ── ID: Idempotency ──

  describe('idempotency', () => {
    it('should return same offset when getOrCreate called twice for default', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('GET')).toBe(0);
      expect(reg.getOrCreate('GET')).toBe(0);
      expect(reg.getOrCreate('HEAD')).toBe(6);
      expect(reg.getOrCreate('HEAD')).toBe(6);
    });

    it('should return same offset and not change size for repeated custom getOrCreate', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('PROPFIND')).toBe(7);
      expect(reg.size).toBe(8);

      expect(reg.getOrCreate('PROPFIND')).toBe(7);
      expect(reg.size).toBe(8);

      expect(reg.getOrCreate('PROPFIND')).toBe(7);
      expect(reg.size).toBe(8);
    });

    it('should return same error kind on repeated limit attempts', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`C_${i}`);
      }

      const r1 = reg.getOrCreate('A');
      const r2 = reg.getOrCreate('B');

      expect(isErr(r1)).toBe(true);
      expect(isErr(r2)).toBe(true);

      if (isErr(r1) && isErr(r2)) {
        expect(r1.data.kind).toBe('method-limit');
        expect(r2.data.kind).toBe('method-limit');
      }
    });
  });

  // ── OR: Ordering ──

  describe('ordering', () => {
    it('should assign offsets to custom methods in registration order', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('ALPHA')).toBe(7);
      expect(reg.getOrCreate('BETA')).toBe(8);
      expect(reg.getOrCreate('GAMMA')).toBe(9);
    });

    it('should assign sequential custom offsets despite interleaved default access', () => {
      const reg = new MethodRegistry();

      reg.getOrCreate('GET'); // default, no new offset
      expect(reg.getOrCreate('ALPHA')).toBe(7);

      reg.getOrCreate('POST'); // default, no new offset
      expect(reg.getOrCreate('BETA')).toBe(8);

      reg.getOrCreate('PUT'); // default
      expect(reg.getOrCreate('GAMMA')).toBe(9);
    });

    it('should not create offset gaps when re-registering existing between new methods', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('A')).toBe(7);
      reg.getOrCreate('A'); // re-register, no gap
      expect(reg.getOrCreate('B')).toBe(8);
      reg.getOrCreate('B'); // re-register, no gap
      expect(reg.getOrCreate('C')).toBe(9);
    });
  });
});
