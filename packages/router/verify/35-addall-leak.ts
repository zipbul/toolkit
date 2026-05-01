/**
 * #35 — addAll partial failure: tree mutation leaks (same root cause as #1).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();

let errorCount = 0;
try {
  r.addAll([
    ['GET', '/ok/first', 'one'],
    ['GET', '/leak/path/:bad([z-a])', 'two'],   // fails
    ['GET', '/never/reached', 'three'],
  ]);
  r.build();
} catch (e: any) { errorCount = e.data?.errors?.length ?? 0; }
console.log('build error count:', errorCount);

const root = (getRouterInternals(r).registration as any).segmentTrees?.[0];
const leak = root?.staticChildren?.['leak'];
console.log('orphan /leak present:', !!leak);
console.log('orphan /leak/path present:', !!leak?.staticChildren?.['path']);

const sm = (getRouterInternals(r).registration as any).staticMap;
console.log('compiled staticMap published:', sm !== undefined);

console.log('VERDICT:', errorCount === 1 && !leak && sm === undefined
  ? 'REFUTED — failed addAll build publishes no partial compiled state'
  : 'REPRODUCED — addAll partial failure leaves orphan tree nodes');
