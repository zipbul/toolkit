/* eslint-disable no-console */
/**
 * Probe: cache hit returns a fresh `{ value, params, meta }` object every
 * match. If we cache the entire MatchOutput (frozen at write) and return
 * the cached reference directly, we avoid the per-match alloc.
 *
 * Trade-off: freeze cost at cache write vs. alloc saved per cache hit.
 */
import { performance } from 'node:perf_hooks';

const CACHE_META = Object.freeze({ matchType: 'cache' as const });
const cachedRef = Object.freeze({
  value: 'handler',
  params: Object.freeze({ id: 'x' }),
  meta: CACHE_META,
});

function bench(label: string, fn: () => unknown, iter = 5_000_000): number {
  for (let i = 0; i < 200_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(45)} ${ns.toFixed(2).padStart(7)} ns`);
  return ns;
}

console.log('== single match return shape ==');
bench('return { v, p, m } fresh', () => ({
  value: cachedRef.value,
  params: cachedRef.params,
  meta: CACHE_META,
}));
bench('return cachedRef directly', () => cachedRef);

// Composite simulation
console.log('\n== composite write/read for cache miss path ==');
{
  let i = 0;
  bench('current: write fresh + read fresh (90% hit)', () => {
    if ((i++) % 10 === 0) {
      // cache miss: build new entry + alloc return
      const entry = { value: 'h', params: { id: 'x' } };
      Object.freeze(entry.params);
      // hc.set call simulated
      return { value: entry.value, params: entry.params, meta: CACHE_META };
    }
    return { value: cachedRef.value, params: cachedRef.params, meta: CACHE_META };
  });
  let j = 0;
  bench('NEW: cache full output, return ref (90% hit)', () => {
    if ((j++) % 10 === 0) {
      // cache miss: build full output, freeze, return
      const out = { value: 'h', params: Object.freeze({ id: 'x' }), meta: CACHE_META };
      Object.freeze(out);
      return out;
    }
    return cachedRef;
  });
}
