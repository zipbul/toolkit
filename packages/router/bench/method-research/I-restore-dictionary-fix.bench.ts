/**
 * I) Compare three `restore()` implementations:
 *   1. current — `delete` keys + reinsert (UncacheableDictionary after ~10 cycles)
 *   2. swap — assign a fresh `Object.create(null)` and rewire (no delete,
 *      stays in PropertyAddition chain)
 *   3. clear-via-Object.keys + reinsert — same as #1 conceptually
 *
 * Then measure hot-path lookup AFTER tier-up (`optimizeNextInvocation`)
 * to see if dictionary mode actually penalizes a JIT-promoted call site.
 */

import { jscDescribe, optimizeNextInvocation } from 'bun:jsc';
import { run, bench, summary, do_not_optimize } from 'mitata';

interface Snap { entries: Array<[string, number]>; nextOffset: number }
const DEFAULTS: ReadonlyArray<[string, number]> = [
  ['GET',0],['POST',1],['PUT',2],['PATCH',3],['DELETE',4],['OPTIONS',5],['HEAD',6],
];

// Approach 1: current (delete + reinsert) — like production MethodRegistry
class RegDelete {
  codeMap: Record<string, number> = Object.create(null);
  next = 0;
  constructor() { for (const [k,v] of DEFAULTS) { this.codeMap[k] = v; this.next++; } }
  add(m: string): number { if (this.codeMap[m] !== undefined) return this.codeMap[m]!; const o = this.next++; this.codeMap[m] = o; return o; }
  snapshot(): Snap { const e: Array<[string,number]> = []; for (const k in this.codeMap) e.push([k, this.codeMap[k]!]); return { entries: e, nextOffset: this.next }; }
  restore(s: Snap) { for (const k in this.codeMap) delete this.codeMap[k]; for (const [k,v] of s.entries) this.codeMap[k] = v; this.next = s.nextOffset; }
}

// Approach 2: swap whole object (avoid dictionary mode)
class RegSwap {
  codeMap: Record<string, number> = Object.create(null);
  next = 0;
  constructor() { for (const [k,v] of DEFAULTS) { this.codeMap[k] = v; this.next++; } }
  add(m: string): number { if (this.codeMap[m] !== undefined) return this.codeMap[m]!; const o = this.next++; this.codeMap[m] = o; return o; }
  snapshot(): Snap { const e: Array<[string,number]> = []; for (const k in this.codeMap) e.push([k, this.codeMap[k]!]); return { entries: e, nextOffset: this.next }; }
  restore(s: Snap) {
    const fresh = Object.create(null) as Record<string, number>;
    for (const [k,v] of s.entries) fresh[k] = v;
    this.codeMap = fresh;
    this.next = s.nextOffset;
  }
}

function build(reg: RegDelete | RegSwap, restoreCount: number): RegDelete | RegSwap {
  reg.add('PROPFIND'); reg.add('MKCOL');
  const snap = reg.snapshot();
  for (let i = 0; i < restoreCount; i++) reg.restore(snap);
  return reg;
}

const TARGETS = ['GET','POST','PUT','PROPFIND','MKCOL'];

function dispatch(reg: RegDelete | RegSwap, m: string): number {
  return reg.codeMap[m] ?? -1;
}

async function main() {
  console.log('=== Phase 1: structure inspection after restore cycles ===');
  for (const cycles of [0, 1, 10, 100]) {
    const a = build(new RegDelete(), cycles);
    const b = build(new RegSwap(), cycles);
    console.log(`\nrestore×${cycles}:`);
    console.log(`  RegDelete:`, jscDescribe(a.codeMap).slice(0, 200));
    console.log(`  RegSwap  :`, jscDescribe(b.codeMap).slice(0, 200));
  }

  // Tier-up.
  const tierWarmDel = build(new RegDelete(), 100);
  const tierWarmSwap = build(new RegSwap(), 100);
  for (let i = 0; i < 5000; i++) for (const t of TARGETS) {
    do_not_optimize(dispatch(tierWarmDel, t));
    do_not_optimize(dispatch(tierWarmSwap, t));
  }
  optimizeNextInvocation(dispatch);

  const N = 1024;
  console.log('\n=== Phase 2: hot-path lookup (post tier-up, 1024/op) ===');
  summary(() => {
    bench('RegDelete (UncacheableDictionary)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) acc += dispatch(tierWarmDel, TARGETS[i % TARGETS.length]!);
      do_not_optimize(acc);
    });
    bench('RegSwap (PropertyAddition chain)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) acc += dispatch(tierWarmSwap, TARGETS[i % TARGETS.length]!);
      do_not_optimize(acc);
    });
  });

  console.log('\n=== Phase 3: restore() call cost ===');
  const r1 = new RegDelete(); r1.add('PROPFIND'); r1.add('MKCOL');
  const r2 = new RegSwap(); r2.add('PROPFIND'); r2.add('MKCOL');
  const snap = r1.snapshot();
  summary(() => {
    bench('RegDelete.restore', () => { r1.restore(snap); do_not_optimize(r1); });
    bench('RegSwap.restore', () => { r2.restore(snap); do_not_optimize(r2); });
  });

  await run();
}

main();
