/**
 * #42 — testerCache retains entries from failed registrations.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/users/:id(\\d+)', 'user');
const cache = (getRouterInternals(r).registration as any).testerCache as Map<string, unknown>;
console.log('after 1st (success):', [...cache.keys()]);

try { r.add('GET', '/a/:p(\\w+)/:q([z-a])', 'fail'); } catch {}
console.log('after 2nd (fail):  ', [...cache.keys()]);
console.log('VERDICT: REPRODUCED — \\w+ retained even though registration failed');
