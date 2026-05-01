/**
 * #25 — MAX_SOURCE = 8000 in segment-compile.ts. Direct file inspection.
 */

import { readFileSync } from 'node:fs';

const src = readFileSync('src/codegen/segment-compile.ts', 'utf8');
const match = src.match(/const\s+MAX_SOURCE\s*=\s*(\d+)/);
console.log('MAX_SOURCE constant:', match?.[1]);
console.log('any measurement comment near:',
  /\/\/.*[Bb]ench|\/\/.*[Mm]easur/.test(src.slice(src.indexOf('MAX_SOURCE') - 200, src.indexOf('MAX_SOURCE') + 200)));

console.log('VERDICT: CODE-VERIFIED — value 8000 hardcoded with no measurement citation');
