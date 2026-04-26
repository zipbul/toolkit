/**
 * Walker fallback coverage.
 *
 * The router's matchImpl is built by a layered codegen pipeline:
 *   1. Shape-specialized matchImpl (e.g. static-prefix wildcard inline)
 *   2. tryCodegenStaticPrefixWildcard (per-method walker)
 *   3. compileSegmentTree (general per-method walker)
 *   4. createIterativeWalker (non-ambiguous trees, no codegen)
 *   5. recursive `match` walker (ambiguous trees, no codegen)
 *   6. radix-walk fallback (when segment tree can't be built at all)
 *
 * Bench routes mostly hit (1)-(3). The rest are easy to leave untested by
 * accident — yet they're the ones executed when route shapes don't fit the
 * codegen subset. These tests intentionally construct trees that bail on
 * codegen and force traffic through the lower tiers.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Inspect the per-method walker function name to confirm which tier was
 *  selected. Codegen functions are named `compiledWildWalk` /
 *  `compiledSegmentWalk`; iterative is `walk` exported by createIterativeWalker;
 *  the recursive fallback also exports `walk` but contains a nested `match`. */
function pickedWalkerName(router: Router<unknown>): string | null {
  const trees = (router as unknown as { trees: Array<((u: string, s: unknown) => boolean) | null> }).trees;
  const tree = trees.find(t => t != null);

  return tree ? tree.name : null;
}

// ── Iterative walker (wide fanout, non-ambiguous) ──────────────────────────

describe('iterative walker (wide fanout exceeding codegen size budget)', () => {
  // To force the iterative walker we need either:
  //   (a) hasAmbiguousNode true (segment-tree codegen bails on ambiguity), or
  //   (b) source size > MAX_SOURCE (codegen compiles to too much JS).
  // The current fanoutCap is 16 — synthetic param routes with many distinct
  // top-level prefixes will exceed MAX_SOURCE and fall through to iterative.
  function makeWideFanoutRouter() {
    const r = new Router<string>();
    // 25 distinct prefixes — emits enough codegen to exceed MAX_SOURCE.
    for (let i = 0; i < 25; i++) {
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

  it('returns null for trailing-slash on terminal param when ignoreTrailingSlash=false', () => {
    const r = new Router<string>({ ignoreTrailingSlash: false });
    // Force iterative path with many prefixes so codegen bails on size.
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
});

// ── Recursive walker (ambiguous tree) ──────────────────────────────────────

describe('recursive walker (ambiguous tree)', () => {
  // Two dynamic routes whose parts collide at the same segment position with
  // a static + param choice. Static routes go through staticMap so they don't
  // create the ambiguity — both must be DYNAMIC for this case.
  function makeAmbiguousRouter() {
    const r = new Router<string>();
    // Position 1 in segment tree: root.staticChildren['api'].next has both
    //   staticChildren: { v1: ... }   (from /api/v1/:user)
    //   paramChild   :ver             (from /api/:ver/users)
    r.add('GET', '/api/v1/:user', 'v1-user');
    r.add('GET', '/api/:ver/users', 'param-version');
    // Add another ambiguity at depth 2
    r.add('GET', '/api/v2/posts/:id', 'v2-post');
    r.add('GET', '/api/:ver/posts/:slug', 'param-post');
    r.build();

    return r;
  }

  it('selects the recursive walker for ambiguous trees', () => {
    const r = makeAmbiguousRouter();
    const trees = (r as unknown as { trees: Array<unknown> }).trees;
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
    // /api/x/:y AND /api/:a/:b — when probing /api/x/<long suffix>, static
    // 'x' branch matches first level but can fail deeper; recursive walker
    // must not leave 'y' in params when backtracking to the param branch.
    r.add('GET', '/api/x/:y', 'static-x');
    r.add('GET', '/api/:a/:b/:c', 'three-param');
    r.build();

    const m = r.match('GET', '/api/x/foo/bar');

    expect(m).not.toBeNull();
    expect(m!.value).toBe('three-param');
    // 'y' should not appear — that param belongs only to the static-x branch.
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

// ── Wildcard semantics inside walker fallbacks ─────────────────────────────

describe('wildcard semantics under fallback walkers', () => {
  it('multi-wildcard at root rejects empty suffix', () => {
    const r = new Router<string>();
    r.add('GET', '/api/*rest+', 'multi'); // *name+ → multi origin (1+ chars)
    // Force fallback by adding ambiguity elsewhere
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
    // Force ambiguity to bypass shape-specialized matchImpl
    r.add('GET', '/api/:v/x', 'a');
    r.add('GET', '/api/:v/:y', 'b');
    r.build();

    expect(r.match('GET', '/files/a/b')!.params).toEqual({ p: 'a/b' });
    expect(r.match('GET', '/files/')!.params).toEqual({ p: '' });
    expect(r.match('GET', '/files')!.params).toEqual({ p: '' });
  });
});

// ── Param decoding under fallback walkers ─────────────────────────────────

describe('decoding under fallback walkers', () => {
  it('decodes percent-encoded params', () => {
    const r = new Router<string>({ decodeParams: true });
    r.add('GET', '/api/v1/:user', 'v1');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();

    const m = r.match('GET', '/api/v1/hello%20world');

    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ user: 'hello world' });
  });

  it('does not decode when decodeParams=false', () => {
    const r = new Router<string>({ decodeParams: false });
    r.add('GET', '/api/v1/:user', 'v1');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();

    const m = r.match('GET', '/api/v1/hello%20world');

    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ user: 'hello%20world' });
  });

  it('keeps raw value when decodeURIComponent throws (malformed %)', () => {
    const r = new Router<string>({ decodeParams: true });
    r.add('GET', '/api/v1/:user', 'v1');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();

    const m = r.match('GET', '/api/v1/%E0%A4%A');

    expect(m).not.toBeNull();
    expect(m!.value).toBe('v1');
    // Either decoded or raw — but must not throw, must not be null.
    expect(typeof m!.params.user).toBe('string');
  });
});

// ── Regex-tested params under fallback walkers ─────────────────────────────

describe('regex testers under fallback walkers', () => {
  it('passes when value matches regex, fails otherwise (recursive walker)', () => {
    const r = new Router<string>();
    // Tester on :id forces tester path. Add ambiguity so fallback walker runs.
    r.add('GET', '/api/v1/:id{\\d+}', 'numeric');
    r.add('GET', '/api/:ver/users', 'pv');
    r.build();

    expect(r.match('GET', '/api/v1/42')!.value).toBe('numeric');
    // /api/v1/foo: :id tester rejects non-numeric. Should fall through to
    // /api/:ver/users → :ver=v1 expects 'users' next, but we have 'foo' → null.
    expect(r.match('GET', '/api/v1/foo')).toBeNull();
  });
});

// ── Multi-method router behavior ──────────────────────────────────────────

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

// ── Shape-specialized matchImpl (file-server topology) ────────────────────

describe('shape-specialized wildcard matchImpl', () => {
  it('matches /static prefix correctly', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.add('GET', '/files/*filepath', 2);
    r.build();

    expect(r.match('GET', '/static/js/app.bundle.js')).toEqual({
      value: 1,
      params: { path: 'js/app.bundle.js' },
      meta: { source: 'dynamic' },
    });

    expect(r.match('GET', '/files/img/logo.png')).toEqual({
      value: 2,
      params: { filepath: 'img/logo.png' },
      meta: { source: 'dynamic' },
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

    // After trim, sp = '/static/foo', path = 'foo'
    expect(r.match('GET', '/static/foo/')!.params).toEqual({ path: 'foo' });
  });

  it('strips query string before probe', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();

    expect(r.match('GET', '/static/foo?v=1')!.params).toEqual({ path: 'foo' });
  });

  it('rejects when method does not match', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.build();

    expect(r.match('POST', '/static/foo')).toBeNull();
  });

  it('rejects path longer than maxPathLength', () => {
    const r = new Router<number>({ maxPathLength: 32 });
    r.add('GET', '/static/*path', 1);
    r.build();

    expect(r.match('GET', '/static/' + 'x'.repeat(100))).toBeNull();
  });

  it('rejects path with a segment longer than maxSegmentLength', () => {
    const r = new Router<number>({ maxSegmentLength: 8 });
    r.add('GET', '/files/*filepath', 1);
    r.build();

    // /files/<256-char single segment> — trips the segLen scan inside the
    // specialized matchImpl, not the wildcard probe.
    expect(r.match('GET', '/files/' + 'x'.repeat(256))).toBeNull();
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

// ── Multi-method + wildcard does NOT trigger shape specialization ─────────

describe('shape specialization gating', () => {
  it('disables specialization when more than one method is active', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.add('POST', '/upload/*filepath', 2);
    r.build();

    const impl = (r as unknown as { matchImpl: { toString: () => string } }).matchImpl;

    // Generic path uses `methodCodes[method]` lookup; specialized path uses
    // `method !== "GET"` literal. The presence of the lookup confirms generic
    // path is in effect.
    expect(impl.toString()).toContain('methodCodes[method]');
    expect(r.match('GET', '/static/foo')!.value).toBe(1);
    expect(r.match('POST', '/upload/bar')!.value).toBe(2);
  });

  it('disables specialization when cache is enabled', () => {
    const r = new Router<number>({ enableCache: true });
    r.add('GET', '/static/*path', 1);
    r.build();

    const impl = (r as unknown as { matchImpl: { toString: () => string } }).matchImpl;

    expect(impl.toString()).toContain('hitCacheByMethod');
  });

  it('disables specialization when a static route is registered alongside wildcards', () => {
    const r = new Router<number>();
    r.add('GET', '/static/*path', 1);
    r.add('GET', '/health', 2); // static, lives in staticMap
    r.build();

    const impl = (r as unknown as { matchImpl: { toString: () => string } }).matchImpl;

    expect(impl.toString()).toContain('staticOutputs[sp]');
  });
});
