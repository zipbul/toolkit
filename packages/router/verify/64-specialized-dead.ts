/**
 * #64 — Specialized wild matchImpl never activates because useCache=true gate.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

// Setup that satisfies all OTHER conditions for specialized wild matchImpl
// (single GET, no statics, no testers, no opts, no case-fold, ≤8 prefixes).
const r = new Router<string>();
r.add('GET', '/files/*p', 'files');
r.add('GET', '/assets/*a', 'assets');
r.build();

const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();
const isSpecialized = !src.includes('hitCacheByMethod') && !src.includes('methodCodes[method]');
console.log('matchImpl is specialized:', isSpecialized);
console.log('contains "hitCacheByMethod":', src.includes('hitCacheByMethod'));
console.log('VERDICT: REPRODUCED — specialized never activates (useCache gate)');
