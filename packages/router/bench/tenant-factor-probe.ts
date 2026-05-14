/* eslint-disable no-console */
/**
 * Probe whether tenant-factor actually fires for the 100k tenant shape.
 * If yes, log keyToTerminal.size + sharedNext object count. If no, log
 * the bail reason. Then strip factor (force-disable) and remeasure RSS
 * to quantify its real contribution.
 */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';
import { getTenantFactor, detectTenantFactor } from '../src/matcher/segment-tree';

function gc(): void { if (typeof Bun !== 'undefined') for (let i = 0; i < 5; i++) Bun.gc(true); }
function rssMb(): number { gc(); return process.memoryUsage().rss / 1024 / 1024; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function countSubtree(root: any): number {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    if (!x) continue;
    n++;
    if (x.singleChildNext) stack.push(x.singleChildNext);
    if (x.staticChildren) for (const k in x.staticChildren) stack.push(x.staticChildren[k]);
    let p = x.paramChild;
    while (p) { stack.push(p.next); p = p.nextSibling; }
  }
  return n;
}

const baseline = rssMb();
const t0 = performance.now();
const r = new Router<number>();
for (let i = 0; i < 100_000; i++) r.add('GET', `/tenant-${i}/users/:id/posts/:postId`, i);
r.build();
const buildMs = performance.now() - t0;

const internals = (r as any)[ROUTER_INTERNALS_KEY];
const trees = internals.registration.snapshot.segmentTrees;
let foundFactor = false;
let factorTotalObjects = 0;
for (const t of trees) {
  if (!t) continue;
  const f = getTenantFactor(t);
  if (f) {
    foundFactor = true;
    factorTotalObjects = countSubtree(t);
    console.log(`tenant-factor: APPLIED`);
    console.log(`  keyToTerminal.size = ${f.keyToTerminal.size}`);
    console.log(`  reachable nodes from root post-factor = ${factorTotalObjects}`);
  }
}
if (!foundFactor) {
  console.log(`tenant-factor: NOT APPLIED — running detector to see why`);
  for (const t of trees) {
    if (!t) continue;
    const f = detectTenantFactor(t);
    console.log(`  detect result: ${f === null ? 'null' : `Map size ${f.keyToTerminal.size}`}`);
    let keyCount = 0;
    if (t.staticChildren) for (const _ in t.staticChildren) keyCount++;
    console.log(`  root.staticChildren keys: ${keyCount}`);
    console.log(`  root.singleChildKey: ${t.singleChildKey ?? '(null)'}`);
    console.log(`  root.paramChild: ${t.paramChild ? 'present' : 'null'}`);
    console.log(`  root.wildcardStore: ${t.wildcardStore ?? '(null)'}`);
  }
}

await sleep(2000);
const settled = rssMb();
console.log(`build=${buildMs.toFixed(0)}ms  rss=${baseline.toFixed(0)}→${settled.toFixed(0)}MB delta=${(settled - baseline).toFixed(0)}MB`);
