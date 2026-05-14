/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';
import { estimateShallowMemoryUsageOf } from 'bun:jsc';

function rss(): number { for (let i = 0; i < 5; i++) Bun.gc(true); return process.memoryUsage().rss / 1024 / 1024; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

const N = 100_000;

// === Area 1: paramsFactories dedup
async function a1(): Promise<void> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/users/:id/posts/:postId`, i);
  r.build();
  const snap = (r as any)[ROUTER_INTERNALS_KEY].registration.snapshot;
  const factories = snap.paramsFactories;
  let nonNull = 0;
  const unique = new Set<any>();
  for (const f of factories) { if (f) { nonNull++; unique.add(f); } }
  const perFactory = unique.size > 0 ? estimateShallowMemoryUsageOf([...unique][0]!) : 0;
  console.log(`[1] paramsFactories: total=${factories.length} nonNull=${nonNull} unique=${unique.size} dedup=${(nonNull / unique.size).toFixed(1)}× per-factory~${perFactory}B unique-mem=${(perFactory * unique.size / 1024).toFixed(0)}KB`);
}

// === Area 2: matchState.paramOffsets actual size
async function a2(): Promise<void> {
  for (const shape of ['static', 'param', 'tenant', 'regex'] as const) {
    const r = new Router<number>();
    for (let i = 0; i < N; i++) {
      if (shape === 'static') r.add('GET', `/api/r-${i}`, i);
      else if (shape === 'param') r.add('GET', `/r${i}/u/:id/p/:pid`, i);
      else if (shape === 'tenant') r.add('GET', `/t-${i}/u/:id/p/:pid`, i);
      else r.add('GET', `/r${i}/:id(\\d+)`, i);
    }
    r.build();
    const snap = (r as any)[ROUTER_INTERNALS_KEY].registration.snapshot;
    console.log(`[2] ${shape.padEnd(8)} maxParamsObserved=${snap.maxParamsObserved}  paramOffsets-slots=${snap.maxParamsObserved * 2 + 2}  bytes=${(snap.maxParamsObserved * 2 + 2) * 4}`);
  }
}

// === Area 3: testerCache dedup ratio
async function a3(): Promise<void> {
  const shapes = ['(\\d+)', '([a-z]+)', '([A-Z]+)', '(\\d{2,8})'];
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/:id${shapes[i % shapes.length]!}`, i);
  r.build();
  const snap = (r as any)[ROUTER_INTERNALS_KEY].registration.snapshot;
  console.log(`[3] regex routes=${N} unique-regex-shapes=4 anyTester=${snap.anyTester}`);
}

// === Area 4: cacheSize sweep (steady when cache misses)
async function a4(): Promise<void> {
  for (const size of [10, 100, 1000, 10000]) {
    const r = new Router<number>({ cacheSize: size });
    for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
    r.build();
    // Use unique paths each call to force cache churn
    let ns = 0;
    for (let it = 0; it < 50_000; it++) r.match('GET', `/r${it % N}/u/42/p/7`);
    const t0 = performance.now();
    for (let it = 0; it < 200_000; it++) r.match('GET', `/r${it % N}/u/42/p/7`);
    ns = ((performance.now() - t0) * 1e6) / 200_000;
    console.log(`[4] cacheSize=${size.toString().padStart(5)}  steady-churn=${ns.toFixed(1)}ns`);
  }
}

// === Area 5: decoder allocation (% match where decoder is called)
async function a5(): Promise<void> {
  // decoder is called when matching :param against URL — substring + decodeURIComponent fallback
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id`, i);
  r.build();
  const plainPath = `/r0/u/42`;
  const encodedPath = `/r0/u/hello%20world`;
  for (let i = 0; i < 50_000; i++) r.match('GET', plainPath);
  let t0 = performance.now();
  for (let i = 0; i < 500_000; i++) r.match('GET', plainPath);
  const plainNs = ((performance.now() - t0) * 1e6) / 500_000;
  for (let i = 0; i < 50_000; i++) r.match('GET', encodedPath);
  t0 = performance.now();
  for (let i = 0; i < 500_000; i++) r.match('GET', encodedPath);
  const encodedNs = ((performance.now() - t0) * 1e6) / 500_000;
  console.log(`[5] decoder: plain=${plainNs.toFixed(1)}ns  encoded=${encodedNs.toFixed(1)}ns  overhead=${(encodedNs - plainNs).toFixed(1)}ns`);
}

// === Area 6: path normalize cost (canonical vs needs-trim/lower)
async function a6(): Promise<void> {
  const r = new Router<number>({ trailingSlash: 'ignore', pathCaseSensitive: false });
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id`, i);
  r.build();
  const canon = `/r0/u/42`;
  const slash = `/r0/u/42/`;
  const mixed = `/R0/U/42`;
  for (let i = 0; i < 50_000; i++) r.match('GET', canon);
  let t0 = performance.now();
  for (let i = 0; i < 500_000; i++) r.match('GET', canon);
  const canonNs = ((performance.now() - t0) * 1e6) / 500_000;
  for (let i = 0; i < 50_000; i++) r.match('GET', slash);
  t0 = performance.now();
  for (let i = 0; i < 500_000; i++) r.match('GET', slash);
  const slashNs = ((performance.now() - t0) * 1e6) / 500_000;
  for (let i = 0; i < 50_000; i++) r.match('GET', mixed);
  t0 = performance.now();
  for (let i = 0; i < 500_000; i++) r.match('GET', mixed);
  const mixedNs = ((performance.now() - t0) * 1e6) / 500_000;
  console.log(`[6] normalize: canon=${canonNs.toFixed(1)}ns  slash=${slashNs.toFixed(1)}ns  mixed=${mixedNs.toFixed(1)}ns`);
}

// === Area 7: terminalSlab — measure size + alt
async function a7(): Promise<void> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
  r.build();
  const snap = (r as any)[ROUTER_INTERNALS_KEY].registration.snapshot;
  const slabBytes = snap.terminalSlab.byteLength;
  const slabEntries = snap.terminalSlab.length / 2;
  console.log(`[7] terminalSlab: entries=${slabEntries} bytes=${(slabBytes / 1024).toFixed(0)}KB (Int32×2 per entry)`);
}

// === Area 8: cache RouterCache instance per method
async function a8(): Promise<void> {
  const r = new Router<number>();
  r.add('GET', '/r/:id', 1);
  r.add('POST', '/r/:id', 2);
  r.build();
  // Probe cache after misses
  for (let i = 0; i < 500; i++) r.match('GET', `/r/${i}`);
  for (let i = 0; i < 500; i++) r.match('POST', `/r/${i}`);
  const before = rss();
  await sleep(500);
  const settled = rss();
  console.log(`[8] cache present: rss-after-500-cache-fills=${(settled - before).toFixed(1)}MB`);
}

// === Area 9: build-stage Object.freeze cost (already in build)
async function a9(): Promise<void> {
  // Compare 100k build with vs without trees freeze (mutate)
  const tBase: number[] = [];
  for (let s = 0; s < 5; s++) {
    const r = new Router<number>();
    for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
    const t0 = performance.now();
    r.build();
    tBase.push(performance.now() - t0);
  }
  tBase.sort((a, b) => a - b);
  console.log(`[9] build median=${tBase[2]!.toFixed(0)}ms (5 runs at 100k param)`);
}

// === Area 10: emitter new Function() cost
async function a10(): Promise<void> {
  // Build small router (codegen will fire)
  const small: number[] = [];
  for (let s = 0; s < 20; s++) {
    const r = new Router<number>();
    for (let i = 0; i < 50; i++) r.add('GET', `/r${i}/u/:id`, i);
    const t0 = performance.now();
    r.build();
    small.push(performance.now() - t0);
  }
  small.sort((a, b) => a - b);
  console.log(`[10] build N=50 (codegen success path) median=${small[10]!.toFixed(2)}ms`);
}

console.log('15-area exhaustive measurement:');
await a1(); await a2(); await a3(); await a4(); await a5();
await a6(); await a7(); await a8(); await a9(); await a10();
