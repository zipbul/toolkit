/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

const N = 100_000;
const SAMPLES = 200;

function buildParam(): Router<number> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/users/:id/posts/:postId`, i);
  r.build();
  return r;
}

function buildStatic(): Router<number> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/api/v1/resource-${i}`, i);
  r.build();
  return r;
}

function ladder(make: () => Router<number>, hit: string, label: string): void {
  const calls = [1, 2, 5, 10, 50, 200, 1000, 10000];
  console.log(`${label} — latency by call index (median of ${SAMPLES} samples)`);
  const buckets: number[][] = calls.map(() => []);
  for (let s = 0; s < SAMPLES; s++) {
    const r = make();
    for (let i = 0, idx = 0; i < calls[calls.length - 1]!; i++) {
      const t0 = performance.now();
      r.match('GET', hit);
      const dt = (performance.now() - t0) * 1e6;
      if (i + 1 === calls[idx]) { buckets[idx]!.push(dt); idx++; }
    }
  }
  for (let i = 0; i < calls.length; i++) {
    const arr = buckets[i]!.sort((a, b) => a - b);
    const p50 = arr[Math.floor(arr.length * 0.5)]!;
    const p99 = arr[Math.floor(arr.length * 0.99)]!;
    console.log(`  call#${calls[i]!.toString().padStart(5)}  p50=${p50.toFixed(0).padStart(6)}ns  p99=${p99.toFixed(0).padStart(6)}ns`);
  }
}

ladder(buildStatic, `/api/v1/resource-${Math.floor(N / 2)}`, 'static 100k');
ladder(buildParam, `/r${Math.floor(N / 2)}/users/42/posts/7`, 'param 100k');
