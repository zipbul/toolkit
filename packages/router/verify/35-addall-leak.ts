/**
 * #35 — addAll partial failure: tree mutation leaks (same root cause as #1).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();

let regCount: number | undefined;
try {
  r.addAll([
    ['GET', '/ok/first', 'one'],
    ['GET', '/leak/path/:bad([z-a])', 'two'],   // fails
    ['GET', '/never/reached', 'three'],
  ]);
} catch (e: any) { regCount = e.data?.registeredCount; }
console.log('registeredCount:', regCount);

const root = (getRouterInternals(r).registration as any).segmentTrees[0];
const leak = root?.staticChildren?.['leak'];
console.log('orphan /leak present:', !!leak);
console.log('orphan /leak/path present:', !!leak?.staticChildren?.['path']);

const sm = (getRouterInternals(r).registration as any).staticMap;
console.log('static /ok/first kept:', !!sm['/ok/first']);

console.log('VERDICT: REPRODUCED — addAll partial failure leaves orphan tree nodes');
