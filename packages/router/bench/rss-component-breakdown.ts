/* eslint-disable no-console */
/**
 * Decompose 100k tenant RSS to identify the largest reducible component.
 * Steps: build router incrementally, measure RSS delta after each major
 * structure is materialized.
 */
import { performance } from 'node:perf_hooks';
import { estimateShallowMemoryUsageOf } from 'bun:jsc';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

function rssMB(): number { return process.memoryUsage().rss / 1024 / 1024; }
function heapMB(): number { return process.memoryUsage().heapUsed / 1024 / 1024; }

Bun.gc(true);
const r0_rss = rssMB();
const r0_heap = heapMB();

const r = new Router<number>();
for (let i = 0; i < 100_000; i++) r.add('GET', `/users/${i}/posts/:postId`, i);

Bun.gc(true);
const after_add_rss = rssMB();
const after_add_heap = heapMB();

r.build();
Bun.gc(true);
await new Promise(resolve => setTimeout(resolve, 600));
Bun.gc(true);

const after_build_rss = rssMB();
const after_build_heap = heapMB();

console.log('=== RSS / heap deltas ===');
console.log(`baseline:           rss=${r0_rss.toFixed(1)}MB heap=${r0_heap.toFixed(1)}MB`);
console.log(`after 100k add:     rss=${after_add_rss.toFixed(1)}MB (+${(after_add_rss-r0_rss).toFixed(1)})  heap=${after_add_heap.toFixed(1)}MB (+${(after_add_heap-r0_heap).toFixed(1)})`);
console.log(`after build+gc:     rss=${after_build_rss.toFixed(1)}MB (+${(after_build_rss-r0_rss).toFixed(1)})  heap=${after_build_heap.toFixed(1)}MB (+${(after_build_heap-r0_heap).toFixed(1)})`);

const internals = (r as any)[ROUTER_INTERNALS_KEY];
const snap = internals.registration.snapshot;

console.log('\n=== retained structure sizes (estimateShallowMemoryUsageOf) ===');
console.log(`handlers array:        ${(estimateShallowMemoryUsageOf(snap.handlers)/1024).toFixed(1)} KB (length=${snap.handlers.length})`);
console.log(`terminalSlab:          ${(estimateShallowMemoryUsageOf(snap.terminalSlab)/1024).toFixed(1)} KB (length=${snap.terminalSlab.length})`);
console.log(`paramsFactories:       ${(estimateShallowMemoryUsageOf(snap.paramsFactories)/1024).toFixed(1)} KB (length=${snap.paramsFactories.length})`);

// Count tenantFactor Map size if applied
const segTrees = snap.segmentTrees;
let factorMapEntries = 0;
let segNodeCount = 0;
function walk(n: any): void {
  if (!n) return;
  segNodeCount++;
  if (n.staticChildren) for (const k in n.staticChildren) walk(n.staticChildren[k]);
  if (n.singleChildNext) walk(n.singleChildNext);
  let p = n.paramChild;
  while (p) { walk(p.next); p = p.nextSibling; }
}
for (let mc = 0; mc < segTrees.length; mc++) {
  const root = segTrees[mc];
  if (!root) continue;
  walk(root);
  // tenant factor
  const tf = (await import('../src/matcher/segment-tree')).getTenantFactor(root);
  if (tf) factorMapEntries += tf.keyToTerminal.size;
}
console.log(`segment node count:    ${segNodeCount} (post-factor)`);
console.log(`tenantFactor entries:  ${factorMapEntries}`);

// Estimate Map memory
// V8/JSC Map: ~40-50 bytes/entry + key string (~20 bytes/entry for short)
const mapBytes = factorMapEntries * 65;
console.log(`tenantFactor Map est:  ${(mapBytes/1024/1024).toFixed(2)} MB (~65 B/entry × ${factorMapEntries})`);

// handlers retained (numbers in this bench)
const numTotal = snap.handlers.filter((h: any) => typeof h === 'number').length;
console.log(`handlers (number values): ${numTotal} entries`);

void performance;
