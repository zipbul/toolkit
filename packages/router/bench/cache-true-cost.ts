/* eslint-disable no-console */
/**
 * Cache true cost analysis:
 *  - hot path lookup cost on miss (with cache active)
 *  - hot path cost when cache disabled
 *  - hit rate vs size sweep under realistic Zipf-like access
 *  - memory cost per cache entry
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

const N = 100_000;
const ITER = 500_000;

function make(): Router<number> {
  const r = new Router<number>();
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
  r.build();
  return r;
}

function probe(label: string, hitMaker: (it: number) => string, r: Router<number>): void {
  for (let i = 0; i < 50_000; i++) r.match('GET', hitMaker(i));
  const t0 = performance.now();
  for (let i = 0; i < ITER; i++) r.match('GET', hitMaker(i));
  const ns = ((performance.now() - t0) * 1e6) / ITER;
  console.log(`  ${label.padEnd(40)} ${ns.toFixed(1).padStart(6)}ns/match`);
}

console.log('default cacheSize=1000:');
{
  const r = make();
  probe('all-miss (cyclic 100k unique paths)', (it) => `/r${it % N}/u/${it}/p/${it}`, r);
  probe('all-hit (single path repeated)', () => `/r0/u/42/p/7`, r);
  probe('Zipf-like (top-10 paths 90% of traffic)', (it) => {
    const r2 = Math.random();
    if (r2 < 0.9) return `/r${it % 10}/u/42/p/7`;
    return `/r${it % N}/u/${it}/p/${it}`;
  }, r);
}

console.log();
console.log('cacheSize=10:');
{
  const r = new Router<number>({ cacheSize: 10 });
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
  r.build();
  probe('all-miss (cyclic 100k unique paths)', (it) => `/r${it % N}/u/${it}/p/${it}`, r);
  probe('all-hit (single path repeated)', () => `/r0/u/42/p/7`, r);
  probe('Zipf-like (top-10 paths 90%)', (it) => {
    const r2 = Math.random();
    if (r2 < 0.9) return `/r${it % 10}/u/42/p/7`;
    return `/r${it % N}/u/${it}/p/${it}`;
  }, r);
}

console.log();
console.log('cacheSize=100000 (memory-heavy):');
{
  const r = new Router<number>({ cacheSize: 100000 });
  for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
  r.build();
  probe('all-miss (cyclic 100k unique paths)', (it) => `/r${it % N}/u/${it}/p/${it}`, r);
  probe('all-hit (single path repeated)', () => `/r0/u/42/p/7`, r);
  probe('Zipf-like (top-10 paths 90%)', (it) => {
    const r2 = Math.random();
    if (r2 < 0.9) return `/r${it % 10}/u/42/p/7`;
    return `/r${it % N}/u/${it}/p/${it}`;
  }, r);
}
