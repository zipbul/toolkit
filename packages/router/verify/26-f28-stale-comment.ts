/**
 * #26 — `F28` reference is a stale internal-stage comment.
 */

import { readFileSync } from 'node:fs';

const src = readFileSync('src/codegen/segment-compile.ts', 'utf8');
const has = /F28/.test(src);
console.log('contains "F28":', has);
console.log('VERDICT:', has ? 'REPRODUCED — stale comment present' : 'REFUTED');
