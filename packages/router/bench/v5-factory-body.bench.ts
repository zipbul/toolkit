/**
 * V5: factory body NullProtoObj vs `{__proto__: null}` literal.
 *
 * Scenario: registration.ts:572 generated factory body.
 *   - baseline: var p = { __proto__: null }; p["a"] = ...; p["b"] = ...;
 *   - proposed: var p = new NullProtoObj(); p["a"] = ...; p["b"] = ...;
 *
 * 2-param factory, 1000 invocations per bench tick.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

const A_VALS: string[] = new Array(1024);
const B_VALS: string[] = new Array(1024);
for (let i = 0; i < 1024; i++) {
  A_VALS[i] = `aval${i}`;
  B_VALS[i] = `bval${i}`;
}

function factoryLiteral(a: string, b: string): Record<string, unknown> {
  const p: Record<string, unknown> = { __proto__: null } as any;
  p['a'] = a;
  p['b'] = b;
  return p;
}

function factoryNullProto(a: string, b: string): Record<string, unknown> {
  const p = new NullProtoObj();
  p['a'] = a;
  p['b'] = b;
  return p;
}

summary(() => {
  bench('V5 baseline: { __proto__: null } literal', () => {
    for (let i = 0; i < 1000; i++) {
      do_not_optimize(factoryLiteral(A_VALS[i & 1023], B_VALS[i & 1023]));
    }
  });
  bench('V5 proposed: new NullProtoObj()', () => {
    for (let i = 0; i < 1000; i++) {
      do_not_optimize(factoryNullProto(A_VALS[i & 1023], B_VALS[i & 1023]));
    }
  });
});

// Per-call (1 invocation per iter) variant — to cross-check the loop result.
let _v5cursor = 0;
summary(() => {
  bench('V5 baseline (single call): { __proto__: null }', () => {
    const i = _v5cursor++ & 1023;
    do_not_optimize(factoryLiteral(A_VALS[i], B_VALS[i]));
  });
  bench('V5 proposed (single call): new NullProtoObj()', () => {
    const i = _v5cursor++ & 1023;
    do_not_optimize(factoryNullProto(A_VALS[i], B_VALS[i]));
  });
});

await run();
