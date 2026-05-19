import { isErr } from '@zipbul/result';
import { describe, it, expect } from 'bun:test';

import { MethodRegistry } from './method-registry';
import { RouterErrorKind } from './types';

describe('MethodRegistry', () => {
  describe('happy path', () => {
    it('should return correct offsets for all 7 default methods', () => {
      const reg = new MethodRegistry();
      const defaults: Array<[string, number]> = [
        ['GET', 0],
        ['POST', 1],
        ['PUT', 2],
        ['PATCH', 3],
        ['DELETE', 4],
        ['OPTIONS', 5],
        ['HEAD', 6],
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

  describe('edge cases', () => {
    it('should reject empty string method name', () => {
      const reg = new MethodRegistry();
      const result = reg.getOrCreate('');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect([RouterErrorKind.MethodEmpty, 'method-too-long', RouterErrorKind.MethodInvalidToken]).toContain(result.data.kind);
      }
    });

    it('should return undefined from get() for non-existent method', () => {
      const reg = new MethodRegistry();

      expect(reg.get('NONEXISTENT')).toBeUndefined();
    });

    it('should accept arbitrarily long valid-tchar method names (no length cap; RFC 9110 §2.3)', () => {
      const reg = new MethodRegistry();
      const longName = 'X'.repeat(1000);
      const result = reg.getOrCreate(longName);

      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(typeof result).toBe('number');
        expect(reg.get(longName)).toBe(result);
      }
    });

    it('should allow exactly 32 methods and all be accessible via get()', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 25; i++) {
        const result = reg.getOrCreate(`CUSTOM_${i}`);
        expect(isErr(result)).toBe(false);
      }

      expect(reg.size).toBe(32);

      expect(reg.get('GET')).toBe(0);
      expect(reg.get('CUSTOM_0')).toBe(7);
      expect(reg.get('CUSTOM_24')).toBe(31);
    });

    it('should assign offset 31 for the 32nd method (boundary)', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 24; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }

      const result = reg.getOrCreate('CUSTOM_24');
      expect(result).toBe(31);
    });

    it("should treat methods as case-sensitive ('get' ≠ 'GET')", () => {
      const reg = new MethodRegistry();

      expect(reg.get('GET')).toBe(0);
      expect(reg.get('get')).toBeUndefined();

      const result = reg.getOrCreate('get');
      expect(result).toBe(7);
    });
  });

  describe('negative / error', () => {
    function fillToMax(reg: MethodRegistry): void {
      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }
    }

    it('should return err with kind=RouterErrorKind.MethodLimit when exceeding 32 methods', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);

      const result = reg.getOrCreate('OVERFLOW');

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.MethodLimit);
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
      reg.getOrCreate('OVERFLOW');
      expect(reg.get('GET')).toBe(0);
      expect(reg.get('CUSTOM_0')).toBe(7);
      expect(reg.get('CUSTOM_24')).toBe(31);
    });

    it('should allow getOrCreate() for existing methods after limit error', () => {
      const reg = new MethodRegistry();
      fillToMax(reg);
      reg.getOrCreate('OVERFLOW');
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

  describe('corner cases', () => {
    it('should return existing offset via getOrCreate when at max capacity', () => {
      const reg = new MethodRegistry();

      for (let i = 0; i < 25; i++) {
        reg.getOrCreate(`CUSTOM_${i}`);
      }

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

      const limitResult = reg.getOrCreate('NEW');
      expect(isErr(limitResult)).toBe(true);

      const existingResult = reg.getOrCreate('CUSTOM_12');
      expect(isErr(existingResult)).toBe(false);
      expect(existingResult).toBe(7 + 12);
    });
  });

  describe('state transition', () => {
    it('should complete full lifecycle: construct → fill to 32 → hit limit → reads ok', () => {
      const reg = new MethodRegistry();

      expect(reg.size).toBe(7);

      for (let i = 0; i < 25; i++) {
        const result = reg.getOrCreate(`M_${i}`);
        expect(isErr(result)).toBe(false);
        expect(result).toBe(7 + i);
      }

      expect(reg.size).toBe(32);

      const errResult = reg.getOrCreate('OVER');
      expect(isErr(errResult)).toBe(true);

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

      reg.getOrCreate('FAIL_1');
      reg.getOrCreate('FAIL_2');

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
        expect(r1.data.kind).toBe(RouterErrorKind.MethodLimit);
        expect(r2.data.kind).toBe(RouterErrorKind.MethodLimit);
      }
    });
  });

  describe('ordering', () => {
    it('should assign offsets to custom methods in registration order', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('ALPHA')).toBe(7);
      expect(reg.getOrCreate('BETA')).toBe(8);
      expect(reg.getOrCreate('GAMMA')).toBe(9);
    });

    it('should assign sequential custom offsets despite interleaved default access', () => {
      const reg = new MethodRegistry();

      reg.getOrCreate('GET');
      expect(reg.getOrCreate('ALPHA')).toBe(7);

      reg.getOrCreate('POST');
      expect(reg.getOrCreate('BETA')).toBe(8);

      reg.getOrCreate('PUT');
      expect(reg.getOrCreate('GAMMA')).toBe(9);
    });

    it('should not create offset gaps when re-registering existing between new methods', () => {
      const reg = new MethodRegistry();

      expect(reg.getOrCreate('A')).toBe(7);
      reg.getOrCreate('A');
      expect(reg.getOrCreate('B')).toBe(8);
      reg.getOrCreate('B');
      expect(reg.getOrCreate('C')).toBe(9);
    });
  });

  describe('getCodeMap', () => {
    it('should expose every default method with the same offset as getOrCreate', () => {
      const reg = new MethodRegistry();
      const map = reg.getCodeMap();

      expect(map.GET).toBe(0);
      expect(map.POST).toBe(1);
      expect(map.PUT).toBe(2);
      expect(map.PATCH).toBe(3);
      expect(map.DELETE).toBe(4);
      expect(map.OPTIONS).toBe(5);
      expect(map.HEAD).toBe(6);
    });

    it('should reflect newly registered custom methods immediately', () => {
      const reg = new MethodRegistry();
      reg.getOrCreate('PROPFIND');
      const map = reg.getCodeMap();

      expect(map.PROPFIND).toBe(7);
    });

    it('should be a prototype-less object so unrelated property reads return undefined', () => {
      const reg = new MethodRegistry();
      const map = reg.getCodeMap() as unknown as Record<string, unknown>;

      expect(Object.getPrototypeOf(map)).toBeNull();
      expect(map.toString).toBeUndefined();
      expect(map.hasOwnProperty).toBeUndefined();
    });

    it('should agree with getAllCodes() entry-by-entry', () => {
      const reg = new MethodRegistry();
      reg.getOrCreate('PROPFIND');
      reg.getOrCreate('LOCK');

      const map = reg.getCodeMap();

      for (const [name, code] of reg.getAllCodes()) {
        expect(map[name]).toBe(code);
      }
    });
  });
});
