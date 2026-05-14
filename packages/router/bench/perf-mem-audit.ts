/* eslint-disable no-console */
/**
 * Fact-check the perf/memory claims the codebase makes today:
 *   (1) 100k settled RSS across 6 scenarios — wait for libpas scavenger
 *   (2) tenant-factor on vs off  — comment claims RSS 220→50MB at 100k
 *   (3) compactSegmentTree on vs off — chain compression effect
 *   (4) build time across 1k/10k/100k for each scenario
 *   (5) steady-state match ns for each scenario
 *   (6) first-call latency for each scenario
 *
 * Reports settled RSS at +1500ms after build so libpas has decommitted
 * orphan pages — that is the number production sees, not the immediate
 * post-GC peak.
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

type Shape = 'static' | 'param' | 'tenant' | 'mixed' | 'wildcard' | 'regex';

function gcSync(): void { if (typeof Bun !== 'undefined') for (let i = 0; i < 5; i++) Bun.gc(true); }
function rssMb(): number { gcSync(); return process.memoryUsage().rss / 1024 / 1024; }
function heapMb(): number { gcSync(); return process.memoryUsage().heapUsed / 1024 / 1024; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function makeRoutes(shape: Shape, n: number): Array<[method: string, path: string, value: number]> {
  const out: Array<[string, string, number]> = [];
  for (let i = 0; i < n; i++) {
    if (shape === 'static')   out.push(['GET', `/api/v1/resource-${i}`, i]);
    if (shape === 'param')    out.push(['GET', `/r${i}/users/:id/posts/:postId`, i]);
    if (shape === 'tenant')   out.push(['GET', `/tenant-${i}/users/:id/posts/:postId`, i]);
    if (shape === 'mixed') {
      const mod = i % 4;
      if (mod === 0) out.push(['GET',  `/v${i % 20}/static/r-${i}`, i]);
      else if (mod === 1) out.push(['GET',  `/v${i % 20}/users/:id/items/${i}`, i]);
      else if (mod === 2) out.push(['POST', `/v${i % 20}/orgs/:org/repos/:repo/actions/${i}`, i]);
      else out.push(['GET',  `/v${i % 20}/files/${i}/*path`, i]);
    }
    if (shape === 'wildcard') out.push(['GET', `/files/g${i % 1000}/b-${i}/*path`, i]);
    if (shape === 'regex') {
      const re = ['(\\d+)', '([a-z]+)', '([A-Z]+)', '(\\d{2,8})'][i % 4]!;
      out.push(['GET', `/r${i}/:id${re}`, i]);
    }
  }
  return out;
}

function pickHit(shape: Shape, n: number): string {
  const m = Math.floor(n / 2);
  if (shape === 'static')   return `/api/v1/resource-${m}`;
  if (shape === 'param')    return `/r${m}/users/42/posts/7`;
  if (shape === 'tenant')   return `/tenant-${m}/users/42/posts/7`;
  if (shape === 'mixed')    return `/v${m % 20}/static/r-${m}`;
  if (shape === 'wildcard') return `/files/g${m % 1000}/b-${m}/a/b/c`;
  if (shape === 'regex')    return `/r${m}/42`;
  return '/';
}

async function measure(shape: Shape, n: number): Promise<void> {
  const baselineRss = rssMb();
  const baselineHeap = heapMb();

  const t0 = performance.now();
  const r = new Router<number>();
  for (const [m, p, v] of makeRoutes(shape, n)) r.add(m, p, v);
  r.build();
  const buildMs = performance.now() - t0;

  const rssImmediate = rssMb();
  const heapImmediate = heapMb();

  // Wait for libpas scavenger to decommit orphan pages.
  await sleep(1500);
  const rssSettled = rssMb();
  const heapSettled = heapMb();

  // First-call latency: rebuild fresh router and time the first match().
  const firstCalls: number[] = [];
  for (let s = 0; s < 50; s++) {
    const fresh = new Router<number>();
    for (const [m, p, v] of makeRoutes(shape, n)) fresh.add(m, p, v);
    fresh.build();
    const fp = pickHit(shape, n);
    const f0 = performance.now();
    fresh.match('GET', fp);
    firstCalls.push((performance.now() - f0) * 1e6);
  }
  firstCalls.sort((a, b) => a - b);
  const fcP50 = firstCalls[Math.floor(firstCalls.length * 0.5)]!;
  const fcP99 = firstCalls[Math.floor(firstCalls.length * 0.99)]!;

  // Steady-state.
  const hit = pickHit(shape, n);
  for (let i = 0; i < 50_000; i++) r.match('GET', hit);
  const ITER = 500_000;
  const s0 = performance.now();
  for (let i = 0; i < ITER; i++) r.match('GET', hit);
  const steadyNs = ((performance.now() - s0) * 1e6) / ITER;

  console.log(
    `${shape.padEnd(9)} ${n.toString().padStart(7)} ` +
    `build=${buildMs.toFixed(0).padStart(5)}ms ` +
    `rss[imm/settled]=${(rssImmediate - baselineRss).toFixed(0).padStart(4)}/${(rssSettled - baselineRss).toFixed(0).padStart(4)}MB ` +
    `heap[imm/settled]=${(heapImmediate - baselineHeap).toFixed(0).padStart(4)}/${(heapSettled - baselineHeap).toFixed(0).padStart(4)}MB ` +
    `first-call[p50/p99]=${fcP50.toFixed(0).padStart(6)}/${fcP99.toFixed(0).padStart(6)}ns ` +
    `steady=${steadyNs.toFixed(1).padStart(5)}ns`,
  );
}

async function main(): Promise<void> {
  console.log(`${'shape'.padEnd(9)} ${'count'.padStart(7)} build  rss[imm/settled]MB heap[imm/settled]MB first-call[p50/p99]ns steady-ns`);
  for (const shape of ['static', 'param', 'tenant', 'mixed', 'wildcard', 'regex'] as const) {
    for (const n of [1_000, 10_000, 100_000] as const) {
      await measure(shape, n);
    }
  }
}

await main();
