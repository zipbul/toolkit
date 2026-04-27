import { Router } from '../index';

// Realistic route set: mix of static, param, wildcard
const router = new Router<string>({ enableCache: true, cacheSize: 1024 });

const routes: Array<[string, string]> = [
  ['GET', '/'],
  ['GET', '/health'],
  ['GET', '/users'],
  ['POST', '/users'],
  ['GET', '/users/:id'],
  ['PATCH', '/users/:id'],
  ['DELETE', '/users/:id'],
  ['GET', '/users/:id/posts'],
  ['GET', '/users/:id/posts/:postId'],
  ['POST', '/users/:id/posts/:postId/comments'],
  ['GET', '/orgs/:org/repos/:repo/issues/:num'],
  ['GET', '/orgs/:org/repos/:repo/pulls/:num/files'],
  ['GET', '/files/*path'],
  ['GET', '/docs/:section?/:page?'],
  ['GET', '/api/v:version(\\d+)/resource/:id(\\d+)'],
];

for (const [m, p] of routes) router.add(m as any, p, `${m} ${p}`);
router.build();

const queries: Array<[string, string]> = [
  ['GET', '/'],
  ['GET', '/health'],
  ['GET', '/users'],
  ['GET', '/users/42'],
  ['PATCH', '/users/42'],
  ['GET', '/users/42/posts'],
  ['GET', '/users/42/posts/99'],
  ['POST', '/users/42/posts/99/comments'],
  ['GET', '/orgs/zipbul/repos/toolkit/issues/7'],
  ['GET', '/orgs/zipbul/repos/toolkit/pulls/7/files'],
  ['GET', '/files/a/b/c/d.txt'],
  ['GET', '/docs'],
  ['GET', '/docs/intro'],
  ['GET', '/docs/intro/getting-started'],
  ['GET', '/api/v1/resource/123'],
  ['GET', '/missing-path'],      // miss
  ['GET', '/users/abc/posts'],   // param mismatch would still match :id
];

const ITERS = 5_000_000;

function heap(): number {
  if (typeof (globalThis as any).Bun?.gc === 'function') {
    (globalThis as any).Bun.gc(true);
  }
  return process.memoryUsage().heapUsed;
}

const before = heap();
const t0 = Bun.nanoseconds();

for (let i = 0; i < ITERS; i++) {
  const [m, p] = queries[i % queries.length]!;
  router.match(m as any, p);
}

const elapsedMs = (Bun.nanoseconds() - t0) / 1e6;
const after = heap();

console.log(`iterations: ${ITERS.toLocaleString()}`);
console.log(`elapsed:    ${elapsedMs.toFixed(1)} ms`);
console.log(`throughput: ${Math.round(ITERS / (elapsedMs / 1000)).toLocaleString()} ops/s`);
console.log(`heap before: ${(before / 1024 / 1024).toFixed(2)} MB`);
console.log(`heap after:  ${(after / 1024 / 1024).toFixed(2)} MB`);
console.log(`delta:       ${((after - before) / 1024 / 1024).toFixed(2)} MB`);
console.log(`per-match:   ${((after - before) / ITERS).toFixed(4)} bytes`);
