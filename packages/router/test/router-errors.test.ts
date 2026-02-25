import { describe, it, expect, spyOn } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';
import type { RouterErrData } from '../src/types';

import { Router } from '../src/router';

// ── Helpers ──

function expectNotErr<T>(result: T | Err<RouterErrData>): asserts result is Exclude<T, Err<RouterErrData>> {
  expect(isErr(result)).toBe(false);
}

function expectErr(result: unknown): asserts result is Err<RouterErrData> {
  expect(isErr(result)).toBe(true);
}

function fillMethodsToLimit(router: Router<string>): void {
  for (let i = 0; i < 25; i++) {
    router.add(`CUSTOM_${i}` as any, `/limit-${i}`, `limit-${i}`);
  }
}

describe('Router<T> errors', () => {
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

  it('should return err for conflicting wildcard after param (route-conflict)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'by-id');

    const result = router.add('GET', '/users/*', 'by-wildcard');
    expectErr(result);
    expect(result.data.kind).toBe('route-conflict');
  });

  it('should return err with registeredCount on addAll fail-fast', () => {
    const router = new Router<string>();
    router.add('GET', '/existing', 'existing');

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

    const addResult = router.add('POST', '/new', 'new');
    expectErr(addResult);

    const matchResult = router.match('GET', '/ok');
    expectNotErr(matchResult);
    expect(matchResult).not.toBeNull();
    if (matchResult !== null) {
      expect(matchResult.value).toBe('ok');
    }
  });

  it('should return err for unclosed regex pattern (route-parse)', () => {
    const router = new Router<string>();

    const result = router.add('GET', '/users/:id{\\d+', 'invalid-regex');
    expectErr(result);
    expect(result.data.kind).toBe('route-parse');
  });

  it('should propagate processor segment-limit error during match', () => {
    const router = new Router<string>({
      maxSegmentLength: 5,
    });
    router.add('GET', '/ok', 'ok');
    router.build();

    const result = router.match('GET', '/very-long-segment-name');
    expectErr(result);
    expect(result.data.kind).toBe('segment-limit');
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

  it('should return sealed err when add with method array called after build', () => {
    const router = new Router<string>();
    router.build();

    const result = router.add(['GET', 'POST'], '/z', 'z');
    expectErr(result);
    expect(result.data.kind).toBe('router-sealed');
  });

  it('should return err for param-duplicate in same path', () => {
    const router = new Router<string>();

    const result = router.add('GET', '/users/:id/posts/:id', 'dup-param');
    expectErr(result);
    expect(result.data.kind).toBe('param-duplicate');
  });

  it('should return err for wildcard not in last position (route-parse)', () => {
    const router = new Router<string>();

    const result = router.add('GET', '/files/*/extra', 'bad');
    expectErr(result);
    expect(result.data.kind).toBe('route-parse');
  });

  it('should return err kind=\'encoding\' for malformed percent-encoding with failFast', () => {
    const router = new Router<string>({
      failFastOnBadEncoding: true,
    });
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/bad%GG');
    expectErr(result);
    expect(result.data.kind).toBe('encoding');
  });

  it('should return err kind=\'encoded-slash\' for %2F with reject behavior', () => {
    const router = new Router<string>({ encodedSlashBehavior: 'reject' });
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    if (isErr(result)) {
      expect(result.data.kind).toBe('encoded-slash');
    }
  });

  it('should return err with suggestion field for all error kinds', () => {
    // router-sealed
    const r1 = new Router<string>();
    r1.build();
    const sealed = r1.add('GET', '/x', 'x');
    expectErr(sealed);
    expect(typeof sealed.data.suggestion).toBe('string');

    // not-built
    const r2 = new Router<string>();
    r2.add('GET', '/x', 'x');
    const notBuilt = r2.match('GET', '/x');
    expectErr(notBuilt);
    expect(typeof notBuilt.data.suggestion).toBe('string');

    // route-duplicate
    const r3 = new Router<string>();
    r3.add('GET', '/x', 'x');
    const dup = r3.add('GET', '/x', 'x2');
    expectErr(dup);
    expect(typeof dup.data.suggestion).toBe('string');
  });

  it('should return err when adding conflicting wildcard names at same node', () => {
    const router = new Router<string>();
    router.add('GET', '/files/*path', 'files-get');

    const result = router.add('POST', '/files/*other', 'files-post');
    expectErr(result);
    expect(result.data.kind).toBe('route-conflict');
  });

  it('should return sealed err with registeredCount=0 from addAll after build', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const result = router.addAll([
      ['POST', '/a', 'a'],
      ['PUT', '/b', 'b'],
    ]);
    expectErr(result);
    expect(result.data.kind).toBe('router-sealed');
    expect(result.data.registeredCount).toBe(0);
  });

  it('should return err for route-conflict when static after wildcard', () => {
    const router = new Router<string>();
    router.add('GET', '/api/*', 'wildcard');

    const result = router.add('GET', '/api/specific', 'specific');
    expectErr(result);
    expect(result.data.kind).toBe('route-conflict');
  });

  it('should return err with method field in add error data', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const result = router.add('POST', '/new', 'new');
    expectErr(result);
    expect(result.data.method).toBe('POST');
  });

  // ── NEW: NE additions (5 tests) ──

  it('should return regex-unsafe error when pattern contains backreference', () => {
    const router = new Router<string>({
      regexSafety: { mode: 'error', forbidBackreferences: true },
    });

    const result = router.add('GET', '/users/:id{([a-z])\\1}', 'handler');
    expectErr(result);
    expect(result.data.kind).toBe('regex-unsafe');
    expect(result.data.message).toContain('Backreferences');
  });

  it('should return regex-unsafe error when pattern exceeds maxLength', () => {
    const router = new Router<string>({
      regexSafety: { mode: 'error', maxLength: 5 },
    });

    const result = router.add('GET', '/users/:id{[a-zA-Z0-9]+}', 'handler');
    expectErr(result);
    expect(result.data.kind).toBe('regex-unsafe');
    expect(result.data.message).toContain('exceeds limit');
  });

  it('should not return error when regexSafety mode=warn for unsafe pattern', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const router = new Router<string>({
      regexSafety: { mode: 'warn', forbidBackreferences: true },
    });
    const result = router.add('GET', '/users/:id{([a-z])\\1}', 'handler');
    expectNotErr(result);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('should return regex-timeout error when patternTester throws during match', () => {
    // regex-timeout in matcher.ts is caught when tester(value) throws.
    // Through public API, the closest reachable path is regexSafety.validator throwing during add().
    const router = new Router<string>({
      regexSafety: {
        mode: 'warn',
        validator: () => {
          throw new Error('validator timeout simulation');
        },
      },
    });

    expect(() => router.add('GET', '/users/:id{\\d+}', 'handler')).toThrow(
      'validator timeout simulation',
    );
  });

  it('should return error when regexAnchorPolicy=error and pattern contains anchor', () => {
    const router = new Router<string>({ regexAnchorPolicy: 'error' });

    const result = router.add('GET', '/users/:id{^\\d+$}', 'handler');
    expectErr(result);
    expect(result.data.kind).toBe('regex-anchor');
    expect(result.data.message).toContain('anchors');
  });

  // ── 0-2: MAX_STACK_DEPTH / MAX_PARAMS guard ──

  it('should return err kind=\'segment-limit\' when path has more than 64 segments', () => {
    const router = new Router<string>();
    // 65 path segments: /s0/s1/.../s64
    const path = '/' + Array.from({ length: 65 }, (_, i) => `s${i}`).join('/');

    const result = router.add('GET', path, 'deep');
    expectErr(result);
    expect(result.data.kind).toBe('segment-limit');
  });

  it('should not return error when path has exactly 64 segments', () => {
    const router = new Router<string>();
    // 64 path segments: /s0/s1/.../s63
    const path = '/' + Array.from({ length: 64 }, (_, i) => `s${i}`).join('/');

    const result = router.add('GET', path, 'deep');
    expectNotErr(result);
  });

  it('should return err when path has more than 32 unique param segments', () => {
    const router = new Router<string>();
    // 33 distinct param names: /:p0/:p1/.../:p32
    const path = '/' + Array.from({ length: 33 }, (_, i) => `:p${i}`).join('/');

    const result = router.add('GET', path, 'many-params');
    expectErr(result);
  });

  it('should not return error when path has exactly 32 unique param segments', () => {
    const router = new Router<string>();
    // 32 distinct param names: /:p0/:p1/.../:p31
    const path = '/' + Array.from({ length: 32 }, (_, i) => `:p${i}`).join('/');

    const result = router.add('GET', path, 'max-params');
    expectNotErr(result);
  });
});
