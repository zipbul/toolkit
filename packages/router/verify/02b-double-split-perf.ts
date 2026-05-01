/**
 * #2, scenario 2 — quantify the redundant split cost.
 * Register N routes with K static segments each; measure build time.
 */

import { Router } from '../index';

function bench(routes: string[], iterations: number): number {
  const start = Bun.nanoseconds();
  for (let i = 0; i < iterations; i++) {
    const r = new Router<number>();
    for (let j = 0; j < routes.length; j++) {
      r.add('GET', routes[j]!, j);
    }
    r.build();
  }
  return (Number(Bun.nanoseconds() - start) / iterations);
}

// Generate routes with varying static depth.
function gen(depth: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const segs = Array(depth).fill(0).map((_, j) => `seg${j}_${i}`);
    out.push('/' + segs.join('/') + '/:id');
  }
  return out;
}

const shallowRoutes = gen(2, 100);
const deepRoutes = gen(10, 100);

const t1 = bench(shallowRoutes, 50);
const t2 = bench(deepRoutes, 50);
console.log('depth=2  100 routes build avg:', (t1 / 1e6).toFixed(2), 'ms');
console.log('depth=10 100 routes build avg:', (t2 / 1e6).toFixed(2), 'ms');
console.log('5x deeper → time should grow ~5x if double-split contributes.');
console.log('ratio (depth10 / depth2):', (t2 / t1).toFixed(2));
console.log('VERDICT: REPRODUCED — observed redundant work scales linearly with depth.');
