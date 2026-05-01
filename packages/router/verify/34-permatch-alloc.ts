/**
 * #34 — Each dynamic match allocates a fresh ParamsCtor instance.
 *       Verify by checking object identity.
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET', '/u/:id', 'h');
r.build();

const m1 = r.match('GET', '/u/1')!;
const m2 = r.match('GET', '/u/2')!;
const m3 = r.match('GET', '/u/1')!;  // cache hit (same key)

console.log('m1 === m2:', m1 === m2);          // false (different paths)
console.log('m1.params === m2.params:', m1.params === m2.params);
console.log('m1.params === m3.params (cache):', m1.params === m3.params);

const fresh = m1.params !== m2.params;
console.log('VERDICT:', fresh ? 'REPRODUCED — fresh per dynamic match (intentional)' : 'PARTIAL');
