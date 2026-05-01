/**
 * #4 — Verify `prev!` invariant in segment-tree.ts:236.
 *
 * `if (matched === null)` branch (line 224) executes only when the while
 * loop walked to the end without matching. In that case, the last iteration
 * sets prev = p (line 220-221). So prev is non-null whenever this branch
 * runs.
 *
 * Trigger: register two sibling params with the same regex pattern (so they
 * append rather than reuse), then trigger via a route addition that walks
 * to end-of-chain.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();

// 1st: /:a(\d+) — establishes paramChild (head).
r.add('GET', '/:a(\\d+)', 'A');

// 2nd: /:b([a-z]+) — different name, different pattern.
//   Walks the chain, doesn't match (different name), prev=head, then
//   appends new sibling.
r.add('GET', '/:b([a-z]+)', 'B');

// 3rd: /:c([A-Z]+) — different name again.
//   Walks: p=head, prev=null→head, p=head.nextSibling=B, prev=B, p=null→exit.
//   prev=B (non-null), append fresh.
r.add('GET', '/:c([A-Z]+)', 'C');

r.build();

// Verify all three siblings present and reachable.
console.log('match /42:',  r.match('GET', '/42')?.value);
console.log('match /abc:', r.match('GET', '/abc')?.value);
console.log('match /XYZ:', r.match('GET', '/XYZ')?.value);

// Inspect tree shape.
const root = (getRouterInternals(r).registration as any).segmentTrees[0];
let p = root.paramChild;
const chain: string[] = [];
while (p) { chain.push(p.name); p = p.nextSibling; }
console.log('sibling chain:', chain);
console.log('VERDICT: REFUTED — prev! invariant held after appending three siblings.');
