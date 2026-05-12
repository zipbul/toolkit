/**
 * A) JSC hidden class stability for `MethodRegistry.codeMap`.
 *
 * Production builds the codeMap by inserting the 7 defaults in the
 * constructor, then adding any user-declared custom methods on demand.
 * If JSC's hidden-class tracking transitions through the same chain on
 * every router instance (deterministic order), inline caches stay
 * monomorphic; if user-declared methods arrive in different orders per
 * router, the chain forks → polymorphic IC → property-load tax.
 *
 * Empirical test plan:
 *   1. Build many MethodRegistry-equivalent objects with the 7 default
 *      methods, then add custom methods in different permutations across
 *      instances.
 *   2. Use `jscDescribe` (bun:jsc) to read each object's structure id.
 *   3. Compare hot-path lookup cost on (a) deterministic-order
 *      registries vs (b) permutation-order registries to see the IC
 *      penalty empirically — even without parsing structure IDs, a
 *      polymorphic IC slows lookup measurably.
 */

import { jscDescribe, optimizeNextInvocation } from 'bun:jsc';
import { run, bench, summary, do_not_optimize } from 'mitata';

const DEFAULTS = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'] as const;
const CUSTOMS = ['PROPFIND','MKCOL','COPY','MOVE','LOCK','UNLOCK','REPORT','SEARCH'] as const;

function makeRegistryDeterministic(): Record<string, number> {
  const r = Object.create(null) as Record<string, number>;
  let n = 0;
  for (const m of DEFAULTS) r[m] = n++;
  for (const m of CUSTOMS)  r[m] = n++;
  return r;
}

function makeRegistryPermuted(seed: number): Record<string, number> {
  const r = Object.create(null) as Record<string, number>;
  let n = 0;
  for (const m of DEFAULTS) r[m] = n++; // defaults always same order
  // Permute customs based on seed.
  const customs = [...CUSTOMS];
  for (let i = customs.length - 1; i > 0; i--) {
    const j = (seed * 31 + i * 17) % (i + 1);
    [customs[i], customs[j]] = [customs[j]!, customs[i]!];
  }
  for (const m of customs) r[m] = n++;
  return r;
}

// ── Phase 1 — print structure descriptions ──
function printStructures(): void {
  console.log('=== Phase 1: structure inspection ===');
  const det1 = makeRegistryDeterministic();
  const det2 = makeRegistryDeterministic();
  console.log('det1:', jscDescribe(det1));
  console.log('det2:', jscDescribe(det2));

  for (let s = 0; s < 4; s++) {
    const p = makeRegistryPermuted(s);
    console.log(`perm seed=${s}:`, jscDescribe(p));
  }
}

// ── Phase 2 — IC behavior — same site dispatching across many shapes ──
const TARGETS = ['GET','POST','PROPFIND','LOCK'];

function dispatch(reg: Record<string, number>, m: string): number {
  return reg[m] ?? -1;
}

async function main() {
  printStructures();

  // Build N registries with deterministic vs permuted order.
  const N = 64;
  const detRegs: Record<string, number>[] = [];
  const permRegs: Record<string, number>[] = [];
  for (let i = 0; i < N; i++) {
    detRegs.push(makeRegistryDeterministic());
    permRegs.push(makeRegistryPermuted(i));
  }

  // Single-shape stress: same registry repeatedly (pure monomorphic).
  const single = makeRegistryDeterministic();

  // Force tier-up.
  for (let warm = 0; warm < 1000; warm++) {
    for (const t of TARGETS) {
      do_not_optimize(dispatch(single, t));
      do_not_optimize(dispatch(detRegs[warm % N]!, t));
      do_not_optimize(dispatch(permRegs[warm % N]!, t));
    }
  }
  optimizeNextInvocation(dispatch);

  console.log('\n=== Phase 2: IC behavior — 4 method targets ×  N=64 registries ===');
  summary(() => {
    bench('single registry (monomorphic IC)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) for (const t of TARGETS) acc += dispatch(single, t);
      do_not_optimize(acc);
    });
    bench('N deterministic registries (same shape chain)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) for (const t of TARGETS) acc += dispatch(detRegs[i]!, t);
      do_not_optimize(acc);
    });
    bench('N permuted registries (forked shape chains)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) for (const t of TARGETS) acc += dispatch(permRegs[i]!, t);
      do_not_optimize(acc);
    });
  });

  await run();
}

main();
