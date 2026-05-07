/* eslint-disable no-console */

import { performance } from 'node:perf_hooks';

import FindMyWay from 'find-my-way';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import KoaTreeRouter from 'koa-tree-router';
import { Memoirist } from 'memoirist';
import { addRoute, createRouter as createRou3, findRoute } from 'rou3';

import { Router } from '../src/router';

type Route = [method: string, path: string, value: number];

const COUNT = 100_000;
const ITER = 200_000;
const target = process.argv[2] ?? 'zipbul';
const scenarioName = process.argv[3] ?? 'static';

function gc(): void {
  if (typeof Bun !== 'undefined') Bun.gc(true);
}

function mem(): NodeJS.MemoryUsage {
  gc();
  return process.memoryUsage();
}

function fmtMem(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage): string {
  const rss = (after.rss - before.rss) / 1024 / 1024;
  const heap = (after.heapUsed - before.heapUsed) / 1024 / 1024;
  const arrayBuffers = (after.arrayBuffers - before.arrayBuffers) / 1024 / 1024;
  return `rss=${rss.toFixed(2)}MB heap=${heap.toFixed(2)}MB arrayBuffers=${arrayBuffers.toFixed(2)}MB`;
}

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
    if (mod === 0) out.push(['GET', `/v${i % 20}/static/resource-${i}`, i]);
    else if (mod === 1) out.push(['GET', `/v${i % 20}/users/:id/items/${i}`, i]);
    else if (mod === 2) out.push(['POST', `/v${i % 20}/orgs/:org/repos/:repo/actions/${i}`, i]);
    else out.push(['GET', `/v${i % 20}/files/${i}/*path`, i]);
  }
  return out;
}

interface Scenario {
  routes: Route[];
  hits: string[];
  misses: string[];
  /**
   * Same path as one of the hits but registered under a different method.
   * Used to verify the adapter actually rejects mismatched methods rather
   * than returning the GET route for a POST request.
   */
  wrongMethod: { method: string; path: string };
}

function scenario(): Scenario {
  if (scenarioName === 'param') {
    return {
      routes: paramRoutes(),
      hits: [
        '/tenant-0/users/42/posts/7',
        '/tenant-50000/users/42/posts/7',
        '/tenant-99999/users/42/posts/7',
      ],
      misses: [
        '/tenant-x/users/42/posts/7',
      ],
      wrongMethod: { method: 'POST', path: '/tenant-0/users/42/posts/7' },
    };
  }

  if (scenarioName === 'wildcard') {
    return {
      routes: wildcardRoutes(),
      hits: [
        // Match the bucket numbering used by wildcardRoutes()
        // (`bucket-${b*1000+g}` for g in [0,1000), b in [0,100)).
        '/files/group-0/bucket-0/a.txt',
        '/files/group-500/bucket-50500/a/b/c.txt',
        '/files/group-999/bucket-99999/a/b/c.txt',
      ],
      misses: [
        '/files/group-x/bucket-0/a.txt',
      ],
      wrongMethod: { method: 'POST', path: '/files/group-0/bucket-0/a.txt' },
    };
  }

  if (scenarioName === 'mixed') {
    return {
      routes: mixedRoutes(),
      hits: [
        '/v0/static/resource-0',
        '/v1/users/42/items/50001',
        '/v19/files/99999/a/b/c.txt',
      ],
      misses: [
        '/v0/none',
      ],
      wrongMethod: { method: 'PATCH', path: '/v0/static/resource-0' },
    };
  }

  if (scenarioName !== 'static') {
    console.error(`Unknown scenario '${scenarioName}'. Choices: static, param, wildcard, mixed`);
    process.exit(1);
  }

  return {
    routes: staticRoutes(),
    hits: [
      '/api/v1/resource-0',
      '/api/v1/resource-50000',
      '/api/v1/resource-99999',
    ],
    misses: [
      '/api/v1/resource-x',
    ],
    wrongMethod: { method: 'POST', path: '/api/v1/resource-0' },
  };
}

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < 20_000; i++) fn();

  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    const result = fn();
    if (result !== undefined && result !== null) checksum++;
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
    rewritePath: (path) => rewriteWildcardTrailing(path, '/*'),
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
    rewritePath: (path) => path.replace(/\/\*([^/]+)$/, '/**:$1'),
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
};

function resolveAdapterVersion(pkg: string): string {
  if (pkg.startsWith('@zipbul/')) return 'workspace';
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
  for (const hit of sc.hits) {
    const r = match(router, 'GET', hit);
    if (r === null || r === undefined) {
      return { ok: false, reason: 'hit-returned-null', detail: hit };
    }
  }
  for (const miss of sc.misses) {
    const r = match(router, 'GET', miss);
    if (r !== null && r !== undefined) {
      return { ok: false, reason: 'miss-returned-non-null', detail: miss };
    }
  }
  const wm = match(router, sc.wrongMethod.method, sc.wrongMethod.path);
  if (wm !== null && wm !== undefined) {
    return {
      ok: false,
      reason: 'wrong-method-returned-non-null',
      detail: `${sc.wrongMethod.method} ${sc.wrongMethod.path}`,
    };
  }
  return { ok: true };
}

function measure(name: string, build: (rs: Route[]) => unknown, match: (router: unknown, method: string, path: string) => unknown): void {
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
  const rs = rewrite === undefined
    ? sc.routes
    : sc.routes.map(([m, p, v]) => [m, rewrite(p), v] as Route);
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
    console.log(
      `correctnessClass=mismatch reason=${correctness.reason} detail=${JSON.stringify(correctness.detail)}`,
    );
    return;
  }
  bench('hit first', () => match(router, 'GET', sc.hits[0]!));
  bench('hit middle', () => match(router, 'GET', sc.hits[1]!));
  bench('hit last', () => match(router, 'GET', sc.hits[2]!));
  bench('miss', () => match(router, 'GET', sc.misses[0]!));
  bench('wrong-method', () => match(router, sc.wrongMethod.method, sc.wrongMethod.path));
}

const builders: Record<string, () => void> = {
  zipbul: () => measure(
    'zipbul',
    (rs) => {
      const router = new Router<number>();
      for (const [method, path, value] of rs) router.add(method as 'GET', path, value);
      router.build();
      return router;
    },
    (router, method, path) => (router as Router<number>).match(method, path),
  ),
  'find-my-way': () => measure(
    'find-my-way',
    (rs) => {
      const router = FindMyWay();
      for (const [method, path, value] of rs) router.on(method as 'GET', path, () => value);
      return router;
    },
    (router, method, path) => (router as ReturnType<typeof FindMyWay>).find(method as 'GET', path),
  ),
  memoirist: () => measure(
    'memoirist',
    (rs) => {
      const router = new Memoirist<number>();
      for (const [method, path, value] of rs) router.add(method, path, value);
      return router;
    },
    (router, method, path) => (router as Memoirist<number>).find(method, path),
  ),
  rou3: () => measure(
    'rou3',
    (rs) => {
      const router = createRou3<number>();
      for (const [method, path, value] of rs) addRoute(router, method, path, value);
      return router;
    },
    (router, method, path) => findRoute(router as ReturnType<typeof createRou3<number>>, method, path),
  ),
  'hono-trie': () => measure(
    'hono-trie',
    (rs) => {
      const router = new TrieRouter<number>();
      for (const [method, path, value] of rs) router.add(method, path, value);
      return router;
    },
    (router, method, path) => {
      const result = (router as TrieRouter<number>).match(method, path) as unknown as [unknown[]];
      return result[0].length > 0 ? result : null;
    },
  ),
  'hono-regexp': () => measure(
    'hono-regexp',
    (rs) => {
      const router = new RegExpRouter<number>();
      for (const [method, path, value] of rs) router.add(method, path, value);
      return router;
    },
    (router, method, path) => {
      const result = (router as RegExpRouter<number>).match(method, path) as unknown as [unknown[]];
      return result[0].length > 0 ? result : null;
    },
  ),
  'koa-tree-router': () => measure(
    'koa-tree-router',
    (rs) => {
      const router = new KoaTreeRouter() as any;
      for (const [method, path, value] of rs) router.on(method, path, () => value);
      return router;
    },
    (router, method, path) => {
      const result = (router as any).find(method, path);
      return result.handle === null ? null : result;
    },
  ),
};

const run = builders[target];
if (run === undefined) {
  console.error(`Unknown baseline '${target}'. Choices: ${Object.keys(builders).join(', ')}`);
  process.exit(1);
}

console.log(`bun=${typeof Bun !== 'undefined' ? Bun.version : 'n/a'} node=${process.version} platform=${process.platform} arch=${process.arch}`);
run();
