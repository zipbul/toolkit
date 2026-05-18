/* eslint-disable no-console */

import FindMyWay from 'find-my-way';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import KoaTreeRouter from 'koa-tree-router';
import { Memoirist } from 'memoirist';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createRouter as createRadix3 } from 'radix3';
import { addRoute, createRouter as createRou3, findRoute } from 'rou3';

import { Router } from '../src/router';
import { fmtMem, mem, median, percentile, printEnv, settleScavenger } from './helpers';

type Route = [method: string, path: string, value: number];

const COUNT = 100_000;
const ITER = 200_000;

// argv is an internal worker-mode IPC for the self-spawn loop below.
// End users never pass argv — they just `bun bench/100k-external-baselines.ts`
// and the orchestrator branch spawns one fresh process per
// router × scenario so JIT/RSS isolation is preserved.
const isWorker = process.argv.length > 2;
const target = process.argv[2] ?? '';
const scenarioName = process.argv[3] ?? '';

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function staticRoutes(): Route[] {
  const out: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(['GET', `/api/v1/resource-${i}`, i]);
  }
  return out;
}

function paramRoutes(): Route[] {
  const out: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(['GET', `/tenant-${i}/users/:id/posts/:postId`, i]);
  }
  return out;
}

function wildcardRoutes(): Route[] {
  const out: Route[] = [];
  // Same shape as the in-process `100k wildcard-heavy` scenario so the
  // baseline numbers compare apples-to-apples against the in-tree run.
  for (let g = 0; g < 1000; g++) {
    for (let b = 0; b < 100; b++) {
      out.push(['GET', `/files/group-${g}/bucket-${b * 1000 + g}/*p`, g * 100 + b]);
    }
  }
  return out;
}

function mixedRoutes(): Route[] {
  const out: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    const mod = i % 4;
    if (mod === 0) {out.push(['GET', `/v${i % 20}/static/resource-${i}`, i]);}
    else if (mod === 1) {out.push(['GET', `/v${i % 20}/users/:id/items/${i}`, i]);}
    else if (mod === 2) {out.push(['POST', `/v${i % 20}/orgs/:org/repos/:repo/actions/${i}`, i]);}
    else {out.push(['GET', `/v${i % 20}/files/${i}/*path`, i]);}
  }
  return out;
}

type MethodPath = readonly [method: string, path: string];

interface Scenario {
  routes: Route[];
  /** Method-aware hits so mixed scenarios (POST/DELETE/PATCH routes)
   *  are exercised under the correct method, matching 100k-verification. */
  hits: readonly MethodPath[];
  misses: readonly MethodPath[];
  /** Same path as a hit but registered under a different method. */
  wrongMethod: MethodPath;
}

function scenario(): Scenario {
  if (scenarioName === 'param') {
    return {
      routes: paramRoutes(),
      hits: [
        ['GET', '/tenant-0/users/42/posts/7'],
        ['GET', '/tenant-50000/users/42/posts/7'],
        ['GET', '/tenant-99999/users/42/posts/7'],
      ],
      misses: [['GET', '/tenant-x/users/42/posts/7']],
      wrongMethod: ['POST', '/tenant-0/users/42/posts/7'],
    };
  }

  if (scenarioName === 'wildcard') {
    return {
      routes: wildcardRoutes(),
      hits: [
        ['GET', '/files/group-0/bucket-0/a.txt'],
        ['GET', '/files/group-0/bucket-50000/a/b/c.txt'],
        ['GET', '/files/group-999/bucket-99999/a/b/c.txt'],
      ],
      misses: [['GET', '/files/group-x/bucket-0/a.txt']],
      wrongMethod: ['POST', '/files/group-0/bucket-0/a.txt'],
    };
  }

  if (scenarioName === 'mixed') {
    return {
      routes: mixedRoutes(),
      hits: [
        ['GET', '/v0/static/resource-0'],
        ['GET', '/v1/users/42/items/50001'],
        ['POST', '/v2/orgs/acme/repos/core/actions/50002'],
        ['GET', '/v19/files/99999/a/b/c.txt'],
      ],
      misses: [['GET', '/v0/none']],
      wrongMethod: ['PATCH', '/v0/static/resource-0'],
    };
  }

  if (scenarioName !== 'static') {
    console.error(`Unknown scenario '${scenarioName}'. Choices: static, param, wildcard, mixed`);
    process.exit(1);
  }

  return {
    routes: staticRoutes(),
    hits: [
      ['GET', '/api/v1/resource-0'],
      ['GET', '/api/v1/resource-50000'],
      ['GET', '/api/v1/resource-99999'],
    ],
    misses: [['GET', '/api/v1/resource-x']],
    wrongMethod: ['POST', '/api/v1/resource-0'],
  };
}

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < 20_000; i++) {fn();}

  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    const result = fn();
    if (result !== undefined && result !== null) {checksum++;}
  }
  const ns = Number(nowNs() - start) / ITER;
  console.log(`${name.padEnd(28)} ${ns.toFixed(2)} ns/op checksum=${checksum}`);
}

interface AdapterMeta {
  /** npm package name resolved against package.json. */
  pkg: string;
  /** Capability matrix: which scenarios this adapter can run under. */
  scenarios: ReadonlySet<'static' | 'param' | 'wildcard' | 'mixed'>;
  /**
   * Failure class summary when a scenario is unsupported. The harness
   * prints this so reproducers can see why a baseline was skipped without
   * digging through adapter source.
   */
  notes: string;
  /**
   * Path rewrite that converts the canonical route shape (`*p` named
   * wildcards, `:name` params) into the adapter's accepted syntax. The
   * default (no rewrite) is correct for adapters that already accept the
   * canonical form. Rewriting only touches REGISTRATION paths — the
   * runtime hit/miss paths are kept identical so the bench comparison is
   * apples-to-apples on what each adapter resolves.
   */
  rewritePath?: (path: string) => string;
}

/**
 * Rewrites the trailing `/*name` wildcard segment to the form the target
 * adapter expects. The path tail is the only place wildcards appear in our
 * scenarios; mid-path wildcards remain canonical and would need a richer
 * per-adapter normalizer.
 */
function rewriteWildcardTrailing(path: string, replacement: string): string {
  return path.replace(/\/\*[^/]*$/, replacement);
}

const adapterMeta: Record<string, AdapterMeta> = {
  zipbul: {
    pkg: '@zipbul/router (workspace)',
    scenarios: new Set(['static', 'param', 'wildcard', 'mixed']),
    notes: 'in-tree implementation under test',
  },
  'find-my-way': {
    pkg: 'find-my-way',
    scenarios: new Set(['static', 'param', 'wildcard', 'mixed']),
    notes: 'wildcard tail registered as bare `/*` (find-my-way drops the wildcard name)',
    rewritePath: path => rewriteWildcardTrailing(path, '/*'),
  },
  memoirist: {
    pkg: 'memoirist',
    scenarios: new Set(['static', 'param', 'wildcard', 'mixed']),
    notes: 'wildcard tail registered as `/*name` (memoirist accepts the canonical form)',
  },
  rou3: {
    pkg: 'rou3',
    scenarios: new Set(['static', 'param', 'wildcard', 'mixed']),
    notes: 'wildcard tail rewritten to `/**:name` (rou3 reserves `**` for catch-all)',
    rewritePath: path => path.replace(/\/\*([^/]+)$/, '/**:$1'),
  },
  'hono-trie': {
    pkg: 'hono/router/trie-router',
    scenarios: new Set(['static', 'param']),
    notes: 'static-only / param-only — wildcard and mixed shapes return ambiguous matches',
  },
  'hono-regexp': {
    pkg: 'hono/router/reg-exp-router',
    scenarios: new Set(['static', 'param']),
    notes: 'param-only — wildcard/mixed unsupported by RegExpRouter',
  },
  'koa-tree-router': {
    pkg: 'koa-tree-router',
    scenarios: new Set(['static', 'param']),
    notes: 'static-only / param-only — wildcard and mixed unsupported',
  },
  radix3: {
    pkg: 'radix3',
    scenarios: new Set(['static', 'param', 'wildcard']),
    notes: 'method-agnostic — composite key `${method} ${path}` per route, lookup mirrors',
    rewritePath: path => path.replace(/\/\*([^/]+)$/, '/**:$1'),
  },
};

function resolveAdapterVersion(pkg: string): string {
  if (pkg.startsWith('@zipbul/')) {return 'workspace';}
  // Hono ships subpath routers off the same `hono` package — resolve the
  // top-level package.json, not the subpath.
  const top = pkg.split('/')[0]!;
  try {
    const meta = require(`${top}/package.json`);
    return typeof meta.version === 'string' ? meta.version : 'unknown';
  } catch {
    return 'unresolvable';
  }
}

const BUILD_TIMEOUT_MS = 60_000;
const BENCH_MEMORY_CAP_MB = 2_048;

function correctnessCheck(
  router: unknown,
  match: (router: unknown, method: string, path: string) => unknown,
  sc: Scenario,
): { ok: true } | { ok: false; reason: string; detail: string } {
  for (const [m, p] of sc.hits) {
    const r = match(router, m, p);
    if (r === null || r === undefined) {
      return { ok: false, reason: 'hit-returned-null', detail: `${m} ${p}` };
    }
  }
  for (const [m, p] of sc.misses) {
    const r = match(router, m, p);
    if (r !== null && r !== undefined) {
      return { ok: false, reason: 'miss-returned-non-null', detail: `${m} ${p}` };
    }
  }
  const [wmm, wmp] = sc.wrongMethod;
  const wm = match(router, wmm, wmp);
  if (wm !== null && wm !== undefined) {
    return {
      ok: false,
      reason: 'wrong-method-returned-non-null',
      detail: `${wmm} ${wmp}`,
    };
  }
  return { ok: true };
}

async function measure(
  name: string,
  build: (rs: Route[]) => unknown,
  match: (router: unknown, method: string, path: string) => unknown,
): Promise<void> {
  const meta = adapterMeta[name];
  const sc = scenario();
  const version = meta !== undefined ? resolveAdapterVersion(meta.pkg) : 'unknown';
  console.log(
    `baseline=${name} version=${version} scenario=${scenarioName} routes=${COUNT}` +
      ` buildTimeoutMs=${BUILD_TIMEOUT_MS} memCapMB=${BENCH_MEMORY_CAP_MB}`,
  );
  if (meta === undefined) {
    console.log('skip=true reason=no-adapter-meta');
    return;
  }
  if (!meta.scenarios.has(scenarioName as 'static' | 'param' | 'wildcard' | 'mixed')) {
    console.log(`skip=true reason=scenario-unsupported note=${JSON.stringify(meta.notes)}`);
    return;
  }
  const rewrite = meta.rewritePath;
  const rs = rewrite === undefined ? sc.routes : sc.routes.map(([m, p, v]) => [m, rewrite(p), v] as Route);
  // Settle before `before` so RSS baseline matches regression-snapshot.ts:193.
  settleScavenger();
  const before = mem();
  const start = performance.now();
  let router: unknown;
  try {
    router = build(rs);
  } catch (error) {
    console.log(`build failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const buildMs = performance.now() - start;
  if (buildMs > BUILD_TIMEOUT_MS) {
    console.log(`build=${buildMs.toFixed(2)}ms timeoutClass=build phase exceeded ${BUILD_TIMEOUT_MS}ms`);
    return;
  }
  // Unified 1500ms settle (helpers.settleScavenger) so RSS measurement
  // matches 100k-verification.ts head-to-head. Without it, the two
  // harnesses would compare zipbul to memoirist under different
  // scavenger windows and the resulting RSS column would be unfair.
  settleScavenger();
  const after = mem();
  if (after.rss / 1024 / 1024 > BENCH_MEMORY_CAP_MB) {
    console.log(`build=${buildMs.toFixed(2)}ms memCapClass=exceeded rss=${(after.rss / 1024 / 1024).toFixed(2)}MB`);
    return;
  }
  console.log(`build=${buildMs.toFixed(2)}ms mem=${fmtMem(before, after)}`);
  // Sanity-check the adapter on the canonical hit / miss / wrong-method
  // paths before measuring. Catches silent mismatches that would
  // otherwise show up as a `checksum=0` line buried among the timing
  // numbers.
  const correctness = correctnessCheck(router, match, sc);
  if (!correctness.ok) {
    console.log(`correctnessClass=mismatch reason=${correctness.reason} detail=${JSON.stringify(correctness.detail)}`);
    return;
  }
  for (let i = 0; i < sc.hits.length; i++) {
    const [m, p] = sc.hits[i]!;
    bench(`hit ${i}`, () => match(router, m, p));
  }
  for (let i = 0; i < sc.misses.length; i++) {
    const [m, p] = sc.misses[i]!;
    bench(`miss ${i}`, () => match(router, m, p));
  }
  const [wm, wp] = sc.wrongMethod;
  bench('wrong-method', () => match(router, wm, wp));
}

const builders: Record<string, () => Promise<void>> = {
  zipbul: () =>
    measure(
      'zipbul',
      rs => {
        const router = new Router<number>();
        for (const [method, path, value] of rs) {router.add(method as 'GET', path, value);}
        router.build();
        return router;
      },
      (router, method, path) => (router as Router<number>).match(method, path),
    ),
  'find-my-way': () =>
    measure(
      'find-my-way',
      rs => {
        // ignoreTrailingSlash:true to match 100k-external-correctness.ts:51.
        const router = FindMyWay({ ignoreTrailingSlash: true });
        for (const [method, path, value] of rs) {router.on(method as 'GET', path, () => value);}
        return router;
      },
      (router, method, path) => (router as ReturnType<typeof FindMyWay>).find(method as 'GET', path),
    ),
  memoirist: () =>
    measure(
      'memoirist',
      rs => {
        const router = new Memoirist<number>();
        for (const [method, path, value] of rs) {router.add(method, path, value);}
        return router;
      },
      (router, method, path) => (router as Memoirist<number>).find(method, path),
    ),
  rou3: () =>
    measure(
      'rou3',
      rs => {
        const router = createRou3<number>();
        for (const [method, path, value] of rs) {addRoute(router, method, path, value);}
        return router;
      },
      (router, method, path) => findRoute(router as ReturnType<typeof createRou3<number>>, method, path),
    ),
  'hono-trie': () =>
    measure(
      'hono-trie',
      rs => {
        const router = new TrieRouter<number>();
        for (const [method, path, value] of rs) {router.add(method, path, value);}
        return router;
      },
      (router, method, path) => {
        const result = (router as TrieRouter<number>).match(method, path) as unknown as [unknown[]];
        return result[0].length > 0 ? result : null;
      },
    ),
  'hono-regexp': () =>
    measure(
      'hono-regexp',
      rs => {
        const router = new RegExpRouter<number>();
        for (const [method, path, value] of rs) {router.add(method, path, value);}
        return router;
      },
      (router, method, path) => {
        const result = (router as RegExpRouter<number>).match(method, path) as unknown as [unknown[]];
        return result[0].length > 0 ? result : null;
      },
    ),
  'koa-tree-router': () =>
    measure(
      'koa-tree-router',
      rs => {
        const router = new KoaTreeRouter() as any;
        for (const [method, path, value] of rs) {router.on(method, path, () => value);}
        return router;
      },
      (router, method, path) => {
        const result = (router as any).find(method, path);
        return result.handle === null ? null : result;
      },
    ),
  radix3: () =>
    measure(
      'radix3',
      rs => {
        const router = createRadix3<any>() as any;
        for (const [method, path, value] of rs) {
          router.insert(`/${method}${path}`, { method, value });
        }
        return router;
      },
      (router, method, path) => (router as any).lookup(`/${method}${path}`) ?? null,
    ),
};

if (isWorker) {
  const run = builders[target];
  if (run === undefined) {
    console.error(`Unknown baseline '${target}'. Choices: ${Object.keys(builders).join(', ')}`);
    process.exit(1);
  }
  printEnv();
  await run();
} else {
  const selfPath = fileURLToPath(import.meta.url);
  const scenarios = ['static', 'param', 'wildcard', 'mixed'] as const;
  const adapters = Object.keys(builders);
  const RUNS = 3;

  printEnv();
  console.log(
    `adapters=${adapters.length} scenarios=${scenarios.length} runs=${RUNS} (each pair runs in a fresh process; ${RUNS} runs per pair for percentile)`,
  );
  // Scenario coverage subset of 100k-verification.ts (static/param/wildcard/mixed
  // only). high-fanout/versioned-api/regex-heavy aren't compared against externals
  // because hono-trie/hono-regexp/koa-tree-router/radix3 don't fully support them.

  interface PairRun {
    buildMs: number;
    rssMb: number;
    heapMb: number;
    hitNs: number[];
    missNs: number[];
    wrongMethodNs: number[];
  }

  function parsePairRun(stdout: string): PairRun | null {
    const build = stdout.match(/build=([0-9.]+)ms mem=rss=([0-9.-]+)MB heap=([0-9.-]+)MB/);
    if (build === null) {return null;}
    const hits = [...stdout.matchAll(/^hit \d+\s+([0-9.]+) ns\/op checksum=/gm)].map(m => Number(m[1]));
    const misses = [...stdout.matchAll(/^miss \d+\s+([0-9.]+) ns\/op checksum=/gm)].map(m => Number(m[1]));
    const wrong = [...stdout.matchAll(/^wrong-method\s+([0-9.]+) ns\/op checksum=/gm)].map(m => Number(m[1]));
    return {
      buildMs: Number(build[1]),
      rssMb: Number(build[2]),
      heapMb: Number(build[3]),
      hitNs: hits,
      missNs: misses,
      wrongMethodNs: wrong,
    };
  }

  function fmt(value: number, digits = 2): string {
    return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
  }

  for (const scenario of scenarios) {
    for (const adapter of adapters) {
      console.log(`\n=== ${adapter} / ${scenario} ===`);
      const runs: PairRun[] = [];
      for (let i = 0; i < RUNS; i++) {
        const child = spawnSync('bun', [selfPath, adapter, scenario], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
        if (child.status !== 0) {
          console.error(`run=${i + 1} status=${child.status}`);
          console.error(child.stderr);
          continue;
        }
        process.stdout.write(child.stdout);
        const parsed = parsePairRun(child.stdout);
        if (parsed !== null) {runs.push(parsed);}
      }
      if (runs.length === 0) {continue;}
      const builds = runs.map(r => r.buildMs);
      const rss = runs.map(r => r.rssMb);
      const heap = runs.map(r => r.heapMb);
      const hits = runs.flatMap(r => r.hitNs);
      const misses = runs.flatMap(r => r.missNs);
      const wrong = runs.flatMap(r => r.wrongMethodNs);
      // builds/rss/heap are 1 sample per run (RUNS=3) → use max instead of p99
      // which would collapse to the same value.
      console.log(
        `summary adapter=${adapter} scenario=${scenario} runs=${runs.length} ` +
          `buildMedian=${fmt(median(builds))}ms buildMax=${fmt(Math.max(...builds))}ms ` +
          `rssMedian=${fmt(median(rss))}MB heapMedian=${fmt(median(heap))}MB ` +
          `hitMedian=${fmt(median(hits))}ns hitP99=${fmt(percentile(hits, 99))}ns ` +
          `missMedian=${fmt(median(misses))}ns missP99=${fmt(percentile(misses, 99))}ns ` +
          `wrongMethodMedian=${fmt(median(wrong))}ns wrongMethodP99=${fmt(percentile(wrong, 99))}ns`,
      );
    }
  }
}
