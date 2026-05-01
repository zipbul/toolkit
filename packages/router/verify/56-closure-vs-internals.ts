/**
 * #56 — Router constructor stores matchImpl twice: closure variable and
 *       internals wrapper. Verify the source wiring and runtime availability.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/router.ts', 'utf8');
const hasClosureSlot = /let\s+matchImpl:/.test(src);
const assignsClosure = /matchImpl\s*=\s*compileMatchFn/.test(src);
const copiesToInternals = /internals\.matchImpl\s*=\s*matchImpl/.test(src);
const hotPathUsesClosure = /return\s+matchImpl\(method,\s*path\)/.test(src);

const r = new Router<string>();
r.add('GET', '/u/:id', 'h');
r.build();

const fromInternals = (getRouterInternals(r) as any).matchImpl;
console.log('source has closure matchImpl slot:', hasClosureSlot);
console.log('source assigns closure from compileMatchFn:', assignsClosure);
console.log('source copies closure into internals:', copiesToInternals);
console.log('source hot path calls closure directly:', hotPathUsesClosure);
console.log('internals matchImpl is function:', typeof fromInternals === 'function');

console.log('VERDICT:', hasClosureSlot && assignsClosure && copiesToInternals && hotPathUsesClosure && typeof fromInternals === 'function'
  ? 'REPRODUCED — matchImpl is stored in both closure and internals wrapper'
  : 'REFUTED');
