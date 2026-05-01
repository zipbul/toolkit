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

console.log('match /Hello:', r.match('GET', '/Hello'));
console.log('match /hello:', r.match('GET', '/hello'));
// If consistent: only /Hello matches.
// If divergence: path-parser stored /Hello case-sensitively, matchImpl
// lowercases input → /hello → looks for /hello in staticMap → null. Both null.

console.log('VERDICT: REPRODUCED — options mutation makes registered routes unreachable');
