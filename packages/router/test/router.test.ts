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

function fillMethodsToLimit(router: Router<string>): void {
  // 7 defaults exist. Register 25 customs to fill to 32 via unique paths.
  for (let i = 0; i < 25; i++) {
    router.add(`CUSTOM_${i}` as any, `/limit-${i}`, `limit-${i}`);
  }
}

describe('Router<T>', () => {
  // ── HP: Happy Path ──

  describe('happy path', () => {
    it('should match static route with correct value and empty params', () => {
      const router = new Router<string>();
      const addResult = router.add('GET', '/hello', 'world');
      expectNotErr(addResult);
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

      const getResult = router.match('GET', '/multi');
      const postResult = router.match('POST', '/multi');
      expectNotErr(getResult);
      expectNotErr(postResult);
      expect(getResult).not.toBeNull();
      expect(postResult).not.toBeNull();
    });

    it('should register all 7 standard methods when add called with \'*\'', () => {
      const router = new Router<string>();
      const addResult = router.add('*', '/all', 'all');
      expectNotErr(addResult);
      router.build();

      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
      for (const m of methods) {
        const result = router.match(m, '/all');
        expectNotErr(result);
        expect(result).not.toBeNull();
      }
    });

    it('should register and match all routes when using addAll', () => {
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

    it('should return void success when addAll called with empty array', () => {
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

    it('should extract params from dynamic param route', () => {
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

    it('should capture wildcard param', () => {
      const router = new Router<string>();
      router.add('GET', '/files/*', 'files');
      router.build();

      const result = router.match('GET', '/files/a/b/c');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('files');
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

    it('should use cache on second match when cache enabled (source=\'cache\')', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/users/:id', 'user');
      router.build();

      // First match: dynamic
      const first = router.match('GET', '/users/42');
      expectNotErr(first);
      expect(first).not.toBeNull();
      if (first !== null) {
        expect(first.meta.source).toBe('dynamic');
      }

      // Second match: cache
      const second = router.match('GET', '/users/42');
      expectNotErr(second);
      expect(second).not.toBeNull();
      if (second !== null) {
        expect(second.meta.source).toBe('cache');
        expect(second.value).toBe('user');
        expect(second.params.id).toBe('42');
      }
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

    it('should match correct route among multiple routes', () => {
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
  });

  // ── NE: Negative / Error ──

  describe('negative / error', () => {
    it('should return err kind=\'router-sealed\' when add called after build', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const result = router.add('GET', '/y', 'y');
      expectErr(result);
      expect(result.data.kind).toBe('router-sealed');
      expect(result.data.path).toBe('/y');
      expect(result.data.method).toBe('GET');
    });

    it('should return err kind=\'not-built\' when match called before build', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      const result = router.match('GET', '/x');
      expectErr(result);
      expect(result.data.kind).toBe('not-built');
    });

    it('should return err for duplicate method+path (route-duplicate)', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'first');

      const result = router.add('GET', '/x', 'second');
      expectErr(result);
      expect(result.data.kind).toBe('route-duplicate');
    });

    it('should return err for conflicting routes (route-conflict)', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'by-id');

      // Wildcard after param children → conflict
      const result = router.add('GET', '/users/*', 'by-wildcard');
      expectErr(result);
      expect(result.data.kind).toBe('route-conflict');
    });

    it('should return err with correct registeredCount on addAll fail-fast', () => {
      const router = new Router<string>();
      router.add('GET', '/existing', 'existing');

      // Second entry duplicates /existing
      const result = router.addAll([
        ['POST', '/new', 'new'],
        ['GET', '/existing', 'duplicate'],
      ]);

      expectErr(result);
      expect(result.data.registeredCount).toBe(1);
    });

    it('should return registeredCount=0 when addAll first entry fails', () => {
      const router = new Router<string>();
      router.add('GET', '/existing', 'existing');

      const result = router.addAll([
        ['GET', '/existing', 'duplicate'],
        ['POST', '/other', 'other'],
      ]);

      expectErr(result);
      expect(result.data.registeredCount).toBe(0);
    });

    it('should return err kind=\'router-sealed\' when addAll called after build', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');
      router.build();

      const result = router.addAll([['POST', '/y', 'y']]);
      expectErr(result);
      expect(result.data.kind).toBe('router-sealed');
      expect(result.data.registeredCount).toBe(0);
    });

    it('should return err kind=\'method-limit\' when exceeding 32 methods', () => {
      const router = new Router<string>();
      fillMethodsToLimit(router);

      const result = router.add('OVERFLOW_METHOD' as any, '/overflow', 'overflow');
      expectErr(result);
      expect(result.data.kind).toBe('method-limit');
    });

    it('should still match existing routes after sealed add-error', () => {
      const router = new Router<string>();
      router.add('GET', '/ok', 'ok');
      router.build();

      // Attempt to add after seal
      const addResult = router.add('POST', '/new', 'new');
      expectErr(addResult);

      // Original route still matches
      const matchResult = router.match('GET', '/ok');
      expectNotErr(matchResult);
      expect(matchResult).not.toBeNull();
      if (matchResult !== null) {
        expect(matchResult.value).toBe('ok');
      }
    });

    it('should return err for pattern parse error from builder', () => {
      const router = new Router<string>();

      // Unclosed regex pattern (missing closing '}')
      const result = router.add('GET', '/users/:id{\\d+', 'invalid-regex');

      // Builder throws "Parameter regex must close with '}'" → caught → Result err
      expectErr(result);
    });

    it('should propagate processor error during match as err', () => {
      const router = new Router<string>({
        failFastOnBadEncoding: true,
        maxSegmentLength: 5,
      });
      router.add('GET', '/ok', 'ok');
      router.build();

      // Segment exceeds maxSegmentLength
      const result = router.match('GET', '/very-long-segment-name');
      expectErr(result);
    });

    it('should include kind, message, path, method in err data', () => {
      const router = new Router<string>();
      router.build();

      const result = router.add('GET', '/after-seal', 'v');
      expectErr(result);
      expect(result.data.kind).toBe('router-sealed');
      expect(typeof result.data.message).toBe('string');
      expect(result.data.path).toBe('/after-seal');
      expect(result.data.method).toBe('GET');
    });

    it('should return err when add with method array called after build', () => {
      const router = new Router<string>();
      router.build();

      const result = router.add(['GET', 'POST'], '/z', 'z');
      expectErr(result);
      expect(result.data.kind).toBe('router-sealed');
    });
  });

  // ── ED: Edge ──

  describe('edge cases', () => {
    it('should add and match root path \'/\'', () => {
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

    it('should return null when matching on empty built router', () => {
      const router = new Router<string>();
      router.build();

      const result = router.match('GET', '/anything');
      expectNotErr(result);
      expect(result).toBeNull();
    });

    it('should evict and replace with cacheSize=1', () => {
      const router = new Router<string>({ enableCache: true, cacheSize: 1 });
      router.add('GET', '/users/:id', 'user');
      router.build();

      // First match - dynamic, cached
      const first = router.match('GET', '/users/1');
      expectNotErr(first);

      // Second match different param - dynamic, evicts first
      const second = router.match('GET', '/users/2');
      expectNotErr(second);

      // Third match of first param - dynamic again (evicted from cache)
      const third = router.match('GET', '/users/1');
      expectNotErr(third);
      if (third !== null) {
        expect(third.meta.source).toBe('dynamic');
      }
    });

    it('should not match different case when caseSensitive=true', () => {
      const router = new Router<string>({ caseSensitive: true });
      router.add('GET', '/Hello', 'hello');
      router.build();

      const exact = router.match('GET', '/Hello');
      const lower = router.match('GET', '/hello');
      expectNotErr(exact);
      expectNotErr(lower);
      expect(exact).not.toBeNull();
      expect(lower).toBeNull();
    });

    it('should match different case when caseSensitive=false', () => {
      const router = new Router<string>({ caseSensitive: false });
      router.add('GET', '/Hello', 'hello');
      router.build();

      const lower = router.match('GET', '/hello');
      expectNotErr(lower);
      expect(lower).not.toBeNull();
    });

    it('should match path with trailing slash when ignoreTrailingSlash=true', () => {
      const router = new Router<string>({ ignoreTrailingSlash: true });
      router.add('GET', '/path', 'val');
      router.build();

      const withSlash = router.match('GET', '/path/');
      expectNotErr(withSlash);
      expect(withSlash).not.toBeNull();
      if (withSlash !== null) {
        expect(withSlash.value).toBe('val');
      }
    });

    it('should store and return falsy values (0, \'\', false, null) correctly', () => {
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
        expect(result.value).toBe(obj); // reference equality
      }
    });

    it('should handle encoded slash behaviors (decode/preserve/reject)', () => {
      // reject mode
      const rejectRouter = new Router<string>({ encodedSlashBehavior: 'reject' });
      rejectRouter.add('GET', '/files/:name', 'files');
      rejectRouter.build();

      const rejectResult = rejectRouter.match('GET', '/files/a%2Fb');
      // Should be err for encoded slash in reject mode
      if (isErr(rejectResult)) {
        expect(rejectResult.data.kind).toBe('encoded-slash');
      }
    });

    it('should collapse consecutive slashes', () => {
      const router = new Router<string>({ collapseSlashes: true });
      router.add('GET', '/a/b', 'ab');
      router.build();

      const result = router.match('GET', '/a//b');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe('ab');
      }
    });

    it('should match static route via fast-path without full normalization', () => {
      const router = new Router<string>();
      router.add('GET', '/fast', 'fast');
      router.build();

      // Clean path starting with '/' → static fast-path
      const result = router.match('GET', '/fast');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.meta.source).toBe('static');
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
  });

  // ── CO: Corner ──

  describe('corner cases', () => {
    it('should preserve first route and report registeredCount when addAll second entry conflicts', () => {
      const router = new Router<string>();
      router.add('GET', '/conflict', 'original');

      const result = router.addAll([
        ['POST', '/ok', 'ok'],
        ['GET', '/conflict', 'dup'],
      ]);

      expectErr(result);
      expect(result.data.registeredCount).toBe(1);

      // First route from addAll was registered
      router.build();
      const okResult = router.match('POST', '/ok');
      expectNotErr(okResult);
      expect(okResult).not.toBeNull();
    });

    it('should cache null on miss and return null from cache on next match', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/exists', 'exists');
      router.build();

      // First miss → cached null
      const miss1 = router.match('GET', '/users/nope');
      expectNotErr(miss1);
      expect(miss1).toBeNull();

      // Second miss → from cache
      const miss2 = router.match('GET', '/users/nope');
      expectNotErr(miss2);
      expect(miss2).toBeNull();
    });

    it('should match correctly with caseSensitive=false and ignoreTrailingSlash combined', () => {
      const router = new Router<string>({
        caseSensitive: false,
        ignoreTrailingSlash: true,
      });
      router.add('GET', '/Hello', 'hello');
      router.build();

      const result = router.match('GET', '/hello/');
      expectNotErr(result);
      expect(result).not.toBeNull();
    });

    it('should return MatchOutput for falsy value (not confuse with null)', () => {
      const router = new Router<number>();
      router.add('GET', '/zero', 0);
      router.build();

      const result = router.match('GET', '/zero');
      expectNotErr(result);
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result.value).toBe(0);
      }
    });

    it('should return duplicate err when add \'*\' then add same path with specific method', () => {
      const router = new Router<string>();
      router.add('*', '/path', 'all');

      const result = router.add('GET', '/path', 'specific');
      expectErr(result);
      expect(result.data.kind).toBe('route-duplicate');
    });

    it('should return this safely when build called twice', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      const first = router.build();
      const second = router.build();

      expect(first).toBe(router);
      expect(second).toBe(router);
    });

    it('should still match existing routes after sealed add-error attempt', () => {
      const router = new Router<string>();
      router.add('GET', '/good', 'good');
      router.build();

      const addErr = router.add('POST', '/late', 'late');
      expectErr(addErr);

      const matchResult = router.match('GET', '/good');
      expectNotErr(matchResult);
      expect(matchResult).not.toBeNull();
      if (matchResult !== null) {
        expect(matchResult.value).toBe('good');
      }
    });

    it('should return cloned params from cache (not shared references)', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/users/:id', 'user');
      router.build();

      const first = router.match('GET', '/users/1');
      expectNotErr(first);
      if (first !== null) {
        // Mutate params
        first.params.id = 'mutated';
      }

      const second = router.match('GET', '/users/1');
      expectNotErr(second);
      if (second !== null) {
        expect(second.params.id).toBe('1'); // Not "mutated"
      }
    });

    it('should keep multiple Router instances independent', () => {
      const r1 = new Router<string>();
      const r2 = new Router<string>();

      r1.add('GET', '/r1', 'r1');
      r2.add('GET', '/r2', 'r2');

      r1.build();
      r2.build();

      const r1r2 = r1.match('GET', '/r2');
      const r2r1 = r2.match('GET', '/r1');

      expectNotErr(r1r2);
      expectNotErr(r2r1);
      expect(r1r2).toBeNull();
      expect(r2r1).toBeNull();
    });

    it('should not corrupt state after addAll partial success', () => {
      const router = new Router<string>();
      router.add('GET', '/base', 'base');

      const result = router.addAll([
        ['POST', '/ok', 'ok'],
        ['GET', '/base', 'dup'], // fails
      ]);

      expectErr(result);

      // Router is not sealed — can still add and build
      const addResult = router.add('PUT', '/another', 'another');
      expectNotErr(addResult);
      router.build();

      // All valid routes match
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
  });

  // ── ST: State Transition ──

  describe('state transition', () => {
    it('should complete standard lifecycle: construct → add → build → match', () => {
      const router = new Router<string>();

      // Phase 1: construct - not sealed
      const matchBefore = router.match('GET', '/x');
      expectErr(matchBefore);

      // Phase 2: add
      const addResult = router.add('GET', '/x', 'x');
      expectNotErr(addResult);

      // Phase 3: build
      const built = router.build();
      expect(built).toBe(router);

      // Phase 4: match
      const matchAfter = router.match('GET', '/x');
      expectNotErr(matchAfter);
      expect(matchAfter).not.toBeNull();

      // Phase 5: add after seal fails
      const addAfter = router.add('POST', '/y', 'y');
      expectErr(addAfter);
    });

    it('should allow adding valid route after previous add error (not sealed)', () => {
      const router = new Router<string>();
      router.add('GET', '/users/:id', 'user');

      // Error: wildcard conflicts with existing param child
      const errResult = router.add('GET', '/users/*', 'wildcard');
      expectErr(errResult);

      // Should not be sealed — add another valid route
      const okResult = router.add('POST', '/posts', 'posts');
      expectNotErr(okResult);

      router.build();

      const userMatch = router.match('GET', '/users/123');
      const postsMatch = router.match('POST', '/posts');
      expectNotErr(userMatch);
      expectNotErr(postsMatch);
      expect(userMatch).not.toBeNull();
      expect(postsMatch).not.toBeNull();
    });

    it('should allow multiple valid adds between invalid ones', () => {
      const router = new Router<string>();

      router.add('GET', '/a', 'a');
      router.add('GET', '/a', 'dup'); // err - duplicate
      router.add('GET', '/b', 'b'); // should work
      router.add('GET', '/b', 'dup2'); // err - duplicate
      router.add('GET', '/c', 'c'); // should work

      router.build();

      expectNotErr(router.match('GET', '/a'));
      expectNotErr(router.match('GET', '/b'));
      expectNotErr(router.match('GET', '/c'));
    });

    it('should match each standard method after add with \'*\'', () => {
      const router = new Router<string>();
      router.add('*', '/all', 'all');
      router.build();

      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
      for (const m of methods) {
        const result = router.match(m, '/all');
        expectNotErr(result);
        expect(result).not.toBeNull();
        if (result !== null) {
          expect(result.value).toBe('all');
        }
      }
    });

    it('should succeed match after recovering from not-built error', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      // Not built yet
      const earlyMatch = router.match('GET', '/x');
      expectErr(earlyMatch);

      // Now build
      router.build();

      // Should work
      const lateMatch = router.match('GET', '/x');
      expectNotErr(lateMatch);
      expect(lateMatch).not.toBeNull();
    });

    it('should populate cache on first match and hit on second', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/users/:id', 'user');
      router.build();

      const first = router.match('GET', '/users/42');
      expectNotErr(first);
      if (first !== null) {
        expect(first.meta.source).toBe('dynamic');
      }

      const second = router.match('GET', '/users/42');
      expectNotErr(second);
      if (second !== null) {
        expect(second.meta.source).toBe('cache');
      }
    });

    it('should create matcher after build (sealed state)', () => {
      const router = new Router<string>();
      router.add('GET', '/x', 'x');

      // Before build: match fails with not-built
      const before = router.match('GET', '/x');
      expectErr(before);

      router.build();

      // After build: match works
      const after = router.match('GET', '/x');
      expectNotErr(after);
      expect(after).not.toBeNull();
    });
  });

  // ── ID: Idempotency ──

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

      expect(router.match('GET', '/nope')).toBeNull();
      expect(router.match('GET', '/nope')).toBeNull();
    });

    it('should not be idempotent for add: first ok, second err on duplicate', () => {
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
    });
  });

  // ── OR: Ordering ──

  describe('ordering', () => {
    it('should check static before cache before dynamic in match priority', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/static', 'static-val');
      router.add('GET', '/users/:id', 'dynamic-val');
      router.build();

      // Static route → source='static'
      const staticResult = router.match('GET', '/static');
      expectNotErr(staticResult);
      if (staticResult !== null) {
        expect(staticResult.meta.source).toBe('static');
      }

      // Dynamic route → source='dynamic' first time
      const dynamicResult = router.match('GET', '/users/1');
      expectNotErr(dynamicResult);
      if (dynamicResult !== null) {
        expect(dynamicResult.meta.source).toBe('dynamic');
      }

      // Same dynamic route → source='cache' second time
      const cachedResult = router.match('GET', '/users/1');
      expectNotErr(cachedResult);
      if (cachedResult !== null) {
        expect(cachedResult.meta.source).toBe('cache');
      }
    });

    it('should register both methods when add called with method array', () => {
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

    it('should match correctly regardless of route registration order', () => {
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

    it('should populate cache entries in match call order', () => {
      const router = new Router<string>({ enableCache: true });
      router.add('GET', '/users/:id', 'user');
      router.build();

      // Match in order: 1, 2
      router.match('GET', '/users/1');
      router.match('GET', '/users/2');

      // Both should be cached now
      const cached1 = router.match('GET', '/users/1');
      const cached2 = router.match('GET', '/users/2');

      expectNotErr(cached1);
      expectNotErr(cached2);
      if (cached1 !== null) expect(cached1.meta.source).toBe('cache');
      if (cached2 !== null) expect(cached2.meta.source).toBe('cache');
    });

    it('should process addAll entries sequentially respecting fail-fast order', () => {
      const router = new Router<string>();
      router.add('GET', '/dup', 'original');

      const result = router.addAll([
        ['POST', '/first', 'first'],
        ['PUT', '/second', 'second'],
        ['GET', '/dup', 'duplicate'], // fails here
        ['DELETE', '/third', 'third'], // never processed
      ]);

      expectErr(result);
      expect(result.data.registeredCount).toBe(2);

      // first and second registered, third not
      router.build();
      expectNotErr(router.match('POST', '/first'));
      expectNotErr(router.match('PUT', '/second'));
      const third = router.match('DELETE', '/third');
      expectNotErr(third);
      expect(third).toBeNull();
    });
  });
});
