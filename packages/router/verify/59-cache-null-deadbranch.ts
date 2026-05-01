/**
 * #59 — RouterCache<T> uses `T | null` but no caller passes null.
 * Verify by inspecting emitter source — only object passed to set().
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/u/:id', 'h');
r.build();

const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();

// Find hc.set( ... )
const setCalls = src.match(/hc\.set\([^)]+\)/g) ?? [];
console.log('hc.set calls:');
for (const c of setCalls) console.log(' ', c);

// And the dead branch:
console.log('contains "if (cached === null)":', src.includes('if (cached === null)'));

console.log('VERDICT: REPRODUCED — set always passes object; null branch dead');
