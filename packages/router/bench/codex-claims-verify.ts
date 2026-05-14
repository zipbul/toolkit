/* eslint-disable no-console */
/**
 * Verify codex claims:
 * 1. paramsFactories[tIdx] holds 2^N entries (each pointing to same super-factory)
 * 2. Real memory cost of 1M references — measure
 * 3. Lower bound: actual node count vs 2^N - 1 vs Θ(2^N/√N)
 * 4. paramsFactoriesByHandler[hIdx] would shrink array to handler count
 */
import { estimateShallowMemoryUsageOf } from 'bun:jsc';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

function rssMB(): number { return process.memoryUsage().rss / 1024 / 1024; }
function heapMB(): number { return process.memoryUsage().heapUsed / 1024 / 1024; }

console.log('=== Claim 1+4: paramsFactories shape ===');
console.log('N | terminals | unique fns | array length | array shallow MB | hIdx alternative size MB');
for (const N of [3, 5, 7, 10, 12, 15]) {
  Bun.gc(true);
  const path = '/' + Array.from({length: N}, (_, i) => `s${i}/:p${i}?`).join('/');
  const r = new Router<number>();
  r.add('GET', path, 1);
  r.build();
  const internals = (r as any)[ROUTER_INTERNALS_KEY];
  const snap = internals.registration.snapshot;
  const factories = snap.paramsFactories;
  const arrayShallow = estimateShallowMemoryUsageOf(factories);
  const uniqueFns = new Set(factories.filter((f: any) => f !== null)).size;
  const handlerCount = snap.handlers.length;
  // Hypothetical paramsFactoriesByHandler: only handlerCount entries
  const altSize = handlerCount * 8;
  console.log(`${N} | ${factories.length} | ${uniqueFns} | ${factories.length} | ${(arrayShallow/1024/1024).toFixed(2)} | ${(altSize/1024/1024).toFixed(4)}`);
}

console.log('\n=== Claim 5: lower bound — actual nodes vs 2^N - 1 vs C(N, N/2) ===');
console.log('N | actual nodes | 2^N - 1 | C(N, N/2)');
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
  return Math.round(r);
}
function countNodes(root: any): number {
  if (!root) return 0;
  let n = 1;
  if (root.staticChildren) for (const k in root.staticChildren) n += countNodes(root.staticChildren[k]);
  if (root.singleChildNext) n += countNodes(root.singleChildNext);
  let p = root.paramChild;
  while (p) { n += countNodes(p.next); p = p.nextSibling; }
  return n;
}
for (const N of [3, 5, 7, 10, 12, 15]) {
  Bun.gc(true);
  const path = '/' + Array.from({length: N}, (_, i) => `s${i}/:p${i}?`).join('/');
  const r = new Router<number>();
  r.add('GET', path, 1);
  r.build();
  const internals = (r as any)[ROUTER_INTERNALS_KEY];
  const root = internals.registration.snapshot.segmentTrees[0];
  const actual = countNodes(root);
  const twoN = (1 << N) - 1;
  const cnHalf = binomial(N, Math.floor(N / 2));
  console.log(`${N} | ${actual} | ${twoN} | ${cnHalf}`);
}

console.log('\n=== N=20 RSS contribution of paramsFactories array ===');
Bun.gc(true);
const baseRss = rssMB();
const baseHeap = heapMB();
const path20 = '/' + Array.from({length: 20}, (_, i) => `s${i}/:p${i}?`).join('/');
const r20 = new Router<number>();
r20.add('GET', path20, 1);
r20.build();
Bun.gc(true);
const after_rss = rssMB();
const after_heap = heapMB();
const internals20 = (r20 as any)[ROUTER_INTERNALS_KEY];
const snap20 = internals20.registration.snapshot;
const arr20 = snap20.paramsFactories;
console.log(`paramsFactories length: ${arr20.length}`);
console.log(`paramsFactories shallow: ${(estimateShallowMemoryUsageOf(arr20)/1024/1024).toFixed(2)} MB`);
console.log(`unique fns: ${new Set(arr20.filter((f: any) => f !== null)).size}`);
console.log(`handlers: ${snap20.handlers.length}`);
console.log(`paramsFactoriesByHandler hypothetical size: ${(snap20.handlers.length * 8 / 1024).toFixed(2)} KB`);
console.log(`RSS post-build: +${(after_rss-baseRss).toFixed(0)} MB`);
console.log(`heap post-build: +${(after_heap-baseHeap).toFixed(0)} MB`);
