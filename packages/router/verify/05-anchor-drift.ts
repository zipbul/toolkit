/**
 * #5 — anchor stripping not propagated to PathPart.pattern.
 *
 * Code references:
 *   - path-parser.ts:314-315: pattern = rawPattern (anchor 미정규화)
 *   - path-parser.ts:407-: validatePattern normalizes only internally
 *   - segment-tree.ts:154,163: testerCache key = part.pattern (raw)
 *   - segment-tree.ts:198,203: pattern equality check uses raw source
 *
 * Three observable effects:
 *   A. testerCache: equivalent regex stored as separate keys
 *   B. spurious conflict on equivalent regex at same path/param
 *   C. matcher works by accident (RegExp `^^...$$` idempotency)
 */

import { Router } from '../index';
import { RouterError } from '../src/error';
import { getRouterInternals } from '../internal';

// (A) testerCache duplicates equivalent regex.
const r1 = new Router<string>();
r1.add('GET', '/a/:id(\\d+)', 'A');
r1.add('GET', '/b/:id(^\\d+$)', 'B');
r1.build();
const cache1 = (getRouterInternals(r1).registration as any).testerCache as Map<string, unknown>;
console.log('(A) testerCache keys:', [...cache1.keys()]);
console.log('   expected normalized: 1 entry; actual:', cache1.size);

// (B) spurious conflict: equivalent regex at SAME path → rejected.
const r2 = new Router<string>();
r2.add('GET', '/a/:id(\\d+)', 'first');
let kind: string | undefined;
try {
  r2.add('GET', '/a/:id(^\\d+$)', 'second');
  r2.build();
} catch (e: any) {
  kind = e?.data?.errors?.[0]?.error?.kind ?? e?.data?.kind;
}
console.log('(B) registering equivalent regex at same path → kind:', kind);

// (C) matcher works by RegExp anchor idempotency.
const r3 = new Router<string>();
r3.add('GET', '/users/:id(^\\d+$)', 'h');
r3.build();
console.log('(C) /users/42 (anchored regex):', r3.match('GET', '/users/42')?.value);
console.log('(C) /users/abc:', r3.match('GET', '/users/abc'));

// (D) what does the matcher actually compile? Inspect the cached tester
// fn name — if shortcut digit, it differs from regex .test fallback.
// Both \d+ and ^\d+$ should hit the digit shortcut after our fix; they
// currently miss because the cache keys diverge.
console.log('(A) tester impls:', [...cache1.values()].map((t: any) => t.name || 'anon'));

console.log('VERDICT:', cache1.size === 1 && kind === 'route-duplicate'
  ? 'REFUTED — anchor stripping is propagated to route shape and tester cache'
  : 'REPRODUCED — anchor stripping not propagated; spurious conflict + dup cache keys');
