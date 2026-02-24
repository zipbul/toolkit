import { describe, it, expect, spyOn } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';
import type { RouterErrData, MatchOutput } from '../types';

import { Router } from '../router';

// ── Helpers ──

function expectNotErr<T>(result: T | Err<RouterErrData>): asserts result is Exclude<T, Err<RouterErrData>> {
  expect(isErr(result)).toBe(false);
}

function expectErr(result: unknown): asserts result is Err<RouterErrData> {
  expect(isErr(result)).toBe(true);
}

describe('Router<T> combinations', () => {
  // ── Option × Cache (6 tests) ──

  describe('option × cache', () => {
    it('should use lowered cache key when caseSensitive=false + cache enabled', () => {
      const router = new Router<string>({ caseSensitive: false, enableCache: true });
      router.add('GET', '/users/:id', 'val');
      router.build();

      // First: /Users/123 → lowered to /users/123 → dynamic match
      const r1 = router.match('GET', '/Users/123');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.meta.source).toBe('dynamic');

      // Second: /USERS/123 → lowered to /users/123 → same cache key → cache hit
      const r2 = router.match('GET', '/USERS/123');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.meta.source).toBe('cache');
        expect(r2.params.id).toBe('123');
      }
    });

    it('should share cache entry for trailing-slash and non-trailing-slash paths when ignoreTrailingSlash + cache', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true, enableCache: true });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // /api/42/ → trailing stripped → searchPath /api/42
      const r1 = router.match('GET', '/api/42/');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.meta.source).toBe('dynamic');

      // /api/42 → same searchPath → cache hit
      const r2 = router.match('GET', '/api/42');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.value).toBe('val');
        expect(r2.meta.source).toBe('cache');
      }
    });

    it('should produce separate cache entries for collapsed vs non-collapsed paths when collapseSlashes + cache', () => {
      const router = new Router<string>({ collapseSlashes: true, enableCache: true });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const r1 = router.match('GET', '/api/42');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.meta.source).toBe('dynamic');

      // //api//42 → searchPath unchanged (collapse happens in normalize, not pre-match)
      // Different cache key from /api/42
      const r2 = router.match('GET', '//api//42');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) expect(r2.meta.source).toBe('dynamic'); // NOT cache

      // Same collapsed path → cache hit for this key
      const r3 = router.match('GET', '//api//42');
      expectNotErr(r3);
      expect(r3).not.toBeNull();
      if (r3 !== null) expect(r3.meta.source).toBe('cache');
    });

    it('should produce separate cache entries for traversal vs clean paths when blockTraversal + cache', () => {
      const router = new Router<string>({ blockTraversal: true, enableCache: true });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const r1 = router.match('GET', '/api/42');
      expectNotErr(r1);
      expect(r1).not.toBeNull();

      // /api/x/../42 resolves to /api/42 but has different cache key
      const r2 = router.match('GET', '/api/x/../42');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.meta.source).toBe('dynamic'); // separate cache entry
        expect(r2.params.id).toBe('42');
      }
    });

    it('should store decoded params in cache and return decoded on cache hit when decodeParams + cache', () => {
      const router = new Router<string>({ decodeParams: true, enableCache: true });
      router.add('GET', '/items/:name', 'val');
      router.build();

      const r1 = router.match('GET', '/items/hello%20world');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) {
        expect(r1.params.name).toBe('hello world');
        expect(r1.meta.source).toBe('dynamic');
      }

      // Cache hit returns decoded params
      const r2 = router.match('GET', '/items/hello%20world');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.params.name).toBe('hello world');
        expect(r2.meta.source).toBe('cache');
      }
    });

    it('should store optional param defaults in cache and return them on cache hit', () => {
      const router = new Router<string>({
        optionalParamBehavior: 'setUndefined',
        enableCache: true,
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      const r1 = router.match('GET', '/items');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) {
        expect('id' in r1.params).toBe(true);
        expect(r1.params.id).toBeUndefined();
      }

      // Cache hit also has the default
      const r2 = router.match('GET', '/items');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.meta.source).toBe('cache');
        expect('id' in r2.params).toBe(true);
        expect(r2.params.id).toBeUndefined();
      }
    });
  });

  // ── Option × Option Pipeline (8 tests) ──

  describe('option × option pipeline', () => {
    it('should lower path and resolve dot segments when caseSensitive=false + blockTraversal', () => {
      const router = new Router<string>({ caseSensitive: false, blockTraversal: true });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // /API/../API/42 → lowered to /api/../api/42 → dots resolved to /api/42
      const result = router.match('GET', '/API/../API/42');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('val');
        expect(result.params.id).toBe('42');
      }
    });

    it('should reject lowercase-hex encoded slash when caseSensitive=false + encodedSlash=reject', () => {
      const router = new Router<string>({
        caseSensitive: false,
        encodedSlashBehavior: 'reject',
        failFastOnBadEncoding: true,
      });
      router.add('GET', '/items/:id', 'val');
      router.build();

      // /items/a%2Fb → lowered to /items/a%2fb → decoder detects %2f → encoded-slash error
      const result = router.match('GET', '/items/a%2Fb');
      expectErr(result);
      expect(result.data.kind).toBe('encoded-slash');
    });

    it('should strip trailing slash and collapse multi-slashes when ignoreTrailingSlash + collapseSlashes', () => {
      const router = new Router<string>({
        ignoreTrailingSlash: true,
        collapseSlashes: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // //api//42/ → trailing strip → //api//42 → normalize: collapse → /api/42
      const result = router.match('GET', '//api//42/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('42');
      }
    });

    it('should apply triple pipeline (collapse + blockTraversal + ignoreTrailingSlash) in correct order', () => {
      const router = new Router<string>({
        collapseSlashes: true,
        blockTraversal: true,
        ignoreTrailingSlash: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // //api//x/../42/ → trailing strip → //api//x/../42
      // normalize: dots → ['','api','','42'] → collapse → ['api','42'] → /api/42
      const result = router.match('GET', '//api//x/../42/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('42');
      }
    });

    it('should preserve all slashes and trailing slash in strict mode (collapseSlashes=false + ignoreTrailingSlash=false)', () => {
      const router = new Router<string>({
        collapseSlashes: false,
        ignoreTrailingSlash: false,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // //api/42 → no collapse → segments include empty '' → doesn't match /api/:id
      const r1 = router.match('GET', '//api/42');
      expectNotErr(r1);
      expect(r1).toBeNull();

      // /api/42/ → no trailing strip → extra empty segment → no match
      const r2 = router.match('GET', '/api/42/');
      expectNotErr(r2);
      expect(r2).toBeNull();

      // Clean path still matches
      const r3 = router.match('GET', '/api/42');
      expectNotErr(r3);
      expect(r3).not.toBeNull();
      if (r3 !== null) {
        expect(r3.params.id).toBe('42');
      }
    });

    it('should resolve encoded dot-dot segments %2E%2E as traversal when blockTraversal enabled', () => {
      const router = new Router<string>({ blockTraversal: true });
      router.add('GET', '/safe/:id', 'val');
      router.build();

      // %2E%2E is treated as '..' by resolveDotSegments
      const result = router.match('GET', '/safe/%2E%2E/safe/42');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('42');
      }
    });

    it('should return raw params when encodedSlash=preserve even with decodeParams=true', () => {
      const router = new Router<string>({
        encodedSlashBehavior: 'preserve',
        decodeParams: true,
      });
      router.add('GET', '/items/:name', 'val');
      router.build();

      // 'preserve' decoder returns raw string regardless of decodeParams
      const result = router.match('GET', '/items/hello%20world');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.name).toBe('hello%20world');
      }
    });

    it('should return raw params when decodeParams=false even with encodedSlash=decode', () => {
      const router = new Router<string>({
        encodedSlashBehavior: 'decode',
        decodeParams: false,
      });
      router.add('GET', '/items/:name', 'val');
      router.build();

      // decodeParams=false → decodeAndCache returns raw without calling decoder
      const result = router.match('GET', '/items/hello%20world');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.name).toBe('hello%20world');
      }
    });
  });

  // ── Option × Route Type (7 tests) ──

  describe('option × route type', () => {
    it('should match lowered input against regex param when caseSensitive=false', () => {
      const router = new Router<string>({ caseSensitive: false });
      router.add('GET', '/users/:id{\\d+}', 'val');
      router.build();

      const result = router.match('GET', '/USERS/42');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('42');
      }
    });

    it('should treat stripped trailing slash as optional param absent when ignoreTrailingSlash + optional param', () => {
      const router = new Router<string>({
        ignoreTrailingSlash: true,
        optionalParamBehavior: 'setUndefined',
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      // /items/ → trailing strip → /items → matches with id absent
      const result = router.match('GET', '/items/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect('id' in result.params).toBe(true);
        expect(result.params.id).toBeUndefined();
      }
    });

    it('should capture empty suffix when ignoreTrailingSlash strips wildcard trailing slash', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true });
      router.add('GET', '/files/*', 'val');
      router.build();

      // /files/ → trailing strip → /files → wildcard suffix = '' (star origin allows empty)
      const result = router.match('GET', '/files/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params['*']).toBe('');
      }
    });

    it('should fail match when blockTraversal resolves prefix away from wildcard route', () => {
      const router = new Router<string>({ blockTraversal: true });
      router.add('GET', '/public/*', 'val');
      router.build();

      // /public/../secret/file.txt → dots resolve to /secret/file.txt → no match
      const result = router.match('GET', '/public/../secret/file.txt');
      expectNotErr(result);
      expect(result).toBeNull();
    });

    it('should not decode wildcard suffix since suffix uses normalizedPath not decoder', () => {
      const router = new Router<string>({
        decodeParams: true,
        encodedSlashBehavior: 'decode',
      });
      router.add('GET', '/files/*path', 'val');
      router.build();

      // Wildcard suffix = normalizedPath.substring(offset), NOT decoded
      const result = router.match('GET', '/files/a%20b/c');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.path).toBe('a%20b/c');
      }
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
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.params.id).toBe('42');

      // Absent
      const r2 = router.match('GET', '/items');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect('id' in r2.params).toBe(true);
        expect(r2.params.id).toBeUndefined();
      }

      // Cache hits preserve distinct values
      const r3 = router.match('GET', '/items/42');
      expectNotErr(r3);
      if (r3 !== null) {
        expect(r3.meta.source).toBe('cache');
        expect(r3.params.id).toBe('42');
      }
      const r4 = router.match('GET', '/items');
      expectNotErr(r4);
      if (r4 !== null) {
        expect(r4.meta.source).toBe('cache');
        expect(r4.params.id).toBeUndefined();
      }
    });

    it('should strip query string before dynamic param extraction', () => {
      const router = new Router<string>();
      router.add('GET', '/api/:id', 'val');
      router.build();

      const result = router.match('GET', '/api/42?key=value&foo=bar');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('42');
      }
    });
  });

  // ── Triple+ / Mega Combinations (5 tests) ──

  describe('triple+ combinations', () => {
    it('should apply caseSensitive=false + ignoreTrailingSlash + cache as triple transform with consistent cache key', () => {
      const router = new Router<string>({
        caseSensitive: false,
        ignoreTrailingSlash: true,
        enableCache: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // /API/42/ → strip trailing → /API/42 → lower → /api/42
      const r1 = router.match('GET', '/API/42/');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.meta.source).toBe('dynamic');

      // /Api/42 → no strip → lower → /api/42 → same cache key → hit
      const r2 = router.match('GET', '/Api/42');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.meta.source).toBe('cache');
        expect(r2.params.id).toBe('42');
      }
    });

    it('should apply caseSensitive=false + blockTraversal + cache with dot-segment in cache key', () => {
      const router = new Router<string>({
        caseSensitive: false,
        blockTraversal: true,
        enableCache: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // /API/../API/42 → lower → /api/../api/42 (cache key)
      const r1 = router.match('GET', '/API/../API/42');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.meta.source).toBe('dynamic');

      // Same lowered path → cache hit
      const r2 = router.match('GET', '/api/../api/42');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.meta.source).toBe('cache');
        expect(r2.params.id).toBe('42');
      }
    });

    it('should apply ignoreTrailingSlash + collapseSlashes + blockTraversal + cache as quad pipeline', () => {
      const router = new Router<string>({
        ignoreTrailingSlash: true,
        collapseSlashes: true,
        blockTraversal: true,
        enableCache: true,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      // //api//x/../42/ → strip trailing → //api//x/../42 → normalize resolves to /api/42
      const r1 = router.match('GET', '//api//x/../42/');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) expect(r1.params.id).toBe('42');

      // Same complex path → cache hit
      const r2 = router.match('GET', '//api//x/../42/');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) expect(r2.meta.source).toBe('cache');

      // Clean path → separate cache key, same result
      const r3 = router.match('GET', '/api/42');
      expectNotErr(r3);
      expect(r3).not.toBeNull();
      if (r3 !== null) expect(r3.params.id).toBe('42');
    });

    it('should match correctly with ALL options enabled simultaneously (mega combo)', () => {
      const router = new Router<string>({
        caseSensitive: false,
        ignoreTrailingSlash: true,
        collapseSlashes: true,
        blockTraversal: true,
        decodeParams: true,
        encodedSlashBehavior: 'decode',
        enableCache: true,
        cacheSize: 10,
        maxSegmentLength: 256,
        failFastOnBadEncoding: false,
        optionalParamBehavior: 'setUndefined',
        regexSafety: { mode: 'error' },
        regexAnchorPolicy: 'silent',
        strictParamNames: false,
      });
      router.add('GET', '/api/:category/:id?', 'val');
      router.build();

      // All transforms: trailing strip + lowercase + dot resolve + collapse
      const result = router.match('GET', '//API//items/../Products//42/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.category).toBe('products');
        expect(result.params.id).toBe('42');
      }

      // Optional absent
      const r2 = router.match('GET', '/api/tools');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.params.category).toBe('tools');
        expect('id' in r2.params).toBe(true);
        expect(r2.params.id).toBeUndefined();
      }
    });

    it('should store empty-string defaults in cache when optionalParamBehavior=setEmptyString + cache', () => {
      const router = new Router<string>({
        optionalParamBehavior: 'setEmptyString',
        enableCache: true,
      });
      router.add('GET', '/items/:id?', 'val');
      router.build();

      const r1 = router.match('GET', '/items');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) {
        expect(r1.params.id).toBe('');
      }

      // Cache hit preserves empty-string default
      const r2 = router.match('GET', '/items');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.meta.source).toBe('cache');
        expect(r2.params.id).toBe('');
      }
    });
  });

  // ── Error Combinations (2 tests) ──

  describe('error combinations', () => {
    it('should not cache encoding errors — re-request produces same error', () => {
      const router = new Router<string>({
        enableCache: true,
        failFastOnBadEncoding: true,
      });
      router.add('GET', '/items/:id', 'val');
      router.build();

      // Bad encoding → error (not cached)
      const r1 = router.match('GET', '/items/%GG');
      expectErr(r1);
      expect(r1.data.kind).toBe('encoding');

      // Same path → same error (re-computed, not from cache)
      const r2 = router.match('GET', '/items/%GG');
      expectErr(r2);
      expect(r2.data.kind).toBe('encoding');

      // Valid path still works
      const r3 = router.match('GET', '/items/42');
      expectNotErr(r3);
      expect(r3).not.toBeNull();
      if (r3 !== null) expect(r3.value).toBe('val');
    });

    it('should still error on long segment after collapseSlashes removes empty segments', () => {
      const router = new Router<string>({
        collapseSlashes: true,
        maxSegmentLength: 10,
      });
      router.add('GET', '/api/:id', 'val');
      router.build();

      const longSeg = 'a'.repeat(20);

      // ///api//{longSeg} → collapse removes empties but longSeg still exceeds limit
      const result = router.match('GET', `///api//${longSeg}`);
      expectErr(result);
      expect(result.data.kind).toBe('segment-limit');
    });
  });
});
