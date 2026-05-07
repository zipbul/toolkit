/* eslint-disable no-console */
/**
 * 30 fresh processes × 100 samples = 3000-sample distribution of the
 * first-call match latency, post build-time warmup. Measures whether the
 * codegen + warmup design keeps the p99 of the first observed user request
 * inside the published Guard (10 µs).
 *
 * Worker mode: run a single fresh process worth of 100 samples for the
 * given node-count target; print the raw ns array as JSON.
 *
 * Driver mode: spawn 30 worker processes, aggregate p50/p75/p99/p999/max
 * across the 3000 samples, write the resulting table to stdout.
 */
export {};

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { Router } from '../src/router';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SHAPES = [16, 32, 64, 128, 256] as const;
const PROCESSES_PER_SHAPE = 30;
const SAMPLES_PER_PROCESS = 100;

function buildRouter(targetNodes: number): { router: Router<number>; firstPath: string } {
  const r = new Router<number>();
  // Each registered route adds ~2-3 segment-tree nodes (literal + param).
  // Approximate `targetNodes` nodes by registering targetNodes/2 routes
  // with one literal + one param segment apiece. The router's build pass
  // emits a compiled walker for this dynamic tree.
  const routes = Math.max(1, (targetNodes / 2) | 0);
  for (let i = 0; i < routes; i++) {
    r.add('GET', `/leaf-${i}/:tail`, i);
  }
  r.build();
  return { router: r, firstPath: `/leaf-${(routes / 2) | 0}/value` };
}

function runWorker(targetNodes: number): number[] {
  const samples: number[] = [];
  for (let s = 0; s < SAMPLES_PER_PROCESS; s++) {
    const { router, firstPath } = buildRouter(targetNodes);
    const t0 = performance.now();
    router.match('GET', firstPath);
    samples.push((performance.now() - t0) * 1e6);
  }
  return samples;
}

function pct(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

if (process.argv.includes('--worker')) {
  const idx = process.argv.indexOf('--worker');
  const target = Number(process.argv[idx + 1]);
  if (!Number.isFinite(target)) {
    console.error('--worker requires a node count argument');
    process.exit(1);
  }
  const samples = runWorker(target);
  process.stdout.write(JSON.stringify(samples));
  process.exit(0);
}

const guardNs = 10_000;
const rows: Array<{
  shape: number;
  p50: number;
  p75: number;
  p99: number;
  p999: number;
  max: number;
  guardPass: boolean;
}> = [];

for (const shape of SHAPES) {
  const all: number[] = [];
  for (let p = 0; p < PROCESSES_PER_SHAPE; p++) {
    const child = spawnSync('bun', [SCRIPT_PATH, '--worker', String(shape)], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
    });
    if (child.status !== 0) {
      console.error(child.stderr);
      throw new Error(`worker failed for shape=${shape}`);
    }
    const samples = JSON.parse(child.stdout) as number[];
    for (const s of samples) all.push(s);
  }
  const p50 = pct(all, 50);
  const p75 = pct(all, 75);
  const p99 = pct(all, 99);
  const p999 = pct(all, 99.9);
  const max = Math.max(...all);
  rows.push({ shape, p50, p75, p99, p999, max, guardPass: p99 <= guardNs });
}

console.log('\n## first-match latency distribution (3000 samples per shape)');
console.log('| nodes | p50 ns | p75 ns | p99 ns | p999 ns | max ns | ≤10µs Guard |');
console.log('|------:|-------:|-------:|-------:|--------:|-------:|:-----------:|');
for (const r of rows) {
  console.log(
    `| ${r.shape} | ${r.p50.toFixed(0)} | ${r.p75.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.p999.toFixed(0)} | ${r.max.toFixed(0)} | ${r.guardPass ? '✓' : '✗'} |`,
  );
}
