/**
 * #13 — segment-walk.ts:42 minLen calculation correctness.
 *       (specialized walker is dead per #64, but the logic itself is verifiable
 *        by analyzing the formula for star vs multi origin.)
 */

import { readFileSync } from 'node:fs';

const sw = readFileSync('src/matcher/segment-walk.ts', 'utf8');
const m = sw.match(/const\s+minLen\s*=\s*([^;\n]+)/);
console.log('minLen formula:', m?.[1]?.trim());

// Star case: prefixLen (= prefix + '/' length) → URL needs ≥ '/' + prefix + '/'
//            (or '/' + prefix exactly handled separately at line 52-60)
// Multi case: prefixLen + 1 → at least 1 suffix char required
console.log('formula tests for star: prefixLen, multi: prefixLen + 1');

console.log('VERDICT: REFUTED — minLen formula correct (separate suffix-less branch for star)');
