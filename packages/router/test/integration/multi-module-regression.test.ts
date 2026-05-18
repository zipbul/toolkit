/**
 * Regression fixtures. Each suite locks down a behavior that a prior
 * audit pass found broken; the test name (or in-test comment) documents
 * the specific shape under test. Commit hashes belong in `git log`,
 * not here.
 */
import { describe, it, expect } from 'bun:test';

import { RouterError } from '../../src/error';
import { Router } from '../../src/router';
import { firstBuildIssue } from '../test-utils';

describe('subtreeShapesEqual: terminal-store presence (C-03/04/05/06)', () => {
  it('rejects factor when one tenant adds a mid-route terminal that other tenants do not have', () => {
    const r = new Router<string>();
    // 1500 tenants registered with /tenant-X/data/:type/:item only
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/data/:type/:item`, `leaf-${i}`);
    }
    // tenant-5 alone adds /tenant-5/data/:type (mid-position terminal)
    r.add('GET', '/tenant-5/data/:type', 'mid-5');
    r.build();

    expect(r.match('GET', '/tenant-0/data/abc/xyz')?.value).toBe('leaf-0');
    expect(r.match('GET', '/tenant-99/data/abc/xyz')?.value).toBe('leaf-99');
    expect(r.match('GET', '/tenant-5/data/abc')?.value).toBe('mid-5');
    expect(r.match('GET', '/tenant-5/data/abc/xyz')?.value).toBe('leaf-5');
    expect(r.match('GET', '/tenant-99/data/abc')).toBeNull();
  });

  it('still routes correctly when every tenant shares the exact same shape (factor applies)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/data/:type/:item`, `leaf-${i}`);
    }
    r.build();

    expect(r.match('GET', '/tenant-0/data/abc/xyz')?.value).toBe('leaf-0');
    expect(r.match('GET', '/tenant-750/data/x/y')?.value).toBe('leaf-750');
    expect(r.match('GET', '/tenant-1499/data/x/y')?.value).toBe('leaf-1499');
    expect(r.match('GET', '/tenant-1500/data/x/y')).toBeNull();
  });
});

describe('multi-prefix factor: partial-mutation rollback (W1, C-07/08/09)', () => {
  it('leaves the tree intact when only some root children qualify for a factor', () => {
    const r = new Router<string>();
    // child A: 1500 tenants with shared shape — qualifies for factor
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/a/${i}/users/:id`, `a-${i}`);
    }
    // child B: single static route — does NOT qualify for factor.
    // The previous (pre-fix) implementation mutated `a` then aborted on `b`,
    // leaving an inconsistent tree that a later walker tier walked wrong.
    r.add('GET', '/b/static/route', 'b-static');
    r.build();

    expect(r.match('GET', '/a/500/users/abc')?.value).toBe('a-500');
    expect(r.match('GET', '/a/0/users/x')?.value).toBe('a-0');
    expect(r.match('GET', '/a/1499/users/y')?.value).toBe('a-1499');
    expect(r.match('GET', '/b/static/route')?.value).toBe('b-static');
    expect(r.match('GET', '/b/static/wrong')).toBeNull();
    expect(r.match('GET', '/a/9999/users/x')).toBeNull();
  });

  it('still applies factor when every root child qualifies', () => {
    const r = new Router<string>();
    // Two prefixes, each with 1500 sibling tenants of identical shape.
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/users/${i}/posts/:id`, `users-${i}`);
      r.add('GET', `/api/${i}/items/:id`, `api-${i}`);
    }
    r.build();

    expect(r.match('GET', '/users/0/posts/abc')?.value).toBe('users-0');
    expect(r.match('GET', '/users/1499/posts/x')?.value).toBe('users-1499');
    expect(r.match('GET', '/api/0/items/abc')?.value).toBe('api-0');
    expect(r.match('GET', '/api/1499/items/y')?.value).toBe('api-1499');
    expect(r.match('GET', '/users/9999/posts/x')).toBeNull();
    expect(r.match('GET', '/api/9999/items/x')).toBeNull();
  });
});

describe('super-factory presentBitmask boundary (C-01/02)', () => {
  it('accepts a route with exactly 31 capturing segments', () => {
    const r = new Router<string>();
    const segs = Array.from({ length: 31 }, (_, i) => `:p${i}`).join('/');
    r.add('GET', `/${segs}`, 'wide');
    r.build();

    const url = '/' + Array.from({ length: 31 }, (_, i) => `v${i}`).join('/');
    const got = r.match('GET', url);
    expect(got?.value).toBe('wide');
    expect(Object.keys(got!.params).length).toBe(31);
    expect(got!.params['p0']).toBe('v0');
    expect(got!.params['p30']).toBe('v30');
  });

  it('rejects a route with 32 capturing segments at registration', () => {
    const r = new Router<string>();
    const segs = Array.from({ length: 32 }, (_, i) => `:p${i}`).join('/');
    r.add('GET', `/${segs}`, 'too-wide');
    const issue = firstBuildIssue(r);
    expect(issue.kind).toBe('route-parse');
    expect(issue.message).toContain('31');
  });
});

describe('walker tier consistency — every applicable tier returns the same result', () => {
  // Workloads designed to exercise different walker tiers.
  // Same probe set, different scale, expectations identical.
  const cases = [
    {
      name: 'iterative tier (small static-only)',
      register: (r: Router<string>) => {
        r.add('GET', '/api/v1/users', 'list');
        r.add('GET', '/api/v1/users/:id', 'detail');
        r.add('GET', '/api/v1/users/:id/posts', 'posts');
      },
      probes: [
        ['/api/v1/users', 'list'],
        ['/api/v1/users/42', 'detail'],
        ['/api/v1/users/42/posts', 'posts'],
        ['/api/v1/missing', null],
      ] as const,
    },
    {
      name: 'prefixed-factor tier (single chain + 1500 fanout)',
      register: (r: Router<string>) => {
        for (let i = 0; i < 1500; i++) {r.add('GET', `/users/${i}/posts/:id`, `u-${i}`);}
      },
      probes: [
        ['/users/0/posts/x', 'u-0'],
        ['/users/1499/posts/y', 'u-1499'],
        ['/users/750/posts/z', 'u-750'],
        ['/users/9999/posts/x', null],
      ] as const,
    },
    {
      name: 'multi-prefix factor tier (multi-root + per-child fanout)',
      register: (r: Router<string>) => {
        for (let i = 0; i < 1500; i++) {
          r.add('GET', `/users/${i}/posts/:id`, `u-${i}`);
          r.add('GET', `/api/${i}/items/:id`, `a-${i}`);
        }
      },
      probes: [
        ['/users/0/posts/x', 'u-0'],
        ['/api/0/items/x', 'a-0'],
        ['/users/1499/posts/y', 'u-1499'],
        ['/api/1499/items/z', 'a-1499'],
        ['/users/0/missing/x', null],
      ] as const,
    },
    {
      name: 'root-level tenant factor (>1000 sibling tenants at root)',
      register: (r: Router<string>) => {
        for (let i = 0; i < 1500; i++) {r.add('GET', `/tenant-${i}/users/:id`, `t-${i}`);}
      },
      probes: [
        ['/tenant-0/users/x', 't-0'],
        ['/tenant-500/users/y', 't-500'],
        ['/tenant-1499/users/z', 't-1499'],
        ['/tenant-9999/users/x', null],
      ] as const,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = new Router<string>();
      c.register(r);
      r.build();
      for (const [path, expected] of c.probes) {
        const got = r.match('GET', path);
        const value = got === null ? null : got.value;
        expect(value).toBe(expected);
      }
    });
  }
});

describe('leafStoreOf rejects multi-terminal subtree (AUDIT2-001/002)', () => {
  it('does not collapse intermediate + leaf terminals into one factor entry', () => {
    const r = new Router<string>();
    // Every tenant has BOTH an intermediate terminal (/data/:id) AND a
    // leaf terminal (/data/:id/item). The factored walker keeps a single
    // storeOverride per tenant key — without the leafStoreOf guard, the
    // override would be pinned to the intermediate handler and every
    // leaf match would silently return the wrong route.
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/data/:id`, `mid-${i}`);
      r.add('GET', `/tenant-${i}/data/:id/item`, `leaf-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/data/abc')?.value).toBe('mid-0');
    expect(r.match('GET', '/tenant-0/data/abc/item')?.value).toBe('leaf-0');
    expect(r.match('GET', '/tenant-99/data/x')?.value).toBe('mid-99');
    expect(r.match('GET', '/tenant-99/data/x/item')?.value).toBe('leaf-99');
    expect(r.match('GET', '/tenant-1499/data/y/item')?.value).toBe('leaf-1499');
  });
});

describe('cacheSize validation (AUDIT2-009)', () => {
  it('rejects negative cacheSize', () => {
    expect(() => new Router<string>({ cacheSize: -1 })).toThrow(RouterError);
  });
  it('rejects zero cacheSize', () => {
    expect(() => new Router<string>({ cacheSize: 0 })).toThrow(RouterError);
  });
  it('rejects NaN cacheSize', () => {
    expect(() => new Router<string>({ cacheSize: Number.NaN })).toThrow(RouterError);
  });
  it('rejects non-integer cacheSize', () => {
    expect(() => new Router<string>({ cacheSize: 3.5 })).toThrow(RouterError);
  });
  it('accepts positive integer cacheSize', () => {
    expect(() => new Router<string>({ cacheSize: 1024 })).not.toThrow();
    expect(() => new Router<string>({ cacheSize: 1 })).not.toThrow();
  });
  it('error has kind=router-options-invalid', () => {
    try {
      new Router<string>({ cacheSize: -1 });
    } catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      expect((e as RouterError).data.kind).toBe('router-options-invalid');
      return;
    }
    throw new Error('expected throw');
  });
});

describe('rollback after route validation failure (R1)', () => {
  it('truncates every per-terminal column including presentBitmaskByTerminal', () => {
    // Mix valid + invalid routes. Fail invalid → all columns must
    // truncate consistently. Re-validating a fresh router with the
    // same set should produce the same issue list.
    const buildOnce = () => {
      const r = new Router<string>();
      r.add('GET', '/users/:id?', 'ok-1'); // valid (1 optional)
      r.add('GET', '/' + Array.from({ length: 32 }, (_, i) => `:p${i}`).join('/'), 'too-many'); // 32 captures → reject
      r.add('GET', '/posts/:slug', 'ok-2'); // valid
      try {
        r.build();
      } catch (e) {
        return e as RouterError;
      }
      throw new Error('expected build to throw');
    };
    const e1 = buildOnce();
    const e2 = buildOnce();
    if (e1.data.kind !== 'route-validation' || e2.data.kind !== 'route-validation') {
      throw new Error('expected route-validation kind');
    }
    expect(e1.data.errors.length).toBe(e2.data.errors.length);
    expect(e1.data.errors[0]!.error.kind).toBe(e2.data.errors[0]!.error.kind);
  });
});

describe('coverage: ParamSiblingAdd undo + LEAF_STORE_MAX_DEPTH removal', () => {
  it('rolls back a fresh param-sibling on bulk seal failure (UndoKind.ParamSiblingAdd)', () => {
    const r = new Router<string>();
    // Same regex pattern, different param names — wildcard-prefix-index
    // matches the regex AST (allowing the shared trie node), but
    // segment-tree's insertParamPart sees a name mismatch and appends a
    // fresh ParamSegment via `tail.nextSibling = fresh`. That's the
    // single insert path that pushes UndoKind.ParamSiblingAdd.
    r.add('GET', '/users/:a(\\d+)/x', 'first');
    r.add('GET', '/users/:b(\\d+)/y', 'second');
    // Malformed path triggers a parse failure → seal() runs a bulk
    // `rollback(undo, 0)` over every entry, including the
    // ParamSiblingAdd record from the route above.
    r.add('GET', '?bad-path', 'broken');
    expect(() => r.build()).toThrow(RouterError);
  });

  it('factors a >64-segment chain (no LEAF_STORE_MAX_DEPTH ceiling)', () => {
    // 70-segment chain per tenant — would have been silently rejected
    // by the prior 64-depth cap inside leafStoreOf. Now factor detection
    // descends the full chain.
    const r = new Router<string>();
    const chain = Array.from({ length: 70 }, (_, i) => `s${i}`).join('/');
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/${chain}/:final`, `deep-${i}`);
    }
    r.build();
    const probe = `/tenant-0/${chain}/X`;
    expect(r.match('GET', probe)?.value).toBe('deep-0');
    const tail = `/tenant-1499/${chain}/Y`;
    expect(r.match('GET', tail)?.value).toBe('deep-1499');
  });
});
