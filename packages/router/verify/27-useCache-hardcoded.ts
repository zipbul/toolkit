/**
 * #27 — useCache: true hardcoded → MatchConfig.useCache becomes a constant
 *        masquerading as boolean.
 */

import { readFileSync } from 'node:fs';

const src = readFileSync('src/router.ts', 'utf8');
const m = src.match(/useCache:\s*(\w+)/);
console.log('router.ts useCache literal:', m?.[1]);

const emSrc = readFileSync('src/codegen/emitter.ts', 'utf8');
const branchCount = (emSrc.match(/\bif\s*\(useCache\)/g) ?? []).length;
console.log('emitter.ts `if (useCache)` branches:', branchCount);

console.log('VERDICT:', m?.[1] === 'true' && branchCount > 0
  ? 'REPRODUCED — useCache is hardcoded true and still gates emit branches'
  : 'REFUTED');
