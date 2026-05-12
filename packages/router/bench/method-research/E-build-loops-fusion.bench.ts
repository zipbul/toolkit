/**
 * E) `build.ts` walks `methodRegistry.getAllCodes()` twice — once to
 * populate `trees[code]` (segment walker per method), once to filter
 * `activeMethodCodes` (methods that actually have routes). Could fuse
 * to one pass. Build-time only, but worth measuring before claiming
 * "no further optimization".
 *
 * Simulate the build loop work with stand-in functions; real
 * createSegmentWalker is too heavy to isolate here.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

import { MethodRegistry } from '../../src/method-registry';

function makeRegistry(custom: number): MethodRegistry {
  const r = new MethodRegistry();
  for (let i = 0; i < custom; i++) {
    r.getOrCreate(`CUSTOM_${i}`);
  }
  return r;
}

// Stub for createSegmentWalker — returns a function (closure alloc).
function makeWalker(code: number): (s: string) => boolean {
  return (s: string) => s.length > code;
}

interface Snapshot {
  segmentTrees: Array<unknown | null>;
  staticByMethod: Array<unknown | undefined>;
}

function makeSnapshot(reg: MethodRegistry): Snapshot {
  const trees: Array<unknown | null> = [];
  const statics: Array<unknown | undefined> = [];
  for (const [, code] of reg.getAllCodes()) {
    // Half have trees, half have statics — realistic-ish.
    trees[code] = code % 2 === 0 ? {} : null;
    statics[code] = code % 3 === 0 ? {} : undefined;
  }
  return { segmentTrees: trees, staticByMethod: statics };
}

// ── Current 2-loop build ──
function buildTwoLoops(reg: MethodRegistry, snap: Snapshot): {
  trees: Array<((s: string) => boolean) | null>;
  active: Array<readonly [string, number]>;
} {
  const allCodes = reg.getAllCodes();
  const trees: Array<((s: string) => boolean) | null> = [];

  for (const [, code] of allCodes) {
    const segRoot = snap.segmentTrees[code];
    if (segRoot !== null && segRoot !== undefined) trees[code] = makeWalker(code);
    else trees[code] = null;
  }

  const active: Array<readonly [string, number]> = [];
  for (const [name, code] of allCodes) {
    if (trees[code] != null || snap.staticByMethod[code] !== undefined) {
      active.push([name, code]);
    }
  }
  return { trees, active };
}

// ── Fused 1-loop build ──
function buildOneLoop(reg: MethodRegistry, snap: Snapshot): {
  trees: Array<((s: string) => boolean) | null>;
  active: Array<readonly [string, number]>;
} {
  const trees: Array<((s: string) => boolean) | null> = [];
  const active: Array<readonly [string, number]> = [];
  for (const [name, code] of reg.getAllCodes()) {
    const segRoot = snap.segmentTrees[code];
    let tree: ((s: string) => boolean) | null = null;
    if (segRoot !== null && segRoot !== undefined) tree = makeWalker(code);
    trees[code] = tree;
    if (tree !== null || snap.staticByMethod[code] !== undefined) {
      active.push([name, code]);
    }
  }
  return { trees, active };
}

async function main() {
  for (const customs of [0, 8, 25] as const) {
    const reg = makeRegistry(customs);
    const snap = makeSnapshot(reg);

    // Sanity: both produce identical output.
    const a = buildTwoLoops(reg, snap);
    const b = buildOneLoop(reg, snap);
    if (a.trees.length !== b.trees.length || a.active.length !== b.active.length) {
      console.error('!! mismatch — fusion changes semantics');
      process.exit(1);
    }
    for (let i = 0; i < a.active.length; i++) {
      if (a.active[i]![0] !== b.active[i]![0] || a.active[i]![1] !== b.active[i]![1]) {
        console.error('!! active codes differ');
        process.exit(1);
      }
    }

    console.log(`\n=== ${7 + customs} methods (${customs} custom) ===`);
    summary(() => {
      bench('current — 2-loop', () => {
        do_not_optimize(buildTwoLoops(reg, snap));
      });
      bench('fused — 1-loop', () => {
        do_not_optimize(buildOneLoop(reg, snap));
      });
    });
  }

  await run();
}

main();
