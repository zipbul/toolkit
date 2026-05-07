/* eslint-disable no-console */

import { performance } from 'node:perf_hooks';

import { ROUTER_INTERNALS_KEY, Router } from '../src/router';

type Route = [method: string, path: string, value: number];
type Scenario = {
  name: string;
  routes: Route[];
  hits: Array<[method: string, path: string]>;
  misses: Array<[method: string, path: string]>;
};

const COUNT = 100_000;
const ITER = 500_000;
const scenarioFilter = process.argv[2] ?? 'all';

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

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < 20_000; i++) fn();

  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    if (fn() !== null) checksum++;
  }
  const end = nowNs();
  const ns = Number(end - start) / ITER;

  console.log(`${name.padEnd(36)} ${ns.toFixed(2).padStart(10)} ns/op checksum=${checksum}`);
}

function buildZipbul(routes: Route[]): { router: Router<number>; buildMs: number; memDelta: string } {
  const before = mem();
  const router = new Router<number>();
  const addStart = performance.now();

  for (const [method, path, value] of routes) {
    router.add(method as 'GET', path, value);
  }

  router.build();
  const buildMs = performance.now() - addStart;
  const after = mem();

  return { router, buildMs, memDelta: fmtMem(before, after) };
}

function printDiagnostics(router: Router<number>): void {
  const diagnostics = (router as any)[ROUTER_INTERNALS_KEY]?.registration?.getDiagnostics?.();
  if (diagnostics !== null && diagnostics !== undefined) {
    console.log(`diagnostics=${JSON.stringify(diagnostics)}`);
  }
}

function staticScenario(): Scenario {
  const routes: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    routes.push(['GET', `/api/v1/resource-${i}`, i]);
  }

  return {
    name: '100k static',
    routes,
    hits: [
      ['GET', '/api/v1/resource-0'],
      ['GET', '/api/v1/resource-50000'],
      ['GET', '/api/v1/resource-99999'],
    ],
    misses: [
      ['GET', '/api/v1/resource-x'],
      ['POST', '/api/v1/resource-50000'],
    ],
  };
}

function paramScenario(): Scenario {
  const routes: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    routes.push(['GET', `/tenant-${i}/users/:id/posts/:postId`, i]);
  }

  return {
    name: '100k param',
    routes,
    hits: [
      ['GET', '/tenant-0/users/42/posts/7'],
      ['GET', '/tenant-50000/users/42/posts/7'],
      ['GET', '/tenant-99999/users/42/posts/7'],
    ],
    misses: [
      ['GET', '/tenant-x/users/42/posts/7'],
      ['POST', '/tenant-50000/users/42/posts/7'],
    ],
  };
}

function mixedScenario(): Scenario {
  const routes: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    const mod = i % 4;
    if (mod === 0) routes.push(['GET', `/v${i % 20}/static/resource-${i}`, i]);
    else if (mod === 1) routes.push(['GET', `/v${i % 20}/users/:id/items/${i}`, i]);
    else if (mod === 2) routes.push(['POST', `/v${i % 20}/orgs/:org/repos/:repo/actions/${i}`, i]);
    else routes.push(['GET', `/v${i % 20}/files/${i}/*path`, i]);
  }

  return {
    name: '100k mixed',
    routes,
    hits: [
      ['GET', '/v0/static/resource-0'],
      ['GET', '/v1/users/42/items/50001'],
      ['POST', '/v2/orgs/acme/repos/core/actions/50002'],
      ['GET', '/v19/files/99999/a/b/c.txt'],
    ],
    misses: [
      ['GET', '/v0/none'],
      ['PATCH', '/v0/static/resource-0'],
    ],
  };
}

function highFanoutScenario(): Scenario {
  const routes: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    routes.push(['GET', `/root/child-${i}`, i]);
  }

  return {
    name: '100k high-fanout',
    routes,
    hits: [
      ['GET', '/root/child-0'],
      ['GET', '/root/child-50000'],
      ['GET', '/root/child-99999'],
    ],
    misses: [
      ['GET', '/root/nope'],
      ['POST', '/root/child-50000'],
    ],
  };
}

function versionedApiScenario(): Scenario {
  const routes: Route[] = [];
  const methods = ['GET', 'POST', 'PATCH', 'DELETE'] as const;
  for (let i = 0; i < COUNT; i++) {
    routes.push([
      methods[i % methods.length]!,
      `/api/v${i % 50}/tenants/tenant-${i % 1000}/users/:user/posts/${i}/comments/:comment`,
      i,
    ]);
  }

  return {
    name: '100k versioned-api',
    routes,
    hits: [
      ['GET', '/api/v0/tenants/tenant-0/users/u1/posts/0/comments/c1'],
      ['POST', '/api/v1/tenants/tenant-1/users/u1/posts/50001/comments/c1'],
      ['DELETE', '/api/v49/tenants/tenant-999/users/u1/posts/99999/comments/c1'],
    ],
    misses: [
      ['GET', '/api/v0/tenants/nope/users/u1/posts/0/comments/c1'],
      ['PUT', '/api/v0/tenants/tenant-0/users/u1/posts/0/comments/c1'],
    ],
  };
}

function wildcardHeavyScenario(): Scenario {
  const routes: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    routes.push(['GET', `/files/group-${i % 1000}/bucket-${i}/*path`, i]);
  }

  return {
    name: '100k wildcard-heavy',
    routes,
    hits: [
      ['GET', '/files/group-0/bucket-0/a.txt'],
      ['GET', '/files/group-0/bucket-50000/a/b/c.txt'],
      ['GET', '/files/group-999/bucket-99999/a/b/c.txt'],
    ],
    misses: [
      ['GET', '/files/group-0/nope/a.txt'],
      ['POST', '/files/group-0/bucket-0/a.txt'],
    ],
  };
}

function regexHeavyScenario(): Scenario {
  // 100k routes where each segment uses a constrained regex param.
  // Stresses regex compilation, sibling disjointness, and tester cache.
  // Uses 4 distinct regex shapes per group to exercise sibling logic without
  // exploding past maxRegexSiblingsPerSegment=32.
  const routes: Route[] = [];
  const shapes = ['(\\d+)', '([a-z]+)', '([A-Z]+)', '(\\d{2,8})'];
  for (let i = 0; i < COUNT; i++) {
    const shape = shapes[i % shapes.length]!;
    routes.push(['GET', `/r${i}/:id${shape}`, i]);
  }
  return {
    name: '100k regex-heavy',
    routes,
    hits: [
      ['GET', '/r0/123'],
      ['GET', '/r50001/abc'],
      ['GET', '/r99998/XYZ'],
    ],
    misses: [
      ['GET', '/r0/!!!'],
      ['POST', '/r0/123'],
    ],
  };
}

function churnScenario(): Scenario {
  // 100k param routes; hits/misses use unique paths each call to force
  // cache eviction churn. Probes cycle through 100k unique IDs (10× cacheSize).
  const routes: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    routes.push(['GET', `/c-${i}/u/:id`, i]);
  }
  // Hits/misses are sampled across the full key space to maximize churn.
  return {
    name: '100k churn',
    routes,
    hits: [
      ['GET', '/c-0/u/1'],
      ['GET', '/c-50000/u/9999'],
      ['GET', '/c-99999/u/424242'],
    ],
    misses: [
      ['GET', '/c-x/u/1'],
      ['GET', '/c-0/zzz/1'],
    ],
  };
}

function wildcardConflictFeasibility(): void {
  console.log('\n## wildcard conflict feasibility');
  const sizes = [1_000, 5_000, 10_000, 25_000, 50_000];
  for (const size of sizes) {
    const routes: Route[] = [];
    for (let i = 0; i < size; i++) routes.push(['GET', `/wc/${i}/*path`, i]);
    for (let i = 0; i < size; i++) routes.push(['GET', `/static/${i}/leaf`, i]);
    const { router, buildMs, memDelta } = buildZipbul(routes);
    console.log(`disjoint wildcards=${size} statics=${size} routes=${routes.length} add+build=${buildMs.toFixed(2)}ms mem=${memDelta}`);
    printDiagnostics(router);
  }
}

function mixedPhaseProxy(): void {
  console.log('\n## mixed phase proxy');

  const scenarios: Scenario[] = [
    {
      name: 'proxy 25k mixed-static-only',
      routes: mixedScenario().routes.filter(([, path]) => path.includes('/static/')),
      hits: [],
      misses: [],
    },
    {
      name: 'proxy 25k mixed-get-param-only',
      routes: mixedScenario().routes.filter(([method, path]) => method === 'GET' && path.includes('/users/')),
      hits: [],
      misses: [],
    },
    {
      name: 'proxy 25k mixed-post-param-only',
      routes: mixedScenario().routes.filter(([method, path]) => method === 'POST' && path.includes('/orgs/')),
      hits: [],
      misses: [],
    },
    {
      name: 'proxy 25k mixed-wildcard-only',
      routes: mixedScenario().routes.filter(([, path]) => path.includes('/files/')),
      hits: [],
      misses: [],
    },
    mixedScenario(),
  ];

  for (const scenario of scenarios) {
    const { router, buildMs, memDelta } = buildZipbul(scenario.routes);
    console.log(`${scenario.name.padEnd(34)} routes=${String(scenario.routes.length).padStart(6)} add+build=${buildMs.toFixed(2)}ms mem=${memDelta}`);
    printDiagnostics(router);
  }
}

function cacheTraversalFeasibility(): void {
  console.log('\n## cache traversal feasibility');
  const scenario = paramScenario();
  const built = buildZipbul(scenario.routes);
  console.log(`build=${built.buildMs.toFixed(2)}ms mem=${built.memDelta}`);
  printDiagnostics(built.router);

  const hotPath = '/tenant-50000/users/42/posts/7';
  bench('cache-hot dynamic same path', () => built.router.match('GET', hotPath));

  let seq = 0;
  bench('cache-churn dynamic unique-ish', () => {
    seq = (seq + 1) % 100_000;
    return built.router.match('GET', `/tenant-${seq}/users/42/posts/7`);
  });

  seq = 0;
  bench('wrong-method dynamic unique-ish', () => {
    seq = (seq + 1) % 100_000;
    return built.router.match('POST', `/tenant-${seq}/users/42/posts/7`);
  });

  seq = 0;
  bench('404 dynamic unique-ish', () => {
    seq = (seq + 1) % 100_000;
    return built.router.match('GET', `/tenant-x-${seq}/users/42/posts/7`);
  });
}

function runScenario(scenario: Scenario): void {
  console.log(`\n## ${scenario.name}`);
  console.log(`routes=${scenario.routes.length}`);

  const built = buildZipbul(scenario.routes);
  console.log(`build=${built.buildMs.toFixed(2)}ms mem=${built.memDelta}`);
  printDiagnostics(built.router);

  for (const [method, path] of scenario.hits) {
    const firstStart = nowNs();
    const first = built.router.match(method as 'GET', path);
    const firstNs = Number(nowNs() - firstStart);
    console.log(`first ${method} ${path} => ${first === null ? 'miss' : 'hit'} ${firstNs}ns`);
    bench(`hit ${method} ${path.slice(0, 24)}`, () => built.router.match(method as 'GET', path));
  }

  for (const [method, path] of scenario.misses) {
    bench(`miss ${method} ${path.slice(0, 23)}`, () => built.router.match(method as 'GET', path));
  }
}

function candidateMicrobench(): void {
  console.log('\n## candidate microbench');

  const path = '/api/v1/resource-50000';
  const methodCode = Object.create(null) as Record<string, number>;
  methodCode.GET = 0;
  methodCode.POST = 1;

  const methodFirst = [Object.create(null), Object.create(null)] as Array<Record<string, number>>;
  methodFirst[0]![path] = 1;
  const pathFirst = Object.create(null) as Record<string, Int32Array>;
  const arr = new Int32Array(8).fill(-1);
  arr[0] = 1;
  pathFirst[path] = arr;

  const staticBucket = Object.create(null) as Record<string, number>;
  staticBucket[path] = 1;
  const hitCache = new Map<string, number>();
  hitCache.set(path, 1);
  const missCache = new Set<string>();

  bench('method-first static table', () => methodFirst[methodCode.GET]![path] ?? null);
  bench('path-first method array', () => pathFirst[path]?.[methodCode.GET] ?? null);
  bench('static-first then cache', () => staticBucket[path] ?? hitCache.get(path) ?? null);
  bench('cache-first then static', () => hitCache.get(path) ?? staticBucket[path] ?? null);
  bench('miss-cache check then static', () => missCache.has(path) ? null : staticBucket[path] ?? null);

  const url = '/tenant-50000/users/42/posts/7';
  bench('indexOf segment scan', () => {
    let pos = 1;
    let count = 0;
    while (pos < url.length) {
      const end = url.indexOf('/', pos);
      if (end === -1) return count + url.length;
      count += end;
      pos = end + 1;
    }
    return count;
  });
  bench('manual segment scan', () => {
    let count = 0;
    for (let i = 1; i < url.length; i++) {
      if (url.charCodeAt(i) === 47) count += i;
    }
    return count;
  });
}

async function tryUrlPatternBaseline(): Promise<void> {
  console.log('\n## URLPattern baseline feasibility');
  const routes = staticScenario().routes;
  const before = mem();
  const start = performance.now();
  try {
    const patterns = routes.map(([, path, value]) => ({ pattern: new URLPattern({ pathname: path }), value }));
    const buildMs = performance.now() - start;
    const after = mem();
    console.log(`URLPattern build ok count=${patterns.length} build=${buildMs.toFixed(2)}ms mem=${fmtMem(before, after)}`);
    const target = '/api/v1/resource-99999';
    const iterations = 1_000;
    for (let i = 0; i < 100; i++) {
      for (const entry of patterns) {
        if (entry.pattern.test({ pathname: target })) break;
      }
    }
    const scanStart = nowNs();
    let checksum = 0;
    for (let i = 0; i < iterations; i++) {
      for (const entry of patterns) {
        if (entry.pattern.test({ pathname: target })) {
          checksum += entry.value;
          break;
        }
      }
    }
    const scanNs = Number(nowNs() - scanStart) / iterations;
    console.log(`URLPattern linear last ${scanNs.toFixed(2)} ns/op checksum=${checksum}`);
  } catch (error) {
    console.log(`URLPattern build failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  console.log(`bun=${typeof Bun !== 'undefined' ? Bun.version : 'n/a'}`);
  console.log(`node=${process.version}`);
  console.log(`platform=${process.platform} arch=${process.arch}`);

  const scenarios = [
    staticScenario(),
    paramScenario(),
    mixedScenario(),
    highFanoutScenario(),
    versionedApiScenario(),
    wildcardHeavyScenario(),
    regexHeavyScenario(),
    churnScenario(),
  ];

  for (const scenario of scenarios) {
    if (scenarioFilter !== 'all' && scenario.name !== scenarioFilter) continue;
    runScenario(scenario);
  }

  if (scenarioFilter === 'all' || scenarioFilter === 'candidates') {
    candidateMicrobench();
    await tryUrlPatternBaseline();
  }

  if (scenarioFilter === 'all' || scenarioFilter === 'wildcard-conflict-feasibility') {
    wildcardConflictFeasibility();
  }

  if (scenarioFilter === 'all' || scenarioFilter === 'mixed-phase-proxy') {
    mixedPhaseProxy();
  }

  if (scenarioFilter === 'all' || scenarioFilter === 'cache-traversal-feasibility') {
    cacheTraversalFeasibility();
  }
}

await main();
