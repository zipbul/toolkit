/* eslint-disable no-console */
/**
 * Each shape runs in a fresh child invocation so RSS baseline is clean.
 * The previous combined audit measured cumulative deltas and produced
 * negative settled values from prior-build scavenger lag — switching to
 * absolute settled RSS removes that artifact.
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

function gc(): void { if (typeof Bun !== 'undefined') for (let i = 0; i < 5; i++) Bun.gc(true); }
function rssMb(): number { gc(); return process.memoryUsage().rss / 1024 / 1024; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

const shape = process.argv[2]!;
const n = parseInt(process.argv[3]!, 10);

const baseline = rssMb();
const r = new Router<number>();
const t0 = performance.now();

for (let i = 0; i < n; i++) {
  if (shape === 'static')   r.add('GET', `/api/v1/resource-${i}`, i);
  if (shape === 'param')    r.add('GET', `/r${i}/users/:id/posts/:postId`, i);
  if (shape === 'tenant')   r.add('GET', `/tenant-${i}/users/:id/posts/:postId`, i);
  if (shape === 'mixed') {
    const mod = i % 4;
    if (mod === 0) r.add('GET',  `/v${i % 20}/static/r-${i}`, i);
    else if (mod === 1) r.add('GET',  `/v${i % 20}/users/:id/items/${i}`, i);
    else if (mod === 2) r.add('POST', `/v${i % 20}/orgs/:org/repos/:repo/actions/${i}`, i);
    else r.add('GET',  `/v${i % 20}/files/${i}/*path`, i);
  }
  if (shape === 'wildcard') r.add('GET', `/files/g${i % 1000}/b-${i}/*path`, i);
  if (shape === 'regex') {
    const re = ['(\\d+)', '([a-z]+)', '([A-Z]+)', '(\\d{2,8})'][i % 4]!;
    r.add('GET', `/r${i}/:id${re}`, i);
  }
}
r.build();
const buildMs = performance.now() - t0;

const rssImm = rssMb();
await sleep(2000);
const rssSettled = rssMb();
const heapSettled = process.memoryUsage().heapUsed / 1024 / 1024;

console.log(
  `${shape.padEnd(9)} ${n.toString().padStart(7)} ` +
  `build=${buildMs.toFixed(0).padStart(5)}ms ` +
  `rss[baseline/imm/settled]=${baseline.toFixed(0).padStart(3)}/${rssImm.toFixed(0).padStart(4)}/${rssSettled.toFixed(0).padStart(3)}MB ` +
  `delta=${(rssSettled - baseline).toFixed(0)}MB heap=${heapSettled.toFixed(0)}MB`,
);
