/* eslint-disable no-console */
/**
 * POC: Static table representation comparison at 100k scale, end-to-end.
 *
 * Compares three candidate static-table representations:
 *  - per-method Object.create(null) (current)
 *  - per-method Map<string, number>
 *  - single global Map<(method,path) composite key, handler>
 *
 * Output: warmed hit/miss/wrong-method ns, build ms, RSS MiB.
 * Uses 100k routes, 8 methods sharded uniformly.
 */
export {};

import { performance } from 'node:perf_hooks';

const N = 100_000;
const ITER = 500_000;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'CONNECT'];

function gc(): void { if (typeof Bun !== 'undefined') Bun.gc(true); }
function mem(): NodeJS.MemoryUsage { gc(); return process.memoryUsage(); }
function diffMb(a: NodeJS.MemoryUsage, b: NodeJS.MemoryUsage): { rss: number; heap: number } {
  return { rss: (b.rss - a.rss) / 1024 / 1024, heap: (b.heapUsed - a.heapUsed) / 1024 / 1024 };
}

function bench(label: string, fn: () => unknown): number {
  for (let i = 0; i < 20_000; i++) fn();
  const t0 = process.hrtime.bigint();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) if (fn() !== null) checksum++;
  const ns = Number(process.hrtime.bigint() - t0) / ITER;
  console.log(`  ${label.padEnd(38)} ${ns.toFixed(2).padStart(8)} ns/op cksm=${checksum}`);
  return ns;
}

// ─── Generate route table ───
type Route = { method: string; methodCode: number; path: string; handlerIdx: number };
const routes: Route[] = [];
for (let i = 0; i < N; i++) {
  const m = i % METHODS.length;
  routes.push({ method: METHODS[m]!, methodCode: m, path: `/api/v1/resource-${i}`, handlerIdx: i });
}

// Hit / miss / wrong-method probes
const hitProbes: Array<{ method: string; methodCode: number; path: string }> = [];
const missProbes: Array<{ method: string; methodCode: number; path: string }> = [];
const wrongProbes: Array<{ method: string; methodCode: number; path: string }> = [];
for (let i = 0; i < 100; i++) {
  const idx = Math.floor((i / 100) * N);
  const r = routes[idx]!;
  hitProbes.push({ method: r.method, methodCode: r.methodCode, path: r.path });
  missProbes.push({ method: r.method, methodCode: r.methodCode, path: r.path + '-NONE' });
  wrongProbes.push({ method: METHODS[(r.methodCode + 1) % METHODS.length]!, methodCode: (r.methodCode + 1) % METHODS.length, path: r.path });
}

// ─── A1: per-method Object.create(null) ───
function buildA1(): { lookup: (mc: number, p: string) => number | null; rss: number; heap: number; buildMs: number } {
  const before = mem();
  const t0 = performance.now();
  const tbl: Array<Record<string, number> | null> = new Array(METHODS.length).fill(null);
  for (const r of routes) {
    let bucket = tbl[r.methodCode];
    if (bucket === null) { bucket = Object.create(null) as Record<string, number>; tbl[r.methodCode] = bucket; }
    bucket[r.path] = r.handlerIdx;
  }
  const buildMs = performance.now() - t0;
  const after = mem();
  const d = diffMb(before, after);
  return {
    lookup: (mc, p) => {
      const b = tbl[mc];
      if (b === null) return null;
      const v = b[p];
      return v === undefined ? null : v;
    },
    rss: d.rss, heap: d.heap, buildMs,
  };
}

// ─── A2: per-method Map ───
function buildA2(): { lookup: (mc: number, p: string) => number | null; rss: number; heap: number; buildMs: number } {
  const before = mem();
  const t0 = performance.now();
  const tbl: Array<Map<string, number> | null> = new Array(METHODS.length).fill(null);
  for (const r of routes) {
    let bucket = tbl[r.methodCode];
    if (bucket === null) { bucket = new Map(); tbl[r.methodCode] = bucket; }
    bucket.set(r.path, r.handlerIdx);
  }
  const buildMs = performance.now() - t0;
  const after = mem();
  const d = diffMb(before, after);
  return {
    lookup: (mc, p) => {
      const b = tbl[mc];
      if (b === null) return null;
      const v = b.get(p);
      return v === undefined ? null : v;
    },
    rss: d.rss, heap: d.heap, buildMs,
  };
}

// ─── A3: single global Map<composite, number> ───
function buildA3(): { lookup: (mc: number, p: string) => number | null; rss: number; heap: number; buildMs: number } {
  const before = mem();
  const t0 = performance.now();
  const tbl = new Map<string, number>();
  for (const r of routes) {
    tbl.set(r.methodCode + ':' + r.path, r.handlerIdx);
  }
  const buildMs = performance.now() - t0;
  const after = mem();
  const d = diffMb(before, after);
  return {
    lookup: (mc, p) => {
      const v = tbl.get(mc + ':' + p);
      return v === undefined ? null : v;
    },
    rss: d.rss, heap: d.heap, buildMs,
  };
}

const candidates = [
  { name: 'A1 per-method object (current)', build: buildA1 },
  { name: 'A2 per-method Map', build: buildA2 },
  { name: 'A3 single global Map (str key)', build: buildA3 },
];

console.log(`bun=${Bun.version} node=${process.version} platform=${process.platform}`);
console.log(`routes=${N} methods=${METHODS.length} probes=${hitProbes.length} iter=${ITER}`);

for (const c of candidates) {
  console.log(`\n## ${c.name}`);
  const built = c.build();
  console.log(`  build=${built.buildMs.toFixed(1)}ms rss=+${built.rss.toFixed(1)}MiB heap=+${built.heap.toFixed(1)}MiB`);
  let i = 0;
  bench('warmed hit (cycle 100 probes)', () => {
    const p = hitProbes[(i++) % hitProbes.length]!;
    return built.lookup(p.methodCode, p.path);
  });
  i = 0;
  bench('warmed miss (cycle 100 probes)', () => {
    const p = missProbes[(i++) % missProbes.length]!;
    return built.lookup(p.methodCode, p.path);
  });
  i = 0;
  bench('warmed wrong-method (cycle 100)', () => {
    const p = wrongProbes[(i++) % wrongProbes.length]!;
    return built.lookup(p.methodCode, p.path);
  });
}
