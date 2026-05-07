/**
 * Apples-to-apples microbench against six external routers.
 *
 * Each adapter is held to the same per-scenario sanity contract before any
 * timing runs:
 *   - every hit path the bench will measure must return non-null
 *   - every declared miss path must return null
 *   - the declared wrong-method dispatch must return null
 *   - the wildcard syntax rewrite produces a path the adapter actually
 *     accepts at registration time
 * If any adapter fails the contract for a scenario, that adapter is
 * excluded from the scenario's bench block (with a printed reason)
 * instead of silently emitting a `0 ns/op` line.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

import { Router } from '../src/router';
import FindMyWay from 'find-my-way';
import { Memoirist } from 'memoirist';
import { createRouter as createRou3, addRoute, findRoute } from 'rou3';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import KoaTreeRouter from 'koa-tree-router';

type Method = string;
type Route = readonly [Method, string, number];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTE SETS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const STATIC_ROUTES: Route[] = [];
for (let i = 0; i < 100; i++) {
  STATIC_ROUTES.push(['GET', `/api/v1/resource${i}`, i]);
}

const PARAM_ROUTES: Route[] = [
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['GET', '/repos/:owner/:repo/issues/:number', 3],
  ['GET', '/orgs/:org/teams/:team/members/:member', 4],
];

// Wildcard scenario uses two distinct prefixes; both adapters' hit paths
// hit a different prefix so neither side is biased by IC monomorphism.
const WILDCARD_ROUTES: Route[] = [
  ['GET', '/static/*path', 1],
  ['GET', '/files/*filepath', 2],
];

const GITHUB_ROUTES: Route[] = [
  ['GET', '/user', 1],
  ['GET', '/users/:user', 2],
  ['GET', '/users/:user/repos', 3],
  ['GET', '/users/:user/orgs', 4],
  ['GET', '/users/:user/gists', 5],
  ['GET', '/users/:user/followers', 6],
  ['GET', '/users/:user/following', 7],
  ['GET', '/users/:user/following/:target', 8],
  ['GET', '/users/:user/keys', 9],
  ['GET', '/repos/:owner/:repo', 10],
  ['GET', '/repos/:owner/:repo/commits', 11],
  ['GET', '/repos/:owner/:repo/commits/:sha', 12],
  ['GET', '/repos/:owner/:repo/branches', 13],
  ['GET', '/repos/:owner/:repo/branches/:branch', 14],
  ['GET', '/repos/:owner/:repo/tags', 15],
  ['GET', '/repos/:owner/:repo/contributors', 16],
  ['GET', '/repos/:owner/:repo/languages', 17],
  ['GET', '/repos/:owner/:repo/teams', 18],
  ['GET', '/repos/:owner/:repo/releases', 19],
  ['GET', '/repos/:owner/:repo/releases/:id', 20],
  ['POST', '/repos/:owner/:repo/releases', 21],
  ['GET', '/repos/:owner/:repo/issues', 22],
  ['GET', '/repos/:owner/:repo/issues/:number', 23],
  ['POST', '/repos/:owner/:repo/issues', 24],
  ['GET', '/repos/:owner/:repo/issues/:number/comments', 25],
  ['POST', '/repos/:owner/:repo/issues/:number/comments', 26],
  ['GET', '/repos/:owner/:repo/pulls', 27],
  ['GET', '/repos/:owner/:repo/pulls/:number', 28],
  ['POST', '/repos/:owner/:repo/pulls', 29],
  ['GET', '/repos/:owner/:repo/pulls/:number/commits', 30],
  ['GET', '/repos/:owner/:repo/pulls/:number/files', 31],
  ['GET', '/repos/:owner/:repo/contents/:path', 32],
  ['GET', '/repos/:owner/:repo/stargazers', 33],
  ['GET', '/repos/:owner/:repo/subscribers', 34],
  ['GET', '/repos/:owner/:repo/forks', 35],
  ['POST', '/repos/:owner/:repo/forks', 36],
  ['GET', '/repos/:owner/:repo/hooks', 37],
  ['GET', '/repos/:owner/:repo/hooks/:id', 38],
  ['POST', '/repos/:owner/:repo/hooks', 39],
  ['GET', '/repos/:owner/:repo/collaborators', 40],
  ['GET', '/repos/:owner/:repo/collaborators/:user', 41],
  ['PUT', '/repos/:owner/:repo/collaborators/:user', 42],
  ['DELETE', '/repos/:owner/:repo/collaborators/:user', 43],
  ['GET', '/orgs/:org', 44],
  ['GET', '/orgs/:org/repos', 45],
  ['GET', '/orgs/:org/members', 46],
  ['GET', '/orgs/:org/members/:user', 47],
  ['GET', '/orgs/:org/teams', 48],
  ['GET', '/orgs/:org/teams/:team', 49],
  ['POST', '/orgs/:org/teams', 50],
  ['GET', '/orgs/:org/teams/:team/members', 51],
  ['GET', '/orgs/:org/teams/:team/repos', 52],
  ['GET', '/gists', 53],
  ['GET', '/gists/:id', 54],
  ['POST', '/gists', 55],
  ['GET', '/gists/:id/comments', 56],
  ['GET', '/search/repositories', 57],
  ['GET', '/search/code', 58],
  ['GET', '/search/issues', 59],
  ['GET', '/search/users', 60],
  ['GET', '/notifications', 61],
  ['GET', '/events', 62],
  ['GET', '/feeds', 63],
  ['GET', '/rate_limit', 64],
  ['GET', '/emojis', 65],
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ADAPTER INTERFACE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Adapter {
  readonly name: string;
  /** Per-scenario route-shape rewrite; identity for adapters that accept
   *  the canonical `*name` named-wildcard form. */
  rewrite(path: string): string;
  setup(routes: ReadonlyArray<Route>): unknown;
  /** Match returning a non-null sentinel on hit, null on miss. */
  match(router: unknown, method: Method, path: string): unknown;
}

const adapters: Adapter[] = [
  {
    name: 'zipbul',
    rewrite: (p) => p,
    setup: (rs) => {
      const r = new Router<number>();
      for (const [m, p, v] of rs) r.add(m as 'GET', p, v);
      r.build();
      return r;
    },
    match: (r, m, p) => (r as Router<number>).match(m, p),
  },
  {
    name: 'find-my-way',
    // find-my-way accepts a bare trailing `*` as catchall; named `*name`
    // is rejected at register time.
    rewrite: (p) => p.replace(/\/\*[^/]+$/, '/*'),
    setup: (rs) => {
      const r = FindMyWay();
      for (const [m, p, v] of rs) r.on(m as 'GET', p, () => v);
      return r;
    },
    match: (r, m, p) => (r as ReturnType<typeof FindMyWay>).find(m as 'GET', p),
  },
  {
    name: 'memoirist',
    // memoirist accepts canonical `*name`.
    rewrite: (p) => p,
    setup: (rs) => {
      const r = new Memoirist<number>();
      for (const [m, p, v] of rs) r.add(m, p, v);
      return r;
    },
    match: (r, m, p) => (r as Memoirist<number>).find(m, p),
  },
  {
    name: 'rou3',
    // rou3 reserves `**:name` as the named catch-all form.
    rewrite: (p) => p.replace(/\/\*([^/]+)$/, '/**:$1'),
    setup: (rs) => {
      const r = createRou3<number>();
      for (const [m, p, v] of rs) addRoute(r, m, p, v);
      return r;
    },
    match: (r, m, p) => findRoute(r as ReturnType<typeof createRou3<number>>, m, p),
  },
  {
    name: 'hono-regexp',
    // hono accepts a bare trailing `*` placeholder.
    rewrite: (p) => p.replace(/\/\*[^/]+$/, '/*'),
    setup: (rs) => {
      const r = new RegExpRouter<number>();
      for (const [m, p, v] of rs) r.add(m, p, v);
      return r;
    },
    match: (r, m, p) => {
      const out = (r as RegExpRouter<number>).match(m, p) as unknown as [unknown[]];
      return out[0].length > 0 ? out : null;
    },
  },
  {
    name: 'hono-trie',
    rewrite: (p) => p.replace(/\/\*[^/]+$/, '/*'),
    setup: (rs) => {
      const r = new TrieRouter<number>();
      for (const [m, p, v] of rs) r.add(m, p, v);
      return r;
    },
    match: (r, m, p) => {
      const out = (r as TrieRouter<number>).match(m, p) as unknown as [unknown[]];
      return out[0].length > 0 ? out : null;
    },
  },
  {
    name: 'koa-tree-router',
    // koa-tree-router uses `*name` as named catchall.
    rewrite: (p) => p,
    setup: (rs) => {
      const r = new KoaTreeRouter() as unknown as {
        on: (m: string, p: string, h: () => unknown) => void;
        find: (m: string, p: string) => { handle: unknown };
      };
      for (const [m, p, v] of rs) r.on(m, p, () => v);
      return r;
    },
    match: (r, m, p) => {
      const out = (r as { find: (m: string, p: string) => { handle: unknown } }).find(m, p);
      return out.handle === null ? null : out;
    },
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SCENARIO DEFINITIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Scenario {
  /** Display label (also used to name bench summary blocks). */
  label: string;
  /** Canonical route list (each adapter rewrites with `rewrite()` first). */
  routes: ReadonlyArray<Route>;
  /** Hit assertions: each `[method, path]` must return non-null on every adapter. */
  hits: ReadonlyArray<readonly [Method, string]>;
  /** Miss assertions: each path must return null on every adapter. */
  misses: ReadonlyArray<readonly [Method, string]>;
  /** Wrong-method axis: `path` is registered under a different method,
   *  the bench dispatches `method` and expects null. */
  wrongMethod: readonly [Method, string];
}

const scenarios: Scenario[] = [
  {
    label: 'static',
    routes: STATIC_ROUTES,
    hits: [
      ['GET', '/api/v1/resource0'],
      ['GET', '/api/v1/resource50'],
      ['GET', '/api/v1/resource99'],
    ],
    misses: [['GET', '/api/v1/missing']],
    wrongMethod: ['POST', '/api/v1/resource50'],
  },
  {
    label: 'param-1',
    routes: PARAM_ROUTES,
    hits: [['GET', '/users/42']],
    misses: [['GET', '/missing/42']],
    wrongMethod: ['POST', '/users/42'],
  },
  {
    label: 'param-3',
    routes: PARAM_ROUTES,
    hits: [['GET', '/repos/zipbul/toolkit/issues/42']],
    misses: [['GET', '/repos/zipbul/toolkit/missing/42']],
    wrongMethod: ['POST', '/repos/zipbul/toolkit/issues/42'],
  },
  {
    label: 'wildcard',
    routes: WILDCARD_ROUTES,
    hits: [
      ['GET', '/static/js/app.bundle.js'],
      ['GET', '/files/uploads/2024/photo.jpg'],
    ],
    misses: [['GET', '/missing/path/here']],
    wrongMethod: ['POST', '/static/js/app.bundle.js'],
  },
  {
    label: 'github-static',
    routes: GITHUB_ROUTES,
    hits: [['GET', '/user']],
    misses: [['GET', '/missing']],
    wrongMethod: ['POST', '/user'],
  },
  {
    label: 'github-param',
    routes: GITHUB_ROUTES,
    hits: [['GET', '/repos/zipbul/toolkit/issues/42']],
    misses: [['GET', '/repos/zipbul/toolkit/missing/42']],
    wrongMethod: ['DELETE', '/repos/zipbul/toolkit/issues/42'],
  },
  {
    label: 'miss',
    routes: STATIC_ROUTES,
    hits: [],
    misses: [['GET', '/nonexistent/path/that/does/not/exist']],
    // wrong-method on a known-missing path is the same outcome as a plain
    // miss; reuse the miss path so the axis is exercised consistently.
    wrongMethod: ['POST', '/nonexistent/path/that/does/not/exist'],
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SANITY GATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface BuiltAdapter {
  adapter: Adapter;
  router: unknown;
  /** True iff every hit/miss/wrong-method assertion passed for this scenario. */
  passed: boolean;
  failureReason?: string;
}

function buildAndCheck(scenario: Scenario): BuiltAdapter[] {
  return adapters.map((adapter) => {
    let router: unknown;
    const rewritten = scenario.routes.map(([m, p, v]) => [m, adapter.rewrite(p), v] as Route);
    try {
      router = adapter.setup(rewritten);
    } catch (e) {
      return {
        adapter,
        router: null,
        passed: false,
        failureReason: `setup-failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    for (const [m, p] of scenario.hits) {
      const r = adapter.match(router, m, p);
      if (r === null || r === undefined) {
        return { adapter, router, passed: false, failureReason: `hit-null: ${m} ${p}` };
      }
    }
    for (const [m, p] of scenario.misses) {
      const r = adapter.match(router, m, p);
      if (r !== null && r !== undefined) {
        return { adapter, router, passed: false, failureReason: `miss-not-null: ${m} ${p}` };
      }
    }
    {
      const [m, p] = scenario.wrongMethod;
      const r = adapter.match(router, m, p);
      if (r !== null && r !== undefined) {
        return { adapter, router, passed: false, failureReason: `wrong-method-not-null: ${m} ${p}` };
      }
    }
    return { adapter, router, passed: true };
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BENCH HARNESS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const builtPerScenario = scenarios.map((s) => ({ scenario: s, built: buildAndCheck(s) }));

console.log('## Sanity gate');
for (const { scenario, built } of builtPerScenario) {
  for (const b of built) {
    if (b.passed) {
      console.log(`  ${scenario.label.padEnd(14)} ${b.adapter.name.padEnd(18)} OK`);
    } else {
      console.log(`  ${scenario.label.padEnd(14)} ${b.adapter.name.padEnd(18)} EXCLUDED reason=${b.failureReason}`);
    }
  }
}
console.log('');

/**
 * Run a single hit/miss/wrong-method block for one scenario. Each adapter
 * that survived the sanity gate contributes one mitata bench entry; the
 * input arguments are identical across adapters so the comparison is
 * apples-to-apples.
 */
function benchScenario(scenario: Scenario, built: BuiltAdapter[]): void {
  // Hit benches — one summary per declared hit path.
  scenario.hits.forEach(([m, path], idx) => {
    summary(() => {
      for (const b of built) {
        if (!b.passed) continue;
        const router = b.router;
        const adapter = b.adapter;
        bench(`${scenario.label}/hit${scenario.hits.length > 1 ? `-${idx}` : ''} — ${adapter.name}`, () => {
          do_not_optimize(adapter.match(router, m, path));
        });
      }
    });
  });

  // Miss bench.
  if (scenario.misses.length > 0) {
    const [m, path] = scenario.misses[0]!;
    summary(() => {
      for (const b of built) {
        if (!b.passed) continue;
        const router = b.router;
        const adapter = b.adapter;
        bench(`${scenario.label}/miss — ${adapter.name}`, () => {
          do_not_optimize(adapter.match(router, m, path));
        });
      }
    });
  }

  // Wrong-method bench.
  {
    const [m, path] = scenario.wrongMethod;
    summary(() => {
      for (const b of built) {
        if (!b.passed) continue;
        const router = b.router;
        const adapter = b.adapter;
        bench(`${scenario.label}/wrong-method — ${adapter.name}`, () => {
          do_not_optimize(adapter.match(router, m, path));
        });
      }
    });
  }
}

for (const { scenario, built } of builtPerScenario) {
  benchScenario(scenario, built);
}

await run();
