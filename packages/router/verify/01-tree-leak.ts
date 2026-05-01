/**
 * #1 — Static path partial failure leaks empty child nodes in segment-tree.
 *
 * Hypothesis (code references):
 *   - src/matcher/segment-tree.ts:134-137 — creates child nodes for static
 *     segments BEFORE attempting param/wildcard parts.
 *   - src/matcher/segment-tree.ts:159-171 — `new RegExp(...)` may throw, in
 *     which case the function returns Err but does NOT undo the static
 *     child nodes created above.
 *
 * Trigger condition (legitimate user input only):
 *   - Path-parser must pass the input (it only rejects backreferences and
 *     nested unlimited quantifiers). Use a regex that's syntactically
 *     invalid for `new RegExp` but free of those two issues.
 *   - Pre-flight: confirm `[z-a]` triggers `RegExp` rejection.
 *   - Setup must NOT have a pre-existing static path collapsing the trigger
 *     into shared nodes — fresh router gives a clean lineage to inspect.
 *
 * Cross-scenarios planned (file 01b…):
 *   - 01b: addAll API path (#35 also relies on this root cause).
 *   - 01c: different invalid regex (e.g. `(?<>x)`) to ensure trigger isn't
 *     specific to one pathological pattern.
 *   - 01d: multiple failed registrations to check accumulation.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

// Pre-flight: confirm the regex `[z-a]` is what we expect (RegExp ctor rejects).
let regexpRejects = false;
try { new RegExp('^(?:[z-a])$'); } catch { regexpRejects = true; }
console.log('preflight: RegExp ctor rejects [z-a]:', regexpRejects);
if (!regexpRejects) {
  console.log('VERDICT: NOT-VERIFIED (preflight failed; environment differs)');
  process.exit(0);
}

// Fresh router. No prior dynamic routes — segmentTrees[GET] starts undefined.
const r = new Router<string>();

// Single registration attempt. Path has 2 static segments (`leak`, `path`)
// before the failing param `:bad([z-a])`.
let threw = false;
let kind: string | undefined;
try {
  r.add('GET', '/leak/path/:bad([z-a])', 'h');
  r.build();
} catch (e: any) {
  threw = true;
  kind = e?.data?.kind;
}
console.log('build() threw:', threw, '| kind:', kind);

// Inspect the GET segment tree.
const reg = (getRouterInternals(r).registration as unknown as {
  segmentTrees: Array<null | {
    store: number | null;
    staticChildren: Record<string, any> | null;
    paramChild: any;
    wildcardStore: number | null;
  }>;
}) ;

const root = reg.segmentTrees?.[0]; // GET = method code 0
const orphan = (n: any) =>
  n.store === null && n.staticChildren === null
  && n.paramChild === null && n.wildcardStore === null;

if (!root) {
  console.log('VERDICT: REFUTED — no GET tree allocated; nothing leaked.');
} else {
  const leak = root.staticChildren?.['leak'];
  const path = leak?.staticChildren?.['path'];
  console.log('  root has "leak" child:', !!leak);
  console.log('  "leak" has "path" child:', !!path);
  if (path) {
    console.log('  "path" node fully orphan:', orphan(path));
    console.log('    store:', path.store, '| staticChildren:', path.staticChildren,
      '| paramChild:', path.paramChild, '| wildcardStore:', path.wildcardStore);
    console.log('VERDICT: REPRODUCED — orphan static node left after partial-failure.');
  } else {
    console.log('VERDICT: PARTIAL — tree allocated but expected leak path absent.');
  }
}
