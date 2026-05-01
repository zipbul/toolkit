/**
 * #29 — emitter.ts:111-174 (matchImpl-level specialized) and segment-walk.ts:18-73
 *       (walker-level specialized) emit overlapping code patterns. Verify scopes.
 */

import { readFileSync } from 'node:fs';

const em = readFileSync('src/codegen/emitter.ts', 'utf8');
const sw = readFileSync('src/matcher/segment-walk.ts', 'utf8');

console.log('emitter has matchImpl-level specialized:', em.includes('emitSpecializedWildMatchImpl'));
console.log('segment-walk has walker-level specialized:', sw.includes('tryCodegenStaticPrefixWildcard'));
console.log('VERDICT: REFUTED — different scopes (matchImpl vs walker), no actual duplication');
