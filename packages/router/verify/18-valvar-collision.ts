/**
 * #18 — `_t` suffix valVar collision (rewritten — force val_t emit path).
 *
 * Code path emitting val_t (segment-compile.ts:353-360):
 *   - generic param continuation
 *   - next.store !== null (next has store AND child structure → not strictTerminal)
 *
 * Setup: /:p/x  with  /:p  (the latter requires next has store + sub-tree).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/:p',   'leaf');     // :p has store
r.add('GET', '/:p/x', 'branch');   // :p has child too → val_t branch emits
r.build();

const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();

// Look for val_t pattern.
const valTRegex = /val\d+_t\b/g;
const matches = src.match(valTRegex) ?? [];
console.log('val_t identifiers found:', [...new Set(matches)]);

// Look for any duplicate var declarations.
const decls: string[] = (src.match(/var\s+(\w+)/g) ?? []).map((s: string) => s.replace(/var\s+/, ''));
const counts = new Map<string, number>();
for (const d of decls) counts.set(d, (counts.get(d) ?? 0) + 1);
const dupes = [...counts.entries()].filter(([, c]) => c > 1);
console.log('all duplicate var declarations:', dupes);

// Check if any val\d+_t collides with another val\d+ or another val\d+_t
const valIds = decls.filter((d: string) => /^val\d+(_t)?$/.test(d));
console.log('val identifiers in matchImpl:', valIds);
const valDup = new Map<string, number>();
for (const v of valIds) valDup.set(v, (valDup.get(v) ?? 0) + 1);
const valConflicts = [...valDup.entries()].filter(([, c]) => c > 1);
console.log('val conflicts:', valConflicts);

console.log('VERDICT:', valConflicts.length === 0
  ? 'REFUTED — no val collision (fresh counter monotonic; _t suffix unique per call)'
  : 'REPRODUCED — collision found');
