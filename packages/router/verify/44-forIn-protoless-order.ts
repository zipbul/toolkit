/**
 * #44 — for-in on Object.create(null) preserves insertion order in JSC.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
const inserted = ['z', 'a', 'm', 'b', 'k'];
for (const seg of inserted) r.add('GET', `/${seg}/:id`, seg);
r.build();

const root = (getRouterInternals(r).registration as any).segmentTrees[0];
const sc = root.staticChildren;
const order: string[] = [];
for (const k in sc) order.push(k);

console.log('inserted order:', inserted);
console.log('for-in order:  ', order);
const matches = JSON.stringify(inserted) === JSON.stringify(order);
console.log('VERDICT:', matches
  ? 'REFUTED — JSC preserves insertion order; behavior deterministic'
  : 'REPRODUCED — order differs (potential issue)');
