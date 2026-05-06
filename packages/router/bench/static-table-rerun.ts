/* B + A — Map vs object re-verification with mitata, dead-code-elim guard, GC noise control */
/* eslint-disable no-console */
import { bench, run, do_not_optimize } from 'mitata';

const N = 100_000;
const keys: string[] = [];
for (let i = 0; i < N; i++) keys.push(`/api/v${i % 50}/users/${i}`);

// Build all candidate structures
const objMap: Record<string, number> = Object.create(null);
const sealedObj: Record<string, number> = Object.create(null);
const m = new Map<string, number>();
for (let i = 0; i < N; i++) {
  objMap[keys[i]!] = i;
  sealedObj[keys[i]!] = i;
  m.set(keys[i]!, i);
}
Object.preventExtensions(sealedObj);

// Method-first sharded: 32 buckets × ~3,125 keys
const SHARDS = 32;
const shardObjs: Array<Record<string, number>> = [];
const shardMaps: Array<Map<string, number>> = [];
for (let s = 0; s < SHARDS; s++) {
  shardObjs.push(Object.create(null));
  shardMaps.push(new Map());
}
for (let i = 0; i < N; i++) {
  const s = i % SHARDS;
  shardObjs[s]![keys[i]!] = i;
  shardMaps[s]!.set(keys[i]!, i);
}

// Adversarial: hash-collision-prone keys (long common prefix)
const collKeys: string[] = [];
for (let i = 0; i < N; i++) collKeys.push(`/aaaaaaaaaaaaaaaaaaaaaaaaaaaa/route/${i}`);
const collObj: Record<string, number> = Object.create(null);
const collMap = new Map<string, number>();
for (let i = 0; i < N; i++) {
  collObj[collKeys[i]!] = i;
  collMap.set(collKeys[i]!, i);
}

let idx = 0;

bench('null-proto object lookup (100k)', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(objMap[k]);
});
bench('sealed null-proto object lookup (100k)', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(sealedObj[k]);
});
bench('Map<string,number>.get (100k)', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(m.get(k));
});

bench('sharded null-proto (32× ~3.1k)', () => {
  const i = (idx = (idx + 1) % N);
  const k = keys[i]!;
  do_not_optimize(shardObjs[i % SHARDS]![k]);
});
bench('sharded Map (32× ~3.1k)', () => {
  const i = (idx = (idx + 1) % N);
  const k = keys[i]!;
  do_not_optimize(shardMaps[i % SHARDS]!.get(k));
});

bench('collision-prone object (long prefix)', () => {
  const k = collKeys[(idx = (idx + 1) % N)]!;
  do_not_optimize(collObj[k]);
});
bench('collision-prone Map (long prefix)', () => {
  const k = collKeys[(idx = (idx + 1) % N)]!;
  do_not_optimize(collMap.get(k));
});

// MISS lookups
const missKeys: string[] = [];
for (let i = 0; i < 1024; i++) missKeys.push(`/missing/route/${i}/x`);
bench('null-proto MISS (100k sealed)', () => {
  const k = missKeys[(idx = (idx + 1) & 1023)]!;
  do_not_optimize(objMap[k]);
});
bench('Map MISS (100k)', () => {
  const k = missKeys[(idx = (idx + 1) & 1023)]!;
  do_not_optimize(m.get(k));
});

await run({ format: 'mitata' });
