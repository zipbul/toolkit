/**
 * #31 — hasAnyStatic single-method branch uses closure-captured activeBucket.
 *       Verify by inspecting emitted JS source.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

// Single-method router with statics + dynamic
const r = new Router<string>();
r.add('GET', '/health', 'static');
r.add('GET', '/u/:id', 'dynamic');
r.build();

const impl = (getRouterInternals(r) as any).matchImpl;
const src = impl.toString();

const hasActiveBucket = src.includes('activeBucket[sp]');
const hasStaticOutputsByMethod = /staticOutputsByMethod\[mc\]/.test(src);
console.log('emit uses activeBucket (single-method):', hasActiveBucket);
console.log('emit uses staticOutputsByMethod[mc] (multi-method fallback):', hasStaticOutputsByMethod);

console.log('VERDICT:', hasActiveBucket && !hasStaticOutputsByMethod
  ? 'REFUTED — single-method emit uses closure-captured bucket only (correct)'
  : 'PARTIAL');
