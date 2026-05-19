/**
 * Walker tier dispatch + fallback coverage.
 *
 * The router's matchImpl is built by a layered codegen pipeline:
 *   1. Shape-specialized matchImpl (e.g. static-prefix wildcard inline)
 *   2. tryCodegenStaticPrefixWildcard (per-method walker)
 *   3. compileSegmentTree (general per-method walker)
 *   4. createIterativeWalker (non-ambiguous trees, no codegen)
 *   5. recursive `match` walker (ambiguous trees, no codegen)
 *   6. radix-walk fallback (when segment tree can't be built at all)
 *
 * Bench routes mostly hit (1)-(3). The lower tiers fire only when route shapes
 * don't fit the codegen subset; this file intentionally constructs trees that
 * bail on codegen and forces traffic through each tier, plus the per-shape
 * `walkSharedSubtree` branches inside the factored / prefix-factor walkers.
 */
import { describe, it, expect } from 'bun:test';

import { getRouterInternals } from '../../internal';
import { Router } from '../../src/router';
import { MatchSource } from '../../src/types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function pickedWalkerName(router: Router<string>): string | null {
  const trees = (
    getRouterInternals(router) as unknown as {
      matchLayer: { trees: Array<((u: string, s: unknown) => boolean) | null> };
    }
  ).matchLayer.trees;
  const tree = trees.find(t => t != null);
  return tree ? tree.name : null;
}

// ── Iterative walker (wide fanout, non-ambiguous) ──────────────────────────

describe('iterative walker (wide fanout exceeding codegen size budget)', () => {
  function makeWideFanoutRouter() {
    const r = new Router<string>();
    for (let i = 0; i < 200; i++) {
      r.add('GET', `/zone${i}/:slug`, `r${i}`);
      r.add('GET', `/zone${i}/:slug/sub/:sub`, `r${i}sub`);
    }
    r.build();
    return r;
  }

  it('selects the iterative walker when codegen exceeds source budget', () => {
    expect(pickedWalkerName(makeWideFanoutRouter())).toBe('walk');
  });

  it('matches single-param routes', () => {
    const r = makeWideFanoutRouter();
    const m = r.match('GET', '/zone3/foo');
    expect(m).not.toBeNull();
    expect(m!.value).toBe('r3');
    expect(m!.params).toEqual({ slug: 'foo' });
  });

  it('matches param chains', () => {
    const r = makeWideFanoutRouter();
    const m = r.match('GET', '/zone10/foo/sub/bar');
    expect(m).not.toBeNull();
    expect(m!.value).toBe('r10sub');
    expect(m!.params).toEqual({ slug: 'foo', sub: 'bar' });
  });

  it('matches different prefixes correctly', () => {
    const r = makeWideFanoutRouter();
    expect(r.match('GET', '/zone0/x')!.value).toBe('r0');
    expect(r.match('GET', '/zone24/y')!.value).toBe('r24');
    expect(r.match('GET', '/zone7/x/sub/z')!.value).toBe('r7sub');
  });

  it('returns null for unmatched prefix', () => {
    const r = makeWideFanoutRouter();
    expect(r.match('GET', '/unknown/path')).toBeNull();
  });

  it('returns null for trailing-slash on terminal param when trailingSlash="strict"', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    for (let i = 0; i < 25; i++) {
      r.add('GET', `/zone${i}/:slug`, `r${i}`);
      r.add('GET', `/zone${i}/:slug/sub/:sub`, `r${i}sub`);
    }
    r.build();
    expect(r.match('GET', '/zone3/foo/')).toBeNull();
    expect(r.match('GET', '/zone3/foo')!.value).toBe('r3');
  });

  it('does not match when URL has extra trailing segment beyond the route', () => {
    const r = makeWideFanoutRouter();
    expect(r.match('GET', '/zone3/foo/extra')).toBeNull();
  });

  it('rejects empty param segment (//)', () => {
    const r = makeWideFanoutRouter();
    expect(r.match('GET', '/zone3//sub/x')).toBeNull();
  });

  it('does not match wildcard-only when route had no wildcard', () => {
    const r = makeWideFanoutRouter();
    expect(r.match('GET', '/zone3/foo/extras/whatever/here')).toBeNull();
  });

  it('rejects via tester when a regex param at iterative-walker depth refuses the slice', () => {
    // Forces iterative tier by route count, then plants a regex-constrained
    // param at the leaf so the walker hits `tester(decoded) !== TESTER_PASS`
    // (iterative.ts:60-61) on a non-numeric input.
    const r = new Router<string>();
    for (let i = 0; i < 200; i++) {
      r.add('GET', `/zone${i}/users/:id(\\d+)`, `r-${i}`);
    }
    r.build();
    expect(r.match('GET', '/zone3/users/42')?.value).toBe('r-3');
    expect(r.match('GET', '/zone3/users/abc')).toBeNull();
  });
});

// ── Recursive walker (ambiguous tree) ──────────────────────────────────────

describe('recursive walker (ambiguous tree)', () => {
  function makeAmbiguousRouter() {
    const r = new Router<string>();
    r.add('GET', '/api/v1/:user', 'v1-user');
    r.add('GET', '/api/:ver/users', 'param-version');
    r.add('GET', '/api/v2/posts/:id', 'v2-post');
    r.add('GET', '/api/:ver/posts/:slug', 'param-post');
    r.build();
    return r;
  }

  it('selects the recursive walker for ambiguous trees', () => {
    const r = makeAmbiguousRouter();
    const trees = (getRouterInternals(r) as unknown as { matchLayer: { trees: Array<unknown> } }).matchLayer.trees;
    const tree = trees.find(t => t != null) as { name: string };
    expect(tree.name).toBe('walk');
  });

  it('static-segment route wins over param at the same position (static-first)', () => {
    const r = makeAmbiguousRouter();
    const m = r.match('GET', '/api/v1/joe');
    expect(m).not.toBeNull();
    expect(m!.value).toBe('v1-user');
    expect(m!.params).toEqual({ user: 'joe' });
  });

  it('falls back to param when static does not match', () => {
    const r = makeAmbiguousRouter();
    const m = r.match('GET', '/api/v3/users');
    expect(m).not.toBeNull();
    expect(m!.value).toBe('param-version');
    expect(m!.params).toEqual({ ver: 'v3' });
  });

  it('handles deeper ambiguity correctly (v2/posts vs :ver/posts)', () => {
    const r = makeAmbiguousRouter();
    expect(r.match('GET', '/api/v2/posts/42')!.value).toBe('v2-post');
    expect(r.match('GET', '/api/v9/posts/hello')!.value).toBe('param-post');
  });

  it('does not commit params from a failed static branch', () => {
    const r = new Router<string>();
    r.add('GET', '/api/x/:y', 'static-x');
    r.add('GET', '/api/:a/:b/:c', 'three-param');
    r.build();

    const m = r.match('GET', '/api/x/foo/bar');
    expect(m).not.toBeNull();
    expect(m!.value).toBe('three-param');
    expect(m!.params).toEqual({ a: 'x', b: 'foo', c: 'bar' });
    expect((m!.params as Record<string, unknown>).y).toBeUndefined();
  });

  it('rejects empty param segment under ambiguous tree', () => {
    const r = makeAmbiguousRouter();
    expect(r.match('GET', '/api//users')).toBeNull();
  });

  it('matches root-only when registered alongside ambiguous routes', () => {
    const r = new Router<string>();
    r.add('GET', '/', 'root');
    r.add('GET', '/api/v1/:user', 'v1-user');
    r.add('GET', '/api/:ver/users', 'param-version');
    r.build();
    expect(r.match('GET', '/')!.value).toBe('root');
  });
});

// ── Wildcard semantics under fallback walkers ──────────────────────────────

describe('wildcard semantics under fallback walkers', () => {
  it('multi-wildcard at root rejects empty suffix', () => {
    const r = new Router<string>();
    r.add('GET', '/api/*rest+', 'multi');
    r.add('GET', '/other/:a/x', 'other');
    r.add('GET', '/other/:a/:b', 'other2');
    r.build();
    expect(r.match('GET', '/api/foo/bar')!.params).toEqual({ rest: 'foo/bar' });
    expect(r.match('GET', '/api/')).toBeNull();
    expect(r.match('GET', '/api')).toBeNull();
  });

  it('star-wildcard captures empty when URL ends at prefix', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*p', 'files');
    r.add('GET', '/api/:v/x', 'a');
    r.add('GET', '/api/:v/:y', 'b');
    r.build();
    expect(r.match('GET', '/files/a/b')!.params).toEqual({ p: 'a/b' });
    expect(r.match('GET', '/files/')!.params).toEqual({ p: '' });
    expect(r.match('GET', '/files')!.params).toEqual({ p: '' });
  });
});

// ── Decoding + regex testers under fallback walkers ────────────────────────

describe('decoding under fallback walkers', () => {
  it('decodes percent-encoded params', () => {
    const r = new Router<string>();
    r.add('GET', '/api/v1/:user', 'v1');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();
    const m = r.match('GET', '/api/v1/hello%20world');
    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ user: 'hello world' });
  });

  it('throws on malformed percent-encoded input (router does not swallow decode errors)', () => {
    const r = new Router<string>();
    r.add('GET', '/api/v1/:user', 'v1');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();
    expect(() => r.match('GET', '/api/v1/%E0%A4%A')).toThrow();
  });
});

describe('regex testers under fallback walkers', () => {
  it('passes when value matches regex, fails otherwise (recursive walker)', () => {
    const r = new Router<string>();
    r.add('GET', '/api/v1/:id(\\d+)', 'numeric');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();
    expect(r.match('GET', '/api/v1/42')!.value).toBe('numeric');
    expect(r.match('GET', '/api/v1/foo')).toBeNull();
  });
});

// ── Multi-method router behavior ───────────────────────────────────────────

describe('multi-method routers (no shape specialization)', () => {
  it('routes by method correctly', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'get');
    r.add('POST', '/users/:id', 'post');
    r.add('DELETE', '/users/:id', 'del');
    r.build();
    expect(r.match('GET', '/users/42')!.value).toBe('get');
    expect(r.match('POST', '/users/42')!.value).toBe('post');
    expect(r.match('DELETE', '/users/42')!.value).toBe('del');
    expect(r.match('PUT', '/users/42')).toBeNull();
  });

  it('static + dynamic in different methods does not cross-contaminate', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'health');
    r.add('POST', '/users/:id', 'post-user');
    r.build();
    expect(r.match('GET', '/health')!.value).toBe('health');
    expect(r.match('POST', '/users/42')!.value).toBe('post-user');
    expect(r.match('GET', '/users/42')).toBeNull();
    expect(r.match('POST', '/health')).toBeNull();
  });
});

// ── Shape-specialized matchImpl (file-server topology) ─────────────────────

describe('shape-specialized wildcard matchImpl', () => {
  it('matches /static prefix correctly', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.add('GET', '/files/*filepath', 2);
    r.build();
    expect(r.match('GET', '/static/js/app.bundle.js')).toEqual({
      value: 1,
      params: { path: 'js/app.bundle.js' },
      meta: { source: MatchSource.Dynamic },
    });
    expect(r.match('GET', '/files/img/logo.png')).toEqual({
      value: 2,
      params: { filepath: 'img/logo.png' },
      meta: { source: MatchSource.Dynamic },
    });
  });

  it('captures empty for star wildcard at exact prefix (no trailing slash)', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();
    const m = r.match('GET', '/static');
    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ path: '' });
  });

  it('rejects bogus URL with no leading slash', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();
    expect(r.match('GET', 'static/foo')).toBeNull();
    expect(r.match('GET', '')).toBeNull();
  });

  it('strips trailing slash before probe (default option)', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();
    expect(r.match('GET', '/static/foo/')!.params).toEqual({ path: 'foo' });
  });

  it('treats query string as part of path (caller strips ?)', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();
    expect(r.match('GET', '/static/foo?v=1')!.params).toEqual({ path: 'foo?v=1' });
  });

  it('rejects when method does not match', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();
    expect(r.match('POST', '/static/foo')).toBeNull();
  });

  it('captures arbitrarily long wildcard suffixes without any length cap', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();
    const long = 'x'.repeat(100);
    expect(r.match('GET', '/static/' + long)!.params).toEqual({ path: long });
  });

  it('captures arbitrarily long single-segment wildcards', () => {
    const r = new Router<number>();
    r.add('GET', '/files/*filepath', 1);
    r.build();
    const long = 'x'.repeat(256);
    expect(r.match('GET', '/files/' + long)!.params).toEqual({ filepath: long });
  });

  it('multi-wildcard rejects exact prefix and bare-prefix paths', () => {
    const r = new Router<number>();
    r.add('GET', '/api/*rest+', 1);
    r.build();
    expect(r.match('GET', '/api/x')!.params).toEqual({ rest: 'x' });
    expect(r.match('GET', '/api/')).toBeNull();
    expect(r.match('GET', '/api')).toBeNull();
  });
});

describe('shape specialization gating', () => {
  it('disables specialization when more than one method is active', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.add('POST', '/upload/*filepath', 2);
    r.build();
    const impl = getRouterInternals(r).matchImpl as { toString: () => string };
    // Multi-method dispatch reduces to `mcByMethod[method]` table
    // lookup; the table maps method names to numeric method codes
    // that matchActive consumes directly.
    expect(impl.toString()).toContain('mcByMethod[method]');
    expect(r.match('GET', '/static/foo')!.value).toBe(1);
    expect(r.match('POST', '/upload/bar')!.value).toBe(2);
  });

  it('disables specialization when cache is enabled', () => {
    const r = new Router<number>({});
    r.add('GET', '/static/*path', 1);
    r.build();
    const impl = getRouterInternals(r).matchImpl as { toString: () => string };
    expect(impl.toString()).toContain('hitCacheByMethod');
  });

  it('uses the closure-captured activeBucket fast path when only one method is active', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.add('GET', '/health', 2);
    r.build();
    const impl = getRouterInternals(r).matchImpl as { toString: () => string };
    expect(impl.toString()).toContain('activeBucket');
  });
});

// ── Walker wildcard tail across tiers ──────────────────────────────────────

describe('walker wildcard tail across tiers', () => {
  it('iterative walker — star wildcard at leaf accepts non-empty + empty', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*path', 'files');
    r.build();
    expect(r.match('GET', '/files/a/b/c.txt')?.value).toBe('files');
    expect(r.match('GET', '/files/single')?.value).toBe('files');
    expect(r.match('GET', '/files')?.value).toBe('files');
  });

  it('factored walker — star wildcard sharedNext leaf (1500 tenants)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/*path`, `wild-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/files/a/b')?.value).toBe('wild-0');
    expect(r.match('GET', '/tenant-1499/files/x/y/z')?.value).toBe('wild-1499');
    expect(r.match('GET', '/tenant-9999/files/x')).toBeNull();
  });

  it('prefixed-factor walker — star wildcard past the prefix chain', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/api/${i}/files/*path`, `api-wild-${i}`);
    }
    r.build();
    expect(r.match('GET', '/api/0/files/a')?.value).toBe('api-wild-0');
    expect(r.match('GET', '/api/750/files/deep/nested')?.value).toBe('api-wild-750');
    expect(r.match('GET', '/api/9999/files/x')).toBeNull();
  });

  it('multi-prefix factor walker — wildcard tail under each prefix', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/users/${i}/files/*path`, `u-w-${i}`);
      r.add('GET', `/api/${i}/files/*path`, `a-w-${i}`);
    }
    r.build();
    expect(r.match('GET', '/users/0/files/a/b')?.value).toBe('u-w-0');
    expect(r.match('GET', '/api/1499/files/x')?.value).toBe('a-w-1499');
    expect(r.match('GET', '/users/9999/files/x')).toBeNull();
  });

  it('multi-prefix factor — one child has internal prefix chain, the other factors directly', () => {
    // Mixed shape that exercises both Pending branches of
    // tryDetectMultiPrefixFactor: `users/v1` introduces a single-static-chain
    // prefix before its 1500 tenants (prefixed-factor branch), while `api`
    // exposes its 1500 tenants directly under root (direct-factor branch).
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/users/v1/${i}/posts/:id`, `u-v1-${i}`);
      r.add('GET', `/api/${i}/files/:name`, `a-${i}`);
    }
    r.build();
    expect(r.match('GET', '/users/v1/0/posts/42')?.value).toBe('u-v1-0');
    expect(r.match('GET', '/users/v1/1499/posts/x')?.value).toBe('u-v1-1499');
    expect(r.match('GET', '/api/0/files/a')?.value).toBe('a-0');
    expect(r.match('GET', '/api/1499/files/z')?.value).toBe('a-1499');
    expect(r.match('GET', '/users/v2/0/posts/42')).toBeNull();
  });
});

describe('codegen — :param followed by multi-wildcard tail (`/x/:id/*rest+`)', () => {
  it('emits the param + multi-wildcard terminal branch and matches with both params populated', () => {
    // Pins segment-compile.ts:269-271 (paramAtSlashEmit's
    // wildcardTerminal + multi origin path). Without a covering test the
    // emitter could regress to strict-terminal-only without any failure.
    const r = new Router<string>();
    r.add('GET', '/users/:id/*rest+', 'h');
    r.build();

    const m = r.match('GET', '/users/42/files/a.txt')!;
    expect(m).not.toBeNull();
    expect(m.value).toBe('h');
    expect(m.params.id).toBe('42');
    expect(m.params.rest).toBe('files/a.txt');

    // multi origin requires a non-empty tail.
    expect(r.match('GET', '/users/42')).toBeNull();
    expect(r.match('GET', '/users/42/')).toBeNull();
  });
});

describe('walker root edge cases', () => {
  it('root-only static handler', () => {
    const r = new Router<string>();
    r.add('GET', '/', 'root');
    r.build();
    expect(r.match('GET', '/')?.value).toBe('root');
    expect(r.match('GET', '/anything')).toBeNull();
  });

  it('root wildcard /*all matches everything including /', () => {
    const r = new Router<string>();
    r.add('GET', '/*all', 'catch-all');
    r.build();
    expect(r.match('GET', '/anything')?.value).toBe('catch-all');
    expect(r.match('GET', '/a/b/c')?.value).toBe('catch-all');
    expect(r.match('GET', '/')?.value).toBe('catch-all');
  });

  it('root + leaf coexist', () => {
    const r = new Router<string>();
    r.add('GET', '/', 'root');
    r.add('GET', '/users/:id', 'user');
    r.build();
    expect(r.match('GET', '/')?.value).toBe('root');
    expect(r.match('GET', '/users/42')?.value).toBe('user');
  });
});

describe('static + dynamic precedence at same position', () => {
  it('static literal wins over param at the same segment', () => {
    const r = new Router<string>();
    r.add('GET', '/users/me', 'me');
    r.add('GET', '/users/:id', 'detail');
    r.build();
    expect(r.match('GET', '/users/me')?.value).toBe('me');
    expect(r.match('GET', '/users/42')?.value).toBe('detail');
  });

  it('deeper nested precedence', () => {
    const r = new Router<string>();
    r.add('GET', '/api/v1/users', 'list');
    r.add('GET', '/api/v1/users/:id', 'one');
    r.add('GET', '/api/v1/:resource', 'generic');
    r.build();
    expect(r.match('GET', '/api/v1/users')?.value).toBe('list');
    expect(r.match('GET', '/api/v1/users/42')?.value).toBe('one');
    expect(r.match('GET', '/api/v1/posts')?.value).toBe('generic');
  });

  it('three-way precedence: static literal + param + nested wildcard', () => {
    const r = new Router<string>();
    r.add('GET', '/x/me', 'static-me');
    r.add('GET', '/x/:id', 'param-id');
    r.add('GET', '/x/:id/files/*rest', 'wild-rest');
    r.build();
    expect(r.match('GET', '/x/me')?.value).toBe('static-me');
    expect(r.match('GET', '/x/other')?.value).toBe('param-id');
    expect(r.match('GET', '/x/abc/files/a/b/c')?.value).toBe('wild-rest');
  });
});

describe('match.params edge values', () => {
  it('empty string param value (not allowed by walker)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'h');
    r.build();
    expect(r.match('GET', '/users//')).toBeNull();
    expect(r.match('GET', '/users/')).toBeNull();
  });

  it('long param value', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'h');
    r.build();
    const long = 'x'.repeat(2000);
    expect(r.match('GET', `/users/${long}`)?.params['id']).toBe(long);
  });

  it('decoded param value (percent-encoded)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'h');
    r.build();
    expect(r.match('GET', '/users/foo%20bar')?.params['name']).toBe('foo bar');
    expect(r.match('GET', '/users/%E4%B8%80')?.params['name']).toBe('一');
  });
});

// ── Factored walker shared-subtree shapes (1500-tenant tier) ───────────────

describe('factored walker shared-subtree shapes', () => {
  it('walks a paramChild + tester (regex-constrained) inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/users/:id(\\d+)`, `tenant-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/users/42')?.value).toBe('tenant-0');
    expect(r.match('GET', '/tenant-0/users/42')?.params.id).toBe('42');
    expect(r.match('GET', '/tenant-1499/users/9999')?.value).toBe('tenant-1499');
    expect(r.match('GET', '/tenant-0/users/abc')).toBeNull();
  });

  it('walks a multi-wildcard terminal inside shared subtree (multi origin rejects empty tail)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/*tail+`, `multi-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/files/a/b/c')?.value).toBe('multi-0');
    expect(r.match('GET', '/tenant-0/files/a/b/c')?.params.tail).toBe('a/b/c');
    expect(r.match('GET', '/tenant-1499/files/x')?.value).toBe('multi-1499');
    expect(r.match('GET', '/tenant-0/files')).toBeNull();
    expect(r.match('GET', '/tenant-0/files/')).toBeNull();
  });

  it('walks a star-wildcard terminal inside shared subtree (zero or more)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/assets/*path`, `star-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/assets/style.css')?.value).toBe('star-0');
    expect(r.match('GET', '/tenant-0/assets/a/b/c.css')?.params.path).toBe('a/b/c.css');
    const empty = r.match('GET', '/tenant-0/assets');
    expect(empty?.value).toBe('star-0');
    expect(empty?.params.path).toBe('');
  });

  it('walks a multi-static-children Record sibling group inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/users/profile`, `profile-${i}`);
      r.add('GET', `/tenant-${i}/users/settings`, `settings-${i}`);
      r.add('GET', `/tenant-${i}/users/billing`, `billing-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/users/profile')?.value).toBe('profile-0');
    expect(r.match('GET', '/tenant-0/users/settings')?.value).toBe('settings-0');
    expect(r.match('GET', '/tenant-1499/users/billing')?.value).toBe('billing-1499');
    expect(r.match('GET', '/tenant-0/users/unknown')).toBeNull();
  });

  it('walks a deep singleChildKey chain inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/api/v1/items/:id`, `item-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/api/v1/items/42')?.value).toBe('item-0');
    expect(r.match('GET', '/tenant-1499/api/v1/items/x')?.value).toBe('item-1499');
    expect(r.match('GET', '/tenant-0/api/v1/items')).toBeNull();
    expect(r.match('GET', '/tenant-0/api/wrong/items/42')).toBeNull();
  });

  it('walks a staticPrefix-compacted chain inside shared subtree', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/api/v1/users/items/:id`, `compact-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/api/v1/users/items/42')?.value).toBe('compact-0');
    expect(r.match('GET', '/tenant-0/api/v1/users/items/42')?.params.id).toBe('42');
    expect(r.match('GET', '/tenant-0/api/v2/users/items/42')).toBeNull();
    expect(r.match('GET', '/tenant-0/api/v1/users')).toBeNull();
  });
});
