import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';
import type { RouterErrData, MatchOutput } from '../types';

import { Router } from '../router';

// ── Helpers ──

type TestResult<T> = T | Err<RouterErrData>;

function expectNotErr<T>(result: TestResult<T>): asserts result is Exclude<T, Err<RouterErrData>> {
  expect(isErr(result)).toBe(false);
}

function expectErr(result: unknown): asserts result is Err<RouterErrData> {
  expect(isErr(result)).toBe(true);
}

describe('Router<T>', () => {
  // ── HP: Happy Path (21 tests) ──

  describe('happy path', () => {
    it('should match static route returning value and empty params', () => {
      const router = new Router<string>();
      router.add('GET', '/hello', 'world');
      router.build();

      const result = router.match('GET', '/hello');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('world');
        expect(result.params).toEqual({});
      }
    });

    it('should register all methods when add called with method array', () => {
      const router = new Router<string>();
      const addResult = router.add(['GET', 'POST'], '/multi', 'multi');
      expectNotErr(addResult);
      router.build();

      const get = router.match('GET', '/multi');
      const post = router.match('POST', '/multi');
      expectNotErr(get);
      expectNotErr(post);
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
        expectNotErr(result);
        expect(result).not.toBeNull();
      }
    });

    it('should register and match all routes via addAll', () => {
      const router = new Router<string>();
      const entries: Array<[any, string, string]> = [
        ['GET', '/a', 'a'],
        ['POST', '/b', 'b'],
      ];
      const addResult = router.addAll(entries);
      expectNotErr(addResult);
      router.build();

      const a = router.match('GET', '/a');
      const b = router.match('POST', '/b');
      expectNotErr(a);
      expectNotErr(b);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      if (a !== null) expect(a.value).toBe('a');
      if (b !== null) expect(b.value).toBe('b');
    });

    it('should return void for addAll with empty array', () => {
      const router = new Router<string>();
      const result = router.addAll([]);
      expectNotErr(result);
    });

    it('should return source=\'static\' for static route match', () => {
      const router = new Router<string>();
      router.add('GET', '/static', 'val');
      router.build();

      const result = router.match('GET', '/static');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.meta.source).toBe('static');
      }
    });

    it('should extract params from dynamic :param route', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      const result = router.match('GET', '/users/123');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('123');
        expect(result.value).toBe('user');
      }
    });

    it('should capture wildcard param segments', () => {
      const router = new Router<string>();
      router.add('GET', '/files/*', 'files');
      router.build();

      const result = router.match('GET', '/files/a/b/c');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('files');
        expect(result.params['*']).toBe('a/b/c');
      }
    });

    it('should return null for non-existent route', () => {
      const router = new Router<string>();
      router.add('GET', '/exists', 'val');
      router.build();

      const result = router.match('GET', '/nonexistent');
      expectNotErr(result);
      expect(result).toBeNull();
    });

    it('should store and return arbitrary types (object, function)', () => {
      const handler = { handle: () => 'ok' };
      const router = new Router<typeof handler>();
      router.add('GET', '/obj', handler);
      router.build();

      const result = router.match('GET', '/obj');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe(handler);
        expect(result.value.handle()).toBe('ok');
      }
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
      expectNotErr(a);
      expectNotErr(b);
      expectNotErr(ap);
      if (a !== null) expect(a.value).toBe('route-a');
      if (b !== null) expect(b.value).toBe('route-b');
      if (ap !== null) expect(ap.value).toBe('route-a-post');
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
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.meta.source).toBe('dynamic');
      }
    });

    it('should return void (not Err) for valid add', () => {
      const router = new Router<string>();
      const result = router.add('GET', '/test', 'val');
      expect(isErr(result)).toBe(false);
    });

    it('should return void (not Err) for valid addAll', () => {
      const router = new Router<string>();
      const result = router.addAll([['GET', '/test', 'val']]);
      expect(isErr(result)).toBe(false);
    });

    it('should match named wildcard param (*name)', () => {
      const router = new Router<string>();
      router.add('GET', '/files/*filepath', 'files');
      router.build();

      const result = router.match('GET', '/files/a/b/c');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('files');
        expect(result.params.filepath).toBe('a/b/c');
      }
    });

    it('should match multi-segment dynamic param (:file+)', () => {
      const router = new Router<string>();
      router.add('GET', '/docs/:file+', 'docs');
      router.build();

      const result = router.match('GET', '/docs/a/b');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('docs');
        expect(result.params.file).toBe('a/b');
      }
    });

    it('should match optional param when present (:id?)', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id?', 'user');
      router.build();

      const result = router.match('GET', '/users/123');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('123');
      }
    });

    it('should omit optional param from params when absent with omit behavior', () => {
      const router = new Router<string>({ optionalParamBehavior: 'omit' });
      router.add('GET', '/users/:id?', 'user');
      router.build();

      const result = router.match('GET', '/users');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('user');
        expect('id' in result.params).toBe(false);
      }
    });

    it('should match regex-constrained param (:id{\\d+})', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id{\\d+}', 'user');
      router.build();

      // Should match numeric
      const numeric = router.match('GET', '/users/123');
      expectNotErr(numeric);
      expect(numeric).not.toBeNull();
      if (numeric !== null) {
        expect(numeric.params.id).toBe('123');
      }

      // Should not match non-numeric
      const alpha = router.match('GET', '/users/abc');
      expectNotErr(alpha);
      expect(alpha).toBeNull();
    });

    it('should register and match custom HTTP method', () => {
      const router = new Router<string>();
      router.add('PURGE' as any, '/cache', 'purge');
      router.build();

      const result = router.match('PURGE' as any, '/cache');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('purge');
      }
    });
  });

  // ── ED: Edge Cases (10 tests) ──

  describe('edge cases', () => {
    it('should match root path \'/\'', () => {
      const router = new Router<string>();
      router.add('GET', '/', 'root');
      router.build();

      const result = router.match('GET', '/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('root');
      }
    });

    it('should return null on empty built router', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expectNotErr(result);
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
      expectNotErr(zero);
      expectNotErr(empty);
      expectNotErr(f);

      if (zero !== null) expect(zero.value).toBe(0);
      if (empty !== null) expect(empty.value).toBe('');
      if (f !== null) expect(f.value).toBe(false);
    });

    it('should return reference-equal value in MatchOutput', () => {
      const obj = { id: 1 };
      const router = new Router<typeof obj>();
      router.add('GET', '/ref', obj);
      router.build();

      const result = router.match('GET', '/ref');
      expectNotErr(result);
      if (result !== null) {
        expect(result.value).toBe(obj);
      }
    });

    it('should return null (not undefined) for no match', () => {
      const router = new Router<string>();
      router.add('GET', '/exists', 'val');
      router.build();

      const result = router.match('GET', '/nope');
      expectNotErr(result);
      expect(result).toBeNull();
      expect(result).not.toBeUndefined();
    });

    it('should handle single-character static path \'/a\'', () => {
      const router = new Router<string>();
      router.add('GET', '/a', 'a-val');
      router.build();

      const result = router.match('GET', '/a');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('a-val');
      }
    });

    it('should match deeply nested path (20+ segments)', () => {
      const router = new Router<string>();
      const segments = Array.from({ length: 21 }, (_, i) => `s${i}`);
      const path = '/' + segments.join('/');
      router.add('GET', path, 'deep');
      router.build();

      const result = router.match('GET', path);
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('deep');
      }
    });

    it('should handle path with max-length segment (256 chars)', () => {
      const router = new Router<string>();
      const longSeg = 'a'.repeat(256);
      const path = `/${longSeg}`;
      router.add('GET', path, 'long');
      router.build();

      const result = router.match('GET', path);
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('long');
      }
    });

    it('should match param when value contains special characters', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      const result = router.match('GET', '/users/hello-world_v2.0');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.id).toBe('hello-world_v2.0');
      }
    });

    it('should strip query string from match path', () => {
      const router = new Router<string>();
      router.add('GET', '/hello', 'world');
      router.build();

      const result = router.match('GET', '/hello?foo=bar&baz=1');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('world');
      }
    });
  });

  // ── ST: State Transition (11 tests) ──

  describe('state transition', () => {
    it('should complete standard lifecycle: construct → add → build → match', () => {
      const router = new Router<string>();

      // Phase 1: not built yet → match fails
      const matchBefore = router.match('GET', '/x');
      expectErr(matchBefore);

      // Phase 2: add
      const addResult = router.add('GET', '/x', 'x');
      expectNotErr(addResult);

      // Phase 3: build
      const built = router.build();
      expect(built).toBe(router);

      // Phase 4: match succeeds
      const matchAfter = router.match('GET', '/x');
      expectNotErr(matchAfter);
      expect(matchAfter).not.toBeNull();

      // Phase 5: add after seal fails
      const addAfter = router.add('POST', '/y', 'y');
      expectErr(addAfter);
    });

    it('should allow adding valid route after previous add error', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');

      // Conflict
      const errResult = router.add('GET', '/users/*', 'wildcard');
      expectErr(errResult);

      // Should not be sealed
      const okResult = router.add('POST', '/posts', 'posts');
      expectNotErr(okResult);

      router.build();
      const postsMatch = router.match('POST', '/posts');
      expectNotErr(postsMatch);
      expect(postsMatch).not.toBeNull();
    });

    it('should allow multiple valid adds between invalid ones', () => {
      const router = new Router<string>();

      router.add('GET', '/a', 'a');
      router.add('GET', '/a', 'dup');   // err - duplicate
      router.add('GET', '/b', 'b');     // should work
      router.add('GET', '/b', 'dup2');  // err - duplicate
      router.add('GET', '/c', 'c');     // should work

      router.build();

      expectNotErr(router.match('GET', '/a'));
      expectNotErr(router.match('GET', '/b'));
      expectNotErr(router.match('GET', '/c'));
    });

    it('should succeed match after recovering from not-built error', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      const earlyMatch = router.match('GET', '/x');
      expectErr(earlyMatch);

      router.build();

      const lateMatch = router.match('GET', '/x');
      expectNotErr(lateMatch);
      expect(lateMatch).not.toBeNull();
    });

    it('should create matcher after build (sealed state)', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      const before = router.match('GET', '/x');
      expectErr(before);

      router.build();

      const after = router.match('GET', '/x');
      expectNotErr(after);
      expect(after).not.toBeNull();
    });

    it('should transition from unsealed to sealed on build', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      // Before build: can add
      const addBefore = router.add('GET', '/y', 'y');
      expectNotErr(addBefore);

      router.build();

      // After build: cannot add
      const addAfter = router.add('GET', '/z', 'z');
      expectErr(addAfter);
      expect(addAfter.data.kind).toBe('router-sealed');
    });

    it('should return sealed err for add after build but allow match', () => {
      const router = new Router<string>();
      router.add('GET', '/ok', 'ok');
      router.build();

      const addResult = router.add('POST', '/new', 'new');
      expectErr(addResult);
      expect(addResult.data.kind).toBe('router-sealed');

      const matchResult = router.match('GET', '/ok');
      expectNotErr(matchResult);
      expect(matchResult).not.toBeNull();
      if (matchResult !== null) {
        expect(matchResult.value).toBe('ok');
      }
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
      expectNotErr(s);
      expectNotErr(b1);
      expectNotErr(b2);
      expect(s).not.toBeNull();
      expect(b1).not.toBeNull();
      expect(b2).not.toBeNull();
    });

    it('should handle build on empty router and return null for match', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expectNotErr(result);
      expect(result).toBeNull();
    });

    it('should work after addAll partial success then add then build', () => {
      const router = new Router<string>();
      router.add('GET', '/base', 'base');

      const result = router.addAll([
        ['POST', '/ok', 'ok'],
        ['GET', '/base', 'dup'],
      ]);
      expectErr(result);

      // Router not sealed after addAll error
      const addResult = router.add('PUT', '/another', 'another');
      expectNotErr(addResult);
      router.build();

      const base = router.match('GET', '/base');
      const ok = router.match('POST', '/ok');
      const another = router.match('PUT', '/another');
      expectNotErr(base);
      expectNotErr(ok);
      expectNotErr(another);
      expect(base).not.toBeNull();
      expect(ok).not.toBeNull();
      expect(another).not.toBeNull();
    });

    it('should reject add after build even for new methods', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const result = router.add('PATCH', '/x', 'patch');
      expectErr(result);
      expect(result.data.kind).toBe('router-sealed');
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

      expectNotErr(first);
      expectNotErr(second);
      if (first !== null && second !== null) {
        expect(first.value).toBe(second.value);
        expect(first.params).toEqual(second.params);
      }
    });

    it('should consistently return null when non-existent path matched twice', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const r1 = router.match('GET', '/nope');
      const r2 = router.match('GET', '/nope');
      expectNotErr(r1);
      expectNotErr(r2);
      expect(r1).toBeNull();
      expect(r2).toBeNull();
    });

    it('should not be idempotent for add: first ok second err on duplicate', () => {
      const router = new Router<string>();

      const first = router.add('GET', '/x', 'x');
      const second = router.add('GET', '/x', 'x');

      expectNotErr(first);
      expectErr(second);
    });

    it('should consistently return sealed err across repeated add attempts', () => {
      const router = new Router<string>();
      router.build();

      const r1 = router.add('GET', '/a', 'a');
      const r2 = router.add('POST', '/b', 'b');

      expectErr(r1);
      expectErr(r2);
      expect(r1.data.kind).toBe('router-sealed');
      expect(r2.data.kind).toBe('router-sealed');
    });

    it('should return consistent params across repeated dynamic matches', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id/posts/:postId', 'post');
      router.build();

      const r1 = router.match('GET', '/users/1/posts/99');
      const r2 = router.match('GET', '/users/1/posts/99');
      expectNotErr(r1);
      expectNotErr(r2);
      if (r1 !== null && r2 !== null) {
        expect(r1.params).toEqual({ id: '1', postId: '99' });
        expect(r2.params).toEqual({ id: '1', postId: '99' });
      }
    });

    it('should return consistent results after 100 identical match calls', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');
      router.build();

      for (let i = 0; i < 100; i++) {
        const result = router.match('GET', '/users/42');
        expectNotErr(result);
        expect(result).not.toBeNull();
        if (result !== null) {
          expect(result.value).toBe('user');
          expect(result.params.id).toBe('42');
        }
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
        expectNotErr(res1);
        expectNotErr(res2);
        expect(res1).not.toBeNull();
        expect(res2).not.toBeNull();
        if (res1 !== null && res2 !== null) {
          expect(res1.value).toBe(res2.value);
        }
      }
    });

    it('should return identical err kind for same invalid operation repeated', () => {
      const router = new Router<string>();
      router.add('GET', '/a', 'a');

      const e1 = router.add('GET', '/a', 'dup1');
      const e2 = router.add('GET', '/a', 'dup2');

      expectErr(e1);
      expectErr(e2);
      expect(e1.data.kind).toBe(e2.data.kind);
    });

    it('should return stable null for different non-existent paths', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const paths = ['/a', '/b', '/c/d', '/e/f/g'];
      for (const p of paths) {
        const result = router.match('GET', p);
        expectNotErr(result);
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
      expectNotErr(staticResult);
      if (staticResult !== null) {
        expect(staticResult.meta.source).toBe('static');
      }

      // Dynamic first → source='dynamic'
      const dynamicResult = router.match('GET', '/users/1');
      expectNotErr(dynamicResult);
      if (dynamicResult !== null) {
        expect(dynamicResult.meta.source).toBe('dynamic');
      }

      // Dynamic second → source='cache'
      const cachedResult = router.match('GET', '/users/1');
      expectNotErr(cachedResult);
      if (cachedResult !== null) {
        expect(cachedResult.meta.source).toBe('cache');
      }
    });

    it('should register both methods in array and not others', () => {
      const router = new Router<string>();
      router.add(['GET', 'POST'], '/both', 'both');
      router.build();

      const get = router.match('GET', '/both');
      const post = router.match('POST', '/both');
      const put = router.match('PUT', '/both');

      expectNotErr(get);
      expectNotErr(post);
      expectNotErr(put);
      expect(get).not.toBeNull();
      expect(post).not.toBeNull();
      expect(put).toBeNull();
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
      expectNotErr(r1a);
      expectNotErr(r2a);
      if (r1a !== null && r2a !== null) {
        expect(r1a.value).toBe(r2a.value);
      }
    });

    it('should return respective values for HEAD and GET on same path', () => {
      const router = new Router<string>();
      router.add('HEAD', '/resource', 'head-val');
      router.add('GET', '/resource', 'get-val');
      router.build();

      const head = router.match('HEAD', '/resource');
      const get = router.match('GET', '/resource');

      expectNotErr(head);
      expectNotErr(get);
      if (head !== null) expect(head.value).toBe('head-val');
      if (get !== null) expect(get.value).toBe('get-val');
    });

    it('should process addAll entries sequentially respecting fail-fast', () => {
      const router = new Router<string>();
      router.add('GET', '/dup', 'original');

      const result = router.addAll([
        ['POST', '/first', 'first'],
        ['PUT', '/second', 'second'],
        ['GET', '/dup', 'duplicate'],
        ['DELETE', '/third', 'third'],
      ]);

      expectErr(result);
      expect(result.data.registeredCount).toBe(2);

      router.build();
      expectNotErr(router.match('POST', '/first'));
      expectNotErr(router.match('PUT', '/second'));
      const third = router.match('DELETE', '/third');
      expectNotErr(third);
      expect(third).toBeNull();
    });

    it('should match static before dynamic when both could match', () => {
      const router = new Router<string>();
      router.add('GET', '/users/admin', 'admin-page');
      router.add('GET', '/users/:id', 'user-page');
      router.build();

      const admin = router.match('GET', '/users/admin');
      expectNotErr(admin);
      expect(admin).not.toBeNull();
      if (admin !== null) {
        expect(admin.value).toBe('admin-page');
        expect(admin.meta.source).toBe('static');
      }

      const user = router.match('GET', '/users/123');
      expectNotErr(user);
      expect(user).not.toBeNull();
      if (user !== null) {
        expect(user.value).toBe('user-page');
      }
    });

    it('should preserve method array expansion order', () => {
      const router = new Router<string>();
      // Both GET and POST should be registered
      const addResult = router.add(['GET', 'POST', 'PUT'], '/ordered', 'val');
      expectNotErr(addResult);
      router.build();

      for (const m of ['GET', 'POST', 'PUT'] as const) {
        const result = router.match(m, '/ordered');
        expectNotErr(result);
        expect(result).not.toBeNull();
        if (result !== null) {
          expect(result.value).toBe('val');
        }
      }
    });

    it('should differentiate cache entries by method for same path', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/users/:id', 'get-user');
      router.add('POST', '/users/:id', 'post-user');
      router.build();

      const get = router.match('GET', '/users/42');
      const post = router.match('POST', '/users/42');

      expectNotErr(get);
      expectNotErr(post);
      if (get !== null && post !== null) {
        expect(get.value).toBe('get-user');
        expect(post.value).toBe('post-user');
      }

      // Second calls → cached
      const get2 = router.match('GET', '/users/42');
      const post2 = router.match('POST', '/users/42');
      expectNotErr(get2);
      expectNotErr(post2);
      if (get2 !== null) expect(get2.value).toBe('get-user');
      if (post2 !== null) expect(post2.value).toBe('post-user');
    });
  });

  // ── NEW: ED / ST / ID / OR additions (10 tests) ──

  describe('additional edge & state', () => {
    it('should return null when matching on router with zero routes', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expectNotErr(result);
      expect(result).toBeNull();
    });

    it('should not strip trailing slash on root path / when ignoreTrailingSlash=true', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true });
      router.add('GET', '/', 'root');
      router.build();

      // match() checks searchPath.length > 1 before stripping — root '/' has length 1, so no strip
      const result = router.match('GET', '/');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('root');
      }
    });

    it('should single-decode %2520 to %20 without double decoding', () => {
      const router = new Router<string>({ decodeParams: true });
      router.add('GET', '/seg/:val', 'handler');
      router.build();

      // decodeURIComponent('%2520') → '%20' (NOT ' ')
      const result = router.match('GET', '/seg/%2520');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.params.val).toBe('%20');
      }
    });

    it('should collapse path of only slashes /// to root /', () => {
      const router = new Router<string>({ collapseSlashes: true });
      router.add('GET', '/', 'root');
      router.build();

      // normalize: removeLeadingSlash → // → split → ['',''] → collapseSlashes → [] → normalized: /
      const result = router.match('GET', '///');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('root');
      }
    });

    it('should apply all defaults when multiple optional params are absent', () => {
      const router = new Router<string>({ optionalParamBehavior: 'setUndefined' });
      router.add('GET', '/items/:a?/:b?', 'handler');
      router.build();

      // Both absent
      const r1 = router.match('GET', '/items');
      expectNotErr(r1);
      expect(r1).not.toBeNull();
      if (r1 !== null) {
        expect(r1.value).toBe('handler');
      }

      // One present, one absent → b is defaulted
      const r2 = router.match('GET', '/items/42');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.params.a).toBe('42');
        expect('b' in r2.params).toBe(true);
        expect(r2.params.b).toBeUndefined();
      }

      // Both present
      const r3 = router.match('GET', '/items/42/99');
      expectNotErr(r3);
      expect(r3).not.toBeNull();
      if (r3 !== null) {
        expect(r3.params.a).toBe('42');
        expect(r3.params.b).toBe('99');
      }
    });

    it('should leave dead handler in array when add fails after handler push', () => {
      // Use dynamic route so staticMap isn't involved
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'valid-handler');

      // Duplicate add fails — but builder already pushed handler before detecting conflict
      const result = router.add('GET', '/users/:id', 'dead-handler');
      expectErr(result);
      expect(result.data.kind).toBe('route-duplicate');

      // handlers array = ['valid-handler', 'dead-handler'] but trie references index 0
      router.build();
      const match = router.match('GET', '/users/42');
      expectNotErr(match);
      expect(match).not.toBeNull();
      if (match !== null) {
        expect(match.value).toBe('valid-handler');
      }
    });

    it('should overwrite cached null entry when same path later matches a real route value', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/exists/:id', 'val');
      router.build();

      // First match: path not found → null cached
      const r1 = router.match('GET', '/nope/1');
      expectNotErr(r1);
      expect(r1).toBeNull();

      // Second match: same path → still null (from cache, consistently)
      const r2 = router.match('GET', '/nope/1');
      expectNotErr(r2);
      expect(r2).toBeNull();

      // Existing route still works (separate cache entry)
      const r3 = router.match('GET', '/exists/42');
      expectNotErr(r3);
      expect(r3).not.toBeNull();
      if (r3 !== null) {
        expect(r3.value).toBe('val');
      }
    });

    it('should succeed on valid match after a prior encoding error on different path', () => {
      const router = new Router<string>({ failFastOnBadEncoding: true });
      router.add('GET', '/items/:id', 'handler');
      router.build();

      // First: bad encoding → error
      const bad = router.match('GET', '/items/%GG');
      expectErr(bad);
      expect(bad.data.kind).toBe('encoding');

      // Second: valid path → success (error state does not leak)
      const good = router.match('GET', '/items/abc');
      expectNotErr(good);
      expect(good).not.toBeNull();
      if (good !== null) {
        expect(good.value).toBe('handler');
        expect(good.params.id).toBe('abc');
      }
    });

    it('should return same handler reference identity across multiple matches', () => {
      const handler = { fn: () => 'hello' };
      const router = new Router<typeof handler>();
      router.add('GET', '/api', handler);
      router.build();

      const r1 = router.match('GET', '/api');
      const r2 = router.match('GET', '/api');
      expectNotErr(r1);
      expectNotErr(r2);
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
      if (r1 !== null && r2 !== null) {
        expect(r1.value).toBe(handler); // reference identity
        expect(r2.value).toBe(handler);
        expect(r1.value).toBe(r2.value);
      }
    });

    it('should prefer static over param over wildcard at same trie depth', () => {
      const router = new Router<string>();
      router.add('GET', '/a/exact', 'static');
      router.add('GET', '/a/:param', 'param');
      router.build();

      // Static child 'exact' is tried before param child ':param' in matcher walk
      const result = router.match('GET', '/a/exact');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('static');
      }

      // Non-static value falls through to param
      const r2 = router.match('GET', '/a/other');
      expectNotErr(r2);
      expect(r2).not.toBeNull();
      if (r2 !== null) {
        expect(r2.value).toBe('param');
        expect(r2.params.param).toBe('other');
      }
    });
  });
});
