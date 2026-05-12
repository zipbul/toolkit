/**
 * Z) Sweep WARMUP_ITERATIONS values 0/5/10/20/40 by manually instrumenting
 * the warmup loop. Measures first-call latency post-warmup.
 */
import { compileSegmentTree, collectWarmupPaths } from '../../src/codegen/segment-compile';
import { TESTER_PASS } from '../../src/matcher/pattern-tester';
import { decoder } from '../../src/matcher/decoder';
import { createSegmentNode, insertIntoSegmentTree } from '../../src/matcher/segment-tree';
import { createMatchState } from '../../src/matcher/match-state';
import { performance } from 'node:perf_hooks';

function buildTreeWith(routes: number) {
  const root = createSegmentNode();
  const cache = new Map();
  for (let i = 0; i < routes; i++) {
    insertIntoSegmentTree(root, [{ type: 'static', value: `/p${i}`, segments: [`p${i}`] }] as any, i, cache as any, i);
  }
  return root;
}

function probeWarmupCount(warmupCount: number, routes: number): number {
  const root = buildTreeWith(routes);
  const compiled = compileSegmentTree(root);
  if (!compiled) return -1;
  const fn = compiled.factory(compiled.testers, TESTER_PASS, decoder);
  const paths = collectWarmupPaths(root);
  const state = createMatchState();
  for (let it = 0; it < warmupCount; it++) {
    for (const p of paths) { try { fn(p, state); } catch {} }
  }
  // Now measure first "real" call.
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) try { fn(paths[0]!, state); } catch {}
  return (performance.now() - t0) * 1e6 / 1000;
}

async function main() {
  for (const routes of [10, 50, 200] as const) {
    console.log(`\n=== ${routes} routes — first-call latency by warmup count ===`);
    for (const warmup of [0, 5, 10, 20, 40, 80] as const) {
      const samples: number[] = [];
      for (let trial = 0; trial < 5; trial++) samples.push(probeWarmupCount(warmup, routes));
      samples.sort((a, b) => a - b);
      const median = samples[2]!;
      console.log(`  warmup=${String(warmup).padStart(3)}: median=${median.toFixed(2)} ns/call (samples: ${samples.map(s => s.toFixed(0)).join(', ')})`);
    }
  }
}

main();
