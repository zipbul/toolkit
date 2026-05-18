import { bench, do_not_optimize, run, summary } from 'mitata';

import { Router } from '../src/router';
import { printEnv, settleScavenger } from './helpers';

const CACHE_SIZE = 128;
const UNIQUE = 100_000;

function buildRouter(): Router<string> {
  const r = new Router<string>({ cacheSize: CACHE_SIZE });
  r.add('GET', '/users/:id', 'user');
  r.add('GET', '/orgs/:org/repos/:repo/issues/:issue', 'issue');
  r.build();
  return r;
}

function heap(): number {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  return process.memoryUsage().heapUsed;
}

function runHighCardinality(router: Router<string>, unique: number): void {
  for (let i = 0; i < unique; i++) {
    router.match('GET', `/users/${i}`);
    router.match('GET', `/orgs/o${i}/repos/r${i}/issues/${i}`);
    router.match('GET', `/missing/${i}`);
  }
}

printEnv();
settleScavenger();

// Phase 1: eviction-correctness probe (not a timing bench). Drives
// 100k unique keys through a 128-entry cache and asserts the oldest
// key has been evicted while the newest stays resident.
const probe = buildRouter();
const before = heap();
runHighCardinality(probe, UNIQUE);
const afterFirst = heap();
runHighCardinality(probe, UNIQUE);
const afterSecond = heap();
const oldest = probe.match('GET', '/users/0');
const newest = probe.match('GET', `/users/${UNIQUE - 1}`);

console.log(`cacheSize=${CACHE_SIZE} uniqueKeysPerRouteKind=${UNIQUE.toLocaleString()}`);
console.log(`heap delta first pressure: ${((afterFirst - before) / 1024 / 1024).toFixed(2)} MB`);
console.log(`heap delta second pressure: ${((afterSecond - afterFirst) / 1024 / 1024).toFixed(2)} MB`);
console.log(`oldest source after pressure: ${oldest?.meta.source ?? 'null'}`);
console.log(`newest source after pressure: ${newest?.meta.source ?? 'null'}`);

if (oldest?.meta.source !== 'dynamic') {
  throw new Error(`cache cardinality regression: oldest hit should have been evicted, got ${oldest?.meta.source}`);
}
if (newest?.meta.source !== 'cache') {
  throw new Error(`cache cardinality regression: newest hit should remain cached, got ${newest?.meta.source}`);
}

// Phase 2: timing benches that separate hit / evict / miss cost.
// Earlier bench mixed all three into one call — the cost components
// could not be told apart. Each call site below is monomorphic.
settleScavenger();

const hitRouter = buildRouter();
// Warm cache to exactly CACHE_SIZE keys, all dynamic hits.
for (let i = 0; i < CACHE_SIZE; i++) hitRouter.match('GET', `/users/${i}`);

const evictRouter = buildRouter();
// Warm cache full so every subsequent new key triggers eviction.
for (let i = 0; i < CACHE_SIZE; i++) evictRouter.match('GET', `/users/${i}`);

const missRouter = buildRouter();

summary(() => {
  let hitCursor = 0;
  bench('cache hit (warm, resident key)', () => {
    const n = hitCursor++ % CACHE_SIZE;
    do_not_optimize(hitRouter.match('GET', `/users/${n}`));
  });

  let evictCursor = CACHE_SIZE;
  bench('cache evict (new key, forces LRU evict)', () => {
    const n = evictCursor++;
    do_not_optimize(evictRouter.match('GET', `/users/${n}`));
  });

  let missCursor = 0;
  bench('miss path (no matching route)', () => {
    const n = missCursor++;
    do_not_optimize(missRouter.match('GET', `/nowhere/${n}`));
  });
});

await run();
