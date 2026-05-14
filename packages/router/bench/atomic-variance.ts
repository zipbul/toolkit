/* eslint-disable no-console */
/**
 * Same primitive bench, 10 independent runs each, report
 * min/p50/p99/max/stdev/CoV so we can see if a single number is
 * actually meaningful or noise-dominated.
 */
import { performance } from 'node:perf_hooks';

function stats(xs: number[]): { min: number; p50: number; p99: number; max: number; mean: number; stdev: number; cov: number } {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  const stdev = Math.sqrt(variance);
  return {
    min: s[0]!,
    p50: s[Math.floor(s.length * 0.5)]!,
    p99: s[Math.floor(s.length * 0.99)]!,
    max: s[s.length - 1]!,
    mean,
    stdev,
    cov: stdev / mean,
  };
}

function runProbe(label: string, fn: () => unknown, iter = 5_000_000, runs = 10): void {
  for (let i = 0; i < 500_000; i++) fn();  // warmup
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    for (let i = 0; i < iter; i++) fn();
    samples.push(((performance.now() - t0) * 1e6) / iter);
  }
  const s = stats(samples);
  console.log(`  ${label.padEnd(46)} p50=${s.p50.toFixed(2).padStart(6)} min=${s.min.toFixed(2).padStart(6)} p99=${s.p99.toFixed(2).padStart(6)} max=${s.max.toFixed(2).padStart(6)} cov=${(s.cov * 100).toFixed(1).padStart(4)}%`);
}

console.log('atomic primitive variance (10 independent 5M-iter runs each):');

const noop = () => 0;
runProbe('fn no-op', () => noop());

const path = '/r50/u/42/p/7';
runProbe('charCodeAt(0)', () => path.charCodeAt(0));
runProbe('substring(0, len-1)', () => path.substring(0, path.length - 1));

const m = new Map<string, number>();
for (let i = 0; i < 100; i++) m.set(`/k${i}`, i);
let mi = 0;
runProbe('Map.get hit (100-entry, rotating key)', () => m.get(`/k${(mi++) % 100}`));

const o: Record<string, number> = Object.create(null);
for (let i = 0; i < 100; i++) o[`/k${i}`] = i;
let oi = 0;
runProbe('Record[k] hit (100-entry, rotating key)', () => o[`/k${(oi++) % 100}`]);

runProbe('Object.freeze({a:1}) — new obj each call', () => Object.freeze({ a: 1 }));

runProbe('alloc { value, params, meta }', () => ({ value: 1, params: null, meta: null }));

const cache = new Map<string, { value: number; params: any }>();
let ci = 0;
runProbe('cache write composite (alloc+freeze+set)', () => {
  const k = `/k${(ci++) % 100}`;
  const p = Object.freeze({ id: 1 });
  cache.set(k, { value: 1, params: p });
});
