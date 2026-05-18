/**
 * Apples-to-apples cross-router microbench against seven adapters
 * (zipbul, find-my-way, memoirist, rou3, hono-regexp, hono-trie,
 * koa-tree-router). Each (adapter × scenario) pair runs in a fresh
 * child process — JIT code cache, structure cache, IC state, and RSS
 * baseline are isolated per pair. mitata's cross-router summary
 * (normalized rankings, p-values) is sacrificed in exchange for true
 * process-level isolation; compare adapters via stdout raw values.
 *
 * Each adapter is held to the same per-scenario sanity contract before
 * any timing runs:
 *   - every hit path the bench will measure must return non-null
 *   - every declared miss path must return null
 *   - the declared wrong-method dispatch must return null
 *   - the wildcard syntax rewrite produces a path the adapter actually
 *     accepts at registration time
 * If an adapter fails the contract for a scenario, that pair is skipped
 * (with a printed reason) instead of silently emitting a `0 ns/op` line.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { run, bench, summary, do_not_optimize } from 'mitata';

import { Router } from '../src/router';
import FindMyWay from 'find-my-way';
import { Memoirist } from 'memoirist';
import { createRouter as createRou3, addRoute, findRoute } from 'rou3';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import KoaTreeRouter from 'koa-tree-router';

import { printEnv } from './helpers';

const ADAPTER_NAMES = ['zipbul', 'find-my-way', 'memoirist', 'rou3', 'hono-regexp', 'hono-trie', 'koa-tree-router'] as const;
type AdapterName = (typeof ADAPTER_NAMES)[number];

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
  readonly name: AdapterName;
  /** Per-scenario route-shape rewrite; identity for adapters that accept
   *  the canonical `*name` named-wildcard form. */
  rewrite(path: string): string;
  setup(routes: ReadonlyArray<Route>): unknown;
  /** Match returning a non-null sentinel on hit, null on miss. */
  match(router: unknown, method: Method, path: string): unknown;
}

const adapters: Record<AdapterName, Adapter> = {
  zipbul: {
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
  'find-my-way': {
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
  memoirist: {
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
  rou3: {
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
  'hono-regexp': {
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
  'hono-trie': {
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
  'koa-tree-router': {
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
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SCENARIO DEFINITIONS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface Scenario {
  /** Display label (also used to name bench summary blocks and worker argv). */
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
    wrongMethod: ['POST', '/api/v1/resource50'],
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ORCHESTRATOR / WORKER SPLIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const workerAdapter = process.argv[2];
const workerScenario = process.argv[3];
const isWorker = workerAdapter !== undefined && workerScenario !== undefined;

if (!isWorker) {
  printEnv();
  const total = scenarios.length * ADAPTER_NAMES.length;
  console.log(`adapters=${ADAPTER_NAMES.length} scenarios=${scenarios.length} pairs=${total} (each pair runs in a fresh process for JIT/IC/RSS isolation)`);
  const selfPath = fileURLToPath(import.meta.url);
  let failCount = 0;
  for (const scenario of scenarios) {
    for (const adapterName of ADAPTER_NAMES) {
      console.log(`\n## ${scenario.label} / ${adapterName}`);
      const child = spawnSync('bun', [selfPath, adapterName, scenario.label], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      if (child.status !== 0) {
        console.error(`pair=${scenario.label}/${adapterName} exited with status ${child.status}`);
        failCount++;
      }
    }
  }
  process.exit(failCount > 0 ? 1 : 0);
}

const adapter = adapters[workerAdapter as AdapterName];
if (adapter === undefined) {
  console.error(`Unknown adapter '${workerAdapter}'. Valid: ${ADAPTER_NAMES.join(', ')}`);
  process.exit(1);
}

const scenario = scenarios.find((s) => s.label === workerScenario);
if (scenario === undefined) {
  console.error(`Unknown scenario '${workerScenario}'. Valid: ${scenarios.map((s) => s.label).join(', ')}`);
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SANITY GATE (worker-local; one adapter × one scenario)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const rewritten = scenario.routes.map(([m, p, v]) => [m, adapter.rewrite(p), v] as Route);
let router: unknown;
try {
  router = adapter.setup(rewritten);
} catch (e) {
  console.log(`sanity=setup-failed adapter=${adapter.name} scenario=${scenario.label} error=${JSON.stringify(e instanceof Error ? e.message : String(e))}`);
  process.exit(0);
}

for (const [m, p] of scenario.hits) {
  const r = adapter.match(router, m, p);
  if (r === null || r === undefined) {
    console.log(`sanity=hit-null adapter=${adapter.name} scenario=${scenario.label} path=${JSON.stringify(`${m} ${p}`)}`);
    process.exit(0);
  }
}
for (const [m, p] of scenario.misses) {
  const r = adapter.match(router, m, p);
  if (r !== null && r !== undefined) {
    console.log(`sanity=miss-not-null adapter=${adapter.name} scenario=${scenario.label} path=${JSON.stringify(`${m} ${p}`)}`);
    process.exit(0);
  }
}
{
  const [m, p] = scenario.wrongMethod;
  const r = adapter.match(router, m, p);
  if (r !== null && r !== undefined) {
    console.log(`sanity=wrong-method-not-null adapter=${adapter.name} scenario=${scenario.label} path=${JSON.stringify(`${m} ${p}`)}`);
    process.exit(0);
  }
}
console.log(`sanity=ok adapter=${adapter.name} scenario=${scenario.label}`);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BENCH (single adapter × single scenario)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

summary(() => {
  scenario.hits.forEach(([m, path], idx) => {
    bench(`${scenario.label}/hit${scenario.hits.length > 1 ? `-${idx}` : ''} — ${adapter.name}`, () => {
      do_not_optimize(adapter.match(router, m, path));
    });
  });

  if (scenario.misses.length > 0) {
    const [m, path] = scenario.misses[0]!;
    bench(`${scenario.label}/miss — ${adapter.name}`, () => {
      do_not_optimize(adapter.match(router, m, path));
    });
  }

  {
    const [m, path] = scenario.wrongMethod;
    bench(`${scenario.label}/wrong-method — ${adapter.name}`, () => {
      do_not_optimize(adapter.match(router, m, path));
    });
  }
});

await run();
