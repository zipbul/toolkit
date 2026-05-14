/* eslint-disable no-console */
/**
 * ULTIMATE.md §8.3 line 1365 says spread is "chosen", freeze is "rejected".
 * Re-measure with the actual cache-write-then-90%-hit workload that the
 * router experiences (Zipf 90/10 hits dominate writes ~9:1).
 */
import { performance } from 'node:perf_hooks';

const PARAMS_2 = { id: 'x', name: 'y' };
const PARAMS_5 = { a: '1', b: '2', c: '3', d: '4', e: '5' };
const PARAMS_20 = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, `v${i}`]));

function bench(label: string, fn: () => unknown, iter = 5_000_000): number {
  for (let i = 0; i < 200_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(50)} ${ns.toFixed(2).padStart(7)} ns`);
  return ns;
}

for (const [name, p] of [['2-key', PARAMS_2], ['5-key', PARAMS_5], ['20-key', PARAMS_20]] as const) {
  console.log(`\n== ${name} ==`);
  // Write path: build params + freeze (current) vs build only (ULTIMATE chosen)
  bench('write: build + freeze', () => {
    const o = { ...p };
    Object.freeze(o);
    return o;
  });
  bench('write: build only (no freeze)', () => {
    const o = { ...p };
    return o;
  });
  // Read path: return frozen ref (current) vs spread clone (ULTIMATE chosen)
  const frozen = Object.freeze({ ...p });
  const mutable = { ...p };
  bench('read: return frozen ref', () => frozen);
  bench('read: spread clone', () => ({ ...mutable }));
}

// Composite: 10% write + 90% read (Zipf 90/10)
console.log('\n== Composite 10%write/90%read (5-key) ==');
{
  let i = 0;
  const cached = Object.freeze({ ...PARAMS_5 });
  bench('current (write=freeze, read=ref)', () => {
    if ((i++) % 10 === 0) {
      const o = { ...PARAMS_5 };
      Object.freeze(o);
      return o;
    }
    return cached;
  });
  let j = 0;
  const cachedMut = { ...PARAMS_5 };
  bench('ULTIMATE (write=raw, read=spread)', () => {
    if ((j++) % 10 === 0) {
      return { ...PARAMS_5 };
    }
    return { ...cachedMut };
  });
}
