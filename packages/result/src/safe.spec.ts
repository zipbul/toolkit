import { describe, expect, it, mock } from 'bun:test';

import { isErr } from './is-err';
import { safe } from './safe';

describe('safe', () => {
  describe('sync happy path', () => {
    it('should return fn result when sync fn succeeds', () => {
      // Arrange
      const fn = () => 42;
      // Act
      const result = safe(fn);
      // Assert
      expect(result).toBe(42);
    });

    it('should return null when sync fn returns null', () => {
      // Arrange
      const fn = () => null;
      // Act
      const result = safe(fn);
      // Assert
      expect(result).toBeNull();
    });

    it('should not call mapErr when sync fn succeeds', () => {
      // Arrange
      const fn = () => 'ok';
      const mapErr = mock(() => 'mapped');
      // Act
      safe(fn, mapErr);
      // Assert
      expect(mapErr).not.toHaveBeenCalled();
    });
  });

  describe('async happy path', () => {
    it('should resolve value when promise resolves', async () => {
      // Arrange
      const promise = Promise.resolve(42);
      // Act
      const result = await safe(promise);
      // Assert
      expect(result).toBe(42);
    });

    it('should resolve undefined when promise resolves with undefined', async () => {
      // Arrange
      const promise = Promise.resolve(undefined);
      // Act
      const result = await safe(promise);
      // Assert
      expect(result).toBeUndefined();
    });

    it('should not call mapErr when promise resolves', async () => {
      // Arrange
      const promise = Promise.resolve('ok');
      const mapErr = mock(() => 'mapped');
      // Act
      await safe(promise, mapErr);
      // Assert
      expect(mapErr).not.toHaveBeenCalled();
    });
  });

  describe('sync error without mapErr', () => {
    it('should return Err when sync fn throws Error', () => {
      // Arrange
      const fn = () => { throw new Error('boom'); };
      // Act
      const result = safe(fn);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBeInstanceOf(Error);
        expect((result.data as Error).message).toBe('boom');
      }
    });

    it('should return Err when sync fn throws string', () => {
      // Arrange
      const fn = () => { throw 'string error'; };
      // Act
      const result = safe(fn);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBe('string error');
      }
    });

    it('should return Err wrapping null when sync fn throws null', () => {
      // Arrange
      const fn = () => { throw null; };
      // Act
      const result = safe(fn);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBeNull();
      }
    });

    it('should return Err wrapping undefined when sync fn throws undefined', () => {
      // Arrange
      // eslint-disable-next-line no-throw-literal
      const fn = () => { throw undefined; };
      // Act
      const result = safe(fn);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBeUndefined();
      }
    });
  });

  describe('sync error with mapErr', () => {
    it('should return mapped Err when sync fn throws with mapErr', () => {
      // Arrange
      const fn = () => { throw new Error('fail'); };
      const mapErr = (e: unknown) => (e as Error).message;
      // Act
      const result = safe(fn, mapErr);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBe('fail');
      }
    });

    it('should pass exact thrown reference to sync mapErr', () => {
      // Arrange
      const thrownObj = { code: 'X' };
      const fn = () => { throw thrownObj; };
      let received: unknown;
      const mapErr = (e: unknown) => { received = e; return 'mapped'; };
      // Act
      safe(fn, mapErr);
      // Assert
      expect(received).toBe(thrownObj);
    });
  });

  describe('async error without mapErr', () => {
    it('should resolve to Err when promise rejects with Error', async () => {
      // Arrange
      const promise = Promise.reject(new Error('async boom'));
      // Act
      const result = await safe(promise);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBeInstanceOf(Error);
        expect((result.data as Error).message).toBe('async boom');
      }
    });

    it('should resolve to Err when promise rejects with string', async () => {
      // Arrange
      const promise = Promise.reject('async string error');
      // Act
      const result = await safe(promise);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBe('async string error');
      }
    });

    it('should resolve to Err wrapping null when promise rejects with null', async () => {
      // Arrange
      const promise = Promise.reject(null);
      // Act
      const result = await safe(promise);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBeNull();
      }
    });
  });

  describe('async error with mapErr', () => {
    it('should resolve to mapped Err when promise rejects with mapErr', async () => {
      // Arrange
      const promise = Promise.reject(new Error('async fail'));
      const mapErr = (e: unknown) => (e as Error).message;
      // Act
      const result = await safe(promise, mapErr);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBe('async fail');
      }
    });

    it('should pass exact rejected reference to async mapErr', async () => {
      // Arrange
      const rejectedObj = { code: 'Y' };
      const promise = Promise.reject(rejectedObj);
      let received: unknown;
      const mapErr = (e: unknown) => { received = e; return 'mapped'; };
      // Act
      await safe(promise, mapErr);
      // Assert
      expect(received).toBe(rejectedObj);
    });
  });

  describe('edge cases', () => {
    it('should take sync path when fn returns Promise (not unwrap)', () => {
      // Arrange
      const innerPromise = Promise.resolve(99);
      const fn = () => innerPromise;
      // Act
      const result = safe(fn);
      // Assert — result IS the Promise object, not 99
      expect(result).toBe(innerPromise);
    });

    it('should return undefined when sync fn has no return', () => {
      // Arrange
      const fn = () => {};
      // Act
      const result = safe(fn);
      // Assert
      expect(result).toBeUndefined();
    });

    it('should use async path for Promise subclass', async () => {
      // Arrange
      class MyPromise<T> extends Promise<T> {}
      const promise = MyPromise.resolve(77);
      // Act
      const result = await safe(promise);
      // Assert
      expect(result).toBe(77);
    });

    it('should not inspect return value and return Err-like object as success', () => {
      // Arrange — fn returns object that looks like Err
      const errLike = { data: 'not real' };
      const fn = () => errLike;
      // Act
      const result = safe(fn);
      // Assert — safe returns it as-is (success value)
      expect(result).toBe(errLike);
    });
  });

  describe('corner cases', () => {
    it('should propagate when sync mapErr throws', () => {
      // Arrange
      const fn = () => { throw new Error('original'); };
      const mapErr = () => { throw new Error('mapErr panic'); };
      // Act / Assert — mapErr throw is NOT caught by safe
      expect(() => safe(fn, mapErr)).toThrow('mapErr panic');
    });

    it('should reject when async mapErr throws', async () => {
      // Arrange
      const promise = Promise.reject(new Error('original'));
      const mapErr = () => { throw new Error('async mapErr panic'); };
      // Act / Assert — the returned promise rejects with mapErr's error
      await expect(safe(promise, mapErr)).rejects.toThrow('async mapErr panic');
    });

    it('should return Err with undefined data when mapErr returns undefined', () => {
      // Arrange
      const fn = () => { throw new Error('fail'); };
      const mapErr = () => undefined;
      // Act
      const result = safe(fn, mapErr);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data).toBeUndefined();
      }
    });
  });
});
