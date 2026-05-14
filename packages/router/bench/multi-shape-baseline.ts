/* eslint-disable no-console */
/**
 * Baseline measurement for multi-shape factor candidate.
 * Workload: 100k routes split across N distinct shapes — single-shape (current
 * tenantFactor wins), 2-shape, 4-shape, 10-shape (current tenantFactor rejects
 * because keys per shape may drop below threshold OR shape mismatch on first
 * compare).
 *
 * Goal: identify whether multi-shape workloads have RSS bloat the current
 * detector misses. If RSS is already low (e.g. chain-compression covers it),
 * multi-shape factor offers no wins.
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

function memMB(): { rss: number; heap: number } {
  const u = process.memoryUsage();
  return { rss: u.rss / 1024 / 1024, heap: u.heapUsed / 1024 / 1024 };
}

function bench(name: string, build: (r: Router<number>) => void, iter = 100_000): void {
  Bun.gc(true);
  const m0 = memMB();
  const r = new Router<number>();
  const t0 = performance.now();
  build(r);
  r.build();
  const t1 = performance.now();
  Bun.gc(true);
  const m1 = memMB();

  // Warmed match
  const probes: string[] = [];
  for (let i = 0; i < 1000; i++) probes.push(`/users/${i}/posts/${i}`);
  for (let w = 0; w < 200_000; w++) r.match('GET', probes[w % probes.length]!);

  const t2 = performance.now();
  for (let m = 0; m < 5_000_000; m++) r.match('GET', probes[m % probes.length]!);
  const matchNs = ((performance.now() - t2) * 1e6) / 5_000_000;

  console.log(`  ${name.padEnd(35)} build=${(t1-t0).toFixed(0)}ms  rss+${(m1.rss-m0.rss).toFixed(1)}MB  heap+${(m1.heap-m0.heap).toFixed(1)}MB  match=${matchNs.toFixed(2)}ns`);
  void iter;
}

console.log('== 100k routes, varying shape count ==');

// 1 shape: /users/:id/posts/:postId × 100k tenants
bench('1-shape (tenant)', (r) => {
  for (let i = 0; i < 100_000; i++) r.add('GET', `/users/${i}/posts/:postId`, i);
});

// 2 shapes: half tenant, half /api/:v/items/:id
bench('2-shape mixed', (r) => {
  for (let i = 0; i < 50_000; i++) r.add('GET', `/users/${i}/posts/:postId`, i);
  for (let i = 0; i < 50_000; i++) r.add('GET', `/api/${i}/items/:itemId`, i + 100_000);
});

// 4 shapes
bench('4-shape mixed', (r) => {
  for (let i = 0; i < 25_000; i++) r.add('GET', `/users/${i}/posts/:postId`, i);
  for (let i = 0; i < 25_000; i++) r.add('GET', `/api/${i}/items/:itemId`, i + 100_000);
  for (let i = 0; i < 25_000; i++) r.add('GET', `/files/${i}/blob/:blobId`, i + 200_000);
  for (let i = 0; i < 25_000; i++) r.add('GET', `/teams/${i}/repos/:repoId`, i + 300_000);
});

// 10 shapes
bench('10-shape mixed', (r) => {
  const prefixes = ['users','api','files','teams','orgs','admin','blog','shop','docs','gigs'];
  for (let s = 0; s < 10; s++) {
    for (let i = 0; i < 10_000; i++) r.add('GET', `/${prefixes[s]}/${i}/sub/:subId`, s * 10_000 + i);
  }
});
