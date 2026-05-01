/**
 * #3, scenario 3 — `//` in dynamic route's static prefix.
 * Tests how extractSegments' empty-skip interacts with segment-tree insertion.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();
let rejected = false;
try {
  r.add('GET', '/api//users/:id', 'h');
  r.build();
} catch {
  rejected = true;
}

const trees = (getRouterInternals(r).registration as any).segmentTrees;
const root = trees?.[0];
console.log('register /api//users/:id rejected:', rejected);

function dump(node: any, depth = 0): void {
  const pad = '  '.repeat(depth);
  const stat = node.staticChildren ? Object.keys(node.staticChildren) : null;
  console.log(pad + 'node store=', node.store, 'staticKeys=', stat,
    'param=', node.paramChild?.name, 'wild=', node.wildcardName);
  if (node.staticChildren) {
    for (const k of Object.keys(node.staticChildren)) {
      console.log(pad + ' static[' + JSON.stringify(k) + ']:');
      dump(node.staticChildren[k], depth + 2);
    }
  }
  if (node.paramChild) {
    console.log(pad + ' param[' + node.paramChild.name + ']:');
    dump(node.paramChild.next, depth + 2);
  }
}
if (root) dump(root);

// Test matches:
console.log('match /api//users/42:', r.match('GET', '/api//users/42')?.value ?? null);
console.log('match /api/users/42:',  r.match('GET', '/api/users/42')?.value ?? null);

console.log('VERDICT:', rejected && root === undefined
  ? 'REFUTED — // in dynamic route is rejected before tree insertion'
  : 'REPRODUCED — // in dynamic route silently mapped to single /; semantic mismatch');
