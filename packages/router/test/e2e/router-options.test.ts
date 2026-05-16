import { describe, it, expect } from 'bun:test';

import { Router } from '../../src/router';

describe('Router<T> options', () => {
  it('should not match different case when caseSensitive=true', () => {
    const router = new Router<string>({ pathCaseSensitive: true });
    router.add('GET', '/Hello', 'hello');
    router.build();

    const exact = router.match('GET', '/Hello');
    const lower = router.match('GET', '/hello');
    expect(exact).not.toBeNull();
    expect(lower).toBeNull();
  });

  it('should match different case when caseSensitive=false', () => {
    const router = new Router<string>({ pathCaseSensitive: false });
    router.add('GET', '/Hello', 'hello');
    router.build();

    const lower = router.match('GET', '/hello');
    expect(lower).not.toBeNull();
  });

  it('should match with trailing slash when ignoreTrailingSlash=true', () => {
    const router = new Router<string>({ trailingSlash: "ignore" });
    router.add('GET', '/path', 'val');
    router.build();

    const withSlash = router.match('GET', '/path/');
    expect(withSlash).not.toBeNull();
    expect(withSlash!.value).toBe('val');
  });

  it('should not match trailing slash when ignoreTrailingSlash=false', () => {
    const router = new Router<string>({ trailingSlash: "strict" });
    router.add('GET', '/path', 'val');
    router.build();

    const withSlash = router.match('GET', '/path/');
    expect(withSlash).toBeNull();
  });

  it('should decode params (always-on)', () => {
    const router = new Router<string>();
    router.add('GET', '/users/:id', 'user');
    router.build();

    const result = router.match('GET', '/users/hello%20world');
    expect(result).not.toBeNull();
    expect(result!.params.id).toBe('hello world');
  });

  it('should work with caseSensitive=false + ignoreTrailingSlash=true combined', () => {
    const router = new Router<string>({
      pathCaseSensitive: false,
      trailingSlash: "ignore",
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

  it('accepts a vulnerable regex pattern (regex safety is user responsibility)', () => {
    // Per policy ("URL safety = framework responsibility"), the router does
    // not gate user regex bodies for ReDoS. A nested-quantifier pattern is
    // registered without rejection; it remains the framework's job (e.g. via
    // a `re2` or `recheck` plug-in) to catch this before reaching the router.
    const router = new Router<string>();
    router.add('GET', '/test/:val((?:a+)+)', 'test');
    expect(() => router.build()).not.toThrow();
  });

  it('throws on malformed percent encoding at match (caller responsibility)', () => {
    const router = new Router<string>();
    router.add('GET', '/files/:name', 'files');
    router.build();

    expect(() => router.match('GET', '/files/bad%GG')).toThrow();
  });

  it('should handle optionalParamBehavior=\'set-undefined\'', () => {
    const router = new Router<string>({ optionalParamBehavior: 'set-undefined' });
    router.add('GET', '/users/:id?', 'user');
    router.build();

    const result = router.match('GET', '/users');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('user');
    expect('id' in result!.params).toBe(true);
    expect(result!.params.id).toBeUndefined();
  });

  it('decodes percent-escapes in captured param values', () => {
    // Per RFC 3986 §2.4, percent-encoded octets in the path component
    // are decoded when extracted as a parameter. `%2F` becomes `/` in
    // the captured string — it's just a value, not a path component, so
    // there is no traversal risk.
    const router = new Router<string>();
    router.add('GET', '/files/:name', 'files');
    router.build();

    const result = router.match('GET', '/files/a%2Fb');
    expect(result).not.toBeNull();
    expect(result!.params.name).toBe('a/b');
  });

});
