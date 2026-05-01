/**
 * #28 — cacheSize value is inlined into emit JS at build time.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>({ cacheSize: 5000 });
r.add('GET', '/u/:id', 'h');
r.build();

const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();
const inlined = src.includes('5000');
console.log('emit contains "5000":', inlined);
console.log('VERDICT:', inlined ? 'REPRODUCED — value baked into closure' : 'REFUTED');
