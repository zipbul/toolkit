/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

function gc(): void { if (typeof Bun !== 'undefined') for (let i = 0; i < 5; i++) Bun.gc(true); }
function rssMb(): number { gc(); return process.memoryUsage().rss / 1024 / 1024; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function countTesters(root: any): { paramNodes: number; uniqueTesters: number } {
  const stack = [root];
  let paramNodes = 0;
  const testers = new Set<any>();
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.singleChildNext) stack.push(n.singleChildNext);
    if (n.staticChildren) for (const k in n.staticChildren) stack.push(n.staticChildren[k]);
    let p = n.paramChild;
    while (p) {
      paramNodes++;
      if (p.tester) testers.add(p.tester);
      stack.push(p.next);
      p = p.nextSibling;
    }
  }
  return { paramNodes, uniqueTesters: testers.size };
}

const baseline = rssMb();
const t0 = performance.now();
const r = new Router<number>();
const shapes = ['(\\d+)', '([a-z]+)', '([A-Z]+)', '(\\d{2,8})'];
for (let i = 0; i < 100_000; i++) {
  r.add('GET', `/r${i}/:id${shapes[i % shapes.length]!}`, i);
}
r.build();
const buildMs = performance.now() - t0;

const internals = (r as any)[ROUTER_INTERNALS_KEY];
const trees = internals.registration.snapshot.segmentTrees;
let totalParamNodes = 0;
let totalUniqueTesters = 0;
for (const t of trees) {
  if (!t) continue;
  const c = countTesters(t);
  totalParamNodes += c.paramNodes;
  totalUniqueTesters += c.uniqueTesters;
}

await sleep(2000);
const settled = rssMb();
const heap = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(
  `regex-100k: build=${buildMs.toFixed(0)}ms rss=${baseline.toFixed(0)}→${settled.toFixed(0)}MB delta=${(settled - baseline).toFixed(0)}MB heap=${heap.toFixed(0)}MB`,
);
console.log(`  paramNodes=${totalParamNodes}  uniqueTesters=${totalUniqueTesters}  (4 distinct regex shapes used)`);
console.log(`  → tester dedup factor: ${(totalParamNodes / totalUniqueTesters).toFixed(1)}× (1.0 = no dedup)`);
