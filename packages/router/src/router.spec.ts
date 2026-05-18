import { describe, it, expect } from 'bun:test';

import type { RouterOptions } from './types';

import { catchRouterError } from '../test/test-utils';
import { RouterError } from './error';
import { Router, validateCacheSize } from './router';

// ── Fixtures ──

function makeRouter<T = number>(opts: RouterOptions = {}): Router<T> {
  return new Router<T>(opts);
}

function buildWith(routes: Array<[string, string, number]>, opts: RouterOptions = {}): Router<number> {
  const r = new Router<number>(opts);
  for (const [method, path, value] of routes) {
    r.add(method, path, value);
  }
  r.build();
  return r;
}

describe('Router', () => {
  // ---- HP (Happy Path) ----

  describe('happy path', () => {
    it('should construct with default options', () => {
      const r = makeRouter();

      expect(r).toBeInstanceOf(Router);
    });

    it('should add a single static route via add(method, path, value)', () => {
      const r = makeRouter<number>();
      // add() returns void (throws on error)
      r.add('GET', '/users', 1);
    });

    it('should add routes for method array via add([methods], path, value)', () => {
      const r = makeRouter<number>();
      r.add(['GET', 'POST'], '/users', 1);
      r.build();

      const get = r.match('GET', '/users');
      const post = r.match('POST', '/users');

      expect(get).not.toBeNull();
      expect(post).not.toBeNull();
    });

    it('should add routes for all methods via add("*", path, value)', () => {
      const r = makeRouter<number>();
      r.add('*', '/health', 1);
      r.build();

      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const) {
        const m = r.match(method, '/health');

        expect(m).not.toBeNull();
      }
    });

    it('should add multiple routes via addAll', () => {
      const r = makeRouter<number>();
      r.addAll([
        ['GET', '/a', 1],
        ['POST', '/b', 2],
      ]);

      r.build();

      expect(r.match('GET', '/a')).not.toBeNull();
      expect(r.match('POST', '/b')).not.toBeNull();
    });

    it('should seal router on build() and return this', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);

      const returned = r.build();

      expect(returned).toBe(r);
    });

    it('should match a static route after build', () => {
      const r = buildWith([['GET', '/users', 42]]);
      const result = r.match('GET', '/users');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(42);
      expect(result!.params).toEqual({});
      expect(result!.meta.source).toBe('static');
    });

    it('should match a dynamic param route after build', () => {
      const r = buildWith([['GET', '/users/:id', 10]]);
      const result = r.match('GET', '/users/123');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(10);
      expect(result!.params.id).toBe('123');
      expect(result!.meta.source).toBe('dynamic');
    });

    it('should return null for unregistered path', () => {
      const r = buildWith([['GET', '/users', 1]]);
      const result = r.match('GET', '/posts');

      expect(result).toBeNull();
    });

    it('should return cached result on second match of same dynamic path', () => {
      const r = buildWith([['GET', '/users/:id', 10]], {});

      const first = r.match('GET', '/users/1');
      const second = r.match('GET', '/users/1');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.value).toBe(second!.value);
      expect(first!.params).toEqual(second!.params);
    });

    it('should return meta.source="cache" on cache hit', () => {
      const r = buildWith([['GET', '/users/:id', 10]], {});

      r.match('GET', '/users/1'); // first → dynamic
      const cached = r.match('GET', '/users/1'); // second → cache

      expect(cached).not.toBeNull();
      expect(cached!.meta.source).toBe('cache');
    });

    it('should return null consistently for dynamic miss with cache', () => {
      const r = buildWith([['GET', '/users/:id', 10]], {});

      const first = r.match('GET', '/posts/hello');
      const second = r.match('GET', '/posts/hello');

      expect(first).toBeNull();
      expect(second).toBeNull();
    });
  });

  // ---- NE (Negative/Error) ----

  describe('negative', () => {
    it('should throw RouterError(router-sealed) when add() after build', () => {
      const r = buildWith([['GET', '/x', 1]]);
      const e = catchRouterError(() => r.add('GET', '/y', 2));

      expect(e.data.kind).toBe('router-sealed');
    });

    it('should throw RouterError(router-sealed) when addAll() after build', () => {
      const r = buildWith([['GET', '/x', 1]]);
      const e = catchRouterError(() => r.addAll([['GET', '/y', 2]]));

      expect(e.data.kind).toBe('router-sealed');
    });

    it('should return null when match() called before build', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);

      expect(r.match('GET', '/x')).toBeNull();
    });

    it('should return null for unregistered method', () => {
      const r = buildWith([['GET', '/x', 1]]);
      const result = r.match('DELETE', '/x');

      expect(result).toBeNull();
    });

    it('should report duplicate addAll entries during build validation', () => {
      const r = makeRouter<number>();
      r.add('GET', '/a', 1);
      r.addAll([
        ['POST', '/b', 2],
        ['GET', '/a', 3],
      ]);

      const e = catchRouterError(() => r.build());
      expect(e.data.kind).toBe('route-validation');
      if (e.data.kind === 'route-validation') {
        expect(e.data.errors[0]?.index).toBe(2);
        expect(e.data.errors[0]?.error.kind).toBe('route-duplicate');
      }
    });

    it('should report method array duplicate during build validation', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);
      r.add(['GET', 'POST'], '/x', 2);

      const e = catchRouterError(() => r.build());
      expect(e.data.kind).toBe('route-validation');
      if (e.data.kind === 'route-validation') {
        expect(e.data.errors.some(issue => issue.method === 'GET' && issue.error.kind === 'route-duplicate')).toBe(true);
      }
    });
  });

  // ---- ED (Edge) ----

  describe('edge', () => {
    it('should add and match root path "/"', () => {
      const r = buildWith([['GET', '/', 99]]);
      const result = r.match('GET', '/');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(99);
    });

    it('should accept addAll with empty array', () => {
      const r = makeRouter<number>();
      r.addAll([]); // should not throw
    });

    it('should not error on second build() call (sealed no-op)', () => {
      const r = makeRouter<number>();
      r.add('GET', '/a', 1);

      const first = r.build();
      const second = r.build();

      expect(first).toBe(r);
      expect(second).toBe(r);
    });
  });

  // ---- CO (Corner) ----

  describe('corner', () => {
    it('should throw on add but allow match when sealed', () => {
      const r = buildWith([['GET', '/a', 1]]);

      // add should throw
      const e = catchRouterError(() => r.add('POST', '/b', 2));

      expect(e.data.kind).toBe('router-sealed');

      // match should work
      const matchResult = r.match('GET', '/a');

      expect(matchResult).not.toBeNull();
      expect(matchResult!.value).toBe(1);
    });

    it('should apply combined preNormalize (caseSensitive:false + ignoreTrailingSlash)', () => {
      const r = buildWith([['GET', '/users', 1]], { pathCaseSensitive: false, trailingSlash: 'ignore' });

      // Trailing slash + uppercase → both normalized
      const result = r.match('GET', '/Users/');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(1);
    });

    it('should return null from cache for previously missed path', () => {
      const r = buildWith([['GET', '/users/:id', 1]], {});

      // First miss → null stored in cache
      const miss1 = r.match('GET', '/nope/1');
      // Second hit → from cache
      const miss2 = r.match('GET', '/nope/1');

      expect(miss1).toBeNull();
      expect(miss2).toBeNull();
    });
  });

  // ---- ST (State Transition) ----

  describe('state transitions', () => {
    it('should follow full lifecycle: add → addAll → build → match', () => {
      const r = makeRouter<number>();

      r.add('GET', '/a', 1);
      r.addAll([
        ['POST', '/b', 2],
        ['PUT', '/c', 3],
      ]);
      r.build();

      expect(r.match('GET', '/a')).not.toBeNull();
      expect(r.match('POST', '/b')).not.toBeNull();
      expect(r.match('PUT', '/c')).not.toBeNull();
    });

    it('should release build-time resources after build (match still works, add throws sealed)', () => {
      const r = makeRouter<number>();
      r.add('GET', '/users/:id', 10);
      r.build();

      // Match still works
      const result = r.match('GET', '/users/1');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(10);

      // Add blocked → sealed
      expect(() => r.add('GET', '/y', 2)).toThrow(RouterError);
    });

    it('should write cache entry on dynamic match hit', () => {
      const r = buildWith([['GET', '/items/:id', 5]], {});

      r.match('GET', '/items/42'); // dynamic → writes cache

      const cached = r.match('GET', '/items/42'); // reads from cache

      expect(cached).not.toBeNull();
      expect(cached!.meta.source).toBe('cache');
    });

    it('should return null consistently on dynamic miss', () => {
      const r = buildWith([['GET', '/items/:id', 5]], {});

      const miss1 = r.match('GET', '/nope/1');
      const miss2 = r.match('GET', '/nope/1');

      expect(miss1).toBeNull();
      expect(miss2).toBeNull();
    });

    it('should resolve correct handler values after build', () => {
      const r = makeRouter<string>();
      r.add('GET', '/users/:id', 'user-handler');
      r.add('POST', '/posts/:slug', 'post-handler');
      r.build();

      const user = r.match('GET', '/users/1');
      const post = r.match('POST', '/posts/hello');

      expect(user).not.toBeNull();
      expect(user!.value).toBe('user-handler');
      expect(post).not.toBeNull();
      expect(post!.value).toBe('post-handler');
    });
  });

  // ---- ID (Idempotency) ----

  describe('idempotency', () => {
    it('should return same sealed state on build() called twice', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);

      r.build();
      r.build(); // second call no-op

      const result = r.match('GET', '/x');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(1);
    });

    it('should return same result on matching same dynamic path twice', () => {
      const r = buildWith([['GET', '/users/:id', 10]]);

      const first = r.match('GET', '/users/7');
      const second = r.match('GET', '/users/7');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.value).toBe(second!.value);
      expect(first!.params).toEqual(second!.params);
    });

    it('should return same static result on repeat match', () => {
      const r = buildWith([['GET', '/home', 99]]);

      const first = r.match('GET', '/home');
      const second = r.match('GET', '/home');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.value).toBe(second!.value);
      expect(first!.meta.source).toBe('static');
      expect(second!.meta.source).toBe('static');
    });
  });

  // ---- OR (Ordering) ----

  describe('ordering', () => {
    it('should match static route before dynamic when both exist', () => {
      const r = makeRouter<string>();
      r.add('GET', '/users/me', 'static-me');
      r.add('GET', '/users/:id', 'dynamic-id');
      r.build();

      const result = r.match('GET', '/users/me');

      expect(result).not.toBeNull();
      expect(result!.value).toBe('static-me');
      expect(result!.meta.source).toBe('static');
    });

    it('should follow match pipeline: static → cache → normalize → dynamic', () => {
      const r = buildWith(
        [
          ['GET', '/static', 1],
          ['GET', '/dynamic/:id', 2],
        ],
        {},
      );

      // Static route → source: 'static'
      const staticResult = r.match('GET', '/static');

      expect(staticResult).not.toBeNull();
      expect(staticResult!.meta.source).toBe('static');

      // Dynamic first hit → source: 'dynamic'
      const dynamicResult = r.match('GET', '/dynamic/1');

      expect(dynamicResult).not.toBeNull();
      expect(dynamicResult!.meta.source).toBe('dynamic');

      // Dynamic second hit → source: 'cache'
      const cachedResult = r.match('GET', '/dynamic/1');

      expect(cachedResult).not.toBeNull();
      expect(cachedResult!.meta.source).toBe('cache');
    });

    it('should validate all expanded method array entries at build time', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);
      r.add(['GET', 'POST'], '/x', 2);

      const e = catchRouterError(() => r.build());
      expect(e.data.kind).toBe('route-validation');
      if (e.data.kind === 'route-validation') {
        expect(e.data.errors).toHaveLength(1);
        expect(e.data.errors[0]?.method).toBe('GET');
      }
      expect(r.match('POST', '/x')).toBeNull();
    });
  });
});

describe('validateCacheSize', () => {
  it('accepts an undefined input and returns the default 1000', () => {
    expect(validateCacheSize(undefined)).toBe(1000);
  });

  it('returns the input value when it is a positive integer in range', () => {
    expect(validateCacheSize(1)).toBe(1);
    expect(validateCacheSize(2048)).toBe(2048);
    expect(validateCacheSize(0x4000_0000)).toBe(0x4000_0000);
  });

  it('throws router-options-invalid for zero', () => {
    expect(() => validateCacheSize(0)).toThrow(RouterError);
  });

  it('throws router-options-invalid for negative integers', () => {
    expect(() => validateCacheSize(-1)).toThrow(RouterError);
  });

  it('throws router-options-invalid for non-integer values', () => {
    expect(() => validateCacheSize(1.5)).toThrow(RouterError);
  });

  it('throws router-options-invalid for NaN', () => {
    expect(() => validateCacheSize(Number.NaN)).toThrow(RouterError);
  });

  it('throws router-options-invalid for values above 2^30', () => {
    expect(() => validateCacheSize(0x4000_0001)).toThrow(RouterError);
  });

  it('attaches kind=router-options-invalid to the thrown error', () => {
    const err = catchRouterError(() => validateCacheSize(-1));
    expect(err.data.kind).toBe('router-options-invalid');
  });
});
