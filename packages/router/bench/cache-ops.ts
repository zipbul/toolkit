/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { RouterCache } from '../src/cache';

const ITER = 5_000_000;

// Pre-fill various sizes
for (const size of [10, 100, 1000, 10000]) {
  const lru = new RouterCache<{ v: number }>(size);
  const m = new Map<string, { v: number }>();
  for (let i = 0; i < size; i++) {
    lru.set(`/k${i}`, { v: i });
    m.set(`/k${i}`, { v: i });
  }

  const keys = Array.from({ length: size }, (_, i) => `/k${i}`);
  // get hit
  for (let it = 0; it < 100_000; it++) lru.get(keys[it % size]!);
  let t0 = performance.now();
  for (let it = 0; it < ITER; it++) lru.get(keys[it % size]!);
  const lruGet = ((performance.now() - t0) * 1e6) / ITER;

  for (let it = 0; it < 100_000; it++) m.get(keys[it % size]!);
  t0 = performance.now();
  for (let it = 0; it < ITER; it++) m.get(keys[it % size]!);
  const mapGet = ((performance.now() - t0) * 1e6) / ITER;

  // set replace
  for (let it = 0; it < 100_000; it++) lru.set(keys[it % size]!, { v: it });
  t0 = performance.now();
  for (let it = 0; it < ITER; it++) lru.set(keys[it % size]!, { v: it });
  const lruSet = ((performance.now() - t0) * 1e6) / ITER;

  for (let it = 0; it < 100_000; it++) m.set(keys[it % size]!, { v: it });
  t0 = performance.now();
  for (let it = 0; it < ITER; it++) m.set(keys[it % size]!, { v: it });
  const mapSet = ((performance.now() - t0) * 1e6) / ITER;

  console.log(`size=${size.toString().padStart(5)}  RouterCache get=${lruGet.toFixed(1).padStart(5)}ns set=${lruSet.toFixed(1).padStart(5)}ns  |  Map get=${mapGet.toFixed(1).padStart(5)}ns set=${mapSet.toFixed(1).padStart(5)}ns`);
}
