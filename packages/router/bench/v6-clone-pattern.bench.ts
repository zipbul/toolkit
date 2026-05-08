/**
 * V6: Object.assign(new NullProtoObj(), cp) vs alternatives.
 *
 * Scenario: emitter.ts:225 cache hit clone.
 *   - baseline: Object.assign(new NullProtoObj(), cp)
 *   - alternative A: manual for-in copy into new NullProtoObj()
 *   - alternative B: spread { ...cp } (Object.prototype destination)
 *   - alternative C: Object.create(null, Object.getOwnPropertyDescriptors(cp))
 *
 * Measured at 2 / 5 / 10 / 20 keys.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

function buildSrc(n: number): Record<string, unknown> {
  const o = new NullProtoObj();
  for (let i = 0; i < n; i++) o['k' + i] = 'v' + i;
  return o;
}

const SRC_2 = buildSrc(2);
const SRC_5 = buildSrc(5);
const SRC_10 = buildSrc(10);
const SRC_20 = buildSrc(20);

function cloneAssign(cp: Record<string, unknown>): Record<string, unknown> {
  return Object.assign(new NullProtoObj(), cp);
}
function cloneForIn(cp: Record<string, unknown>): Record<string, unknown> {
  const c = new NullProtoObj();
  for (const k in cp) c[k] = cp[k];
  return c;
}
function cloneSpread(cp: Record<string, unknown>): Record<string, unknown> {
  return { ...cp };
}
function cloneDescriptors(cp: Record<string, unknown>): Record<string, unknown> {
  return Object.create(null, Object.getOwnPropertyDescriptors(cp));
}

function makeBlock(label: string, src: Record<string, unknown>) {
  summary(() => {
    bench(`V6 ${label}: Object.assign(new NullProtoObj, cp)`, () => {
      do_not_optimize(cloneAssign(src));
    });
    bench(`V6 ${label}: for-in -> NullProtoObj`, () => {
      do_not_optimize(cloneForIn(src));
    });
    bench(`V6 ${label}: { ...cp } spread`, () => {
      do_not_optimize(cloneSpread(src));
    });
    bench(`V6 ${label}: Object.create(null, descriptors)`, () => {
      do_not_optimize(cloneDescriptors(src));
    });
  });
}

makeBlock('2 keys', SRC_2);
makeBlock('5 keys', SRC_5);
makeBlock('10 keys', SRC_10);
makeBlock('20 keys', SRC_20);

await run();
