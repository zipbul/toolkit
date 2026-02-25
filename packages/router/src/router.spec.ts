import { describe, it, expect } from 'bun:test';

import { isErr } from '@zipbul/result';

import { Router } from './router';
import type { RouterOptions } from './types';

// ── Fixtures ──

function makeRouter<T = number>(opts: RouterOptions = {}): Router<T> {
  return new Router<T>(opts);
}

function buildWith(
  routes: Array<[string, string, number]>,
  opts: RouterOptions = {},
): Router<number> {
  const r = makeRouter<number>(opts);

  for (const [method, path, handler] of routes) {
    const result = r.add(method as any, path, handler);

    if (isErr(result)) {
      throw new Error(`Failed to add route ${method} ${path}: ${result.data.message}`);
    }
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
      const result = r.add('GET', '/users', 1);

      expect(isErr(result)).toBe(false);
    });

    it('should add routes for method array via add([methods], path, value)', () => {
      const r = makeRouter<number>();
      const result = r.add(['GET', 'POST'], '/users', 1);

      expect(isErr(result)).toBe(false);

      r.build();

      const get = r.match('GET', '/users');
      const post = r.match('POST', '/users');

      expect(isErr(get)).toBe(false);
      expect(get).not.toBeNull();
      expect(isErr(post)).toBe(false);
      expect(post).not.toBeNull();
    });

    it('should add routes for all methods via add("*", path, value)', () => {
      const r = makeRouter<number>();
      const result = r.add('*', '/health', 1);

      expect(isErr(result)).toBe(false);

      r.build();

      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const) {
        const m = r.match(method, '/health');

        expect(isErr(m)).toBe(false);
        expect(m).not.toBeNull();
      }
    });

    it('should add multiple routes via addAll', () => {
      const r = makeRouter<number>();
      const result = r.addAll([
        ['GET', '/a', 1],
        ['POST', '/b', 2],
      ]);

      expect(isErr(result)).toBe(false);

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

      expect(isErr(result)).toBe(false);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(42);
      expect(result!.params).toEqual({});
      expect(result!.meta.source).toBe('static');
    });

    it('should match a dynamic param route after build', () => {
      const r = buildWith([['GET', '/users/:id', 10]]);
      const result = r.match('GET', '/users/123');

      expect(isErr(result)).toBe(false);
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
      const r = buildWith([['GET', '/users/:id', 10]], { enableCache: true });

      const first = r.match('GET', '/users/1');
      const second = r.match('GET', '/users/1');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.value).toBe(second!.value);
      expect(first!.params).toEqual(second!.params);
    });

    it('should return meta.source="cache" on cache hit', () => {
      const r = buildWith([['GET', '/users/:id', 10]], { enableCache: true });

      r.match('GET', '/users/1'); // first → dynamic
      const cached = r.match('GET', '/users/1'); // second → cache

      expect(cached).not.toBeNull();
      expect(cached!.meta.source).toBe('cache');
    });

    it('should return null consistently for dynamic miss with cache', () => {
      const r = buildWith([['GET', '/users/:id', 10]], { enableCache: true });

      const first = r.match('GET', '/posts/hello');
      const second = r.match('GET', '/posts/hello');

      expect(first).toBeNull();
      expect(second).toBeNull();
    });
  });

  // ---- NE (Negative/Error) ----

  describe('negative', () => {
    it('should return err(router-sealed) when add() after build', () => {
      const r = buildWith([['GET', '/x', 1]]);
      const result = r.add('GET', '/y', 2);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.kind).toBe('router-sealed');
      }
    });

    it('should return err(router-sealed) when addAll() after build', () => {
      const r = buildWith([['GET', '/x', 1]]);
      const result = r.addAll([['GET', '/y', 2]]);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.kind).toBe('router-sealed');
      }
    });

    it('should return err(not-built) when match() before build', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);

      const result = r.match('GET', '/x');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.kind).toBe('not-built');
      }
    });

    it('should return err(path-too-long) when path exceeds maxPathLength', () => {
      const r = buildWith([['GET', '/x', 1]], { maxPathLength: 10 });
      const longPath = '/' + 'a'.repeat(20);
      const result = r.match('GET', longPath);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.kind).toBe('path-too-long');
      }
    });

    it('should return null for unregistered method', () => {
      const r = buildWith([['GET', '/x', 1]]);
      const result = r.match('DELETE', '/x');

      expect(result).toBeNull();
    });

    it('should propagate err from addOne in addAll with registeredCount', () => {
      const r = makeRouter<number>();
      // Add first route normally, second is duplicate of first
      r.add('GET', '/a', 1);
      const result = r.addAll([
        ['POST', '/b', 2],
        ['GET', '/a', 3], // duplicate → should fail
      ]);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.registeredCount).toBe(1);
      }
    });

    it('should propagate err when method array add has failure', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);

      // Adding ['GET', 'POST'] to same path — GET will duplicate
      const result = r.add(['GET', 'POST'], '/x', 2);

      expect(isErr(result)).toBe(true);
    });

    it('should propagate err from normalizer on match', () => {
      const r = buildWith(
        [['GET', '/x', 1]],
        { failFastOnBadEncoding: true },
      );

      const result = r.match('GET', '/x/%GG');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.kind).toBe('encoding');
      }
    });
  });

  // ---- ED (Edge) ----

  describe('edge', () => {
    it('should add and match root path "/"', () => {
      const r = buildWith([['GET', '/', 99]]);
      const result = r.match('GET', '/');

      expect(isErr(result)).toBe(false);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(99);
    });

    it('should accept addAll with empty array', () => {
      const r = makeRouter<number>();
      const result = r.addAll([]);

      expect(isErr(result)).toBe(false);
    });

    it('should not error on second build() call (sealed no-op)', () => {
      const r = makeRouter<number>();
      r.add('GET', '/a', 1);

      const first = r.build();
      const second = r.build();

      expect(first).toBe(r);
      expect(second).toBe(r);
    });

    it('should match path at exact maxPathLength', () => {
      const maxLen = 30;
      const path = '/' + 'a'.repeat(maxLen - 1); // exactly 30 chars
      const r = makeRouter<number>({ maxPathLength: maxLen });
      r.add('GET', path, 1);
      r.build();

      const result = r.match('GET', path);

      // Should not err(path-too-long)
      expect(isErr(result)).toBe(false);
    });

    it('should err at maxPathLength+1', () => {
      const maxLen = 30;
      const path = '/' + 'a'.repeat(maxLen); // 31 chars > maxLen
      const r = buildWith([['GET', '/x', 1]], { maxPathLength: maxLen });
      const result = r.match('GET', path);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.kind).toBe('path-too-long');
      }
    });
  });

  // ---- CO (Corner) ----

  describe('corner', () => {
    it('should return err on add but allow match when sealed', () => {
      const r = buildWith([['GET', '/a', 1]]);

      // add should fail
      const addResult = r.add('POST', '/b', 2);

      expect(isErr(addResult)).toBe(true);

      if (isErr(addResult)) {
        expect(addResult.data.kind).toBe('router-sealed');
      }

      // match should work
      const matchResult = r.match('GET', '/a');

      expect(isErr(matchResult)).toBe(false);
      expect(matchResult).not.toBeNull();
      expect(matchResult!.value).toBe(1);
    });

    it('should apply combined preNormalize (caseSensitive:false + ignoreTrailingSlash)', () => {
      const r = buildWith(
        [['GET', '/users', 1]],
        { caseSensitive: false, ignoreTrailingSlash: true },
      );

      // Trailing slash + uppercase → both normalized
      const result = r.match('GET', '/Users/');

      expect(isErr(result)).toBe(false);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(1);
    });

    it('should return null from cache for previously missed path', () => {
      const r = buildWith([['GET', '/users/:id', 1]], { enableCache: true });

      // First miss → null stored in cache
      const miss1 = r.match('GET', '/nope/1');
      // Second hit → from cache
      const miss2 = r.match('GET', '/nope/1');

      expect(miss1).toBeNull();
      expect(miss2).toBeNull();
    });

    it('should use Matcher when compiledMatch is null (high threshold)', () => {
      const r = buildWith(
        [['GET', '/users/:id', 42]],
        { compiledMatchThreshold: 0 }, // threshold 0 → no compiled match
      );

      const result = r.match('GET', '/users/123');

      expect(isErr(result)).toBe(false);
      expect(result).not.toBeNull();
      expect(result!.value).toBe(42);
      expect(result!.params.id).toBe('123');
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

    it('should release build-time resources after build (match still works, add returns sealed)', () => {
      const r = makeRouter<number>();
      r.add('GET', '/users/:id', 10);
      r.build();

      // Match still works → normalizer captured before processor released
      const result = r.match('GET', '/users/1');

      expect(result).not.toBeNull();
      expect(result!.value).toBe(10);

      // Add blocked → sealed state
      const addResult = r.add('GET', '/y', 2);

      expect(isErr(addResult)).toBe(true);
    });

    it('should write cache entry on dynamic match hit', () => {
      const r = buildWith([['GET', '/items/:id', 5]], { enableCache: true });

      r.match('GET', '/items/42'); // dynamic → writes cache

      const cached = r.match('GET', '/items/42'); // reads from cache

      expect(cached).not.toBeNull();
      expect(cached!.meta.source).toBe('cache');
    });

    it('should return null consistently on dynamic miss', () => {
      const r = buildWith([['GET', '/items/:id', 5]], { enableCache: true });

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
        { enableCache: true },
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

    it('should stop method array iteration at first error', () => {
      const r = makeRouter<number>();
      r.add('GET', '/x', 1);

      // ['GET', 'POST'] where GET is duplicate → error on first (GET)
      const result = r.add(['GET', 'POST'], '/x', 2);

      expect(isErr(result)).toBe(true);

      // POST was NOT registered because GET failed first
      r.build();
      const postResult = r.match('POST', '/x');

      expect(postResult).toBeNull();
    });
  });
});
