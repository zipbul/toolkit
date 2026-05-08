/**
 * F3: factory indirect call vs inlined factory body.
 *
 * Current (emitter.ts:297-300):
 *   var factory = paramsFactories[tIdx];
 *   var params = (factory !== null) ? factory(sp, paramOffsets) : EMPTY_PARAMS;
 *
 * Variant B (inline): codegen emits the factory body directly inside
 * the terminal block — substring + property-assign without a function
 * dispatch.
 *
 * Sweeps:
 *   - monomorphic (single factory across calls)
 *   - megamorphic (100 distinct factories cycled)
 * Param shape: 2 (most common in routers).
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

// Build a factory that extracts 2 params from offsets [s0,e0,s1,e1].
function makeFactory(): (u: string, v: Int32Array) => Record<string, unknown> {
  return new Function(
    'NullProtoObj',
    `return function (u, v) {
      var p = new NullProtoObj();
      p["a"] = u.substring(v[0], v[1]);
      p["b"] = u.substring(v[2], v[3]);
      return p;
    };`,
  )(NullProtoObj);
}

const SINGLE_FACTORY = makeFactory();
const MEGA_FACTORIES: Array<(u: string, v: Int32Array) => Record<string, unknown>> = [];
for (let i = 0; i < 100; i++) MEGA_FACTORIES.push(makeFactory());

const SP = '/users/alice/orders/42';
const OFFSETS = new Int32Array([7, 12, 20, 22]); // "alice", "42"

// Variant A: indirect via paramsFactories[idx]
const PFS_MONO: Array<((u: string, v: Int32Array) => Record<string, unknown>) | null> = [SINGLE_FACTORY];
function variantA_mono(idx: number): Record<string, unknown> {
  const f = PFS_MONO[idx]!;
  return f(SP, OFFSETS);
}

const PFS_MEGA: Array<((u: string, v: Int32Array) => Record<string, unknown>) | null> = MEGA_FACTORIES.slice();
function variantA_mega(idx: number): Record<string, unknown> {
  const f = PFS_MEGA[idx]!;
  return f(SP, OFFSETS);
}

// Variant B: inlined body
function variantB(sp: string, off: Int32Array): Record<string, unknown> {
  const p = new NullProtoObj();
  p['a'] = sp.substring(off[0], off[1]);
  p['b'] = sp.substring(off[2], off[3]);
  return p;
}

let _cur = 0;
summary(() => {
  bench('F3 monomorphic: A indirect call (paramsFactories[tIdx])', () => {
    do_not_optimize(variantA_mono(0));
  });
  bench('F3 monomorphic: B inlined body', () => {
    do_not_optimize(variantB(SP, OFFSETS));
  });
});

summary(() => {
  bench('F3 megamorphic (100 fns): A indirect call', () => {
    do_not_optimize(variantA_mega((_cur++ * 17) % 100));
  });
  bench('F3 megamorphic (100 fns): B inlined body', () => {
    do_not_optimize(variantB(SP, OFFSETS));
  });
});

await run();
