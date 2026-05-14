/* eslint-disable no-console */
/**
 * Atomic operations measurement. Each row isolates one JS primitive
 * the matchImpl hot path executes. Costs reported INCLUDE the bench
 * loop overhead (one ms.now()/ns conversion per iteration) — relative
 * comparisons matter more than absolute values.
 */
import { performance } from 'node:perf_hooks';

function bench(label: string, fn: () => unknown, iter = 20_000_000): number {
  for (let i = 0; i < 500_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(48)} ${ns.toFixed(2).padStart(7)} ns`);
  return ns;
}

// ── JS primitives ────────────────────────────────────────────────
console.log('== JS primitive cost ==');
const noop = () => 0;
let acc = 0;
bench('empty loop body (do_not_optimize sink)', () => { acc++; });
bench('function call (no-op)', () => noop());

// String ops
const path = '/r50/u/42/p/7';
bench('string.charCodeAt(0)', () => path.charCodeAt(0));
bench('string.length', () => path.length);
bench('string === string (literal compare)', () => path === '/r50/u/42/p/7' ? 1 : 0);
bench('string.substring(0, len-1)', () => path.substring(0, path.length - 1));
bench('string.slice(0, len-1)', () => path.slice(0, path.length - 1));
bench('string.startsWith short', () => path.startsWith('/r5'));

// Map / Object
const m = new Map<string, number>();
for (let i = 0; i < 100; i++) m.set(`/k${i}`, i);
const o: Record<string, number> = Object.create(null);
for (let i = 0; i < 100; i++) o[`/k${i}`] = i;
let mci = 0;
bench('Map.get hit (100-entry)', () => m.get(`/k${(mci++) % 100}`));
let mci2 = 0;
bench('Map.set existing (100-entry)', () => m.set(`/k${(mci2++) % 100}`, 1));
let mci3 = 0;
bench('Map.has hit', () => m.has(`/k${(mci3++) % 100}`));
let oci = 0;
bench('Record[key] hit (100-entry)', () => o[`/k${(oci++) % 100}`]);

// Object literal alloc
bench('alloc object literal {}', () => { acc = (({} as any).x ?? 0); });
bench('alloc { value, params, meta }', () => ({ value: 1, params: null, meta: null }));
bench('alloc { key, value, used }', () => ({ key: 'x', value: 1, used: true }));

// Object.freeze
const frozen = { a: 1 };
bench('Object.freeze same object', () => Object.freeze(frozen));
bench('Object.freeze new object each', () => Object.freeze({ a: 1 }));

// Array indexing
const arr = new Array<number>(100);
for (let i = 0; i < 100; i++) arr[i] = i;
const int32 = new Int32Array(200);
for (let i = 0; i < 200; i++) int32[i] = i;
let ai = 0;
bench('Array[i] read', () => arr[(ai++) % 100]);
let ti = 0;
bench('Int32Array[i] read', () => int32[(ti++) % 200]);

// Boolean ops
const flag = true;
bench('typeof check', () => typeof flag === 'boolean' ? 1 : 0);
bench('null check', () => (frozen as any) !== null ? 1 : 0);
bench('undefined check', () => (frozen as any) !== undefined ? 1 : 0);

// Function call patterns
const fnArg2 = (a: string, b: number) => a.length + b;
bench('fn(arg, arg) call', () => fnArg2('x', 1));
const closure = (() => { const captured = 42; return () => captured; })();
bench('closure call (capture)', () => closure());

// freeze + alloc + Map.set composite (the cache write hot path)
const cache = new Map<string, { value: number; params: any }>();
let ci = 0;
bench('composite: alloc + freeze + Map.set', () => {
  const k = `/k${(ci++) % 100}`;
  const p = Object.freeze({ id: 1 });
  cache.set(k, { value: 1, params: p });
});

// Specifically: object alloc that becomes the {value, params, meta} return
bench('return-object alloc {v,p,m}', () => ({ value: 1, params: {}, meta: 'd' }));
