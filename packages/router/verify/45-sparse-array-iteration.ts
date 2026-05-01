/**
 * #45 — sparse staticMap arrays correctly skipped via staticRegistered check.
 *       Construct a path registered for one method, then check that other
 *       methods' slots aren't picked up as registered.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

// Register /a only for GET. Then register /b for PUT (method code 2).
// PUT slot for /a is undefined → must NOT show as registered.
const r = new Router<string>();
r.add('GET', '/a', 'g');
r.add('PUT', '/a', 'p');
r.build();

console.log('GET /a:', r.match('GET', '/a')?.value);
console.log('POST /a:', r.match('POST', '/a'));     // not registered
console.log('PUT /a:', r.match('PUT', '/a')?.value);
console.log('DELETE /a:', r.match('DELETE', '/a'));  // not registered

// Inspect staticRegistered for /a — slot pattern.
const sr = (getRouterInternals(r).registration as any).staticRegistered['/a'];
console.log('staticRegistered[/a] slots:', sr);
// Expected: [true, undefined, true, ...]

const correctSparse =
  r.match('GET', '/a')?.value === 'g'
  && r.match('PUT', '/a')?.value === 'p'
  && r.match('POST', '/a') === null
  && r.match('DELETE', '/a') === null;
console.log('VERDICT:', correctSparse ? 'REFUTED — sparse iteration correctly skips unregistered slots' : 'PARTIAL');
