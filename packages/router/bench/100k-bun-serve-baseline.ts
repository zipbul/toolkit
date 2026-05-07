/* eslint-disable no-console */

import { performance } from 'node:perf_hooks';

const COUNT = Number(process.argv[2] ?? 100_000);
const ITER = 2_000;

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

// Phase split per ULT §13 Phase 8 line 2493-2494: route prep, serve init,
// first request, warmed request — each emits its own latency line so a
// regression can be classified by phase rather than collapsed into a
// single end-to-end number.
const SERVE_BUILD_TIMEOUT_MS = 60_000;
const SERVE_MEM_CAP_MB = 2_048;

console.log(`bun=${Bun.version} node=${process.version} platform=${process.platform} arch=${process.arch}`);
console.log(`buildTimeoutMs=${SERVE_BUILD_TIMEOUT_MS} memCapMB=${SERVE_MEM_CAP_MB}`);
console.log(`preparing routes=${COUNT}`);

const before = mem();
const prepStart = performance.now();
const routes: Record<string, Response> = {};

for (let i = 0; i < COUNT; i++) {
  routes[`/api/v1/resource-${i}`] = new Response(String(i));
}
const afterPrep = mem();
const prepMs = performance.now() - prepStart;
console.log(`routes object prepared prep=${prepMs.toFixed(2)}ms mem=${fmtMem(before, afterPrep)}`);

const buildStart = performance.now();
console.log('starting Bun.serve');
const server = Bun.serve({
  port: 0,
  routes,
  fetch() {
    return new Response('miss', { status: 404 });
  },
});
const buildMs = performance.now() - buildStart;
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

console.log(`Bun.serve routes=${COUNT} init=${buildMs.toFixed(2)}ms initMem=${fmtMem(afterPrep, after)} totalMem=${fmtMem(before, after)} port=${server.port}`);

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
  // stable, then ITER measurements. Reported value is the post-warmup
  // average per-request latency.
  for (let i = 0; i < 100; i++) await fetch(`http://127.0.0.1:${server.port}${path}`);

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

async function benchPhases(path: string): Promise<void> {
  const cold = await firstRequest(path);
  const warm = await warmedRequest(path);
  console.log(
    `${path.padEnd(28)} firstRequest=${cold.usFirst.toFixed(2)}us status=${cold.statusFirst}` +
    ` warmedAvg=${warm.usAvg.toFixed(2)}us checksum=${warm.checksum}`,
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
