import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';
import type { RouterErrData, MatchOutput } from '../src/types';

import { Router } from '../src/router';

// ── Helpers ──

function expectNotErr<T>(result: T | Err<RouterErrData>): asserts result is Exclude<T, Err<RouterErrData>> {
  expect(isErr(result)).toBe(false);
}

function expectErr(result: unknown): asserts result is Err<RouterErrData> {
  expect(isErr(result)).toBe(true);
}

describe('Router<T> options', () => {
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

  it('should match with trailing slash when ignoreTrailingSlash=true', () => {
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

  it('should not match trailing slash when ignoreTrailingSlash=false', () => {
    const router = new Router<string>({ ignoreTrailingSlash: false });
    router.add('GET', '/path', 'val');
    router.build();

    const withSlash = router.match('GET', '/path/');
    expectNotErr(withSlash);
    // With ignoreTrailingSlash=false, /path/ does not match /path
    expect(withSlash).toBeNull();
  });

  it('should collapse consecutive slashes when collapseSlashes=true', () => {
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

  it('should block traversal (../.. segments) when blockTraversal=true', () => {
    const router = new Router<string>({ blockTraversal: true });
    router.add('GET', '/api/data', 'data');
    router.build();

    // /api/foo/../data resolves to /api/data via dot segment resolution
    const result = router.match('GET', '/api/foo/../data');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.value).toBe('data');
    }
  });

  it('should reject encoded slash with encodedSlashBehavior=\'reject\'', () => {
    const router = new Router<string>({ encodedSlashBehavior: 'reject' });
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    if (isErr(result)) {
      expect(result.data.kind).toBe('encoded-slash');
    }
  });

  it('should decode encoded slash with encodedSlashBehavior=\'decode\'', () => {
    const router = new Router<string>({ encodedSlashBehavior: 'decode' });
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      // %2F decoded to / → param value contains /
      expect(result.params.name).toBe('a/b');
    }
  });

  it('should preserve encoded slash with encodedSlashBehavior=\'preserve\'', () => {
    const router = new Router<string>({ encodedSlashBehavior: 'preserve' });
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      // preserve mode: no decoding → raw value kept
      expect(result.params.name).toBe('a%2Fb');
    }
  });

  it('should respect maxSegmentLength option', () => {
    const router = new Router<string>({ maxSegmentLength: 10 });
    router.add('GET', '/ok', 'ok');
    router.build();

    // Short segment → OK
    const ok = router.match('GET', '/ok');
    expectNotErr(ok);
    expect(ok).not.toBeNull();

    // Long segment → err
    const long = router.match('GET', '/this-is-too-long-segment');
    expectErr(long);
    expect(long.data.kind).toBe('segment-limit');
  });

  it('should decode params when decodeParams=true (default)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'user');
    router.build();

    const result = router.match('GET', '/users/hello%20world');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.params.id).toBe('hello world');
    }
  });

  it('should not decode params when decodeParams=false', () => {
    const router = new Router<string>({ decodeParams: false });
    router.add('GET', '/users/:id', 'user');
    router.build();

    const result = router.match('GET', '/users/hello%20world');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.params.id).toBe('hello%20world');
    }
  });

  it('should work with caseSensitive=false + ignoreTrailingSlash=true combined', () => {
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

  it('should work with all default options', () => {
    const router = new Router<string>();
    router.add('GET', '/test', 'val');
    router.build();

    const result = router.match('GET', '/test');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.value).toBe('val');
    }
  });

  it('should handle regexSafety mode=\'error\' for unsafe patterns', () => {
    const router = new Router<string>({
      regexSafety: { mode: 'error' },
    });

    // (a+)+ has nested unlimited quantifiers → unsafe
    const result = router.add('GET', '/test/:val{(a+)+}', 'test');
    expectErr(result);
    expect(result.data.kind).toBe('regex-unsafe');
  });

  it('should silently pass through malformed encoding when failFastOnBadEncoding=false', () => {
    const router = new Router<string>({ failFastOnBadEncoding: false });
    router.add('GET', '/files/:name', 'files');
    router.build();

    // %GG is malformed percent-encoding → with failFast=false, silently passed through
    const result = router.match('GET', '/files/bad%GG');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.params.name).toBe('bad%GG');
    }
  });

  it('should handle optionalParamBehavior=\'setUndefined\'', () => {
    const router = new Router<string>({ optionalParamBehavior: 'setUndefined' });
    router.add('GET', '/users/:id?', 'user');
    router.build();

    // Match without optional param
    const result = router.match('GET', '/users');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.value).toBe('user');
      // With setUndefined, the omitted param should be present as undefined
      expect('id' in result.params).toBe(true);
      expect(result.params.id).toBeUndefined();
    }
  });

  // ── 0-1: collapseSlashes independent of ignoreTrailingSlash ──

  it('should collapse slashes when ignoreTrailingSlash=false and collapseSlashes is not set', () => {
    // BUG: before fix, `options.collapseSlashes ?? options.ignoreTrailingSlash ?? true`
    // caused collapseSlashes to fall back to ignoreTrailingSlash (false), disabling collapse.
    const router = new Router<string>({ ignoreTrailingSlash: false });
    router.add('GET', '/a/b', 'ab');
    router.build();

    const result = router.match('GET', '/a//b');
    expectNotErr(result);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.value).toBe('ab');
    }
  });

  it('should not collapse slashes when collapseSlashes=false regardless of ignoreTrailingSlash', () => {
    const router = new Router<string>({ collapseSlashes: false, ignoreTrailingSlash: false });
    router.add('GET', '/a/b', 'ab');
    router.build();

    const result = router.match('GET', '/a//b');
    expectNotErr(result);
    expect(result).toBeNull();
  });
});
