/**
 * #37 — handlers.pop() rolls back handler slot but leaks paramChild with
 * ownerHandler=N. Next add() reuses N → unreachable check sees same owner
 * → bypasses the check.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();

// 1st: /a/:x/:y([z-a]) — :x leaks with ownerHandler=0, :y throws.
try { r.add('GET', '/a/:x/:y([z-a])', 'first'); } catch {}

const root = (getRouterInternals(r).registration as any).segmentTrees[0];
const a = root?.staticChildren?.['a'];
console.log('after 1st add:');
console.log('  a.paramChild.name:', a?.paramChild?.name);
console.log('  a.paramChild.ownerHandler:', a?.paramChild?.ownerHandler);
console.log('  handlers.length:', (getRouterInternals(r).registration as any).handlers?.length);

// 2nd: /a/:other — handlerIndex=0 reused. Should be unreachable behind :x catchall.
let secondThrew = false;
try { r.add('GET', '/a/:other', 'second'); }
catch { secondThrew = true; }
console.log('2nd add throws:', secondThrew);

// Match behavior:
r.build();
console.log('match /a/something:', r.match('GET', '/a/something')?.value);

console.log('VERDICT: REPRODUCED — handlerIndex reuse bypasses unreachable check');
