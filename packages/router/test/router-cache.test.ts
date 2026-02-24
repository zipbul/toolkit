import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';
import type { RouterErrData, MatchOutput } from '../src/types';

import { Router } from '../src/router';

// ── Helpers ──

function expectNotErr<T>(result: T | Err<RouterErrData>): asserts result is Exclude<T, Err<RouterErrData>> {
  expect(isErr(result)).toBe(false);
}

describe('Router<T> cache', () => {
  it('should use cache on second match when cache enabled (source=\'cache\')', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'user');
    router.build();

    const first = router.match('GET', '/users/42');
    expectNotErr(first);
    expect(first).not.toBeNull();
    if (first !== null) {
      expect(first.meta.source).toBe('dynamic');
    }

    const second = router.match('GET', '/users/42');
    expectNotErr(second);
    expect(second).not.toBeNull();
    if (second !== null) {
      expect(second.meta.source).toBe('cache');
      expect(second.value).toBe('user');
      expect(second.params.id).toBe('42');
    }
  });

  it('should evict with cacheSize=1 and re-match as dynamic', () => {
    const router = new Router<string>({ enableCache: true, cacheSize: 1 });
    router.add('GET', '/users/:id', 'user');
    router.build();

    // First match - dynamic, cached
    router.match('GET', '/users/1');

    // Second match different param - dynamic, evicts first
    router.match('GET', '/users/2');

    // Third match of first param - dynamic again (evicted)
    const third = router.match('GET', '/users/1');
    expectNotErr(third);
    if (third !== null) {
      expect(third.meta.source).toBe('dynamic');
    }
  });

  it('should cache null on miss and return null from cache on next match', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/exists', 'exists');
    router.build();

    // First miss → cached null
    const miss1 = router.match('GET', '/users/nope');
    expectNotErr(miss1);
    expect(miss1).toBeNull();

    // Second miss → from cache (still null)
    const miss2 = router.match('GET', '/users/nope');
    expectNotErr(miss2);
    expect(miss2).toBeNull();
  });

  it('should return cloned params from cache (not shared references)', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'user');
    router.build();

    const first = router.match('GET', '/users/1');
    expectNotErr(first);
    if (first !== null) {
      first.params.id = 'mutated';
    }

    const second = router.match('GET', '/users/1');
    expectNotErr(second);
    if (second !== null) {
      expect(second.params.id).toBe('1');
    }
  });

  it('should differentiate cache entries by method for same path', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'get-user');
    router.add('POST', '/users/:id', 'post-user');
    router.build();

    // Prime caches
    router.match('GET', '/users/42');
    router.match('POST', '/users/42');

    // Verify cached values are differentiated
    const get = router.match('GET', '/users/42');
    const post = router.match('POST', '/users/42');

    expectNotErr(get);
    expectNotErr(post);
    if (get !== null) {
      expect(get.meta.source).toBe('cache');
      expect(get.value).toBe('get-user');
    }
    if (post !== null) {
      expect(post.meta.source).toBe('cache');
      expect(post.value).toBe('post-user');
    }
  });

  it('should populate cache in match call order', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'user');
    router.build();

    // Match in order: 1, 2
    router.match('GET', '/users/1');
    router.match('GET', '/users/2');

    // Both should be cached
    const cached1 = router.match('GET', '/users/1');
    const cached2 = router.match('GET', '/users/2');

    expectNotErr(cached1);
    expectNotErr(cached2);
    if (cached1 !== null) expect(cached1.meta.source).toBe('cache');
    if (cached2 !== null) expect(cached2.meta.source).toBe('cache');
  });

  it('should not cache when enableCache is not set (default)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'user');
    router.build();

    // First match - dynamic
    const first = router.match('GET', '/users/42');
    expectNotErr(first);
    if (first !== null) {
      expect(first.meta.source).toBe('dynamic');
    }

    // Second match - still dynamic (no cache)
    const second = router.match('GET', '/users/42');
    expectNotErr(second);
    if (second !== null) {
      expect(second.meta.source).toBe('dynamic');
    }
  });

  it('should bypass cache for static route matches (static fast-path)', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/static', 'static-val');
    router.build();

    // Static routes always return source='static' even with cache enabled
    const first = router.match('GET', '/static');
    const second = router.match('GET', '/static');

    expectNotErr(first);
    expectNotErr(second);
    if (first !== null) expect(first.meta.source).toBe('static');
    if (second !== null) expect(second.meta.source).toBe('static');
  });

  it('should evict entries via clock-sweep when cache is full', () => {
    const router = new Router<string>({ enableCache: true, cacheSize: 2 });
    router.add('GET', '/users/:id', 'user');
    router.build();

    // Fill cache: users/1, users/2
    router.match('GET', '/users/1');
    router.match('GET', '/users/2');

    // Add users/3 → triggers eviction (clock-sweep picks one to evict)
    router.match('GET', '/users/3');

    // users/3 should be cached (just inserted)
    const r3 = router.match('GET', '/users/3');
    expectNotErr(r3);
    if (r3 !== null) {
      expect(r3.meta.source).toBe('cache');
      expect(r3.params.id).toBe('3');
    }

    // At least one of users/1 or users/2 was evicted → after more insertions, old entries return dynamic
    // Insert users/4 to evict another
    router.match('GET', '/users/4');

    // users/4 should be cached
    const r4 = router.match('GET', '/users/4');
    expectNotErr(r4);
    if (r4 !== null) {
      expect(r4.meta.source).toBe('cache');
      expect(r4.params.id).toBe('4');
    }
  });

  it('should cache results independently per custom method', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'get-user');
    router.add('PURGE' as any, '/users/:id', 'purge-user');
    router.build();

    // Prime GET cache
    router.match('GET', '/users/1');
    const getCached = router.match('GET', '/users/1');

    // Prime PURGE cache
    router.match('PURGE' as any, '/users/1');
    const purgeCached = router.match('PURGE' as any, '/users/1');

    expectNotErr(getCached);
    expectNotErr(purgeCached);
    if (getCached !== null) {
      expect(getCached.value).toBe('get-user');
      expect(getCached.meta.source).toBe('cache');
    }
    if (purgeCached !== null) {
      expect(purgeCached.value).toBe('purge-user');
      expect(purgeCached.meta.source).toBe('cache');
    }
  });

  it('should cache null miss entries independently per method', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/exists', 'exists');
    router.build();

    // Miss for GET /nope → cache null
    const getMiss = router.match('GET', '/nope');
    expectNotErr(getMiss);
    expect(getMiss).toBeNull();

    // Miss for POST /nope → cache null independently
    const postMiss = router.match('POST', '/nope');
    expectNotErr(postMiss);
    expect(postMiss).toBeNull();

    // Both still null from separate caches
    const getMiss2 = router.match('GET', '/nope');
    const postMiss2 = router.match('POST', '/nope');
    expectNotErr(getMiss2);
    expectNotErr(postMiss2);
    expect(getMiss2).toBeNull();
    expect(postMiss2).toBeNull();
  });

  it('should maintain cache correctness after many evictions', () => {
    const router = new Router<string>({ enableCache: true, cacheSize: 3 });
    router.add('GET', '/users/:id', 'user');
    router.build();

    // Insert 10 entries into cache of size 3 → many evictions
    for (let i = 0; i < 10; i++) {
      const result = router.match('GET', `/users/${i}`);
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('user');
        expect(result.params.id).toBe(String(i));
      }
    }

    // Last few should be cached
    const last = router.match('GET', '/users/9');
    expectNotErr(last);
    if (last !== null) {
      expect(last.meta.source).toBe('cache');
      expect(last.params.id).toBe('9');
    }
  });
});
