/* eslint-disable no-console */
/**
 * PoC: measure actual ns cost of 1-step lookahead per segment.
 * Compares:
 *   A. Current walker style (per-segment dispatch, no lookahead)
 *   B. Walker with lookahead at each "optional" position
 *
 * Goal: replace the +3-5ns guesstimate with real measurement.
 */
import { performance } from 'node:perf_hooks';

function bench(label: string, fn: () => unknown, iter = 10_000_000): number {
  for (let i = 0; i < 200_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(60)} ${ns.toFixed(2).padStart(7)} ns`);
  return ns;
}

// Synthetic 5-segment URL: /api/v1/users/123/posts
const url = '/api/v1/users/123/posts';
const len = url.length;

// Static lookup table for next-segment dispatch.
const dispatchA: Record<string, number> = Object.create(null);
dispatchA['api'] = 1;
dispatchA['v1'] = 2;
dispatchA['users'] = 3;
dispatchA['123'] = 4;
dispatchA['posts'] = 5;

// "Optional" lookup table — lookahead set for one optional position.
const optionalSkipSet: Record<string, number> = Object.create(null);
optionalSkipSet['users'] = 1;
optionalSkipSet['posts'] = 1;

console.log('== A. Current walker — 5 segments, no lookahead ==');
bench('per-segment scan + dispatch (5 seg)', () => {
  let pos = 1;
  let last = 0;
  while (pos < len) {
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = url.substring(pos, end);
    const next = dispatchA[seg];
    if (next === undefined) return null;
    last = next;
    pos = end === len ? len : end + 1;
  }
  return last;
});

console.log('\n== B. With 1-step lookahead at one position ==');
bench('per-segment + 1 lookahead', () => {
  let pos = 1;
  let last = 0;
  let lookaheadAt = 2; // lookahead at 3rd segment
  let segIdx = 0;
  while (pos < len) {
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = url.substring(pos, end);

    // Lookahead probe at one position
    if (segIdx === lookaheadAt) {
      const skip = optionalSkipSet[seg];
      if (skip !== undefined) {
        // pretend we'd skip; for measurement just fall through
      }
    }

    const next = dispatchA[seg];
    if (next === undefined) return null;
    last = next;
    pos = end === len ? len : end + 1;
    segIdx++;
  }
  return last;
});

console.log('\n== C. With lookahead at every position (worst case) ==');
bench('per-segment + lookahead every step', () => {
  let pos = 1;
  let last = 0;
  while (pos < len) {
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = url.substring(pos, end);

    // Lookahead every iteration
    const skip = optionalSkipSet[seg];
    if (skip !== undefined) { /* would skip */ }

    const next = dispatchA[seg];
    if (next === undefined) return null;
    last = next;
    pos = end === len ? len : end + 1;
  }
  return last;
});

console.log('\n== D. Branch on optional flag (more realistic) ==');
type Node = { isOptional: boolean; skipNext?: Set<string> };
const nodes: Node[] = [
  { isOptional: false },
  { isOptional: false },
  { isOptional: true, skipNext: new Set(['posts']) },
  { isOptional: false },
  { isOptional: false },
];
bench('per-segment + isOptional branch + Set.has', () => {
  let pos = 1;
  let last = 0;
  let segIdx = 0;
  while (pos < len) {
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = url.substring(pos, end);

    const node = nodes[segIdx]!;
    if (node.isOptional) {
      if (node.skipNext!.has(seg)) {
        // skip this optional, advance segIdx but not pos
        segIdx++;
        continue;
      }
    }

    const next = dispatchA[seg];
    if (next === undefined) return null;
    last = next;
    pos = end === len ? len : end + 1;
    segIdx++;
  }
  return last;
});
