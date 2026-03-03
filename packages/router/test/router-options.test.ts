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

describe('Router<T> options', () => {
  it('should not match different case when caseSensitive=true', () => {
    const router = new Router<string>({ caseSensitive: true });
    router.add('GET', '/Hello', 'hello');
    router.build();

    const exact = router.match('GET', '/Hello');
    const lower = router.match('GET', '/hello');
    expect(exact).not.toBeNull();
    expect(lower).toBeNull();
  });

  it('should match different case when caseSensitive=false', () => {
    const router = new Router<string>({ caseSensitive: false });
    router.add('GET', '/Hello', 'hello');
    router.build();

    const lower = router.match('GET', '/hello');
    expect(lower).not.toBeNull();
  });

  it('should match with trailing slash when ignoreTrailingSlash=true', () => {
    const router = new Router<string>({ ignoreTrailingSlash: true });
    router.add('GET', '/path', 'val');
    router.build();

    const withSlash = router.match('GET', '/path/');
    expect(withSlash).not.toBeNull();
    expect(withSlash!.value).toBe('val');
  });

  it('should not match trailing slash when ignoreTrailingSlash=false', () => {
    const router = new Router<string>({ ignoreTrailingSlash: false });
    router.add('GET', '/path', 'val');
    router.build();

    const withSlash = router.match('GET', '/path/');
    expect(withSlash).toBeNull();
  });

  it('should respect maxSegmentLength option', () => {
    const router = new Router<string>({ maxSegmentLength: 10 });
    router.add('GET', '/ok', 'ok');
    router.build();

    const ok = router.match('GET', '/ok');
    expect(ok).not.toBeNull();

    const err = catchRouterError(() => router.match('GET', '/this-is-too-long-segment'));
    expect(err.data.kind).toBe('segment-limit');
  });

  it('should decode params when decodeParams=true (default)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'user');
    router.build();

    const result = router.match('GET', '/users/hello%20world');
    expect(result).not.toBeNull();
    expect(result!.params.id).toBe('hello world');
  });

  it('should not decode params when decodeParams=false', () => {
    const router = new Router<string>({ decodeParams: false });
    router.add('GET', '/users/:id', 'user');
    router.build();

    const result = router.match('GET', '/users/hello%20world');
    expect(result).not.toBeNull();
    expect(result!.params.id).toBe('hello%20world');
  });

  it('should work with caseSensitive=false + ignoreTrailingSlash=true combined', () => {
    const router = new Router<string>({
      caseSensitive: false,
      ignoreTrailingSlash: true,
    });
    router.add('GET', '/Hello', 'hello');
    router.build();

    const result = router.match('GET', '/hello/');
    expect(result).not.toBeNull();
  });

  it('should work with all default options', () => {
    const router = new Router<string>();
    router.add('GET', '/test', 'val');
    router.build();

    const result = router.match('GET', '/test');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('val');
  });

  it('should handle regexSafety mode=\'error\' for unsafe patterns', () => {
    const router = new Router<string>({
      regexSafety: { mode: 'error' },
    });

    const err = catchRouterError(() => router.add('GET', '/test/:val{(a+)+}', 'test'));
    expect(err.data.kind).toBe('regex-unsafe');
  });

  it('should pass through malformed encoding as-is in param values', () => {
    const router = new Router<string>();
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/bad%GG');
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe('bad%GG');
  });

  it('should handle optionalParamBehavior=\'setUndefined\'', () => {
    const router = new Router<string>({ optionalParamBehavior: 'setUndefined' });
    router.add('GET', '/users/:id?', 'user');
    router.build();

    const result = router.match('GET', '/users');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('user');
    expect('id' in result!.params).toBe(true);
    expect(result!.params.id).toBeUndefined();
  });

  it('should decode %2F in param values to /', () => {
    const router = new Router<string>();
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe('a/b');
  });

  it('should not decode params when decodeParams=false even with %2F', () => {
    const router = new Router<string>({ decodeParams: false });
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe('a%2Fb');
  });
});
