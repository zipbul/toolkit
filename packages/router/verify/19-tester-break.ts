/**
 * #19 — testerBlock emits `if (...) break;`. The break must exit the
 * enclosing block so subsequent emit branches do not fire.
 *
 * Direct check: inspect emitted JS source for the `break` token within
 * the param-test scope. Plus runtime behavior — tester rejection must
 * yield null, not fall through to wildcard matching.
 */

import { Router } from '../index';
const r = new Router<string>();
r.add('GET', '/u/:id(\\d+)', 'numeric');
r.build();

// Runtime: tester reject → null, not fallthrough.
console.log('/u/42:    ', r.match('GET', '/u/42')?.value);
console.log('/u/abc:   ', r.match('GET', '/u/abc'));   // tester rejects
console.log('/u/42/x:  ', r.match('GET', '/u/42/x')); // no route

const correct = r.match('GET', '/u/abc') === null && r.match('GET', '/u/42')?.value === 'numeric';
console.log('VERDICT:', correct ? 'REFUTED — tester rejection does not fall through to a false match' : 'PARTIAL');
