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
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';

// ── ignoreTrailingSlash × every route type ─────────────────────────────────

describe('trailingSlash: "ignore" × route type', () => {
  it('static: trailing slash variant matches the no-slash route', () => {
    const r = new Router<string>({ trailingSlash: "ignore" });
    r.add('GET', '/health', 'h');
    r.build();

    expect(r.match('GET', '/health/')!.value).toBe('h');
    expect(r.match('GET', '/health')!.value).toBe('h');
  });

  it('single param: trailing slash trims before match', () => {
    const r = new Router<string>({ trailingSlash: "ignore" });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/42/')!.params).toEqual({ id: '42' });
    expect(r.match('GET', '/users/42')!.params).toEqual({ id: '42' });
  });

  it('param chain: trailing slash trims', () => {
    const r = new Router<string>({ trailingSlash: "ignore" });
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
    r.add('GET', '/files/*p+', 'f'); // multi (1+ chars)
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
});

describe('trailingSlash: "strict" × route type', () => {
  it('static: trailing slash variant DOES NOT match', () => {
    const r = new Router<string>({ trailingSlash: "strict" });
    r.add('GET', '/health', 'h');
    r.build();

    expect(r.match('GET', '/health/')).toBeNull();
    expect(r.match('GET', '/health')!.value).toBe('h');
  });

  it('single param (codegen path): trailing slash on terminal param fails', () => {
    const r = new Router<string>({ trailingSlash: "strict" });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/42/')).toBeNull();
    expect(r.match('GET', '/users/42')!.value).toBe('u');
  });

  it('param chain: trailing slash on inner segment fails', () => {
    const r = new Router<string>({ trailingSlash: "strict" });
    r.add('GET', '/users/:id/posts/:postId', 'p');
    r.build();

    expect(r.match('GET', '/users/1/posts/2/')).toBeNull();
    expect(r.match('GET', '/users/1/posts/2')!.value).toBe('p');
  });

  it('star wildcard: empty trailing-slash position captures empty', () => {
    const r = new Router<string>({ trailingSlash: "strict" });
    r.add('GET', '/files/*p', 'f');
    r.build();

    // /files captures empty; /files/ also matches with empty (star semantics)
    expect(r.match('GET', '/files')!.params.p).toBe('');
    expect(r.match('GET', '/files/')!.params.p).toBe('');
  });

  it('multi wildcard: trailing slash with no content fails', () => {
    const r = new Router<string>({ trailingSlash: "strict" });
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

  it('single param: prefix is case-folded; param value preserves source case', () => {
    const r = new Router<string>({ pathCaseSensitive: false });
    r.add('GET', '/Users/:id', 'u');
    r.build();

    // Prefix matches case-insensitively; param values come from the
    // (already-lowered) sp variable. With case-folding the param itself
    // is also folded since we lowercase the entire `sp`.
    const m = r.match('GET', '/USERS/AbC')!;

    expect(m.value).toBe('u');
    expect(m.params.id).toBe('abc');
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

    expect(b.meta.source).toBe('cache');
    expect(b.params.name).toBe('hello world');
  });
});

// ── cache × route type ───────────────────────────────────────────────────

describe('cache × route type', () => {
  it('static: every static lookup returns the pre-built MatchOutput directly', () => {
    const r = new Router<string>({});
    r.add('GET', '/health', 'h');
    r.build();

    // Static path returns the same pre-built MatchOutput every time without
    // going through the dynamic hit cache.
    expect(r.match('GET', '/health')!.meta.source).toBe('static');
    expect(r.match('GET', '/health')!.meta.source).toBe('static');
  });

  it('param: second hit comes from cache', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/42')!.meta.source).toBe('dynamic');
    expect(r.match('GET', '/users/42')!.meta.source).toBe('cache');
  });

  it('miss: re-asking the same missing URL is short-circuited', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/nonexistent/path')).toBeNull();
    expect(r.match('GET', '/nonexistent/path')).toBeNull();
  });
});

// ── optionalParamBehavior × cache ────────────────────────────────────────

describe('optionalParamBehavior × cache', () => {
  it('omit + cache: missing optional remains absent on cached hit', () => {
    const r = new Router<string>({ optionalParamBehavior: 'omit' });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const a = r.match('GET', '/users')!;

    expect('id' in a.params).toBe(false);

    const b = r.match('GET', '/users')!;

    expect(b.meta.source).toBe('cache');
    expect('id' in b.params).toBe(false);
  });

  it('set-undefined + cache: id is undefined on cached hit', () => {
    const r = new Router<string>({ optionalParamBehavior: 'set-undefined' });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const a = r.match('GET', '/users')!;

    expect('id' in a.params).toBe(true);
    expect(a.params.id).toBeUndefined();

    const b = r.match('GET', '/users')!;

    expect(b.params.id).toBeUndefined();
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

// ── triple combinations: trim slash + case fold + cache ──────────────────

describe('triple combinations', () => {
  it('trim slash + case fold + cache: all three apply consistently', () => {
    const r = new Router<string>({
      trailingSlash: "ignore",
      pathCaseSensitive: false,
    });
    r.add('GET', '/Users/:id', 'u');
    r.build();

    // Mixed-case + trailing slash
    const a = r.match('GET', '/USERS/42/')!;

    expect(a.value).toBe('u');
    expect(a.params.id).toBe('42');

    // Same canonical form should hit cache
    const b = r.match('GET', '/USERS/42/')!;

    expect(b.meta.source).toBe('cache');
  });

  it('decode + tester + cache: all three apply for percent-encoded numeric', () => {
    const r = new Router<string>();
    // %34%32 = "42" — encoded numeric. Tester runs on decoded value.
    r.add('GET', '/users/:id(\\d+)', 'u');
    r.build();

    const a = r.match('GET', '/users/%34%32')!;

    expect(a.value).toBe('u');
    expect(a.params.id).toBe('42');

    const b = r.match('GET', '/users/%34%32')!;

    expect(b.meta.source).toBe('cache');
    expect(b.params.id).toBe('42');
  });
});
