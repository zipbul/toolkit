/**
 * #1, scenario 3 — N failed registrations leak N orphan paths.
 * If user does fail-catch-retry in a loop, leak is O(N).
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();

const N = 10;
let failures = 0;
for (let i = 0; i < N; i++) {
  r.add('GET', `/leak${i}/sub/:p([z-a])`, 'h');
}
try {
  r.build();
} catch (e: any) {
  failures = e?.data?.errors?.length ?? 0;
}
console.log('failures:', failures, '/ attempts:', N);

const reg = (getRouterInternals(r).registration as unknown as { segmentTrees?: any[] }) ;
const root = reg.segmentTrees?.[0];
if (!root) { console.log('VERDICT: REFUTED — no tree.'); process.exit(0); }

let leakCount = 0;
for (const k of Object.keys(root.staticChildren ?? {})) {
  if (k.startsWith('leak')) leakCount++;
}
console.log('orphan leak* keys at root:', leakCount);
console.log(leakCount === N ? 'VERDICT: REPRODUCED — accumulates linearly' : 'VERDICT: PARTIAL');
