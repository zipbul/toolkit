/* eslint-disable no-console */

import { performance } from 'node:perf_hooks';

import { Router } from '../src/router';
import { fmtMem, mem, printEnv, settleScavenger } from './helpers';

type Route = [method: string, path: string, value: number];
type Scenario = {
  name: string;
  routes: Route[];
  hits: Array<[method: string, path: string]>;
  misses: Array<[method: string, path: string]>;
};

const COUNT = 100_000;
const ITER = 500_000;
// argv is an internal worker-mode IPC: when 100k-gate-runner.ts spawns
// this file with a scenario name, only that scenario runs. End users
// just `bun bench/100k-verification.ts` and get the full suite.
const scenarioFilter = process.argv[2] ?? 'all';

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < 20_000; i++) {fn();}

  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    if (fn() !== null) {checksum++;}
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
  settleScavenger();
  const after = mem();

  return { router, buildMs, memDelta: fmtMem(before, after) };
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
    if (mod === 0) {routes.push(['GET', `/v${i % 20}/static/resource-${i}`, i]);}
    else if (mod === 1) {routes.push(['GET', `/v${i % 20}/users/:id/items/${i}`, i]);}
    else if (mod === 2) {routes.push(['POST', `/v${i % 20}/orgs/:org/repos/:repo/actions/${i}`, i]);}
    else {routes.push(['GET', `/v${i % 20}/files/${i}/*path`, i]);}
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
  // Uses 4 distinct regex shapes per group to exercise sibling logic.
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

// Real cache-churn measurement lives in cacheTraversalFeasibility() below
// (unique-ish path per call defeats the cache). A fixed-hit/fixed-miss
// scenario at this scale would just duplicate paramScenario().

function wildcardConflictFeasibility(): void {
  console.log('\n## wildcard conflict feasibility');
  const sizes = [1_000, 5_000, 10_000, 25_000, 50_000];
  for (const size of sizes) {
    const routes: Route[] = [];
    for (let i = 0; i < size; i++) {routes.push(['GET', `/wc/${i}/*path`, i]);}
    for (let i = 0; i < size; i++) {routes.push(['GET', `/static/${i}/leaf`, i]);}
    const { buildMs, memDelta } = buildZipbul(routes);
    console.log(
      `disjoint wildcards=${size} statics=${size} routes=${routes.length} add+build=${buildMs.toFixed(2)}ms mem=${memDelta}`,
    );
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
    const { buildMs, memDelta } = buildZipbul(scenario.routes);
    console.log(
      `${scenario.name.padEnd(34)} routes=${String(scenario.routes.length).padStart(6)} add+build=${buildMs.toFixed(2)}ms mem=${memDelta}`,
    );
  }
}

function cacheTraversalFeasibility(): void {
  console.log('\n## cache traversal feasibility');
  const scenario = paramScenario();
  const built = buildZipbul(scenario.routes);
  console.log(`build=${built.buildMs.toFixed(2)}ms mem=${built.memDelta}`);

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

  // Settle libpas pages from the previous scenario so this scenario's
  // RSS baseline isn't inflated by the prior shape's transient frees.
  settleScavenger();

  const built = buildZipbul(scenario.routes);
  console.log(`build=${built.buildMs.toFixed(2)}ms mem=${built.memDelta}`);

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

async function main(): Promise<void> {
  printEnv();

  const scenarios = [
    staticScenario(),
    paramScenario(),
    mixedScenario(),
    highFanoutScenario(),
    versionedApiScenario(),
    wildcardHeavyScenario(),
    regexHeavyScenario(),
  ];

  for (const scenario of scenarios) {
    if (scenarioFilter !== 'all' && scenario.name !== scenarioFilter) {continue;}
    runScenario(scenario);
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
