import { describe, it, expect } from 'bun:test';

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

function fillMethodsToLimit(router: Router<string>): void {
  for (let i = 0; i < 25; i++) {
    router.add(`CUSTOM_${i}` as any, `/limit-${i}`, `limit-${i}`);
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

  it('should throw RouterError kind=\'not-built\' when match called before build', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');

    const err = catchRouterError(() => router.match('GET', '/x'));
    expect(err.data.kind).toBe('not-built');
  });

  it('should throw for duplicate method+path (route-duplicate)', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'first');

    const err = catchRouterError(() => router.add('GET', '/x', 'second'));
    expect(err.data.kind).toBe('route-duplicate');
  });

  it('should throw for conflicting wildcard after param (route-conflict)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'by-id');

    const err = catchRouterError(() => router.add('GET', '/users/*', 'by-wildcard'));
    expect(err.data.kind).toBe('route-conflict');
  });

  it('should throw with registeredCount on addAll fail-fast', () => {
    const router = new Router<string>();
    router.add('GET', '/existing', 'existing');

    const err = catchRouterError(() => router.addAll([
      ['POST', '/new', 'new'],
      ['GET', '/existing', 'duplicate'],
    ]));

    expect(err.data.registeredCount).toBe(1);
  });

  it('should throw with registeredCount=0 when addAll first entry fails', () => {
    const router = new Router<string>();
    router.add('GET', '/existing', 'existing');

    const err = catchRouterError(() => router.addAll([
      ['GET', '/existing', 'duplicate'],
      ['POST', '/other', 'other'],
    ]));

    expect(err.data.registeredCount).toBe(0);
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

    const err = catchRouterError(() => router.add('OVERFLOW_METHOD' as any, '/overflow', 'overflow'));
    expect(err.data.kind).toBe('method-limit');
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

    const err = catchRouterError(() => router.add('GET', '/users/:id{\\d+', 'invalid-regex'));
    expect(err.data.kind).toBe('route-parse');
  });

  it('should throw segment-limit error during match', () => {
    const router = new Router<string>({
      maxSegmentLength: 5,
    });
    router.add('GET', '/ok', 'ok');
    router.build();

    const err = catchRouterError(() => router.match('GET', '/very-long-segment-name'));
    expect(err.data.kind).toBe('segment-limit');
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

    const err = catchRouterError(() => router.add('GET', '/users/:id/posts/:id', 'dup-param'));
    expect(err.data.kind).toBe('param-duplicate');
  });

  it('should throw for wildcard not in last position (route-parse)', () => {
    const router = new Router<string>();

    const err = catchRouterError(() => router.add('GET', '/files/*/extra', 'bad'));
    expect(err.data.kind).toBe('route-parse');
  });

  it('should include suggestion field for error kinds', () => {
    // router-sealed
    const r1 = new Router<string>();
    r1.build();
    const sealed = catchRouterError(() => r1.add('GET', '/x', 'x'));
    expect(typeof sealed.data.suggestion).toBe('string');

    // not-built
    const r2 = new Router<string>();
    r2.add('GET', '/x', 'x');
    const notBuilt = catchRouterError(() => r2.match('GET', '/x'));
    expect(typeof notBuilt.data.suggestion).toBe('string');

    // route-duplicate
    const r3 = new Router<string>();
    r3.add('GET', '/x', 'x');
    const dup = catchRouterError(() => r3.add('GET', '/x', 'x2'));
    expect(typeof dup.data.suggestion).toBe('string');
  });

  it('should throw for conflicting wildcard names at same node', () => {
    const router = new Router<string>();
    router.add('GET', '/files/*path', 'files-get');

    const err = catchRouterError(() => router.add('POST', '/files/*other', 'files-post'));
    expect(err.data.kind).toBe('route-conflict');
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

  it('should throw for route-conflict when static after wildcard', () => {
    const router = new Router<string>();
    router.add('GET', '/api/*', 'wildcard');

    const err = catchRouterError(() => router.add('GET', '/api/specific', 'specific'));
    expect(err.data.kind).toBe('route-conflict');
  });

  it('should include method field in add error data', () => {
    const router = new Router<string>();
    router.add('GET', '/x', 'x');
    router.build();

    const err = catchRouterError(() => router.add('POST', '/new', 'new'));
    expect(err.data.method).toBe('POST');
  });

  // ── NEW: NE additions (5 tests) ──

  it('should throw regex-unsafe error when pattern contains backreference', () => {
    const router = new Router<string>({
      regexSafety: { mode: 'error', forbidBackreferences: true },
    });

    const err = catchRouterError(() => router.add('GET', '/users/:id{([a-z])\\1}', 'handler'));
    expect(err.data.kind).toBe('regex-unsafe');
    expect(err.data.message).toContain('Backreferences');
  });

  it('should throw regex-unsafe error when pattern exceeds maxLength', () => {
    const router = new Router<string>({
      regexSafety: { mode: 'error', maxLength: 5 },
    });

    const err = catchRouterError(() => router.add('GET', '/users/:id{[a-zA-Z0-9]+}', 'handler'));
    expect(err.data.kind).toBe('regex-unsafe');
    expect(err.data.message).toContain('exceeds limit');
  });

  it('should not throw when regexSafety mode=warn for unsafe pattern', () => {
    const warnings: string[] = [];
    const router = new Router<string>({
      regexSafety: { mode: 'warn', forbidBackreferences: true },
      onWarn: w => warnings.push(w.kind),
    });
    router.add('GET', '/users/:id{([a-z])\\1}', 'handler');
    expect(warnings).toEqual(['regex-unsafe']);
  });

  it('should throw when regexSafety.validator throws during add()', () => {
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

  it('should throw error when regexAnchorPolicy=error and pattern contains anchor', () => {
    const router = new Router<string>({ regexAnchorPolicy: 'error' });

    const err = catchRouterError(() => router.add('GET', '/users/:id{^\\d+$}', 'handler'));
    expect(err.data.kind).toBe('regex-anchor');
    expect(err.data.message).toContain('anchors');
  });

  // ── 0-2: MAX_STACK_DEPTH / MAX_PARAMS guard ──

  it('should throw kind=\'segment-limit\' when path has more than 64 segments', () => {
    const router = new Router<string>();
    const path = '/' + Array.from({ length: 65 }, (_, i) => `s${i}`).join('/');

    const err = catchRouterError(() => router.add('GET', path, 'deep'));
    expect(err.data.kind).toBe('segment-limit');
  });

  it('should not throw when path has exactly 64 segments', () => {
    const router = new Router<string>();
    const path = '/' + Array.from({ length: 64 }, (_, i) => `s${i}`).join('/');

    router.add('GET', path, 'deep');
  });

  it('should throw when path has more than 32 unique param segments', () => {
    const router = new Router<string>();
    const path = '/' + Array.from({ length: 33 }, (_, i) => `:p${i}`).join('/');

    expect(() => router.add('GET', path, 'many-params')).toThrow(RouterError);
  });

  it('should not throw when path has exactly 32 unique param segments', () => {
    const router = new Router<string>();
    const path = '/' + Array.from({ length: 32 }, (_, i) => `:p${i}`).join('/');

    router.add('GET', path, 'max-params');
  });
});
