import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';

// ── Helpers ──

function catchRouterError(fn: () => void): RouterError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RouterError);
    return e as RouterError;
  }
  throw new Error('Expected RouterError to be thrown');
}

describe('Router<T> combinations', () => {
  // ── Option × Cache (4 tests) ──

  describe('option × cache', () => {
    it('should use lowered cache key when caseSensitive=false + cache enabled', () => {
      const router = new Router<string>({ caseSensitive: false, enableCache: true });
      router.add('GET', '/users/:id', 'val');
      router.build();

      const r1 = router.match('GET', '/Users/123');
      expect(r1).not.toBeNull();
      expect(r1!.meta.source).toBe('dynamic');

      const r2 = router.match('GET', '/USERS/123');
      expect(r2).not.toBeNull();
      expect(r2!.meta.source).toBe('cache');
      expect(r2!.params.id).toBe('123');
    });

    it('should share cache entry for trailing-slash and non-trailing-slash paths when ignoreTrailingSlash + cache', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true, enableCache: true });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const r1 = router.match('GET', '/api/42/');
      expect(r1).not.toBeNull();
      expect(r1!.meta.source).toBe('dynamic');

      const r2 = router.match('GET', '/api/42');
      expect(r2).not.toBeNull();
      expect(r2!.value).toBe('val');
      expect(r2!.meta.source).toBe('cache');
    });

    it('should store decoded params in cache and return decoded on cache hit when decodeParams + cache', () => {
      const router = new Router<string>({ decodeParams: true, enableCache: true });
      router.add('GET', '/items/:name', 'val');
      router.build();

      const r1 = router.match('GET', '/items/hello%20world');
      expect(r1).not.toBeNull();
      expect(r1!.params.name).toBe('hello world');
      expect(r1!.meta.source).toBe('dynamic');

      const r2 = router.match('GET', '/items/hello%20world');
      expect(r2).not.toBeNull();
      expect(r2!.params.name).toBe('hello world');
      expect(r2!.meta.source).toBe('cache');
    });

    it('should store optional param defaults in cache and return them on cache hit', () => {
      const router = new Router<string>({
        optionalParamBehavior: 'setUndefined',
        enableCache: true,
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      const r1 = router.match('GET', '/items');
      expect(r1).not.toBeNull();
      expect('id' in r1!.params).toBe(true);
      expect(r1!.params.id).toBeUndefined();

      const r2 = router.match('GET', '/items');
      expect(r2).not.toBeNull();
      expect(r2!.meta.source).toBe('cache');
      expect('id' in r2!.params).toBe(true);
      expect(r2!.params.id).toBeUndefined();
    });
  });

  // ── Option × Option Pipeline (3 tests) ──

  describe('option × option pipeline', () => {
    it('should strip trailing slash when ignoreTrailingSlash=true', () => {
      const router = new Router<string>({
        ignoreTrailingSlash: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const result = router.match('GET', '/api/42/');
      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('42');
    });

    it('should not match trailing slash when ignoreTrailingSlash=false', () => {
      const router = new Router<string>({
        ignoreTrailingSlash: false,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const r1 = router.match('GET', '/api/42/');
      expect(r1).toBeNull();

      const r2 = router.match('GET', '/api/42');
      expect(r2).not.toBeNull();
      expect(r2!.params.id).toBe('42');
    });

    it('should return raw params when decodeParams=false', () => {
      const router = new Router<string>({
        decodeParams: false,
      });
      router.add('GET', '/items/:name', 'val');
      router.build();

      const result = router.match('GET', '/items/hello%20world');
      expect(result).not.toBeNull();
      expect(result!.params.name).toBe('hello%20world');
    });
  });

  // ── Option × Route Type (6 tests) ──

  describe('option × route type', () => {
    it('should match lowered input against regex param when caseSensitive=false', () => {
      const router = new Router<string>({ caseSensitive: false });
      router.add('GET', '/users/:id{\\d+}', 'val');
      router.build();

      const result = router.match('GET', '/USERS/42');
      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('42');
    });

    it('should treat stripped trailing slash as optional param absent when ignoreTrailingSlash + optional param', () => {
      const router = new Router<string>({
        ignoreTrailingSlash: true,
        optionalParamBehavior: 'setUndefined',
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      const result = router.match('GET', '/items/');
      expect(result).not.toBeNull();
      expect('id' in result!.params).toBe(true);
      expect(result!.params.id).toBeUndefined();
    });

    it('should capture empty suffix when ignoreTrailingSlash strips wildcard trailing slash', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true });
      router.add('GET', '/files/*', 'val');
      router.build();

      const result = router.match('GET', '/files/');
      expect(result).not.toBeNull();
      expect(result!.params['*']).toBe('');
    });

    it('should not decode wildcard suffix (raw URL remainder)', () => {
      const router = new Router<string>({
        decodeParams: true,
      });
      router.add('GET', '/files/*path', 'val');
      router.build();

      const result = router.match('GET', '/files/a%20b/c');
      expect(result).not.toBeNull();
      expect(result!.params.path).toBe('a%20b/c');
    });

    it('should cache each optional param variant separately (absent vs present)', () => {
      const router = new Router<string>({
        optionalParamBehavior: 'setUndefined',
        enableCache: true,
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      // Present
      const r1 = router.match('GET', '/items/42');
      expect(r1).not.toBeNull();
      expect(r1!.params.id).toBe('42');

      // Absent
      const r2 = router.match('GET', '/items');
      expect(r2).not.toBeNull();
      expect('id' in r2!.params).toBe(true);
      expect(r2!.params.id).toBeUndefined();

      // Cache hits preserve distinct values
      const r3 = router.match('GET', '/items/42');
      expect(r3!.meta.source).toBe('cache');
      expect(r3!.params.id).toBe('42');

      const r4 = router.match('GET', '/items');
      expect(r4!.meta.source).toBe('cache');
      expect(r4!.params.id).toBeUndefined();
    });

    it('should strip query string before dynamic param extraction', () => {
      const router = new Router<string>();
      router.add('GET', '/api/:id', 'val');
      router.build();

      const result = router.match('GET', '/api/42?key=value&foo=bar');
      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('42');
    });
  });

  // ── Triple+ / Mega Combinations (3 tests) ──

  describe('triple+ combinations', () => {
    it('should apply caseSensitive=false + ignoreTrailingSlash + cache as triple transform with consistent cache key', () => {
      const router = new Router<string>({
        caseSensitive: false,
        ignoreTrailingSlash: true,
        enableCache: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const r1 = router.match('GET', '/API/42/');
      expect(r1).not.toBeNull();
      expect(r1!.meta.source).toBe('dynamic');

      const r2 = router.match('GET', '/Api/42');
      expect(r2).not.toBeNull();
      expect(r2!.meta.source).toBe('cache');
      expect(r2!.params.id).toBe('42');
    });

    it('should match correctly with remaining options enabled simultaneously', () => {
      const router = new Router<string>({
        caseSensitive: false,
        ignoreTrailingSlash: true,
        decodeParams: true,
        enableCache: true,
        cacheSize: 10,
        maxSegmentLength: 256,
        optionalParamBehavior: 'setUndefined',
        regexSafety: { mode: 'error' },
        regexAnchorPolicy: 'silent',
      });
      router.add('GET', '/api/:category/:id?', 'val');
      router.build();

      const result = router.match('GET', '/API/Products/42/');
      expect(result).not.toBeNull();
      expect(result!.params.category).toBe('products');
      expect(result!.params.id).toBe('42');

      const r2 = router.match('GET', '/api/tools');
      expect(r2).not.toBeNull();
      expect(r2!.params.category).toBe('tools');
      expect('id' in r2!.params).toBe(true);
      expect(r2!.params.id).toBeUndefined();
    });

    it('should store empty-string defaults in cache when optionalParamBehavior=setEmptyString + cache', () => {
      const router = new Router<string>({
        optionalParamBehavior: 'setEmptyString',
        enableCache: true,
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      const r1 = router.match('GET', '/items');
      expect(r1).not.toBeNull();
      expect(r1!.params.id).toBe('');

      const r2 = router.match('GET', '/items');
      expect(r2).not.toBeNull();
      expect(r2!.meta.source).toBe('cache');
      expect(r2!.params.id).toBe('');
    });
  });

  // ── Error Combinations (1 test) ──

  describe('error combinations', () => {
    it('should still error on long segment in match', () => {
      const router = new Router<string>({
        maxSegmentLength: 10,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const longSeg = 'a'.repeat(20);

      const err = catchRouterError(() => router.match('GET', `/api/${longSeg}`));
      expect(err.data.kind).toBe('segment-limit');
    });
  });
});
