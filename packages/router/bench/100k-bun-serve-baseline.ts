/* eslint-disable no-console */

import { performance } from 'node:perf_hooks';

import { fmtMem, mem, median, printEnv, settleScavenger } from './helpers';

const COUNT = 100_000;
const ITER = 2_000;
const WARM_RUNS = 3;

// Phase split per ULT §13 Phase 8 line 2493-2494: route prep, serve init,
// first request, warmed request — each emits its own latency line so a
// regression can be classified by phase rather than collapsed into a
// single end-to-end number.
const SERVE_BUILD_TIMEOUT_MS = 60_000;
const SERVE_MEM_CAP_MB = 2_048;

printEnv();
console.log(`buildTimeoutMs=${SERVE_BUILD_TIMEOUT_MS} memCapMB=${SERVE_MEM_CAP_MB}`);
console.log(`preparing routes=${COUNT}`);

settleScavenger();
const before = mem();
const prepStart = performance.now();
const routes: Record<string, Response> = {};

for (let i = 0; i < COUNT; i++) {
  routes[`/api/v1/resource-${i}`] = new Response(String(i));
}
const prepMs = performance.now() - prepStart;
settleScavenger();
const afterPrep = mem();
console.log(`routes object prepared prep=${prepMs.toFixed(2)}ms mem=${fmtMem(before, afterPrep)}`);

function startServer(): { server: ReturnType<typeof Bun.serve>; buildMs: number } {
  const t0 = performance.now();
  const s = Bun.serve({
    port: 0,
    routes,
    fetch() {
      return new Response('miss', { status: 404 });
    },
  });
  return { server: s, buildMs: performance.now() - t0 };
}

console.log('starting Bun.serve');
let { server, buildMs } = startServer();
settleScavenger();
const after = mem();

if (buildMs > SERVE_BUILD_TIMEOUT_MS) {
  console.log(`init=${buildMs.toFixed(2)}ms timeoutClass=serve-init exceeded ${SERVE_BUILD_TIMEOUT_MS}ms`);
  server.stop(true);
  process.exit(1);
}
if (after.rss / 1024 / 1024 > SERVE_MEM_CAP_MB) {
  console.log(`init=${buildMs.toFixed(2)}ms memCapClass=exceeded rss=${(after.rss / 1024 / 1024).toFixed(2)}MB`);
  server.stop(true);
  process.exit(1);
}

console.log(
  `Bun.serve routes=${COUNT} init=${buildMs.toFixed(2)}ms initMem=${fmtMem(afterPrep, after)} totalMem=${fmtMem(before, after)} port=${server.port}`,
);

async function firstRequest(path: string): Promise<{ usFirst: number; statusFirst: number }> {
  // Cold first request: no warmup loop. Measures connection setup +
  // server first-route-hit cost.
  const start = performance.now();
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
  const status = res.status;
  await res.text();
  const usFirst = (performance.now() - start) * 1000;
  return { usFirst, statusFirst: status };
}

async function warmedRequest(path: string): Promise<{ usAvg: number; checksum: number }> {
  // Warmed request loop: 100 warmup hits so JIT and connection state are
  // stable, then ITER measurements. Body must be consumed every loop so
  // the warmup walks the same code path as the timed loop below
  // (skipping .text() leaves connection drain incomplete and biases the
  // measured loop's first iterations).
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
    await res.text();
  }

  const start = performance.now();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
    checksum += res.status;
    await res.text();
  }
  const usAvg = ((performance.now() - start) * 1000) / ITER;
  return { usAvg, checksum };
}

let restartCount = 0;
let restartTotalMs = 0;
async function restartServer(): Promise<void> {
  server.stop(true);
  const { server: s, buildMs: ms } = startServer();
  server = s;
  restartCount++;
  restartTotalMs += ms;
}

async function benchPhases(path: string): Promise<void> {
  // Fresh server before cold measurement so cold isn't contaminated by
  // prior path's warm state (JIT, connection cache).
  await restartServer();
  const cold = await firstRequest(path);

  // Fresh server before each warm run so WARM_RUNS variance reflects
  // independent measurements, not the same JIT/conn cache observed
  // multiple times.
  const warmMeans: number[] = [];
  let warmChecksum = 0;
  for (let i = 0; i < WARM_RUNS; i++) {
    await restartServer();
    const w = await warmedRequest(path);
    warmMeans.push(w.usAvg);
    warmChecksum = w.checksum;
  }
  // WARM_RUNS=3 → p99 collapses to max; report only median/min/max.
  console.log(
    `${path.padEnd(28)} firstRequest=${cold.usFirst.toFixed(2)}us status=${cold.statusFirst}` +
      ` warmedRuns=${WARM_RUNS} warmedMedian=${median(warmMeans).toFixed(2)}us` +
      ` warmedMin=${Math.min(...warmMeans).toFixed(2)}us` +
      ` warmedMax=${Math.max(...warmMeans).toFixed(2)}us checksum=${warmChecksum}`,
  );
}

try {
  await benchPhases('/api/v1/resource-0');
  await benchPhases(`/api/v1/resource-${Math.floor(COUNT / 2)}`);
  await benchPhases(`/api/v1/resource-${COUNT - 1}`);
  await benchPhases('/api/v1/resource-x');
} finally {
  server.stop(true);
}
const restartMean = restartCount > 0 ? restartTotalMs / restartCount : 0;
console.log(
  `serverRestarts=${restartCount} restartTotalMs=${restartTotalMs.toFixed(2)} ` + `restartMeanMs=${restartMean.toFixed(2)}`,
);
