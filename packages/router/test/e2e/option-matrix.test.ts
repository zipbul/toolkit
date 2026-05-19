/**
 * Option × route-type matrix.
 *
 * Each router option is exercised against the canonical route shapes
 * (static, single param, param chain, star wildcard, multi wildcard,
 * optional param, regex param). Combinations that interact (cache + decode,
 * caseSensitive + cache, etc.) get explicit coverage.
 *
 * The goal is to catch option × shape interactions that single-option tests
 * miss — e.g. "decoding works" alone doesn't prove "decoding works in a
 * cached hit" or "decoding works after a trailing-slash trim".
 */
import { describe, expect, it } from 'bun:test';

import { Router } from '../../src/router';
import { MatchSource } from '../../src/types';

// ── ignoreTrailingSlash × every route type ─────────────────────────────────

describe('ignoreTrailingSlash: true × route type', () => {
  it('static: trailing slash variant matches the no-slash route', () => {
    const r = new Router<string>({ ignoreTrailingSlash: true });
    r.add('GET', '/health', 'h');
    r.build();

    expect(r.match('GET', '/health/')!.value).toBe('h');
    expect(r.match('GET', '/health')!.value).toBe('h');
  });

  it('single param: trailing slash trims before match', () => {
    const r = new Router<string>({ ignoreTrailingSlash: true });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/42/')!.params).toEqual({ id: '42' });
    expect(r.match('GET', '/users/42')!.params).toEqual({ id: '42' });
  });

  it('param chain: trailing slash trims', () => {
    const r = new Router<string>({ ignoreTrailingSlash: true });
    r.add('GET', '/users/:id/posts/:postId', 'p');
    r.build();

    expect(r.match('GET', '/users/1/posts/2/')!.params).toEqual({ id: '1', postId: '2' });
  });

  it('star wildcard: trailing slash trim does not affect wildcard capture', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'f');
    r.build();

    expect(r.match('GET', '/files/a/b/')!.params).toEqual({ p: 'a/b' });
    expect(r.match('GET', '/files/')!.params).toEqual({ p: '' });
  });

  it('multi wildcard: trailing slash trim still requires non-empty suffix', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p+', 'f');
    r.build();

    expect(r.match('GET', '/files/a/')!.params).toEqual({ p: 'a' });
    expect(r.match('GET', '/files/')).toBeNull();
  });

  it('regex param: trailing slash trim does not bypass tester', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'u');
    r.build();

    expect(r.match('GET', '/users/42/')!.value).toBe('u');
    expect(r.match('GET', '/users/abc/')).toBeNull();
  });

  it('star wildcard at terminal: trailing slash trim leaves empty capture intact', () => {
    const r = new Router<string>({ ignoreTrailingSlash: true });
    r.add('GET', '/files/*', 'val');
    r.build();
    expect(r.match('GET', '/files/')!.params['*']).toBe('');
  });
});

describe('ignoreTrailingSlash: false × route type', () => {
  it('static: trailing slash variant DOES NOT match', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    r.add('GET', '/health', 'h');
    r.build();

    expect(r.match('GET', '/health/')).toBeNull();
    expect(r.match('GET', '/health')!.value).toBe('h');
  });

  it('single param (codegen path): trailing slash on terminal param fails', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/42/')).toBeNull();
    expect(r.match('GET', '/users/42')!.value).toBe('u');
  });

  it('param chain: trailing slash on inner segment fails', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    r.add('GET', '/users/:id/posts/:postId', 'p');
    r.build();

    expect(r.match('GET', '/users/1/posts/2/')).toBeNull();
    expect(r.match('GET', '/users/1/posts/2')!.value).toBe('p');
  });

  it('star wildcard: empty trailing-slash position captures empty', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    r.add('GET', '/files/*p', 'f');
    r.build();

    expect(r.match('GET', '/files')!.params.p).toBe('');
    expect(r.match('GET', '/files/')!.params.p).toBe('');
  });

  it('multi wildcard: trailing slash with no content fails', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    r.add('GET', '/files/*p+', 'f');
    r.build();

    expect(r.match('GET', '/files/')).toBeNull();
    expect(r.match('GET', '/files/x')!.params.p).toBe('x');
  });
});

// ── caseSensitive × route type ─────────────────────────────────────────────

describe('pathCaseSensitive: true (default) × route type', () => {
  it('static: case mismatch returns null', () => {
    const r = new Router<string>();
    r.add('GET', '/Health', 'h');
    r.build();

    expect(r.match('GET', '/Health')!.value).toBe('h');
    expect(r.match('GET', '/health')).toBeNull();
  });

  it('single param: case-mismatched static prefix returns null', () => {
    const r = new Router<string>();
    r.add('GET', '/Users/:id', 'u');
    r.build();

    expect(r.match('GET', '/Users/42')!.value).toBe('u');
    expect(r.match('GET', '/users/42')).toBeNull();
  });
});

describe('pathCaseSensitive: false × route type', () => {
  it('static: case differences match', () => {
    const r = new Router<string>({ pathCaseSensitive: false });
    r.add('GET', '/Health', 'h');
    r.build();

    expect(r.match('GET', '/Health')!.value).toBe('h');
    expect(r.match('GET', '/health')!.value).toBe('h');
    expect(r.match('GET', '/HEALTH')!.value).toBe('h');
  });

  it('single param: prefix is case-folded; param value is folded with the input', () => {
    const r = new Router<string>({ pathCaseSensitive: false });
    r.add('GET', '/Users/:id', 'u');
    r.build();

    const m = r.match('GET', '/USERS/AbC')!;

    expect(m.value).toBe('u');
    expect(m.params.id).toBe('abc');
  });

  it('regex param: lowered input still passes the tester', () => {
    const r = new Router<string>({ pathCaseSensitive: false });
    r.add('GET', '/users/:id(\\d+)', 'val');
    r.build();
    const m = r.match('GET', '/USERS/42')!;
    expect(m.value).toBe('val');
    expect(m.params.id).toBe('42');
  });
});

// ── percent-decoding × cache ──────────────────────────────────────────────

describe('decoding × cache', () => {
  it('cached hit returns decoded value', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'u');
    r.build();

    const a = r.match('GET', '/users/hello%20world')!;

    expect(a.params.name).toBe('hello world');

    const b = r.match('GET', '/users/hello%20world')!;

    expect(b.meta.source).toBe(MatchSource.Cache);
    expect(b.params.name).toBe('hello world');
  });

  it('wildcard suffix is preserved raw (no decode) and cached as-is', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*path', 'val');
    r.build();
    const m = r.match('GET', '/files/a%20b/c')!;
    expect(m.params.path).toBe('a%20b/c');
  });
});

// ── cache × route type ───────────────────────────────────────────────────

describe('cache × route type', () => {
  it('static: every static lookup returns the pre-built MatchOutput directly', () => {
    const r = new Router<string>({});
    r.add('GET', '/health', 'h');
    r.build();

    expect(r.match('GET', '/health')!.meta.source).toBe(MatchSource.Static);
    expect(r.match('GET', '/health')!.meta.source).toBe(MatchSource.Static);
  });

  it('param: second hit comes from cache', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/42')!.meta.source).toBe(MatchSource.Dynamic);
    expect(r.match('GET', '/users/42')!.meta.source).toBe(MatchSource.Cache);
  });

  it('miss: re-asking the same missing URL is short-circuited', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/nonexistent/path')).toBeNull();
    expect(r.match('GET', '/nonexistent/path')).toBeNull();
  });
});

// ── omitMissingOptional × cache ────────────────────────────────────────

describe('omitMissingOptional × cache', () => {
  it('omit + cache: missing optional remains absent on cached hit', () => {
    const r = new Router<string>({ omitMissingOptional: true });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const a = r.match('GET', '/users')!;

    expect('id' in a.params).toBe(false);

    const b = r.match('GET', '/users')!;

    expect(b.meta.source).toBe(MatchSource.Cache);
    expect('id' in b.params).toBe(false);
  });

  it('set-undefined + cache: id is undefined on cached hit', () => {
    const r = new Router<string>({ omitMissingOptional: false });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const a = r.match('GET', '/users')!;

    expect('id' in a.params).toBe(true);
    expect(a.params.id).toBeUndefined();

    const b = r.match('GET', '/users')!;

    expect(b.params.id).toBeUndefined();
  });

  it('caches each optional variant separately — present and absent', () => {
    const r = new Router<string>({ omitMissingOptional: false });
    r.add('GET', '/items/:id?', 'val');
    r.build();

    const present1 = r.match('GET', '/items/42')!;
    expect(present1.params.id).toBe('42');
    const absent1 = r.match('GET', '/items')!;
    expect(absent1.params.id).toBeUndefined();

    const present2 = r.match('GET', '/items/42')!;
    expect(present2.meta.source).toBe(MatchSource.Cache);
    expect(present2.params.id).toBe('42');

    const absent2 = r.match('GET', '/items')!;
    expect(absent2.meta.source).toBe(MatchSource.Cache);
    expect(absent2.params.id).toBeUndefined();
  });

  it('ignoreTrailingSlash + optional param: trimmed slash leaves optional absent', () => {
    const r = new Router<string>({
      ignoreTrailingSlash: true,
      omitMissingOptional: false,
    });
    r.add('GET', '/items/:id?', 'val');
    r.build();
    const m = r.match('GET', '/items/')!;
    expect('id' in m.params).toBe(true);
    expect(m.params.id).toBeUndefined();
  });
});

// ── unbounded path/segment lengths ────────────────────────────────────────

describe('unbounded length', () => {
  it('accepts arbitrarily long static path registrations', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'f');
    r.build();

    const longPath = '/files/' + 'x'.repeat(100_000);
    const m = r.match('GET', longPath);

    expect(m).not.toBeNull();
    expect(m!.params.p?.length).toBe(100_000);
  });

  it('accepts long single-segment param values', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    const longId = 'x'.repeat(100_000);
    const m = r.match('GET', `/users/${longId}`);

    expect(m).not.toBeNull();
    expect(m!.params.id?.length).toBe(100_000);
  });
});

// ── triple combinations ──────────────────────────────────────────────────

describe('triple combinations', () => {
  it('trim slash + case fold + cache: all three apply consistently', () => {
    const r = new Router<string>({
      ignoreTrailingSlash: true,
      pathCaseSensitive: false,
    });
    r.add('GET', '/Users/:id', 'u');
    r.build();

    const a = r.match('GET', '/USERS/42/')!;

    expect(a.value).toBe('u');
    expect(a.params.id).toBe('42');

    const b = r.match('GET', '/USERS/42/')!;

    expect(b.meta.source).toBe(MatchSource.Cache);
  });

  it('decode + tester + cache: all three apply for percent-encoded numeric', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'u');
    r.build();

    const a = r.match('GET', '/users/%34%32')!;

    expect(a.value).toBe('u');
    expect(a.params.id).toBe('42');

    const b = r.match('GET', '/users/%34%32')!;

    expect(b.meta.source).toBe(MatchSource.Cache);
    expect(b.params.id).toBe('42');
  });

  it('all four flags simultaneously: caseSensitive=false + ignoreTrailingSlash + cacheSize + omitMissingOptional', () => {
    const r = new Router<string>({
      pathCaseSensitive: false,
      ignoreTrailingSlash: true,
      cacheSize: 10,
      omitMissingOptional: false,
    });
    r.add('GET', '/api/:category/:id?', 'val');
    r.build();

    const present = r.match('GET', '/API/Products/42/')!;
    expect(present.params.category).toBe('products');
    expect(present.params.id).toBe('42');

    const absent = r.match('GET', '/api/tools')!;
    expect(absent.params.category).toBe('tools');
    expect('id' in absent.params).toBe(true);
    expect(absent.params.id).toBeUndefined();
  });
});

// ── cache-key normalization across distinct inputs ───────────────────────

describe('cache-key normalization collapses normalized-equal inputs to one entry', () => {
  it('caseSensitive=false: two different-case inputs collapse to the same cache key', () => {
    const r = new Router<string>({ pathCaseSensitive: false });
    r.add('GET', '/users/:id', 'val');
    r.build();

    const first = r.match('GET', '/Users/123')!;
    expect(first.meta.source).toBe(MatchSource.Dynamic);

    const second = r.match('GET', '/USERS/123')!;
    expect(second.meta.source).toBe(MatchSource.Cache);
    expect(second.params.id).toBe('123');
  });

  it('ignoreTrailingSlash=true: trailing-slash and bare paths collapse to the same cache key', () => {
    const r = new Router<string>({ ignoreTrailingSlash: true });
    r.add('GET', '/api/:id', 'val');
    r.build();

    const first = r.match('GET', '/api/42/')!;
    expect(first.meta.source).toBe(MatchSource.Dynamic);

    const second = r.match('GET', '/api/42')!;
    expect(second.meta.source).toBe(MatchSource.Cache);
    expect(second.value).toBe('val');
  });

  it('case + ignoreTrailingSlash combined: a different-case + different-slash second input still cache-hits', () => {
    const r = new Router<string>({
      pathCaseSensitive: false,
      ignoreTrailingSlash: true,
    });
    r.add('GET', '/api/:id', 'val');
    r.build();

    const first = r.match('GET', '/API/42/')!;
    expect(first.meta.source).toBe(MatchSource.Dynamic);

    const second = r.match('GET', '/Api/42')!;
    expect(second.meta.source).toBe(MatchSource.Cache);
    expect(second.params.id).toBe('42');
  });
});

// ── pathname-only contract: query/fragment chars stay in param value ─────

describe('pathname-only contract', () => {
  it('captures query characters as part of dynamic param value (caller strips ? before calling)', () => {
    const r = new Router<string>();
    r.add('GET', '/api/:id', 'val');
    r.build();

    const m = r.match('GET', '/api/42?key=value&foo=bar')!;
    expect(m.params.id).toBe('42?key=value&foo=bar');
  });
});
