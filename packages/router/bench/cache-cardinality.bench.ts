import { bench, do_not_optimize, run, summary } from 'mitata';

import { Router } from '../src/router';

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
  if (typeof (globalThis as any).Bun?.gc === 'function') {
    (globalThis as any).Bun.gc(true);
  }

  return process.memoryUsage().heapUsed;
}

function runHighCardinality(router: Router<string>, unique: number): void {
  for (let i = 0; i < unique; i++) {
    router.match('GET', `/users/${i}`);
    router.match('GET', `/orgs/o${i}/repos/r${i}/issues/${i}`);
    router.match('GET', `/missing/${i}`);
  }
}

const probe = buildRouter();
const before = heap();
runHighCardinality(probe, UNIQUE);
const afterFirst = heap();
runHighCardinality(probe, UNIQUE);
const afterSecond = heap();
const oldest = probe.match('GET', '/users/0');
const newest = probe.match('GET', `/users/${UNIQUE - 1}`);

console.log(`cacheSize: ${CACHE_SIZE}`);
console.log(`unique keys per route kind: ${UNIQUE.toLocaleString()}`);
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

summary(() => {
  const r = buildRouter();
  let i = 0;

  bench('high-cardinality dynamic/cache/miss pressure', () => {
    const n = i++;
    do_not_optimize(r.match('GET', `/users/${n}`));
    do_not_optimize(r.match('GET', `/orgs/o${n}/repos/r${n}/issues/${n}`));
    do_not_optimize(r.match('GET', `/missing/${n}`));
  });
});

await run();
