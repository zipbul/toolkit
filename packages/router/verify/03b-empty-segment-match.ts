/**
 * #3, scenario 2 — observe match behavior for `//`-containing paths.
 * Does the registered path match `//`-form, single-slash form, or both?
 */

import { Router } from '../index';

const r = new Router<string>();
let rejected = false;
try {
  r.add('GET', '/api//users', 'double');
  r.build();
} catch {
  rejected = true;
}
const valid = new Router<string>();
valid.add('GET', '/items', 'single-only');
valid.build();

console.log('register /api//users rejected:', rejected);
console.log('match /api//users:',  r.match('GET', '/api//users')?.value ?? null);
console.log('match /api/users:',   r.match('GET', '/api/users')?.value ?? null);
console.log('match /api///users:', r.match('GET', '/api///users')?.value ?? null);
console.log('match /items:',       valid.match('GET', '/items')?.value ?? null);
console.log('match /items/:',      valid.match('GET', '/items/')?.value ?? null);

console.log('VERDICT:', rejected
  ? 'REFUTED — static `//` route is rejected at registration'
  : 'REPRODUCED — static `//` route is registered as raw key');
