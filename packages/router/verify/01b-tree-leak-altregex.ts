/**
 * #1, scenario 2 — same root cause with a different RegExp-rejecting pattern.
 * Cross-checks that the leak isn't specific to `[z-a]`.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

// Pre-flight: pick a different RegExp-invalid pattern that path-parser allows.
const candidate = '(?<>x)'; // empty named group → RegExp rejects
let rejects = false;
try { new RegExp(`^(?:${candidate})$`); } catch { rejects = true; }
console.log('preflight: RegExp rejects', candidate, ':', rejects);
if (!rejects) { console.log('VERDICT: NOT-VERIFIED'); process.exit(0); }

const r = new Router<string>();

let kind: string | undefined;
try {
  r.add('GET', `/alt/two/three/:p(${candidate})`, 'h');
  r.build();
} catch (e: any) { kind = e?.data?.kind; }
console.log('reject kind:', kind);

const reg = (getRouterInternals(r).registration as unknown as {
  segmentTrees?: any[];
}) ;
const root = reg.segmentTrees?.[0];

const orphan = (n: any) =>
  n.store === null && n.staticChildren === null
  && n.paramChild === null && n.wildcardStore === null;

if (!root) {
  console.log('VERDICT: REFUTED — no tree allocated.');
} else {
  const alt = root.staticChildren?.['alt'];
  const two = alt?.staticChildren?.['two'];
  const three = two?.staticChildren?.['three'];
  console.log('alt:', !!alt, 'two:', !!two, 'three:', !!three);
  if (three) {
    console.log('three orphan:', orphan(three));
    console.log('VERDICT: REPRODUCED');
  } else {
    console.log('VERDICT: PARTIAL');
  }
}
