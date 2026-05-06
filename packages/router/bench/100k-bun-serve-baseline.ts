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

console.log(`bun=${Bun.version} node=${process.version} platform=${process.platform} arch=${process.arch}`);
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

console.log(`Bun.serve routes=${COUNT} init=${buildMs.toFixed(2)}ms initMem=${fmtMem(afterPrep, after)} totalMem=${fmtMem(before, after)} port=${server.port}`);

async function bench(path: string): Promise<void> {
  for (let i = 0; i < 100; i++) await fetch(`http://127.0.0.1:${server.port}${path}`);

  const start = performance.now();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    const res = await fetch(`http://127.0.0.1:${server.port}${path}`);
    checksum += res.status;
    await res.text();
  }
  const us = ((performance.now() - start) * 1000) / ITER;
  console.log(`${path.padEnd(28)} ${us.toFixed(2)} us/request checksum=${checksum}`);
}

try {
  await bench('/api/v1/resource-0');
  await bench(`/api/v1/resource-${Math.floor(COUNT / 2)}`);
  await bench(`/api/v1/resource-${COUNT - 1}`);
  await bench('/api/v1/resource-x');
} finally {
  server.stop(true);
}
