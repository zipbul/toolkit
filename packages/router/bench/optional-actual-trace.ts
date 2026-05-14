/* eslint-disable no-console */
/**
 * Direct reproduction of:
 * 1. agent 6 claim: trie nodes ~Θ(2^N/√N), prefix sharing already works
 * 2. invariant A noop claim — measure on/off via direct call
 * 3. real memory distribution at N=20 (where the 10GB went)
 */
import { performance } from 'node:perf_hooks';
import { estimateShallowMemoryUsageOf } from 'bun:jsc';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

function rssMB(): number { return process.memoryUsage().rss / 1024 / 1024; }
function heapMB(): number { return process.memoryUsage().heapUsed / 1024 / 1024; }

function countSegmentNodes(root: any): number {
  if (!root) return 0;
  let n = 1;
  if (root.staticChildren) for (const k in root.staticChildren) n += countSegmentNodes(root.staticChildren[k]);
  if (root.singleChildNext) n += countSegmentNodes(root.singleChildNext);
  let p = root.paramChild;
  while (p) { n += countSegmentNodes(p.next); p = p.nextSibling; }
  return n;
}

console.log('=== Trie node count vs theoretical ===');
console.log('N | variants | total seg sum | trie nodes | sharing ratio | terminals | slab KB | factories alloc');
for (const N of [3, 5, 7, 10, 12]) {
  Bun.gc(true);
  const path = '/' + Array.from({length: N}, (_, i) => `s${i}/:p${i}?`).join('/');
  const r = new Router<number>();
  r.add('GET', path, 1);
  r.build();
  const internals = (r as any)[ROUTER_INTERNALS_KEY];
  const snap = internals.registration.snapshot;
  const root = snap.segmentTrees[0];
  const nodeCount = countSegmentNodes(root);
  const variants = 1 << N;
  const terminalCount = snap.terminalSlab.length / 3;
  const slabKB = (snap.terminalSlab.length * 4) / 1024;
  const factoryCount = snap.paramsFactories.filter((f: any) => f !== null).length;
  // sum of variant lengths is the "no sharing" baseline
  // for alternating /s0/:p0?/.../sN-1/:pN-1?/sN it's 2N+1 segments × variants in average
  const avgVariantLen = (2 * N) + 1;
  const sumLen = avgVariantLen * variants;
  console.log(`${N} | ${variants} | ${sumLen} | ${nodeCount} | ${(sumLen/nodeCount).toFixed(2)}× | ${terminalCount} | ${slabKB.toFixed(1)} | ${factoryCount}`);
}

console.log('\n=== N=20 real memory breakdown ===');
Bun.gc(true);
const baseRss = rssMB();
const baseHeap = heapMB();
const path20 = '/' + Array.from({length: 20}, (_, i) => `s${i}/:p${i}?`).join('/');
const r20 = new Router<number>();
r20.add('GET', path20, 1);
r20.build();
const after_rss = rssMB();
const after_heap = heapMB();
const internals20 = (r20 as any)[ROUTER_INTERNALS_KEY];
const snap20 = internals20.registration.snapshot;
const root20 = snap20.segmentTrees[0];
const nodeCount20 = countSegmentNodes(root20);
const terminals20 = snap20.terminalSlab.length / 3;
const handlers20 = snap20.handlers.length;
const factories20 = snap20.paramsFactories.filter((f: any) => f !== null).length;
console.log(`baseline rss=${baseRss.toFixed(1)} heap=${baseHeap.toFixed(1)}`);
console.log(`after build rss=${after_rss.toFixed(1)} (+${(after_rss-baseRss).toFixed(1)}MB) heap=${after_heap.toFixed(1)} (+${(after_heap-baseHeap).toFixed(1)}MB)`);
console.log(`segment nodes: ${nodeCount20}`);
console.log(`terminals: ${terminals20}`);
console.log(`handlers: ${handlers20}`);
console.log(`paramsFactories non-null: ${factories20}`);
console.log(`terminalSlab size: ${(snap20.terminalSlab.length * 4 / 1024 / 1024).toFixed(2)}MB`);
console.log(`paramsFactories array shallow: ${(estimateShallowMemoryUsageOf(snap20.paramsFactories)/1024/1024).toFixed(2)}MB`);
console.log(`handlers array shallow: ${(estimateShallowMemoryUsageOf(snap20.handlers)/1024/1024).toFixed(2)}MB`);
