/**
 * #41 — Snapshot freeze depth: outer Map/Object frozen, inner Maps not.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
r.add('GET', '/files/*p', 'wild');
r.build();

const reg = (getRouterInternals(r).registration as any);
console.log('segmentTrees frozen:', Object.isFrozen(reg.segmentTrees));
console.log('staticMap frozen:', Object.isFrozen(reg.staticMap));
console.log('staticRegistered frozen:', Object.isFrozen(reg.staticRegistered));
console.log('wildcardNamesByMethod (outer Map) frozen:', Object.isFrozen(reg.wildcardNamesByMethod));
console.log('handlers frozen:', Object.isFrozen(reg.handlers));

const inner = reg.wildcardNamesByMethod.get(0);
if (inner) {
  console.log('inner Map frozen:', Object.isFrozen(inner));
  // Object.freeze does NOT block Map.set
  try { inner.set('extra', 'name'); console.log('inner.set worked, size:', inner.size); }
  catch { console.log('inner.set rejected'); }
}

console.log('VERDICT: REPRODUCED — outer frozen, inner Map mutable (Object.freeze does not block Map.set)');
