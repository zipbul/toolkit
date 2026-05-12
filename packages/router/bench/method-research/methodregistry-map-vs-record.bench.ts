/**
 * MethodRegistry Map+Record dual-table vs Record-only.
 *
 * Production keeps a `Map<string, number>` for build-time iteration AND a
 * prototype-less `Record<string, number>` for hot-path lookup. This bench
 * checks whether the Map can be removed safely (using for-in over the
 * Record, which preserves insertion order for non-integer string keys per
 * ECMAScript OrdinaryOwnPropertyKeys), and what the cost difference is in:
 *
 *   - construction (build-time)
 *   - iteration in insertion order (build-time hot loop)
 *   - hot-path lookup (production unchanged in either case)
 *   - per-instance memory footprint
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const METHODS_DEFAULT = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'];
const METHODS_FULL = [
  ...METHODS_DEFAULT,
  'TRACE','CONNECT','PROPFIND','PROPPATCH','MKCOL','COPY','MOVE','LOCK',
  'UNLOCK','REPORT','SEARCH','BIND','REBIND','UNBIND','ACL','MKCALENDAR',
  'MKWORKSPACE','UPDATE','CHECKOUT','CHECKIN','UNCHECKOUT','MERGE',
  'BASELINE-CONTROL','MKACTIVITY',
];

class DualRegistry {
  private readonly methodToOffset = new Map<string, number>();
  private readonly codeMap: Record<string, number> = Object.create(null);
  private next = 0;
  add(m: string): number {
    const e = this.methodToOffset.get(m);
    if (e !== undefined) return e;
    const o = this.next++;
    this.methodToOffset.set(m, o);
    this.codeMap[m] = o;
    return o;
  }
  get(m: string): number | undefined { return this.methodToOffset.get(m); }
  getCodeMap(): Record<string, number> { return this.codeMap; }
  *iter(): Generator<readonly [string, number]> {
    for (const [k, v] of this.methodToOffset) yield [k, v];
  }
}

class RecordOnlyRegistry {
  private readonly codeMap: Record<string, number> = Object.create(null);
  private next = 0;
  add(m: string): number {
    const e = this.codeMap[m];
    if (e !== undefined) return e;
    const o = this.next++;
    this.codeMap[m] = o;
    return o;
  }
  get(m: string): number | undefined { return this.codeMap[m]; }
  getCodeMap(): Record<string, number> { return this.codeMap; }
  *iter(): Generator<readonly [string, number]> {
    for (const k in this.codeMap) yield [k, this.codeMap[k]!];
  }
}

// Verify insertion-order preservation property over the production set.
function verifyOrder() {
  const a = new DualRegistry();
  const b = new RecordOnlyRegistry();
  for (const m of METHODS_FULL) { a.add(m); b.add(m); }
  const aOrder = [...a.iter()].map(([k]) => k);
  const bOrder = [...b.iter()].map(([k]) => k);
  const same = aOrder.length === bOrder.length && aOrder.every((k, i) => k === bOrder[i]);
  console.log(`order match across Map vs Record (${METHODS_FULL.length} methods): ${same}`);
  if (!same) {
    console.log(`  Map order:    ${aOrder.join(',')}`);
    console.log(`  Record order: ${bOrder.join(',')}`);
  }
  return same;
}

async function main() {
  if (!verifyOrder()) {
    console.error('FATAL: order mismatch — Record can NOT replace Map');
    process.exit(1);
  }

  for (const [label, methods] of [
    ['7 methods', METHODS_DEFAULT],
    ['32 methods', METHODS_FULL],
  ] as const) {
    console.log(`\n=== ${label} — construction ===`);
    summary(() => {
      bench('Dual (Map + Record)', () => {
        const r = new DualRegistry();
        for (const m of methods) r.add(m);
        do_not_optimize(r);
      });
      bench('Record only', () => {
        const r = new RecordOnlyRegistry();
        for (const m of methods) r.add(m);
        do_not_optimize(r);
      });
    });

    const dual = new DualRegistry();
    const rec = new RecordOnlyRegistry();
    for (const m of methods) { dual.add(m); rec.add(m); }

    console.log(`\n=== ${label} — full iteration (build-time) ===`);
    summary(() => {
      bench('Dual: for of Map', () => {
        let acc = 0;
        for (const [, v] of dual.iter()) acc += v;
        do_not_optimize(acc);
      });
      bench('Record: for in', () => {
        let acc = 0;
        for (const [, v] of rec.iter()) acc += v;
        do_not_optimize(acc);
      });
    });

    console.log(`\n=== ${label} — hot-path lookup (1024 hits) ===`);
    const queries: string[] = [];
    for (let i = 0; i < 1024; i++) queries.push(methods[i % methods.length]!);
    const dualMap = dual.getCodeMap();
    const recMap = rec.getCodeMap();
    summary(() => {
      bench('Dual.codeMap[]', () => {
        let acc = 0;
        for (let i = 0; i < queries.length; i++) acc += dualMap[queries[i]!]!;
        do_not_optimize(acc);
      });
      bench('Record.codeMap[]', () => {
        let acc = 0;
        for (let i = 0; i < queries.length; i++) acc += recMap[queries[i]!]!;
        do_not_optimize(acc);
      });
    });
  }

  // Memory: build many registries and snapshot heap.
  console.log(`\n=== heap footprint @ 10000 router instances ===`);
  function gcAll() { if (typeof globalThis.gc === 'function') globalThis.gc(); }
  function heapMb() { return process.memoryUsage().heapUsed / 1e6; }

  gcAll();
  const h0 = heapMb();
  const dualArr: DualRegistry[] = [];
  for (let i = 0; i < 10000; i++) {
    const r = new DualRegistry();
    for (const m of METHODS_DEFAULT) r.add(m);
    dualArr.push(r);
  }
  gcAll();
  const h1 = heapMb();
  console.log(`Dual (Map+Record): heapDelta=+${(h1 - h0).toFixed(2)} MB`);

  const recArr: RecordOnlyRegistry[] = [];
  gcAll();
  const h2 = heapMb();
  for (let i = 0; i < 10000; i++) {
    const r = new RecordOnlyRegistry();
    for (const m of METHODS_DEFAULT) r.add(m);
    recArr.push(r);
  }
  gcAll();
  const h3 = heapMb();
  console.log(`Record only:       heapDelta=+${(h3 - h2).toFixed(2)} MB`);

  // Keep refs so they aren't GC'd during measurement.
  do_not_optimize(dualArr);
  do_not_optimize(recArr);

  await run();
}

main();
