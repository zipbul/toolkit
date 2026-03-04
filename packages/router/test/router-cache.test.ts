import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';

describe('Router<T> cache', () => {
  it('should use cache on second match when cache enabled (source=\'cache\')', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'user');
    router.build();

    const first = router.match('GET', '/users/42');
    expect(first).not.toBeNull();
    expect(first!.meta.source).toBe('dynamic');

    const second = router.match('GET', '/users/42');
    expect(second).not.toBeNull();
    expect(second!.meta.source).toBe('cache');
    expect(second!.value).toBe('user');
    expect(second!.params.id).toBe('42');
  });

  it('should evict with cacheSize=1 and re-match as dynamic', () => {
    const router = new Router<string>({ enableCache: true, cacheSize: 1 });
    router.add('GET', '/users/:id', 'user');
    router.build();

    router.match('GET', '/users/1');
    router.match('GET', '/users/2');

    const third = router.match('GET', '/users/1');
    expect(third).not.toBeNull();
    expect(third!.meta.source).toBe('dynamic');
  });

  it('should cache null on miss and return null from cache on next match', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/exists', 'exists');
    router.build();

    const miss1 = router.match('GET', '/users/nope');
    expect(miss1).toBeNull();

    const miss2 = router.match('GET', '/users/nope');
    expect(miss2).toBeNull();
  });

  it('should return cloned params from cache (not shared references)', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'user');
    router.build();

    const first = router.match('GET', '/users/1');
    if (first !== null) {
      first.params.id = 'mutated';
    }

    const second = router.match('GET', '/users/1');
    expect(second).not.toBeNull();
    expect(second!.params.id).toBe('1');
  });

  it('should differentiate cache entries by method for same path', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'get-user');
    router.add('POST', '/users/:id', 'post-user');
    router.build();

    router.match('GET', '/users/42');
    router.match('POST', '/users/42');

    const get = router.match('GET', '/users/42');
    const post = router.match('POST', '/users/42');

    expect(get).not.toBeNull();
    expect(post).not.toBeNull();
    expect(get!.meta.source).toBe('cache');
    expect(get!.value).toBe('get-user');
    expect(post!.meta.source).toBe('cache');
    expect(post!.value).toBe('post-user');
  });

  it('should populate cache in match call order', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'user');
    router.build();

    router.match('GET', '/users/1');
    router.match('GET', '/users/2');

    const cached1 = router.match('GET', '/users/1');
    const cached2 = router.match('GET', '/users/2');

    expect(cached1!.meta.source).toBe('cache');
    expect(cached2!.meta.source).toBe('cache');
  });

  it('should not cache when enableCache is not set (default)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'user');
    router.build();

    const first = router.match('GET', '/users/42');
    expect(first!.meta.source).toBe('dynamic');

    const second = router.match('GET', '/users/42');
    expect(second!.meta.source).toBe('dynamic');
  });

  it('should bypass cache for static route matches (static fast-path)', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/static', 'static-val');
    router.build();

    const first = router.match('GET', '/static');
    const second = router.match('GET', '/static');

    expect(first!.meta.source).toBe('static');
    expect(second!.meta.source).toBe('static');
  });

  it('should evict entries via clock-sweep when cache is full', () => {
    const router = new Router<string>({ enableCache: true, cacheSize: 2 });
    router.add('GET', '/users/:id', 'user');
    router.build();

    router.match('GET', '/users/1');
    router.match('GET', '/users/2');
    router.match('GET', '/users/3');

    const r3 = router.match('GET', '/users/3');
    expect(r3!.meta.source).toBe('cache');
    expect(r3!.params.id).toBe('3');

    router.match('GET', '/users/4');

    const r4 = router.match('GET', '/users/4');
    expect(r4!.meta.source).toBe('cache');
    expect(r4!.params.id).toBe('4');
  });

  it('should cache results independently per custom method', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/users/:id', 'get-user');
    router.add('PURGE' as any, '/users/:id', 'purge-user');
    router.build();

    router.match('GET', '/users/1');
    const getCached = router.match('GET', '/users/1');

    router.match('PURGE' as any, '/users/1');
    const purgeCached = router.match('PURGE' as any, '/users/1');

    expect(getCached!.value).toBe('get-user');
    expect(getCached!.meta.source).toBe('cache');
    expect(purgeCached!.value).toBe('purge-user');
    expect(purgeCached!.meta.source).toBe('cache');
  });

  it('should cache null miss entries independently per method', () => {
    const router = new Router<string>({ enableCache: true });
    router.add('GET', '/exists', 'exists');
    router.add('POST', '/exists', 'exists-post');
    router.build();

    const getMiss = router.match('GET', '/nope');
    expect(getMiss).toBeNull();

    const postMiss = router.match('POST', '/nope');
    expect(postMiss).toBeNull();

    const getMiss2 = router.match('GET', '/nope');
    const postMiss2 = router.match('POST', '/nope');
    expect(getMiss2).toBeNull();
    expect(postMiss2).toBeNull();
  });

  it('should maintain cache correctness after many evictions', () => {
    const router = new Router<string>({ enableCache: true, cacheSize: 3 });
    router.add('GET', '/users/:id', 'user');
    router.build();

    for (let i = 0; i < 10; i++) {
      const result = router.match('GET', `/users/${i}`);
      expect(result).not.toBeNull();
      expect(result!.value).toBe('user');
      expect(result!.params.id).toBe(String(i));
    }

    const last = router.match('GET', '/users/9');
    expect(last!.meta.source).toBe('cache');
    expect(last!.params.id).toBe('9');
  });
});
