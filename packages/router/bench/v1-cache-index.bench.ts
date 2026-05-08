/**
 * V1: Map<string,number> vs NullProtoObj for cache index.
 *
 * Scenario: RouterCache internal index. Default cache size = 1000.
 *   - baseline: Map<string, number> with 1000 entries (hit + miss access)
 *   - proposed: NullProtoObj as {[k:string]: number}, same access
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, number> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, number> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

const N = 1000;
const keys: string[] = new Array(N);
for (let i = 0; i < N; i++) keys[i] = `/api/v1/resource${i}`;

// Build Map
const m = new Map<string, number>();
for (let i = 0; i < N; i++) m.set(keys[i], i);

// Build NullProtoObj
const o = new NullProtoObj();
for (let i = 0; i < N; i++) o[keys[i]] = i;

// Hit ordering: deterministic, scattered (avoid sequential prefetch bias)
const hitOrder: number[] = new Array(N);
for (let i = 0; i < N; i++) hitOrder[i] = (i * 277 + 13) % N;

// Miss keys (don't exist in either)
const missKeys: string[] = new Array(N);
for (let i = 0; i < N; i++) missKeys[i] = `/api/v1/missing${i}`;

let cursor = 0;

summary(() => {
  bench('V1 hit: Map<string,number>.get', () => {
    const k = keys[hitOrder[cursor++ & (N - 1)]];
    do_not_optimize(m.get(k));
  });
  bench('V1 hit: NullProtoObj[k]', () => {
    const k = keys[hitOrder[cursor++ & (N - 1)]];
    do_not_optimize(o[k]);
  });
});

summary(() => {
  bench('V1 miss: Map<string,number>.get', () => {
    const k = missKeys[cursor++ & (N - 1)];
    do_not_optimize(m.get(k));
  });
  bench('V1 miss: NullProtoObj[k]', () => {
    const k = missKeys[cursor++ & (N - 1)];
    do_not_optimize(o[k]);
  });
});

await run();
