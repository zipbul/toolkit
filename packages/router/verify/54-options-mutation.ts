/**
 * #54 — Mutating user-supplied options between Router() and build()
 *        causes path-parser (constructor-time) and matchImpl (build-time) to use
 *        different values.
 */

import { Router } from '../index';

const opts: { caseSensitive?: boolean } = { caseSensitive: true };
const r = new Router<string>(opts);
r.add('GET', '/Hello', 'h');

// User mutates opts before build.
opts.caseSensitive = false;
r.build();

const upper = r.match('GET', '/Hello');
const lower = r.match('GET', '/hello');
console.log('match /Hello:', upper);
console.log('match /hello:', lower);
// If consistent: only /Hello matches.
// If divergence: path-parser stored /Hello case-sensitively, matchImpl
// lowercases input → /hello → looks for /hello in staticMap → null. Both null.

console.log('VERDICT:', upper?.value === 'h' && lower === null
  ? 'REFUTED — constructor snapshots options before later user mutation'
  : 'REPRODUCED — options mutation makes registered routes unreachable');
