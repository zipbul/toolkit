/**
 * D) `MethodRegistry.restore()` cost & lasting effect on hot-path
 * lookups.
 *
 * `restore()` walks `for (const key in codeMap) delete codeMap[key]`,
 * then re-inserts. JSC may transition the object into "dictionary mode"
 * once `delete` is observed, which permanently degrades property-load
 * IC even after re-population.
 *
 * Measure:
 *   1. Lookup cost on a fresh registry.
 *   2. Lookup cost on a registry that has been restore()'d N times.
 *   3. jscDescribe shape comparison before/after restore.
 */

import { jscDescribe, optimizeNextInvocation } from 'bun:jsc';
import { run, bench, summary, do_not_optimize } from 'mitata';

import { MethodRegistry } from '../../src/method-registry';

function freshRegistry(): MethodRegistry {
  return new MethodRegistry();
}

function restoredRegistry(n: number): MethodRegistry {
  const r = new MethodRegistry();
  // Add a few customs so snapshot has more entries than defaults.
  r.getOrCreate('PROPFIND');
  r.getOrCreate('MKCOL');
  const snap = r.snapshot();
  for (let i = 0; i < n; i++) r.restore(snap);
  return r;
}

const TARGETS = ['GET','POST','PUT','PROPFIND','MKCOL'];

function dispatch(reg: MethodRegistry, m: string): number {
  const codeMap = reg.getCodeMap();
  return codeMap[m] ?? -1;
}

async function main() {
  const fresh = freshRegistry();
  fresh.getOrCreate('PROPFIND'); fresh.getOrCreate('MKCOL');
  const restored1 = restoredRegistry(1);
  const restored10 = restoredRegistry(10);
  const restored100 = restoredRegistry(100);

  console.log('=== Phase 1: jscDescribe of codeMap ===');
  console.log('fresh        :', jscDescribe(fresh.getCodeMap()));
  console.log('restored×1   :', jscDescribe(restored1.getCodeMap()));
  console.log('restored×10  :', jscDescribe(restored10.getCodeMap()));
  console.log('restored×100 :', jscDescribe(restored100.getCodeMap()));

  // Warm.
  for (let i = 0; i < 1000; i++) {
    for (const t of TARGETS) {
      do_not_optimize(dispatch(fresh, t));
      do_not_optimize(dispatch(restored1, t));
      do_not_optimize(dispatch(restored10, t));
      do_not_optimize(dispatch(restored100, t));
    }
  }
  optimizeNextInvocation(dispatch);

  const N = 1024;
  console.log('\n=== Phase 2: lookup cost (1024 dispatches/op) ===');
  summary(() => {
    bench('fresh registry (no restore)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) acc += dispatch(fresh, TARGETS[i % TARGETS.length]!);
      do_not_optimize(acc);
    });
    bench('restored ×1', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) acc += dispatch(restored1, TARGETS[i % TARGETS.length]!);
      do_not_optimize(acc);
    });
    bench('restored ×10', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) acc += dispatch(restored10, TARGETS[i % TARGETS.length]!);
      do_not_optimize(acc);
    });
    bench('restored ×100', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) acc += dispatch(restored100, TARGETS[i % TARGETS.length]!);
      do_not_optimize(acc);
    });
  });

  // Restore() itself cost.
  console.log('\n=== Phase 3: restore() call cost ===');
  const r = new MethodRegistry();
  r.getOrCreate('PROPFIND'); r.getOrCreate('MKCOL');
  const snap = r.snapshot();
  summary(() => {
    bench('snapshot()', () => {
      do_not_optimize(r.snapshot());
    });
    bench('restore(snap)', () => {
      r.restore(snap);
      do_not_optimize(r);
    });
  });

  await run();
}

main();
