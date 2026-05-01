/**
 * #17 — hasWideFanout's iteration only pushes paramChild.next + static
 *       children. wildcard is terminal so not pushed. Verify codegen bails
 *       on wide fanout when route is dynamic (so segment-tree built).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
// 5 dynamic routes with shared root → fanout 5 at root.
for (let i = 0; i < 5; i++) r.add('GET', `/p${i}/:id`, `s${i}`);
r.build();

const tree = (getRouterInternals(r) as any).matchLayer.trees.find((t: any) => t);
console.log('walker with fanout=5:', tree?.name);

// fanout > 2 should force codegen bail; 'walk' = iterative or recursive
const codegenBailed = tree?.name === 'walk';
console.log('VERDICT:', codegenBailed
  ? 'REFUTED — codegen correctly bails on fanout > 2'
  : 'REPRODUCED — codegen did NOT bail (unexpected)');
