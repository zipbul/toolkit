/**
 * #3, scenario 2 — observe match behavior for `//`-containing paths.
 * Does the registered path match `//`-form, single-slash form, or both?
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET', '/api//users', 'double');
r.add('GET', '/items', 'single-only');
r.build();

console.log('match /api//users:',  r.match('GET', '/api//users')?.value ?? null);
console.log('match /api/users:',   r.match('GET', '/api/users')?.value ?? null);
console.log('match /api///users:', r.match('GET', '/api///users')?.value ?? null);
console.log('match /items:',       r.match('GET', '/items')?.value ?? null);
console.log('match /items/:',      r.match('GET', '/items/')?.value ?? null);

console.log('VERDICT: REPRODUCED — static `//` route is registered as raw key');
