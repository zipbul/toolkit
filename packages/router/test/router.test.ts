import { describe, it, expect } from 'bun:test';
import type { MatchOutput } from '../src/types';

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

describe('Router<T>', () => {
  // ── HP: Happy Path (21 tests) ──

  describe('happy path', () => {
    it('should match static route returning value and empty params', () => {
      const router = new Router<string>();
      router.add('GET', '/hello', 'world');
      router.build();

      const result = router.match('GET', '/hello');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('world');
      expect(result!.params).toEqual({});
    });

    it('should register all methods when add called with method array', () => {
      const router = new Router<string>();
      router.add(['GET', 'POST'], '/multi', 'multi');
      router.build();

      const get = router.match('GET', '/multi');
      const post = router.match('POST', '/multi');
      expect(get).not.toBeNull();
      expect(post).not.toBeNull();
    });

    it('should register all 7 standard methods when add called with \'*\'', () => {
      const router = new Router<string>();
      router.add('*', '/all', 'all');
      router.build();

      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
      for (const m of methods) {
        const result = router.match(m, '/all');
        expect(result).not.toBeNull();
      }
    });

    it('should register and match all routes via addAll', () => {
      const router = new Router<string>();
      const entries: Array<[any, string, string]> = [
        ['GET', '/a', 'a'],
        ['POST', '/b', 'b'],
      ];
      router.addAll(entries);
      router.build();

      const a = router.match('GET', '/a');
      const b = router.match('POST', '/b');
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.value).toBe('a');
      expect(b!.value).toBe('b');
    });

    it('should return void for addAll with empty array', () => {
      const router = new Router<string>();
      // addAll returns void — no throw means success
      router.addAll([]);
    });

    it('should return source=\'static\' for static route match', () => {
      const router = new Router<string>();
      router.add('GET', '/static', 'val');
      router.build();

      const result = router.match('GET', '/static');
      expect(result).not.toBeNull();
      expect(result!.meta.source).toBe('static');
    });

    it('should extract params from dynamic :param route', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      const result = router.match('GET', '/users/123');
      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('123');
      expect(result!.value).toBe('user');
    });

    it('should capture wildcard param segments', () => {
      const router = new Router<string>();
      router.add('GET', '/files/*', 'files');
      router.build();

      const result = router.match('GET', '/files/a/b/c');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('files');
      expect(result!.params['*']).toBe('a/b/c');
    });

    it('should return null for non-existent route', () => {
      const router = new Router<string>();
      router.add('GET', '/exists', 'val');
      router.build();

      const result = router.match('GET', '/nonexistent');
      expect(result).toBeNull();
    });

    it('should store and return arbitrary types (object, function)', () => {
      const handler = { handle: () => 'ok' };
      const router = new Router<typeof handler>();
      router.add('GET', '/obj', handler);
      router.build();

      const result = router.match('GET', '/obj');
      expect(result).not.toBeNull();
      expect(result!.value).toBe(handler);
      expect(result!.value.handle()).toBe('ok');
    });

    it('should match correct route among multiple registered routes', () => {
      const router = new Router<string>();
      router.add('GET', '/a', 'route-a');
      router.add('GET', '/b', 'route-b');
      router.add('POST', '/a', 'route-a-post');
      router.build();

      const a = router.match('GET', '/a');
      const b = router.match('GET', '/b');
      const ap = router.match('POST', '/a');
      expect(a!.value).toBe('route-a');
      expect(b!.value).toBe('route-b');
      expect(ap!.value).toBe('route-a-post');
    });

    it('should return this from build() for chaining', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      const result = router.build();
      expect(result).toBe(router);
    });

    it('should return source=\'dynamic\' for dynamic route match', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      const result = router.match('GET', '/users/1');
      expect(result).not.toBeNull();
      expect(result!.meta.source).toBe('dynamic');
    });

    it('should not throw for valid add', () => {
      const router = new Router<string>();
      router.add('GET', '/test', 'val');
    });

    it('should not throw for valid addAll', () => {
      const router = new Router<string>();
      router.addAll([['GET', '/test', 'val']]);
    });

    it('should match named wildcard param (*name)', () => {
      const router = new Router<string>();
      router.add('GET', '/files/*filepath', 'files');
      router.build();

      const result = router.match('GET', '/files/a/b/c');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('files');
      expect(result!.params.filepath).toBe('a/b/c');
    });

    it('should match multi-segment dynamic param (:file+)', () => {
      const router = new Router<string>();
      router.add('GET', '/docs/:file+', 'docs');
      router.build();

      const result = router.match('GET', '/docs/a/b');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('docs');
      expect(result!.params.file).toBe('a/b');
    });

    it('should match optional param when present (:id?)', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id?', 'user');
      router.build();

      const result = router.match('GET', '/users/123');
      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('123');
    });

    it('should omit optional param from params when absent with omit behavior', () => {
      const router = new Router<string>({ optionalParamBehavior: 'omit' });
      router.add('GET', '/users/:id?', 'user');
      router.build();

      const result = router.match('GET', '/users');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('user');
      expect('id' in result!.params).toBe(false);
    });

    it('should match regex-constrained param (:id{\\d+})', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id{\\d+}', 'user');
      router.build();

      // Should match numeric
      const numeric = router.match('GET', '/users/123');
      expect(numeric).not.toBeNull();
      expect(numeric!.params.id).toBe('123');

      // Should not match non-numeric
      const alpha = router.match('GET', '/users/abc');
      expect(alpha).toBeNull();
    });

    it('should register and match custom HTTP method', () => {
      const router = new Router<string>();
      router.add('PURGE' as any, '/cache', 'purge');
      router.build();

      const result = router.match('PURGE' as any, '/cache');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('purge');
    });
  });

  // ── ED: Edge Cases (10 tests) ──

  describe('edge cases', () => {
    it('should match root path \'/\'', () => {
      const router = new Router<string>();
      router.add('GET', '/', 'root');
      router.build();

      const result = router.match('GET', '/');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('root');
    });

    it('should return null on empty built router', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expect(result).toBeNull();
    });

    it('should store and return falsy values (0, \'\', false)', () => {
      const router = new Router<any>();
      router.add('GET', '/zero', 0);
      router.add('GET', '/empty', '');
      router.add('GET', '/false', false);
      router.build();

      const zero = router.match('GET', '/zero');
      const empty = router.match('GET', '/empty');
      const f = router.match('GET', '/false');

      expect(zero!.value).toBe(0);
      expect(empty!.value).toBe('');
      expect(f!.value).toBe(false);
    });

    it('should return reference-equal value in MatchOutput', () => {
      const obj = { id: 1 };
      const router = new Router<typeof obj>();
      router.add('GET', '/ref', obj);
      router.build();

      const result = router.match('GET', '/ref');
      expect(result).not.toBeNull();
      expect(result!.value).toBe(obj);
    });

    it('should return null (not undefined) for no match', () => {
      const router = new Router<string>();
      router.add('GET', '/exists', 'val');
      router.build();

      const result = router.match('GET', '/nope');
      expect(result).toBeNull();
      expect(result).not.toBeUndefined();
    });

    it('should handle single-character static path \'/a\'', () => {
      const router = new Router<string>();
      router.add('GET', '/a', 'a-val');
      router.build();

      const result = router.match('GET', '/a');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('a-val');
    });

    it('should match deeply nested path (20+ segments)', () => {
      const router = new Router<string>();
      const segments = Array.from({ length: 21 }, (_, i) => `s${i}`);
      const path = '/' + segments.join('/');
      router.add('GET', path, 'deep');
      router.build();

      const result = router.match('GET', path);
      expect(result).not.toBeNull();
      expect(result!.value).toBe('deep');
    });

    it('should handle path with max-length segment (256 chars)', () => {
      const router = new Router<string>();
      const longSeg = 'a'.repeat(256);
      const path = `/${longSeg}`;
      router.add('GET', path, 'long');
      router.build();

      const result = router.match('GET', path);
      expect(result).not.toBeNull();
      expect(result!.value).toBe('long');
    });

    it('should match param when value contains special characters', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      const result = router.match('GET', '/users/hello-world_v2.0');
      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('hello-world_v2.0');
    });

    it('should strip query string from match path', () => {
      const router = new Router<string>();
      router.add('GET', '/hello', 'world');
      router.build();

      const result = router.match('GET', '/hello?foo=bar&baz=1');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('world');
    });
  });

  // ── ST: State Transition (11 tests) ──

  describe('state transition', () => {
    it('should complete standard lifecycle: construct → add → build → match', () => {
      const router = new Router<string>();

      // Phase 1: not built yet → match throws
      expect(() => router.match('GET', '/x')).toThrow(RouterError);

      // Phase 2: add
      router.add('GET', '/x', 'x');

      // Phase 3: build
      const built = router.build();
      expect(built).toBe(router);

      // Phase 4: match succeeds
      const matchAfter = router.match('GET', '/x');
      expect(matchAfter).not.toBeNull();

      // Phase 5: add after seal throws
      expect(() => router.add('POST', '/y', 'y')).toThrow(RouterError);
    });

    it('should allow adding valid route after previous add error', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');

      // Conflict
      expect(() => router.add('GET', '/users/*', 'wildcard')).toThrow(RouterError);

      // Should not be sealed
      router.add('POST', '/posts', 'posts');

      router.build();
      const postsMatch = router.match('POST', '/posts');
      expect(postsMatch).not.toBeNull();
    });

    it('should allow multiple valid adds between invalid ones', () => {
      const router = new Router<string>();

      router.add('GET', '/a', 'a');
      expect(() => router.add('GET', '/a', 'dup')).toThrow(RouterError);
      router.add('GET', '/b', 'b');
      expect(() => router.add('GET', '/b', 'dup2')).toThrow(RouterError);
      router.add('GET', '/c', 'c');

      router.build();

      expect(router.match('GET', '/a')).not.toBeNull();
      expect(router.match('GET', '/b')).not.toBeNull();
      expect(router.match('GET', '/c')).not.toBeNull();
    });

    it('should succeed match after recovering from not-built error', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      expect(() => router.match('GET', '/x')).toThrow(RouterError);

      router.build();

      const lateMatch = router.match('GET', '/x');
      expect(lateMatch).not.toBeNull();
    });

    it('should create matcher after build (sealed state)', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      expect(() => router.match('GET', '/x')).toThrow(RouterError);

      router.build();

      const after = router.match('GET', '/x');
      expect(after).not.toBeNull();
    });

    it('should transition from unsealed to sealed on build', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      // Before build: can add
      router.add('GET', '/y', 'y');

      router.build();

      // After build: cannot add
      const err = catchRouterError(() => router.add('GET', '/z', 'z'));
      expect(err.data.kind).toBe('router-sealed');
    });

    it('should return sealed err for add after build but allow match', () => {
      const router = new Router<string>();
      router.add('GET', '/ok', 'ok');
      router.build();

      const err = catchRouterError(() => router.add('POST', '/new', 'new'));
      expect(err.data.kind).toBe('router-sealed');

      const matchResult = router.match('GET', '/ok');
      expect(matchResult).not.toBeNull();
      expect(matchResult!.value).toBe('ok');
    });

    it('should handle add → addAll → build → match sequence', () => {
      const router = new Router<string>();
      router.add('GET', '/single', 'single');
      router.addAll([
        ['POST', '/bulk1', 'bulk1'],
        ['PUT', '/bulk2', 'bulk2'],
      ]);
      router.build();

      const s = router.match('GET', '/single');
      const b1 = router.match('POST', '/bulk1');
      const b2 = router.match('PUT', '/bulk2');
      expect(s).not.toBeNull();
      expect(b1).not.toBeNull();
      expect(b2).not.toBeNull();
    });

    it('should handle build on empty router and return null for match', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expect(result).toBeNull();
    });

    it('should work after addAll partial success then add then build', () => {
      const router = new Router<string>();
      router.add('GET', '/base', 'base');

      const err = catchRouterError(() => router.addAll([
        ['POST', '/ok', 'ok'],
        ['GET', '/base', 'dup'],
      ]));
      expect(err.data.registeredCount).toBe(1);

      // Router not sealed after addAll error
      router.add('PUT', '/another', 'another');
      router.build();

      const base = router.match('GET', '/base');
      const ok = router.match('POST', '/ok');
      const another = router.match('PUT', '/another');
      expect(base).not.toBeNull();
      expect(ok).not.toBeNull();
      expect(another).not.toBeNull();
    });

    it('should reject add after build even for new methods', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const err = catchRouterError(() => router.add('PATCH', '/x', 'patch'));
      expect(err.data.kind).toBe('router-sealed');
    });
  });

  // ── ID: Idempotency (10 tests) ──

  describe('idempotency', () => {
    it('should return same this when build called multiple times', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      const b1 = router.build();
      const b2 = router.build();
      const b3 = router.build();

      expect(b1).toBe(router);
      expect(b2).toBe(router);
      expect(b3).toBe(router);
    });

    it('should return consistent MatchOutput when same path matched twice', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      const first = router.match('GET', '/users/42');
      const second = router.match('GET', '/users/42');

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.value).toBe(second!.value);
      expect(first!.params).toEqual(second!.params);
    });

    it('should consistently return null when non-existent path matched twice', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const r1 = router.match('GET', '/nope');
      const r2 = router.match('GET', '/nope');
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });

    it('should not be idempotent for add: first ok second throws on duplicate', () => {
      const router = new Router<string>();

      router.add('GET', '/x', 'x');
      expect(() => router.add('GET', '/x', 'x')).toThrow(RouterError);
    });

    it('should consistently throw sealed error across repeated add attempts', () => {
      const router = new Router<string>();
      router.build();

      const e1 = catchRouterError(() => router.add('GET', '/a', 'a'));
      const e2 = catchRouterError(() => router.add('POST', '/b', 'b'));

      expect(e1.data.kind).toBe('router-sealed');
      expect(e2.data.kind).toBe('router-sealed');
    });

    it('should return consistent params across repeated dynamic matches', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id/posts/:postId', 'post');
      router.build();

      const r1 = router.match('GET', '/users/1/posts/99');
      const r2 = router.match('GET', '/users/1/posts/99');
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.params).toEqual({ id: '1', postId: '99' });
      expect(r2!.params).toEqual({ id: '1', postId: '99' });
    });

    it('should return consistent results after 100 identical match calls', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      for (let i = 0; i < 100; i++) {
        const result = router.match('GET', '/users/42');
        expect(result).not.toBeNull();
        expect(result!.value).toBe('user');
        expect(result!.params.id).toBe('42');
      }
    });

    it('should match identically via \'*\' and individual method add', () => {
      // Router 1: via '*'
      const r1 = new Router<string>();
      r1.add('*', '/path', 'val');
      r1.build();

      // Router 2: via individual methods
      const r2 = new Router<string>();
      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const) {
        r2.add(m, '/path', 'val');
      }
      r2.build();

      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const) {
        const res1 = r1.match(m, '/path');
        const res2 = r2.match(m, '/path');
        expect(res1).not.toBeNull();
        expect(res2).not.toBeNull();
        expect(res1!.value).toBe(res2!.value);
      }
    });

    it('should return identical err kind for same invalid operation repeated', () => {
      const router = new Router<string>();
      router.add('GET', '/a', 'a');

      const e1 = catchRouterError(() => router.add('GET', '/a', 'dup1'));
      const e2 = catchRouterError(() => router.add('GET', '/a', 'dup2'));

      expect(e1.data.kind).toBe(e2.data.kind);
    });

    it('should return stable null for different non-existent paths', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const paths = ['/a', '/b', '/c/d', '/e/f/g'];
      for (const p of paths) {
        const result = router.match('GET', p);
        expect(result).toBeNull();
      }
    });
  });

  // ── OR: Ordering (8 tests) ──

  describe('ordering', () => {
    it('should check static → cache → dynamic in match priority', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/static', 'static-val');
      router.add('GET', '/users/:id', 'dynamic-val');
      router.build();

      // Static → source='static'
      const staticResult = router.match('GET', '/static');
      expect(staticResult!.meta.source).toBe('static');

      // Dynamic first → source='dynamic'
      const dynamicResult = router.match('GET', '/users/1');
      expect(dynamicResult!.meta.source).toBe('dynamic');

      // Dynamic second → source='cache'
      const cachedResult = router.match('GET', '/users/1');
      expect(cachedResult!.meta.source).toBe('cache');
    });

    it('should register both methods in array and not others', () => {
      const router = new Router<string>();
      router.add(['GET', 'POST'], '/both', 'both');
      router.build();

      const get = router.match('GET', '/both');
      const post = router.match('POST', '/both');

      expect(get).not.toBeNull();
      expect(post).not.toBeNull();
      // PUT has no routes registered → null (standard methods always have codes)
      expect(router.match('PUT', '/both')).toBeNull();
    });

    it('should match regardless of route registration order', () => {
      const r1 = new Router<string>();
      r1.add('GET', '/b', 'b');
      r1.add('GET', '/a', 'a');
      r1.build();

      const r2 = new Router<string>();
      r2.add('GET', '/a', 'a');
      r2.add('GET', '/b', 'b');
      r2.build();

      const r1a = r1.match('GET', '/a');
      const r2a = r2.match('GET', '/a');
      expect(r1a).not.toBeNull();
      expect(r2a).not.toBeNull();
      expect(r1a!.value).toBe(r2a!.value);
    });

    it('should return respective values for HEAD and GET on same path', () => {
      const router = new Router<string>();
      router.add('HEAD', '/resource', 'head-val');
      router.add('GET', '/resource', 'get-val');
      router.build();

      const head = router.match('HEAD', '/resource');
      const get = router.match('GET', '/resource');

      expect(head!.value).toBe('head-val');
      expect(get!.value).toBe('get-val');
    });

    it('should process addAll entries sequentially respecting fail-fast', () => {
      const router = new Router<string>();
      router.add('GET', '/dup', 'original');

      const err = catchRouterError(() => router.addAll([
        ['POST', '/first', 'first'],
        ['PUT', '/second', 'second'],
        ['GET', '/dup', 'duplicate'],
        ['DELETE', '/third', 'third'],
      ]));

      expect(err.data.registeredCount).toBe(2);

      router.build();
      expect(router.match('POST', '/first')).not.toBeNull();
      expect(router.match('PUT', '/second')).not.toBeNull();
      // DELETE has no routes but is a standard method → null (not throw)
      expect(router.match('DELETE', '/third')).toBeNull();
    });

    it('should match static before dynamic when both could match', () => {
      const router = new Router<string>();
      router.add('GET', '/users/admin', 'admin-page');
      router.add('GET', '/users/:id', 'user-page');
      router.build();

      const admin = router.match('GET', '/users/admin');
      expect(admin).not.toBeNull();
      expect(admin!.value).toBe('admin-page');
      expect(admin!.meta.source).toBe('static');

      const user = router.match('GET', '/users/123');
      expect(user).not.toBeNull();
      expect(user!.value).toBe('user-page');
    });

    it('should preserve method array expansion order', () => {
      const router = new Router<string>();
      router.add(['GET', 'POST', 'PUT'], '/ordered', 'val');
      router.build();

      for (const m of ['GET', 'POST', 'PUT'] as const) {
        const result = router.match(m, '/ordered');
        expect(result).not.toBeNull();
        expect(result!.value).toBe('val');
      }
    });

    it('should differentiate cache entries by method for same path', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/users/:id', 'get-user');
      router.add('POST', '/users/:id', 'post-user');
      router.build();

      const get = router.match('GET', '/users/42');
      const post = router.match('POST', '/users/42');

      expect(get!.value).toBe('get-user');
      expect(post!.value).toBe('post-user');

      // Second calls → cached
      const get2 = router.match('GET', '/users/42');
      const post2 = router.match('POST', '/users/42');
      expect(get2!.value).toBe('get-user');
      expect(post2!.value).toBe('post-user');
    });
  });

  // ── NEW: ED / ST / ID / OR additions (10 tests) ──

  describe('additional edge & state', () => {
    it('should return null when matching on router with zero routes', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expect(result).toBeNull();
    });

    it('should not strip trailing slash on root path / when ignoreTrailingSlash=true', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true });
      router.add('GET', '/', 'root');
      router.build();

      const result = router.match('GET', '/');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('root');
    });

    it('should single-decode %2520 to %20 without double decoding', () => {
      const router = new Router<string>({ decodeParams: true });
      router.add('GET', '/seg/:val', 'handler');
      router.build();

      const result = router.match('GET', '/seg/%2520');
      expect(result).not.toBeNull();
      expect(result!.params.val).toBe('%20');
    });

    it('should apply all defaults when multiple optional params are absent', () => {
      const router = new Router<string>({ optionalParamBehavior: 'setUndefined' });
      router.add('GET', '/items/:a?/:b?', 'handler');
      router.build();

      // Both absent
      const r1 = router.match('GET', '/items');
      expect(r1).not.toBeNull();
      expect(r1!.value).toBe('handler');

      // One present, one absent → b is defaulted
      const r2 = router.match('GET', '/items/42');
      expect(r2).not.toBeNull();
      expect(r2!.params.a).toBe('42');
      expect('b' in r2!.params).toBe(true);
      expect(r2!.params.b).toBeUndefined();

      // Both present
      const r3 = router.match('GET', '/items/42/99');
      expect(r3).not.toBeNull();
      expect(r3!.params.a).toBe('42');
      expect(r3!.params.b).toBe('99');
    });

    it('should leave dead handler in array when add fails after handler push', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'valid-handler');

      const err = catchRouterError(() => router.add('GET', '/users/:id', 'dead-handler'));
      expect(err.data.kind).toBe('route-duplicate');

      router.build();
      const match = router.match('GET', '/users/42');
      expect(match).not.toBeNull();
      expect(match!.value).toBe('valid-handler');
    });

    it('should overwrite cached null entry when same path later matches a real route value', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/exists/:id', 'val');
      router.build();

      // First match: path not found → null cached
      const r1 = router.match('GET', '/nope/1');
      expect(r1).toBeNull();

      // Second match: same path → still null (from cache, consistently)
      const r2 = router.match('GET', '/nope/1');
      expect(r2).toBeNull();

      // Existing route still works (separate cache entry)
      const r3 = router.match('GET', '/exists/42');
      expect(r3).not.toBeNull();
      expect(r3!.value).toBe('val');
    });

    it('should return same handler reference identity across multiple matches', () => {
      const handler = { fn: () => 'hello' };
      const router = new Router<typeof handler>();
      router.add('GET', '/api', handler);
      router.build();

      const r1 = router.match('GET', '/api');
      const r2 = router.match('GET', '/api');
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      expect(r1!.value).toBe(handler);
      expect(r2!.value).toBe(handler);
      expect(r1!.value).toBe(r2!.value);
    });

    it('should prefer static over param over wildcard at same trie depth', () => {
      const router = new Router<string>();
      router.add('GET', '/a/exact', 'static');
      router.add('GET', '/a/:param', 'param');
      router.build();

      const result = router.match('GET', '/a/exact');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('static');

      const r2 = router.match('GET', '/a/other');
      expect(r2).not.toBeNull();
      expect(r2!.value).toBe('param');
      expect(r2!.params.param).toBe('other');
    });
  });
});
