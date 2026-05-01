/**
 * #21 — `:param/*x+` (multi wildcard after param) requires 1+ char suffix.
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET', '/u/:id/files/:p+', 'h');  // multi wildcard
r.build();

console.log('/u/1/files:        ', r.match('GET', '/u/1/files'));         // no suffix → null
console.log('/u/1/files/:       ', r.match('GET', '/u/1/files/'));        // empty trail → null
console.log('/u/1/files/a:      ', r.match('GET', '/u/1/files/a')?.params);
console.log('/u/1/files/a/b/c:  ', r.match('GET', '/u/1/files/a/b/c')?.params);

console.log('VERDICT: REFUTED — multi guard requires 1+ char suffix correctly');
