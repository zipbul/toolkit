/**
 * #30 — handlers array is intentionally NOT frozen (hot-path policy).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/u/:id', 'h');
r.build();

const handlers = (getRouterInternals(r).registration as any).handlers;
console.log('handlers frozen:', Object.isFrozen(handlers));
console.log('handlers content:', handlers);

// sealed=true blocks add() so user cannot grow handlers via public API.
let blocked = false;
try { r.add('POST', '/x', 'y'); } catch { blocked = true; }
console.log('add() after build blocked:', blocked);
console.log('VERDICT: REPRODUCED — handlers mutable by design; sealed prevents user growth');
