/**
 * K) `methodNameByCode` is built via `names[code] = name` for each active
 * method's code. With default code 0..6 active, the array is dense; if a
 * custom method registers code 7 then deletes (registers + un-registers
 * happens at construction only) the array can have holes.
 *
 * Hypothesis: a dense (hole-free) array yields monomorphic IC; a sparse
 * array (with `<empty>` slots) might trigger SparseArrayValueMap or
 * polymorphic load.
 *
 * Test: build dense vs sparse arrays, measure access cost.
 */

import { jscDescribe, optimizeNextInvocation } from 'bun:jsc';
import { run, bench, summary, do_not_optimize } from 'mitata';

function buildDense(activeCodes: ReadonlyArray<readonly [string, number]>): string[] {
  // codes are contiguous 0..N-1
  const a: string[] = [];
  for (const [name, code] of activeCodes) a[code] = name;
  return a;
}

function buildSparse(activeCodes: ReadonlyArray<readonly [string, number]>): string[] {
  // codes have holes (e.g. 0,1,2,5,7,9)
  const a: string[] = [];
  for (const [name, code] of activeCodes) a[code] = name;
  return a;
}

const DENSE: ReadonlyArray<readonly [string, number]> = [
  ['GET',0],['POST',1],['PUT',2],['PATCH',3],['DELETE',4],['OPTIONS',5],['HEAD',6],
];
const SPARSE: ReadonlyArray<readonly [string, number]> = [
  ['GET',0],['POST',1],['DELETE',4],['HEAD',6],['PROPFIND',9],['MKCOL',15],['LOCK',24],
];

function lookup(arr: string[], code: number): string | undefined { return arr[code]; }

async function main() {
  const dense = buildDense(DENSE);
  const sparse = buildSparse(SPARSE);

  console.log('=== Phase 1: structure inspection ===');
  console.log('dense  :', jscDescribe(dense).slice(0, 200));
  console.log('sparse :', jscDescribe(sparse).slice(0, 200));
  console.log('dense.length =', dense.length, ', sparse.length =', sparse.length);

  // Warm.
  const denseProbes = [0,1,2,3,4,5,6];
  const sparseProbes = [0,1,4,6,9,15,24];
  for (let i = 0; i < 5000; i++) {
    for (const c of denseProbes) do_not_optimize(lookup(dense, c));
    for (const c of sparseProbes) do_not_optimize(lookup(sparse, c));
  }
  optimizeNextInvocation(lookup);

  const N = 1024;
  console.log('\n=== Phase 2: lookup cost (1024/op, 7 probes per iter) ===');
  summary(() => {
    bench('dense (codes 0..6 contiguous)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) for (const c of denseProbes) {
        const v = lookup(dense, c); if (v !== undefined) acc++;
      }
      do_not_optimize(acc);
    });
    bench('sparse (codes 0,1,4,6,9,15,24)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) for (const c of sparseProbes) {
        const v = lookup(sparse, c); if (v !== undefined) acc++;
      }
      do_not_optimize(acc);
    });
  });

  console.log('\n=== Phase 3: missed-slot access on sparse (hole probe) ===');
  const holeProbes = [2,3,5,7,8,10,11,12,13,14]; // all holes in sparse
  summary(() => {
    bench('sparse hole access (all undefined)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) for (const c of holeProbes) {
        const v = lookup(sparse, c); if (v === undefined) acc++;
      }
      do_not_optimize(acc);
    });
  });

  await run();
}

main();
