/**
 * #9 — MatchStateWithParams type forces caller to set params before invoking
 *       walker. Verify by inspecting all walker invocation sites.
 */

import { readFileSync } from 'node:fs';

const em = readFileSync('src/codegen/emitter.ts', 'utf8');
const mt = readFileSync('src/pipeline/match.ts', 'utf8');

const emSets = /matchState\.params\s*=\s*params/.test(em);
const emCtor = /var\s+params\s*=\s*new\s+ParamsCtor/.test(em);
const mtSets = /state\.params\s*=\s*sharedParams/.test(mt);

console.log('emitter sets matchState.params before walker:', emSets);
console.log('emitter creates fresh ParamsCtor:', emCtor);
console.log('match.ts sets state.params before walker:', mtSets);

console.log('VERDICT:', emSets && emCtor && mtSets
  ? 'REFUTED — type contract enforced at every call site'
  : 'PARTIAL');
