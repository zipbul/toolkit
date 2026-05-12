/**
 * BB) COMPILE_OBSERVED_HARD_MS = 10. If a shape ever exceeds this, it's
 * permanently disabled. Test: is 10ms achievable on a normal machine
 * for shapes that should compile? Simulate moderate-sized trees and
 * measure the actual compile time distribution.
 */
import { compileSegmentTree } from '../../src/codegen/segment-compile';
import { createSegmentNode, insertIntoSegmentTree } from '../../src/matcher/segment-tree';
import { performance } from 'node:perf_hooks';

function makeTree(routes: number) {
  const root = createSegmentNode();
  const cache = new Map();
  for (let i = 0; i < routes; i++) {
    insertIntoSegmentTree(
      root,
      [{ type: 'static', value: `/p${i}`, segments: [`p${i}`] }] as any,
      i,
      cache as any,
      i,
    );
  }
  return root;
}

async function main() {
  console.log('=== compile time distribution per tree size ===');
  for (const routes of [10, 50, 100, 200, 500, 1000] as const) {
    const samples: number[] = [];
    for (let trial = 0; trial < 10; trial++) {
      const tree = makeTree(routes);
      const t0 = performance.now();
      const r = compileSegmentTree(tree);
      const ms = performance.now() - t0;
      samples.push(ms);
      if (r === null) { console.log(`  ${routes} routes — BAILED (no codegen)`); break; }
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)]!;
    const p99 = samples[samples.length - 1]!;
    console.log(`  ${String(routes).padStart(4)} routes: p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms  ${p50 > 10 ? '⚠ over hard threshold' : ''}`);
  }
}

main();
