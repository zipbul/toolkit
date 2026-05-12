/**
 * S) SegmentNode has 9 fields. JSC inline slot is typically 6 — fields
 * past the 6th go out-of-line (OOL). Test:
 *   1. inspect actual hidden class via bun:jsc.describe
 *   2. measure read cost on inline (first 6) vs OOL (7-9) fields
 *   3. compare against a 6-field alternative (sidecar WeakMap for
 *      rare wildcard fields)
 */

import { jscDescribe, optimizeNextInvocation } from 'bun:jsc';
import { run, bench, summary, do_not_optimize } from 'mitata';

import { createSegmentNode } from '../../src/matcher/segment-tree';

interface Compact6 {
  store: number | null;
  staticChildren: Record<string, Compact6> | null;
  singleChildKey: string | null;
  singleChildNext: Compact6 | null;
  paramChild: unknown | null;
  staticPrefix: string[] | null;
}

function makeCompact6(): Compact6 {
  return {
    store: null, staticChildren: null,
    singleChildKey: null, singleChildNext: null,
    paramChild: null, staticPrefix: null,
  };
}

async function main() {
  const node = createSegmentNode();
  const c6 = makeCompact6();

  console.log('=== Phase 1: SegmentNode shape vs Compact6 ===');
  console.log('SegmentNode (9 fields):', jscDescribe(node).slice(0, 240));
  console.log('Compact6    (6 fields):', jscDescribe(c6).slice(0, 240));

  // Populate with realistic values to trigger any inline-vs-OOL transitions.
  node.store = 5;
  node.staticChildren = Object.create(null);
  node.singleChildKey = 'users';
  node.wildcardName = 'tail';
  node.wildcardOrigin = 'star';
  node.wildcardStore = 7;

  console.log('\nPopulated SegmentNode :', jscDescribe(node).slice(0, 280));

  // Inline-field vs OOL-field read cost.
  function readInline(n: { store: number | null; staticChildren: unknown; singleChildKey: string | null }): number {
    return (n.store ?? 0) + (n.staticChildren !== null ? 1 : 0) + (n.singleChildKey !== null ? 1 : 0);
  }
  function readOOL(n: { wildcardStore: number | null; wildcardName: string | null; wildcardOrigin: string | null }): number {
    return (n.wildcardStore ?? 0) + (n.wildcardName !== null ? 1 : 0) + (n.wildcardOrigin !== null ? 1 : 0);
  }
  function readMixed(n: { store: number | null; wildcardStore: number | null }): number {
    return (n.store ?? 0) + (n.wildcardStore ?? 0);
  }

  // Warm.
  for (let i = 0; i < 5000; i++) {
    do_not_optimize(readInline(node));
    do_not_optimize(readOOL(node));
    do_not_optimize(readMixed(node));
  }
  optimizeNextInvocation(readInline);
  optimizeNextInvocation(readOOL);
  optimizeNextInvocation(readMixed);

  const N = 1024;
  console.log('\n=== Phase 2: read cost (1024/op) ===');
  summary(() => {
    bench('read 3 inline fields (store/staticChildren/singleChildKey)', () => {
      let s = 0;
      for (let i = 0; i < N; i++) s += readInline(node);
      do_not_optimize(s);
    });
    bench('read 3 OOL fields (wildcardStore/Name/Origin)', () => {
      let s = 0;
      for (let i = 0; i < N; i++) s += readOOL(node);
      do_not_optimize(s);
    });
    bench('read mixed (store + wildcardStore)', () => {
      let s = 0;
      for (let i = 0; i < N; i++) s += readMixed(node);
      do_not_optimize(s);
    });
  });

  await run();
}

main();
