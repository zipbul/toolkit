/**
 * #43 — detectWildCodegenSpec is called in both build.ts and segment-walk.ts.
 *       This is a build-time duplication claim, so verify the actual call sites
 *       rather than manually invoking the function twice.
 */

import { readFileSync } from 'node:fs';

const buildSrc = readFileSync('src/pipeline/build.ts', 'utf8');
const walkSrc = readFileSync('src/matcher/segment-walk.ts', 'utf8');

const buildCalls = (buildSrc.match(/detectWildCodegenSpec\s*\(/g) ?? []).length;
const walkCalls = (walkSrc.match(/detectWildCodegenSpec\s*\(/g) ?? []).length;
const importedInBoth = buildSrc.includes("detectWildCodegenSpec } from '../codegen/walker-strategy'")
  && walkSrc.includes("detectWildCodegenSpec } from '../codegen/walker-strategy'");

console.log('build.ts detectWildCodegenSpec call count:', buildCalls);
console.log('segment-walk.ts detectWildCodegenSpec call count:', walkCalls);
console.log('imported in both files:', importedInBoth);

console.log('VERDICT:', importedInBoth && buildCalls >= 1 && walkCalls >= 1
  ? 'REPRODUCED — detectWildCodegenSpec is called from both build and walker creation paths'
  : 'REFUTED');
