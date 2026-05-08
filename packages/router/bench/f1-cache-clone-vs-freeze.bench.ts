/**
 * F1: cache write/read asymmetry — clone-on-read vs freeze-on-write.
 *
 * Current behavior (emitter.ts:247): cache stores `{value, params}`.
 * On hit, `Object.assign(new NullProtoObj(), cached.params)` clones.
 *
 * Variants:
 *   A: clone-on-read (current) — Object.assign(new NullProtoObj(), p)
 *   B: freeze-on-write + ref return — write once with Object.freeze(p),
 *      read returns the frozen reference (no clone, mutation impossible)
 *   C: raw reference (no freeze, no clone) — risk: caller mutation leaks
 *
 * Sweeps: param shape 2/5/10/20 keys × hit-rate 100%/50%/10%.
 *
 * Note: hit-rate sweeps simulate the "amortization break-even" — at low
 * hit rates the dominant cost is the walker, not the clone, so any clone
 * delta gets divided by the proportion of hits.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

function buildParams(n: number): Record<string, unknown> {
  const o = new NullProtoObj();
  for (let i = 0; i < n; i++) o['k' + i] = 'v' + i;
  return o;
}

const SHAPES = [2, 5, 10, 20] as const;

// One pre-built `cached` entry per shape (shape A: unfrozen, shape B: frozen).
const CACHE_A: Record<number, { value: number; params: Record<string, unknown> }> = {};
const CACHE_B: Record<number, { value: number; params: Record<string, unknown> }> = {};
const CACHE_C: Record<number, { value: number; params: Record<string, unknown> }> = {};
for (const n of SHAPES) {
  CACHE_A[n] = { value: 1, params: buildParams(n) };
  CACHE_B[n] = { value: 1, params: Object.freeze(buildParams(n)) as Record<string, unknown> };
  CACHE_C[n] = { value: 1, params: buildParams(n) };
}

function readClone(cached: { value: number; params: Record<string, unknown> }) {
  return {
    value: cached.value,
    params: Object.assign(new NullProtoObj(), cached.params),
  };
}
function readFrozenRef(cached: { value: number; params: Record<string, unknown> }) {
  return { value: cached.value, params: cached.params };
}
function readRawRef(cached: { value: number; params: Record<string, unknown> }) {
  return { value: cached.value, params: cached.params };
}

for (const n of SHAPES) {
  summary(() => {
    bench(`F1 hit=100% keys=${n}: A clone-on-read`, () => {
      do_not_optimize(readClone(CACHE_A[n]));
    });
    bench(`F1 hit=100% keys=${n}: B freeze-on-write + ref`, () => {
      do_not_optimize(readFrozenRef(CACHE_B[n]));
    });
    bench(`F1 hit=100% keys=${n}: C raw ref`, () => {
      do_not_optimize(readRawRef(CACHE_C[n]));
    });
  });
}

// Hit-rate amortization model: the "miss" arm pays a synthetic walker
// cost (~14 ns target) so the relative impact at low hit rates is visible.
function syntheticWalker(): { value: number; params: Record<string, unknown> } {
  // Imitate walker work: build a fresh params object similar to factory cost.
  const p = new NullProtoObj();
  p['k0'] = 'v0';
  p['k1'] = 'v1';
  return { value: 2, params: p };
}

const HIT_RATES = [
  { label: '50%', mask: 0x1 },
  { label: '10%', mask: 0x9 }, // bits 0,3 -> ~12.5%; close enough
];

let _f1cur = 0;
for (const n of [5] as const) {
  for (const hr of HIT_RATES) {
    summary(() => {
      bench(`F1 hit=${hr.label} keys=${n}: A clone+miss`, () => {
        const i = _f1cur++ & 7;
        if ((i & hr.mask) === 0) {
          do_not_optimize(readClone(CACHE_A[n]));
        } else {
          do_not_optimize(syntheticWalker());
        }
      });
      bench(`F1 hit=${hr.label} keys=${n}: B frozen-ref+miss`, () => {
        const i = _f1cur++ & 7;
        if ((i & hr.mask) === 0) {
          do_not_optimize(readFrozenRef(CACHE_B[n]));
        } else {
          do_not_optimize(syntheticWalker());
        }
      });
    });
  }
}

await run();
