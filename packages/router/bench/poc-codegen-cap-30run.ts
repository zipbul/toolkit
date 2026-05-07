/* eslint-disable no-console */
/**
 * POC: 30 fresh-process × 100 sample first-call distribution for codegen cap.
 *
 * Worker mode (--worker NODES): runs 100 fresh `new Function` compiles + first-call
 * timings for the given node count, prints distribution stats as JSON.
 *
 * Driver mode (no flag): spawns 30 fresh bun processes per node count
 * (16/32/64/128/256), aggregates p50/p75/p99/p999/max across all 3000 samples,
 * prints final table.
 *
 * Replaces the 5-run lock used to derive Phase 6 ≤32 cap with a 30-run-grade
 * distribution per ULT line 953.
 */
export {};

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

const NODE_COUNTS = [16, 32, 64, 128, 256];
const PROCESSES_PER_COUNT = 30;
const SAMPLES_PER_PROCESS = 100;

function makeSource(nodes: number): string {
  let body = 'return function match(url, state) { state.paramCount = 0;';
  for (let i = 0; i < nodes; i++) {
    body += `if (url === '/route/${i}') { state.handlerIndex = ${i}; return true; }`;
  }
  body += 'return false; };';
  return body;
}

function workerMode(nodes: number): void {
  const src = makeSource(nodes);
  const firstNs: number[] = [];
  const secondNs: number[] = [];
  const tenthNs: number[] = [];
  for (let s = 0; s < SAMPLES_PER_PROCESS; s++) {
    const fn = new Function(src)() as (url: string, state: { paramCount: number; handlerIndex: number }) => boolean;
    const state = { paramCount: 0, handlerIndex: -1 };

    // first call (cold)
    const t0 = Bun.nanoseconds();
    fn(`/route/${nodes - 1}`, state);
    const t1 = Bun.nanoseconds();
    firstNs.push(t1 - t0);

    // second call (post-warmup)
    const t2 = Bun.nanoseconds();
    fn(`/route/${nodes - 1}`, state);
    const t3 = Bun.nanoseconds();
    secondNs.push(t3 - t2);

    // 10th call (fully tier-up'd)
    for (let i = 0; i < 7; i++) fn(`/route/${nodes - 1}`, state);
    const t4 = Bun.nanoseconds();
    fn(`/route/${nodes - 1}`, state);
    const t5 = Bun.nanoseconds();
    tenthNs.push(t5 - t4);
  }
  process.stdout.write(JSON.stringify({ nodes, first: firstNs, second: secondNs, tenth: tenthNs }) + '\n');
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return Number.NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function median(arr: number[]): number { return pct(arr, 50); }

type CallKind = 'first' | 'second' | 'tenth';
function driverMode(): void {
  const all = new Map<CallKind, Map<number, number[]>>();
  for (const k of ['first', 'second', 'tenth'] as CallKind[]) {
    const m = new Map<number, number[]>();
    for (const n of NODE_COUNTS) m.set(n, []);
    all.set(k, m);
  }

  console.log(`bun=${Bun.version} processes/node=${PROCESSES_PER_COUNT} samples/process=${SAMPLES_PER_PROCESS} total=${PROCESSES_PER_COUNT * SAMPLES_PER_PROCESS}/node`);

  for (const nodes of NODE_COUNTS) {
    process.stdout.write(`measuring ${nodes} nodes: `);
    for (let p = 0; p < PROCESSES_PER_COUNT; p++) {
      const child = spawnSync('bun', [SCRIPT_PATH, '--worker', String(nodes)], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 4,
      });
      if (child.status !== 0) {
        console.error(`\nworker fail nodes=${nodes} run=${p}: ${child.stderr}`);
        process.exit(1);
      }
      const parsed = JSON.parse(child.stdout.trim()) as { nodes: number; first: number[]; second: number[]; tenth: number[] };
      all.get('first')!.get(nodes)!.push(...parsed.first);
      all.get('second')!.get(nodes)!.push(...parsed.second);
      all.get('tenth')!.get(nodes)!.push(...parsed.tenth);
      process.stdout.write('.');
    }
    process.stdout.write(' done\n');
  }

  for (const k of ['first', 'second', 'tenth'] as CallKind[]) {
    const label = k === 'first' ? 'first-call (cold, codegen only)' : k === 'second' ? 'second-call (after warmup, p99 Guard target)' : '10th call (fully tier-up\'d)';
    console.log(`\n## ${label}`);
    console.log(`nodes |       med |       p75 |       p95 |       p99 |      p999 |       max | Guard 10us`);
    console.log(`------|----------:|----------:|----------:|----------:|----------:|----------:|----------`);
    for (const n of NODE_COUNTS) {
      const s = all.get(k)!.get(n)!;
      const m = median(s);
      const p75 = pct(s, 75);
      const p95 = pct(s, 95);
      const p99 = pct(s, 99);
      const p999 = pct(s, 99.9);
      const max = Math.max(...s);
      const guard = p99 <= 10000 ? 'PASS p99' : (p95 <= 10000 ? 'PASS p95 only' : 'FAIL p95');
      console.log(`${String(n).padStart(5)} | ${m.toFixed(0).padStart(8)}ns | ${p75.toFixed(0).padStart(8)}ns | ${p95.toFixed(0).padStart(8)}ns | ${p99.toFixed(0).padStart(8)}ns | ${p999.toFixed(0).padStart(8)}ns | ${max.toFixed(0).padStart(8)}ns | ${guard}`);
    }
  }

  console.log(`\n## Phase 6 cap recommendation`);
  for (const k of ['first', 'second'] as CallKind[]) {
    let best = 0;
    for (const n of NODE_COUNTS) {
      const p99 = pct(all.get(k)!.get(n)!, 99);
      if (p99 <= 10000) best = n;
    }
    console.log(`${k}-call p99 ≤10us: ${best} nodes`);
  }
}

if (process.argv[2] === '--worker') {
  workerMode(parseInt(process.argv[3]!, 10));
} else {
  driverMode();
}
