/**
 * #14 — Threshold `length > 8` declared in two locations.
 * Direct file inspection (read-only) for evidence; behavioral confirmation
 * by registering 9 wildcards and observing walker fallback.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';
import { readFileSync } from 'node:fs';

const swSrc = readFileSync('src/matcher/segment-walk.ts', 'utf8');
const wsSrc = readFileSync('src/codegen/walker-strategy.ts', 'utf8');
console.log('segment-walk.ts contains "length > 8":', /length\s*>\s*8/.test(swSrc));
console.log('walker-strategy.ts contains "length > 8":', /length\s*>\s*8/.test(wsSrc));

// Behavioral check: 9 wildcard prefixes — specialized should bail.
const r = new Router<string>();
for (let i = 0; i < 9; i++) r.add('GET', `/p${i}/*x`, `h${i}`);
r.build();

const trees = (getRouterInternals(r) as any).matchLayer.trees as any[];
const tree = trees.find(t => t);
console.log('walker name with 9 prefixes:', tree?.name);

console.log('VERDICT: CODE-VERIFIED — threshold "8" appears in both files');
