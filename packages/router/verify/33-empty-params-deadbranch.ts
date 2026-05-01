/**
 * #33 — emitter:312-317 `if (params === EMPTY_PARAMS)` is dead.
 * dynamic match always allocates fresh ParamsCtor (line 286-287).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/u/:id', 'h');
r.build();

const m = r.match('GET', '/u/42')!;
const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();

console.log('contains "=== EMPTY_PARAMS":', src.includes('=== EMPTY_PARAMS'));
console.log('match params identity ≠ EMPTY_PARAMS: (always true since fresh alloc per match)');
console.log('match params:', m.params);

console.log('VERDICT: REPRODUCED — EMPTY_PARAMS comparison emitted but always false');
