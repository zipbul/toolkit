/**
 * V2: hot-path Map.get(mc) vs Array index.
 *
 * Scenario: emitter.ts dispatch — methodCache.get(mc) called twice.
 * mc is 0-31 SMI. 8 active methods.
 *   - baseline: Map<number, RouterCache>, .get(mc) × 2
 *   - proposed: Array<RouterCache> indexed by mc (sparse), [mc] × 2
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

class FakeCache {
  hits = 0;
  store: Record<string, number> = Object.create(null);
  constructor(public mc: number) {}
}

const ACTIVE: number[] = [0, 1, 2, 3, 5, 7, 11, 13]; // 8 sparse method codes 0-31

const m = new Map<number, FakeCache>();
for (const mc of ACTIVE) m.set(mc, new FakeCache(mc));

const a: (FakeCache | undefined)[] = new Array(32);
for (const mc of ACTIVE) a[mc] = new FakeCache(mc);

let cursor = 0;
const seq: number[] = new Array(1024);
for (let i = 0; i < 1024; i++) seq[i] = ACTIVE[i % ACTIVE.length];

summary(() => {
  bench('V2: Map<number,Cache>.get(mc) x2', () => {
    const mc = seq[cursor++ & 1023];
    const c1 = m.get(mc);
    const c2 = m.get(mc);
    do_not_optimize(c1);
    do_not_optimize(c2);
  });
  bench('V2: Array<Cache>[mc] x2 (sparse 32)', () => {
    const mc = seq[cursor++ & 1023];
    const c1 = a[mc];
    const c2 = a[mc];
    do_not_optimize(c1);
    do_not_optimize(c2);
  });
});

await run();
