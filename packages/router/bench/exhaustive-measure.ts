/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';
import { estimateShallowMemoryUsageOf, heapStats } from 'bun:jsc';

function gc(): void { for (let i = 0; i < 5; i++) Bun.gc(true); }
function rss(): number { gc(); return process.memoryUsage().rss / 1024 / 1024; }
function jscHeap(): number { gc(); return heapStats().heapSize / 1024 / 1024; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

const N_BIG = 100_000;
const N_MED = 10_000;
const N_SMALL = 1_000;

function makeShape(shape: string, n: number, r: Router<number>): void {
  for (let i = 0; i < n; i++) {
    if (shape === 'static')   r.add('GET', `/api/v1/r-${i}`, i);
    if (shape === 'param')    r.add('GET', `/r${i}/users/:id/posts/:postId`, i);
    if (shape === 'tenant')   r.add('GET', `/tenant-${i}/users/:id/posts/:postId`, i);
    if (shape === 'regex') {
      const re = ['(\\d+)', '([a-z]+)', '([A-Z]+)', '(\\d{2,8})'][i % 4]!;
      r.add('GET', `/r${i}/:id${re}`, i);
    }
  }
}
function hit(shape: string, n: number): string {
  const m = Math.floor(n / 2);
  if (shape === 'static') return `/api/v1/r-${m}`;
  if (shape === 'param')  return `/r${m}/users/42/posts/7`;
  if (shape === 'tenant') return `/tenant-${m}/users/42/posts/7`;
  return `/r${m}/42`;
}

async function buildAndMeasure(label: string, shape: string, n: number): Promise<void> {
  const b = rss();
  const t0 = performance.now();
  const r = new Router<number>();
  makeShape(shape, n, r);
  r.build();
  const buildMs = performance.now() - t0;
  await sleep(2000);
  const settled = rss();
  const heap = jscHeap();
  const path = hit(shape, n);
  for (let i = 0; i < 50_000; i++) r.match('GET', path);
  const s0 = performance.now();
  for (let i = 0; i < 500_000; i++) r.match('GET', path);
  const steady = ((performance.now() - s0) * 1e6) / 500_000;
  console.log(`${label.padEnd(40)} build=${buildMs.toFixed(0).padStart(4)}ms rss=${(settled - b).toFixed(0).padStart(3)}MB heap=${heap.toFixed(0).padStart(3)}MB steady=${steady.toFixed(1).padStart(5)}ns`);
}

const argShape = process.argv[2] ?? 'tenant';
const argN = parseInt(process.argv[3] ?? `${N_BIG}`, 10);
const argLabel = process.argv[4] ?? `${argShape}-${argN}`;
await buildAndMeasure(argLabel, argShape, argN);

void N_MED; void N_SMALL; void estimateShallowMemoryUsageOf;
