/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

function gc(): void { if (typeof Bun !== 'undefined') for (let i = 0; i < 5; i++) Bun.gc(true); }
function rssMb(): number { gc(); return process.memoryUsage().rss / 1024 / 1024; }
function heapMb(): number { gc(); return process.memoryUsage().heapUsed / 1024 / 1024; }

function buildN(count: number, kind: 'static' | 'param' | 'tenant'): { router: Router<number>; buildMs: number; rssDelta: number; heapDelta: number } {
  const r0 = rssMb();
  const h0 = heapMb();
  const router = new Router<number>();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    if (kind === 'static') router.add('GET', `/api/v1/resource-${i}`, i);
    else if (kind === 'param') router.add('GET', `/tenant-${i}/users/:id/posts/:postId`, i);
    else router.add('GET', `/t${i % 1000}/u/:uid/p/${i}`, i);
  }
  router.build();
  const buildMs = performance.now() - t0;
  const r1 = rssMb();
  const h1 = heapMb();
  return { router, buildMs, rssDelta: r1 - r0, heapDelta: h1 - h0 };
}

function steadyNs(router: Router<number>, path: string, iter: number): number {
  for (let i = 0; i < 50_000; i++) router.match('GET', path);
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) router.match('GET', path);
  return ((performance.now() - t0) * 1e6) / iter;
}

const ITER = 500_000;
console.log(`commit=${process.argv[2] ?? 'HEAD'}`);
console.log(`${'shape'.padEnd(20)} ${'count'.padStart(7)} ${'build'.padStart(8)} ${'rss'.padStart(8)} ${'heap'.padStart(8)} ${'steady'.padStart(8)}`);
for (const kind of ['static', 'param', 'tenant'] as const) {
  for (const n of [1_000, 10_000, 100_000] as const) {
    const probe = buildN(n, kind);
    let path: string;
    if (kind === 'static') path = `/api/v1/resource-${Math.floor(n / 2)}`;
    else if (kind === 'param') path = `/tenant-${Math.floor(n / 2)}/users/42/posts/7`;
    else path = `/t${Math.floor(n / 2) % 1000}/u/42/p/${Math.floor(n / 2)}`;
    const ns = steadyNs(probe.router, path, ITER);
    console.log(
      `${kind.padEnd(20)} ${n.toString().padStart(7)} ` +
      `${probe.buildMs.toFixed(0).padStart(6)}ms ` +
      `${probe.rssDelta.toFixed(1).padStart(6)}MB ` +
      `${probe.heapDelta.toFixed(1).padStart(6)}MB ` +
      `${ns.toFixed(1).padStart(6)}ns`,
    );
  }
}
