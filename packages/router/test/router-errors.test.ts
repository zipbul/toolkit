import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';
import type { RouterErrorData } from '../src/types';

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

function fillMethodsToLimit(router: Router<string>): void {
  for (let i = 0; i < 25; i++) {
    router.add(`CUSTOM_${i}` as any, `/limit-${i}`, `limit-${i}`);
  }
}

function firstBuildIssue(router: Router<string>): RouterErrorData {
  const err = catchRouterError(() => router.build());
  expect(err.data.kind).toBe('route-validation');
  if (err.data.kind !== 'route-validation') throw err;
  return err.data.errors[0]!.error;
}

describe('Router<T> errors', () => {
  it('should throw RouterError kind=\'router-sealed\' when add called after build', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const err = catchRouterError(() => router.add('GET', '/y', 'y'));
    expect(err.data.kind).toBe('router-sealed');
    expect(err.data.path).toBe('/y');
    expect(err.data.method).toBe('GET');
  });

  it('should return null when match called before build', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');

    expect(router.match('GET', '/x')).toBeNull();
  });

  it('should throw for duplicate method+path (route-duplicate)', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'first');
    router.add('GET', '/x', 'second');

    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('route-duplicate');
  });

  it('should throw for wildcard whose prefix already has a descendant terminal', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'by-id');
    router.add('GET', '/users/*', 'by-wildcard');

    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('route-unreachable');
  });

  it('should report addAll duplicate during build validation', () => {
    const router = new Router<string>();
    router.add('GET', '/existing', 'existing');
    router.addAll([
      ['POST', '/new', 'new'],
      ['GET', '/existing', 'duplicate'],
    ]);

    const err = catchRouterError(() => router.build());
    expect(err.data.kind).toBe('route-validation');
    if (err.data.kind === 'route-validation') {
      expect(err.data.errors[0]?.index).toBe(2);
      expect(err.data.errors[0]?.error.kind).toBe('route-duplicate');
    }
  });

  it('should report first addAll entry failure during build validation', () => {
    const router = new Router<string>();
    router.add('GET', '/existing', 'existing');
    router.addAll([
      ['GET', '/existing', 'duplicate'],
      ['POST', '/other', 'other'],
    ]);

    const err = catchRouterError(() => router.build());
    expect(err.data.kind).toBe('route-validation');
    if (err.data.kind === 'route-validation') {
      expect(err.data.errors[0]?.index).toBe(1);
      expect(err.data.errors[0]?.error.kind).toBe('route-duplicate');
    }
  });

  it('should throw kind=\'router-sealed\' when addAll called after build', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const err = catchRouterError(() => router.addAll([['POST', '/y', 'y']]));
    expect(err.data.kind).toBe('router-sealed');
    expect(err.data.registeredCount).toBe(0);
  });

  it('should throw kind=\'method-limit\' when exceeding 32 methods', () => {
    const router = new Router<string>();
    fillMethodsToLimit(router);
    router.add('OVERFLOW_METHOD' as any, '/overflow', 'overflow');

    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('method-limit');
  });

  it('should still match existing routes after sealed add-error', () => {
    const router = new Router<string>();
    router.add('GET', '/ok', 'ok');
    router.build();

    expect(() => router.add('POST', '/new', 'new')).toThrow(RouterError);

    const matchResult = router.match('GET', '/ok');
    expect(matchResult).not.toBeNull();
    expect(matchResult!.value).toBe('ok');
  });

  it('should throw for unclosed regex pattern (route-parse)', () => {
    const router = new Router<string>();

    router.add('GET', '/users/:id(\\d+', 'invalid-regex');
    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('route-parse');
  });

  it('should return null for oversized segment during match', () => {
    const router = new Router<string>({
      maxSegmentLength: 5,
    });
    router.add('GET', '/ok', 'ok');
    router.build();

    expect(router.match('GET', '/very-long-segment-name')).toBeNull();
  });

  it('should include kind, message, path, method in error data', () => {
    const router = new Router<string>();
    router.build();

    const err = catchRouterError(() => router.add('GET', '/after-seal', 'v'));
    expect(err.data.kind).toBe('router-sealed');
    expect(typeof err.data.message).toBe('string');
    expect(err.data.path).toBe('/after-seal');
    expect(err.data.method).toBe('GET');
  });

  it('should throw sealed error when add with method array called after build', () => {
    const router = new Router<string>();
    router.build();

    const err = catchRouterError(() => router.add(['GET', 'POST'], '/z', 'z'));
    expect(err.data.kind).toBe('router-sealed');
  });

  it('should throw for param-duplicate in same path', () => {
    const router = new Router<string>();

    router.add('GET', '/users/:id/posts/:id', 'dup-param');
    expect(firstBuildIssue(router).kind).toBe('param-duplicate');
  });

  it('should throw for wildcard not in last position (route-parse)', () => {
    const router = new Router<string>();

    router.add('GET', '/files/*/extra', 'bad');
    expect(firstBuildIssue(router).kind).toBe('route-parse');
  });

  it('should include suggestion field for mutation error kinds', () => {
    // router-sealed
    const r1 = new Router<string>();
    r1.build();
    const sealed = catchRouterError(() => r1.add('GET', '/x', 'x'));
    expect(sealed.data.kind).toBe('router-sealed');
    if (sealed.data.kind === 'router-sealed') {
      expect(typeof sealed.data.suggestion).toBe('string');
    }

    // route-duplicate
    const r3 = new Router<string>();
    r3.add('GET', '/x', 'x');
    r3.add('GET', '/x', 'x2');
    const dup = firstBuildIssue(r3);
    expect(dup.kind).toBe('route-duplicate');
    if (dup.kind === 'route-duplicate') {
      expect(typeof dup.suggestion).toBe('string');
    }
  });

  it('should throw route-unreachable for a second wildcard at a prefix that already has one (method-scoped)', () => {
    const router = new Router<string>();
    router.add('GET', '/files/*path', 'files-get');
    router.add('GET', '/files/*other', 'files-get-2');

    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('route-unreachable');
  });

  it('should allow the same wildcard prefix with different names across distinct methods (F9 — cross-method coexistence)', () => {
    // Pre-A5 the registration below threw because the wildcard-name index
    // was a single global Map<prefix, name>. A5 keys it by methodCode so
    // GET and POST tables are independent — the realistic case where one
    // verb serves files (`*path`) and another serves uploads (`*upload`)
    // at the same prefix now works.
    const router = new Router<string>();
    router.add('GET', '/files/*path', 'files-get');

    expect(() => router.add('POST', '/files/*upload', 'files-post')).not.toThrow();

    router.build();
    expect(router.match('GET', '/files/a.txt')!.value).toBe('files-get');
    expect(router.match('POST', '/files/upload.bin')!.value).toBe('files-post');
  });

  it('should allow a static route under another method even when one method has a wildcard at the same prefix (F9 — cross-method static/wildcard coexistence)', () => {
    // Same scoping rationale as the wildcard/wildcard case above, but for
    // the static-vs-wildcard conflict path. Pre-A5 `POST /files/static`
    // was rejected because GET registered `/files/*p` first; A5 makes the
    // static-conflict check method-local, so POST gets its own clean slate.
    const router = new Router<string>();
    router.add('GET', '/files/*p', 'files-list');

    expect(() => router.add('POST', '/files/static', 'static-upload')).not.toThrow();

    router.build();
    expect(router.match('GET', '/files/anything')!.value).toBe('files-list');
    expect(router.match('POST', '/files/static')!.value).toBe('static-upload');
  });

  it('should throw sealed error with registeredCount=0 from addAll after build', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const err = catchRouterError(() => router.addAll([
      ['POST', '/a', 'a'],
      ['PUT', '/b', 'b'],
    ]));
    expect(err.data.kind).toBe('router-sealed');
    expect(err.data.registeredCount).toBe(0);
  });

  it('should throw route-unreachable when static is registered under an ancestor wildcard', () => {
    const router = new Router<string>();
    router.add('GET', '/api/*', 'wildcard');
    router.add('GET', '/api/specific', 'specific');

    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('route-unreachable');
  });

  it('should include method field in add error data', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const err = catchRouterError(() => router.add('POST', '/new', 'new'));
    expect(err.data.method).toBe('POST');
  });

  // ── NEW: NE additions (5 tests) ──

  it('should throw regex-unsafe error when pattern contains backreference (always-on guard)', () => {
    const router = new Router<string>();

    router.add('GET', '/users/:id(([a-z])\\1)', 'handler');
    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('regex-unsafe');
    expect(issue.message).toContain('Backreferences');
  });

  it('should silently strip ^/$ anchors and accept the pattern', () => {
    const router = new Router<string>();

    expect(() => router.add('GET', '/users/:id(^\\d+$)', 'handler')).not.toThrow();
    router.build();

    expect(router.match('GET', '/users/42')!.value).toBe('handler');
  });

  // ── 0-2: MAX_STACK_DEPTH / MAX_PARAMS guard ──

  it('emits segment-limit when path exceeds the configured maxSegmentCount', () => {
    const router = new Router<string>({ maxSegmentCount: 8 });
    const path = '/' + Array.from({ length: 9 }, (_, i) => `s${i}`).join('/');

    router.add('GET', path, 'deep');
    const issue = firstBuildIssue(router);
    expect(issue.kind).toBe('segment-limit');
  });

  it('accepts a path with exactly maxSegmentCount segments', () => {
    const router = new Router<string>({ maxSegmentCount: 8 });
    const path = '/' + Array.from({ length: 8 }, (_, i) => `s${i}`).join('/');

    router.add('GET', path, 'deep');
  });

  it('emits segment-limit when path exceeds the configured maxParams', () => {
    const router = new Router<string>({ maxParams: 4 });
    const path = '/' + Array.from({ length: 5 }, (_, i) => `:p${i}`).join('/');

    router.add('GET', path, 'many-params');
    expect(firstBuildIssue(router).kind).toBe('segment-limit');
  });

  it('accepts a path with exactly maxParams params', () => {
    const router = new Router<string>({ maxParams: 4 });
    const path = '/' + Array.from({ length: 4 }, (_, i) => `:p${i}`).join('/');

    router.add('GET', path, 'max-params');
  });
});
