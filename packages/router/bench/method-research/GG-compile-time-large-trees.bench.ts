/**
 * GG) Push compileSegmentTree to its real limits. Originally written to
 * prove `COMPILE_OBSERVED_HARD_MS = 10` (the per-shape disable threshold)
 * could never trip under the `MAX_NODES_DEFAULT = 256` cap — p99 was
 * 4.33 ms at the ceiling. The disable feedback was removed in `55dbf27`
 * on that evidence; the bench survives as a regression probe on compile
 * time at the node-count ceiling so a future blow-up surfaces here.
 */
import { compileSegmentTree } from '../../src/codegen/segment-compile';
import { createSegmentNode, insertIntoSegmentTree } from '../../src/matcher/segment-tree';
import { performance } from 'node:perf_hooks';

function makeWide(routes: number, depth: number) {
  // Each route: /seg_0_R/seg_1_R/.../seg_D_R — gives `routes * depth` nodes.
  const root = createSegmentNode();
  const cache = new Map();
  for (let r = 0; r < routes; r++) {
    const segs: string[] = [];
    for (let d = 0; d < depth; d++) segs.push(`seg_${d}_${r}`);
    insertIntoSegmentTree(
      root,
      segs.map(s => ({ type: 'static', value: `/${s}`, segments: [s] })) as any,
      r,
      cache as any,
      r,
      [],
    );
  }
  return root;
}

async function main() {
  console.log('=== compile time distribution near MAX_NODES_DEFAULT (256) ===');
  for (const [routes, depth] of [
    [1, 256], [1, 200],
    [10, 25], [50, 5], [100, 2], [200, 1], [250, 1],
  ] as const) {
    const samples: number[] = [];
    let bailed = false;
    for (let trial = 0; trial < 10; trial++) {
      const tree = makeWide(routes, depth);
      const t0 = performance.now();
      const r = compileSegmentTree(tree);
      const ms = performance.now() - t0;
      if (r === null) { bailed = true; break; }
      samples.push(ms);
    }
    if (bailed) {
      console.log(`  routes=${String(routes).padStart(3)} depth=${String(depth).padStart(3)}  BAILED`);
      continue;
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)]!;
    const p99 = samples[samples.length - 1]!;
    const flag = p50 > 10 ? '⚠ over 10ms' : '';
    console.log(`  routes=${String(routes).padStart(3)} depth=${String(depth).padStart(3)} nodes~${routes * depth}  p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms ${flag}`);
  }
}

main();
