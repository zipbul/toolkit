/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { numberOfDFGCompiles, reoptimizationRetryCount, heapStats } from 'bun:jsc';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

const r = new Router<number>();
for (let i = 0; i < 100; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
r.build();
const internals = (r as any)[ROUTER_INTERNALS_KEY];
const tr = internals.matchLayer.trees[0];
const matchImpl = internals.matchImpl;
const matchState = internals.matchLayer.matchState;

function probe(label: string, fn: () => unknown): void {
  const dfgBefore = numberOfDFGCompiles(fn);
  const ropt = reoptimizationRetryCount(fn);
  for (let i = 0; i < 500_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < 5_000_000; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / 5_000_000;
  const dfgAfter = numberOfDFGCompiles(fn);
  const roptAfter = reoptimizationRetryCount(fn);
  console.log(`  ${label.padEnd(40)} ns=${ns.toFixed(2).padStart(6)}  DFGcompiles[${dfgBefore}→${dfgAfter}]  reopt[${ropt}→${roptAfter}]`);
}

console.log('JSC tier-state per hot-path component (probed via numberOfDFGCompiles/reoptimizationRetryCount):');
console.log(`heap=${(heapStats().heapSize / 1024 / 1024).toFixed(0)}MB`);

probe('matchImpl (full hot path)', () => matchImpl('GET', '/r50/u/42/p/7'));
probe('matchImpl wrong-method', () => matchImpl('PATCH', '/r50/u/42/p/7'));
probe('walker (tr) only', () => tr('/r50/u/42/p/7', matchState));

// Per-stage closures so we can probe their own tier state:
const cacheGet = (() => {
  const cache = new Map<string, number>();
  for (let i = 0; i < 100; i++) cache.set(`/k${i}`, i);
  let i = 0;
  return () => cache.get(`/k${(i++) % 100}`);
})();
probe('Map.get closure', cacheGet);

const recordGet = (() => {
  const o: Record<string, number> = Object.create(null);
  for (let i = 0; i < 100; i++) o[`/k${i}`] = i;
  let i = 0;
  return () => o[`/k${(i++) % 100}`];
})();
probe('Record[k] closure', recordGet);

const freezeAlloc = () => Object.freeze({ a: 1 });
probe('Object.freeze(new) closure', freezeAlloc);
