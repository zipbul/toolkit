/**
 * #67 — resetMatchState exported but not called within src/.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (f.endsWith('.ts') && !f.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const files = walk('src');
let callerCount = 0;
let declarerFile: string | null = null;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (/export\s+function\s+resetMatchState/.test(src)) declarerFile = f;
  // Count call sites: `resetMatchState(` not preceded by `function `.
  const calls = src.match(/(?<!function\s)resetMatchState\s*\(/g) ?? [];
  callerCount += calls.length;
}
console.log('declared in:', declarerFile);
console.log('call sites in src/ (excluding spec):', callerCount);
console.log('VERDICT:', callerCount === 0
  ? 'REPRODUCED — function exported but never called in src'
  : 'REFUTED');
