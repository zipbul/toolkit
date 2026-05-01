/**
 * #65 — detectWildCodegenSpec uses for-in over root.staticChildren.
 *       Order should be insertion order in JSC.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
const inserted = ['z', 'a', 'm'];
for (const seg of inserted) r.add('GET', `/${seg}/*p`, seg);
r.build();

// Read trees order indirectly: inspect tree's static children (insertion order).
const root = (getRouterInternals(r).registration as any).segmentTrees[0];
const order: string[] = [];
for (const k in root.staticChildren) order.push(k);

console.log('inserted:', inserted);
console.log('walker for-in order:', order);
const matches = JSON.stringify(inserted) === JSON.stringify(order);
console.log('VERDICT:', matches
  ? 'REFUTED — JSC preserves insertion order in walker-strategy traversal'
  : 'REPRODUCED');
