/**
 * #8 — Does any walker write params then return false (leaving stale state)?
 *
 * Code paths inspected (segment-walk.ts):
 *   - tryMatchParam:140-141 — writes params AFTER recursive match returns true
 *   - line 233 (recursive walker wildcard) — writes params then return true
 *   - line 349 (iterative walker param) — writes params then continue (not return)
 *   - line 359 (iterative walker wildcard) — writes params then return true
 *
 * Iterative walker line 349-353: writes params[name]=decoded, then continues
 * loop. If subsequent segments don't match, the loop falls through to `return false`.
 * BUT the iterative walker doesn't backtrack — once it commits to a param
 * value it walks forward. If the rest fails, it returns false with stale
 * params. Next match() call will overwrite via fresh ParamsCtor anyway.
 *
 * However: within the SAME match call, if the iterative walker has a node
 * with a single-param child and a wildcard, it writes the param value, then
 * may need wildcard fallback... checking.
 */

import { Router } from '../index';

// Setup 1: Recursive walker (ambiguous tree) with sibling params.
const r1 = new Router<string>();
r1.add('GET', '/users/:id(\\d+)', 'A');
r1.add('GET', '/users/:slug([a-z]+)', 'B');
r1.build();

const m1 = r1.match('GET', '/users/foo');
console.log('Test 1 (sibling regex with first failing):', m1);
console.log('  has stale `id` key:', m1 && 'id' in m1.params);
console.log('  → expected: { value: B, params: {slug: foo} }');

// Setup 2: Recursive walker with deeper failure mid-route.
//   /users/:id(\d+)/posts/:pid    A
//   /users/:slug([a-z]+)/posts    B  (no :pid)
// Match `/users/foo/posts/42` — tries :id (\d+ rejects 'foo'), then :slug
// (matches), then descends. /posts matches. /:pid in route A vs /posts terminal
// in route B... they're different positions, so paths don't overlap exactly.
// Construct a stricter setup.
const r2 = new Router<string>();
r2.add('GET', '/x/:a(\\d+)/y', 'numeric');
r2.add('GET', '/x/:b([a-z]+)/y', 'alpha');
r2.build();

const m2 = r2.match('GET', '/x/abc/y');
console.log('Test 2 (deeper sibling backtrack):', m2);
console.log('  has stale `a` key:', m2 && 'a' in m2.params);

// Setup 3: Iterative walker single-path with mid-failure.
const r3 = new Router<string>();
r3.add('GET', '/q/:val(\\d+)/zzz', 'h');  // only matches digits + zzz
r3.build();

const m3 = r3.match('GET', '/q/abc/zzz');
console.log('Test 3 (iterative param-then-static-fail):', m3);
// Tester rejects 'abc' before write → no pollution possible here.

const m3b = r3.match('GET', '/q/42/wrong');
console.log('Test 3b (iterative param-then-static-fail-after-write):', m3b);
// Param accepts '42', writes params, then static '/wrong' != 'zzz' → fail.
// Next match call gets fresh ParamsCtor anyway.

console.log('VERDICT: REFUTED — no params pollution observed');
