/**
 * #66 — MatchState.paramNames/paramValues 32-slot dead state.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/u/:id/posts/:pid', 'h');
r.build();

r.match('GET', '/u/42/posts/abc');

const ml = (getRouterInternals(r) as any).matchLayer;
const state = ml?.matchState;
console.log('paramNames[0..3]:',
  JSON.stringify(state.paramNames[0]), JSON.stringify(state.paramNames[1]),
  JSON.stringify(state.paramNames[2]), JSON.stringify(state.paramNames[3]));
console.log('paramValues[0..3]:',
  JSON.stringify(state.paramValues[0]), JSON.stringify(state.paramValues[1]),
  JSON.stringify(state.paramValues[2]), JSON.stringify(state.paramValues[3]));
console.log('paramCount:', state.paramCount);
const arraysUnused = state.paramCount === 0
  && state.paramNames.slice(0, 4).every((v: string) => v === '')
  && state.paramValues.slice(0, 4).every((v: string) => v === '');
console.log('VERDICT:', arraysUnused
  ? 'REPRODUCED — paramNames/paramValues remain unused after dynamic match'
  : 'REFUTED');
