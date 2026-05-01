/**
 * #57 — Router.performBuild loops over staticOutputsByMethod to compute
 *       hasAnyStatic, even though build.ts already knows.
 */

import { readFileSync } from 'node:fs';

const rt = readFileSync('src/router.ts', 'utf8');
const has = /for\s*\(\s*const\s+bucket\s+of\s+r\.staticOutputsByMethod\s*\)/.test(rt);
console.log('router.ts re-iterates staticOutputsByMethod:', has);

console.log('VERDICT:', has
  ? 'REPRODUCED — recomputed in router.ts even though build.ts already constructed staticOutputsByMethod'
  : 'REFUTED');
