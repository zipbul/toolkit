/**
 * #69 — matchState is shared across all match() and allowedMethods() calls.
 *       Each invocation reassigns state.params before walker. Verify by
 *       repeated calls — no leakage.
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET',  '/u/:id', 'u');
r.add('POST', '/p/:slug', 'p');
r.build();

const m1 = r.match('GET', '/u/42');
const m2 = r.match('POST', '/p/hello');
const m3 = r.match('GET', '/u/99');

console.log('m1:', m1?.params);
console.log('m2:', m2?.params);
console.log('m3:', m3?.params);

const ok = m1?.params.id === '42'
  && m2?.params.slug === 'hello'
  && m3?.params.id === '99'
  && !('slug' in m3!.params)
  && !('id' in m2!.params);
console.log('VERDICT:', ok
  ? 'REFUTED — shared matchState reassigned per call; no leakage'
  : 'PARTIAL');
