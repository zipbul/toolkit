/**
 * F8: MatchOutput shape — 3-field vs 2-field vs tuple.
 *
 * Variants:
 *   A: { value, params, meta }                   — current
 *   B: { value, params }                         — drop meta
 *   C: { value, params, meta: undefined }        — preserves shape but no alloc
 *   D: [value, params]                            — typed tuple (Array)
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

const META = Object.freeze({ source: 'dynamic' as const });

const VAL = { handler: () => 0 };
function P(): Record<string, unknown> {
  const p = new NullProtoObj();
  p['a'] = '1';
  p['b'] = '2';
  return p;
}

function emitA(): { value: unknown; params: Record<string, unknown>; meta: typeof META } {
  return { value: VAL, params: P(), meta: META };
}
function emitB(): { value: unknown; params: Record<string, unknown> } {
  return { value: VAL, params: P() };
}
function emitC(): { value: unknown; params: Record<string, unknown>; meta: undefined } {
  return { value: VAL, params: P(), meta: undefined };
}
function emitD(): [unknown, Record<string, unknown>] {
  return [VAL, P()];
}

summary(() => {
  bench('F8 A: 3-field {value, params, meta}', () => {
    do_not_optimize(emitA());
  });
  bench('F8 B: 2-field {value, params}', () => {
    do_not_optimize(emitB());
  });
  bench('F8 C: 3-field with meta=undefined', () => {
    do_not_optimize(emitC());
  });
  bench('F8 D: tuple [value, params]', () => {
    do_not_optimize(emitD());
  });
});

await run();
