/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

const N = 100_000;
const SAMPLES = 100;

function pParam(): Router<number> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/users/:id/posts/:postId`, i);
  r.build();
  return r;
}
function pStatic(): Router<number> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/api/v1/resource-${i}`, i);
  r.build();
  return r;
}
function pTenant(): Router<number> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/tenant-${i}/users/:id/posts/:postId`, i);
  r.build();
  return r;
}

function probe(make: () => Router<number>, hit: string, label: string): void {
  const ns: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    const r = make();
    const t0 = performance.now();
    r.match('GET', hit);
    ns.push((performance.now() - t0) * 1e6);
  }
  ns.sort((a, b) => a - b);
  console.log(`${label.padEnd(16)} p50=${ns[Math.floor(ns.length * 0.5)]!.toFixed(0).padStart(7)}ns  p99=${ns[Math.floor(ns.length * 0.99)]!.toFixed(0).padStart(7)}ns`);
}

probe(pStatic, `/api/v1/resource-${Math.floor(N / 2)}`, 'static 100k');
probe(pParam, `/r${Math.floor(N / 2)}/users/42/posts/7`, 'param 100k');
probe(pTenant, `/tenant-${Math.floor(N / 2)}/users/42/posts/7`, 'tenant 100k');
