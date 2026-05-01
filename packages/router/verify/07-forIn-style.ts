/**
 * #7 — `for...in` on NullProtoObj/`Object.create(null)` is functionally
 * equivalent to `Object.keys()` + for-of. Demonstrate by registering routes,
 * then iterating segment-tree's staticChildren both ways. Compare results.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
for (const k of ['a', 'b', 'c', 'd']) r.add('GET', `/${k}/:id`, k);
r.build();

const root = (getRouterInternals(r).registration as any).segmentTrees[0];
const sc = root.staticChildren;

const forInKeys: string[] = [];
for (const k in sc) forInKeys.push(k);
const objKeysOrder = Object.keys(sc);

console.log('for-in keys:    ', forInKeys);
console.log('Object.keys:    ', objKeysOrder);

const equal = forInKeys.length === objKeysOrder.length
  && forInKeys.every((k, i) => k === objKeysOrder[i]);
console.log('VERDICT:', equal ? 'REFUTED — for-in produces identical iteration; style only' : 'REPRODUCED');
