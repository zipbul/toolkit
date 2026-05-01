/**
 * #46 — Option defaults declared in router.ts and build.ts independently.
 */

import { readFileSync } from 'node:fs';

const rt = readFileSync('src/router.ts', 'utf8');
const bt = readFileSync('src/pipeline/build.ts', 'utf8');

const rtCS = rt.match(/caseSensitive\s*\?\?\s*(\w+)/);
const btCS = bt.match(/caseSensitive\s*=\s*options\.caseSensitive\s*\?\?\s*(\w+)/);
const rtITS = rt.match(/ignoreTrailingSlash\s*\?\?\s*(\w+)/);
const btITS = bt.match(/ignoreTrailingSlash\s*=\s*options\.ignoreTrailingSlash\s*\?\?\s*(\w+)/);
const rtSEG = rt.match(/maxSegmentLength\s*\?\?\s*(\d+)/);
const btSEG = bt.match(/maxSegmentLength\s*=\s*options\.maxSegmentLength\s*\?\?\s*(\d+)/);

console.log('caseSensitive       router.ts:', rtCS?.[1], '  build.ts:', btCS?.[1]);
console.log('ignoreTrailingSlash router.ts:', rtITS?.[1], '  build.ts:', btITS?.[1]);
console.log('maxSegmentLength    router.ts:', rtSEG?.[1], '  build.ts:', btSEG?.[1]);

const ssotViolation =
  rtCS?.[1] === btCS?.[1] && rtITS?.[1] === btITS?.[1] && rtSEG?.[1] === btSEG?.[1];
console.log('VERDICT:', ssotViolation
  ? 'CODE-VERIFIED — same defaults declared in both files (SSoT violation, currently aligned)'
  : 'PARTIAL');
