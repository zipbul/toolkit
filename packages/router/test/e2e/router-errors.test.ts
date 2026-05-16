import { describe, it, expect } from 'bun:test';

import { Router } from '../../src/router';
import { RouterError } from '../../src/error';
import { MAX_OPTIONAL_SEGMENTS_PER_ROUTE } from '../../src/builder/route-expand';
import { catchRouterError, firstBuildIssue } from '../test-utils';

function fillMethodsToLimit(router: Router<string>): void {
  for (let i = 0; i < 25; i++) {
    router.add(`CUSTOM_${i}`, `/limit-${i}`, `limit-${i}`);
  }
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
    router.add('OVERFLOW_METHOD', '/overflow', 'overflow');

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

  it('should reject optional segment expansion above the per-route cap before expansion', () => {
    const router = new Router<string>();
    const path = '/' + Array.from({ length: MAX_OPTIONAL_SEGMENTS_PER_ROUTE + 1 }, (_, i) => `:p${i}?`).join('/');

    router.add('GET', path, 'too-many-optionals');
    const issue = firstBuildIssue(router);

    expect(issue.kind).toBe('route-parse');
    expect(issue.message).toContain(`maximum is ${MAX_OPTIONAL_SEGMENTS_PER_ROUTE}`);
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
    const r1 = new Router<string>();
    r1.build();
    const sealed = catchRouterError(() => r1.add('GET', '/x', 'x'));
    expect(sealed.data.kind).toBe('router-sealed');
    if (sealed.data.kind === 'router-sealed') {
      expect(typeof sealed.data.suggestion).toBe('string');
    }

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
    const router = new Router<string>();
    router.add('GET', '/files/*path', 'files-get');

    expect(() => router.add('POST', '/files/*upload', 'files-post')).not.toThrow();

    router.build();
    expect(router.match('GET', '/files/a.txt')!.value).toBe('files-get');
    expect(router.match('POST', '/files/upload.bin')!.value).toBe('files-post');
  });

  it('should allow a static route under another method even when one method has a wildcard at the same prefix (F9 — cross-method static/wildcard coexistence)', () => {
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

  it('accepts a backreference pattern (regex safety is user responsibility, not router)', () => {
    // Per policy, the router does not gate user regex bodies. Backreferences,
    // nested quantifiers, and other ReDoS-vulnerable shapes are accepted at
    // registration time; the framework / a user-supplied normalizer (re2,
    // recheck, etc.) is responsible for catching them.
    const router = new Router<string>();
    router.add('GET', '/users/:id((?:[a-z])\\1)', 'handler');
    expect(() => router.build()).not.toThrow();
  });

  it('should reject anchored regex patterns at build (^/$ are never silently stripped)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id(^\\d+$)', 'handler');

    expect(() => router.build()).toThrow();
  });
});

describe('register-time rejections (former regression fixtures)', () => {
  it('rejects anchored param patterns at parse time alongside a valid one — aggregates only the anchored entry', () => {
    const router = new Router<string>();

    router.add('GET', '/users/:id(\\d+)', 'plain');
    router.add('GET', '/users/:id(^\\d+$)', 'anchored');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors).toHaveLength(1);
      expect(error.data.errors[0]?.error.kind).toBe('route-parse');
    }
  });

  it('rejects empty path segments at build time instead of silently remapping dynamic routes', () => {
    const router = new Router<string>();

    router.add('GET', '/api//users/:id', 'handler');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors[0]?.error.kind).toBe('path-empty-segment');
    }
  });

  it('reports star expansion conflicts as aggregate build validation errors', () => {
    const router = new Router<string>();

    router.add('PUT', '/files/*other', 'put-wild');
    router.add('*', '/files/*path', 'star');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors.some(issue => issue.method === 'PUT' && issue.error.kind === 'route-unreachable')).toBe(true);
    }

    const valid = new Router<string>();
    valid.add('PUT', '/files/*other', 'put-wild');
    valid.build();
    expect(valid.match('PUT', '/files/static')?.value).toBe('put-wild');
  });

  it('does not publish compiled state when regex compilation fails after static insertion', () => {
    const router = new Router<string>();

    router.add('GET', '/leak/path/:id([z-a])', 'bad');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors[0]?.error.kind).toBe('route-parse');
    }
    expect(router.match('GET', '/leak/path/value')).toBeNull();
  });

  it('uses an immutable options snapshot for parser and matcher behavior', () => {
    const options = { pathCaseSensitive: false };
    const router = new Router<string>(options);

    router.add('GET', '/Hello', 'handler');
    options.pathCaseSensitive = true;
    router.build();

    expect(router.match('GET', '/hello')?.value).toBe('handler');
    expect(router.match('GET', '/Hello')?.value).toBe('handler');
  });

  it('reports invalid dynamic routes without making later valid routes reachable', () => {
    const router = new Router<string>();

    router.add('GET', '/a/:x([z-a])', 'bad');
    router.add('GET', '/a/:y', 'good');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors[0]?.error.kind).toBe('route-parse');
    }
    expect(router.match('GET', '/a/value')).toBeNull();

    const valid = new Router<string>();
    valid.add('GET', '/a/:y', 'good');
    valid.build();
    expect(valid.match('GET', '/a/value')?.value).toBe('good');
  });
});

describe('route-parse error suggestions include actionable text', () => {
  it('unclosed regex includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect((issue as { suggestion?: string }).suggestion).toBeDefined();
  });

  it('mid-position wildcard includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*tail/extra', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect((issue as { suggestion?: string }).suggestion).toBeDefined();
  });

  it('empty parameter name includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect((issue as { suggestion?: string }).suggestion).toBeDefined();
  });

  it('invalid first character in param name includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:1id', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect((issue as { suggestion?: string }).suggestion).toBeDefined();
  });

  it('invalid subsequent character in param name includes suggestion', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id-x', 'h');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect((issue as { suggestion?: string }).suggestion).toBeDefined();
  });
});
