/**
 * #42 — testerCache retains entries from failed registrations.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/users/:id(\\d+)', 'user');
r.build();
const cache = (getRouterInternals(r).registration as any).testerCache as Map<string, unknown>;
console.log('after 1st (success):', [...cache.keys()]);

const bad = new Router<string>();
bad.add('GET', '/a/:p(\\w+)/:q([z-a])', 'fail');
try { bad.build(); } catch {}
const badCache = (getRouterInternals(bad).registration as any).testerCache as Map<string, unknown> | undefined;
const keys = [...cache.keys()];
const badKeys = badCache === undefined ? [] : [...badCache.keys()];
console.log('failed build cache published:  ', badKeys);
console.log('VERDICT:', keys.length === 1 && keys[0] === '\\d+' && badKeys.length === 0
  ? 'REFUTED — failed build publishes no testerCache entries'
  : 'REPRODUCED — \\w+ retained even though registration failed');
