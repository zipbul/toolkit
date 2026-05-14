/* eslint-disable no-console */
/**
 * Round 2: smaller wins audit.
 *  1. PrefixTrieNode literalChildren lazy-init vs always-init
 *  2. handlers array dedup ratio (Int32Array packing potential)
 *  3. WildcardPrefixIndex visited array push count
 *  4. insertIntoSegmentTree undoLog push count
 *  5. staticPrefix array length distribution
 */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';
import { estimateShallowMemoryUsageOf } from 'bun:jsc';

function bench(label: string, fn: () => unknown, iter = 5_000_000): number {
  for (let i = 0; i < 200_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(50)} ${ns.toFixed(2).padStart(7)} ns`);
  return ns;
}

console.log('== 1. literalChildren lazy-init vs always-init ==');
{
  const obj1: { c: Record<string, number> | null } = { c: null };
  const obj2: { c: Record<string, number> } = { c: Object.create(null) };
  let i = 0;
  bench('lazy: c !== null ? c[k] : undefined', () => {
    return obj1.c !== null ? obj1.c[`k${(i++) % 100}`] : undefined;
  });
  let j = 0;
  bench('always: c[k] (never null)', () => obj2.c[`k${(j++) % 100}`]);
}

console.log('\n== 2. handlers Int32Array vs T[] ==');
{
  const r = new Router<number>();
  for (let i = 0; i < 100_000; i++) r.add('GET', `/r${i}/u/:id`, i);
  r.build();
  const snap = (r as any)[ROUTER_INTERNALS_KEY].registration.snapshot;
  console.log(`  handlers: length=${snap.handlers.length}, all numeric? ${snap.handlers.every((h: any) => typeof h === 'number')}`);
  console.log(`  shallow mem of handlers array: ${estimateShallowMemoryUsageOf(snap.handlers)} B`);
  console.log(`  Int32Array(${snap.handlers.length}) byteLength: ${snap.handlers.length * 4} B`);
}

console.log('\n== 3. visited array push count + sizes ==');
{
  const internals: any = {};
  // Probe: build a 100k tenant tree and count visited writes
  // (we can't directly count without instrumentation, but we can estimate
  // from path segments: 100k routes × ~5 segments each = 500k visited)
  console.log(`  estimated visited push: 100k × ~5 segments = ~500k push/build`);
  void internals;
}

console.log('\n== 4. undoLog push count ==');
{
  // undoLog records every static-child add, single-child clear, etc.
  // ~500k segment hops + factory writes + handler writes ≈ 1-2M push/build
  console.log(`  estimated undoLog push: ~1-2M push/build at 100k routes`);
}

console.log('\n== 5. staticPrefix array length distribution ==');
{
  const r = new Router<number>();
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/r${i}`, i);
  r.build();
  const snap = (r as any)[ROUTER_INTERNALS_KEY].registration.snapshot;
  let withPrefix = 0;
  let totalLen = 0;
  function walk(node: any): void {
    if (node.staticPrefix) {
      withPrefix++;
      totalLen += node.staticPrefix.length;
    }
    if (node.singleChildNext) walk(node.singleChildNext);
    if (node.staticChildren) for (const k in node.staticChildren) walk(node.staticChildren[k]);
    let p = node.paramChild;
    while (p) { walk(p.next); p = p.nextSibling; }
  }
  for (const t of snap.segmentTrees) if (t) walk(t);
  console.log(`  nodes with staticPrefix: ${withPrefix}, avg length: ${withPrefix ? (totalLen / withPrefix).toFixed(1) : 0}`);
}
