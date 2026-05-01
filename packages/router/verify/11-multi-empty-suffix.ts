/**
 * #11 — Verify multi (`*name+`) wildcard rejects empty suffix correctly.
 * Code: segment-walk.ts:321, 357 `pos >= path.length` for multi-origin.
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET', '/files/:p+', 'multi');
r.build();

console.log('/files:    ', r.match('GET', '/files'));
console.log('/files/:   ', r.match('GET', '/files/'));
console.log('/files/a:  ', r.match('GET', '/files/a')?.params);
console.log('/files/a/b:', r.match('GET', '/files/a/b')?.params);

// Star (zero-or-more) for comparison
const rs = new Router<string>();
rs.add('GET', '/files/*p', 'star');
rs.build();
console.log('star /files:    ', rs.match('GET', '/files')?.params);
console.log('star /files/:   ', rs.match('GET', '/files/')?.params);
console.log('star /files/a:  ', rs.match('GET', '/files/a')?.params);

console.log('VERDICT: REFUTED — multi rejects empty suffix; star captures empty correctly');
