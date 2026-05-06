/* E + F — JSC shape with diverse key distributions, freeze/clone with varying params */
/* eslint-disable no-console */
import { bench, run, do_not_optimize } from 'mitata';

// E: diverse key distributions
const ITERS = 100_000;

function buildKeys(pattern: string): string[] {
  const ks: string[] = [];
  for (let i = 0; i < ITERS; i++) {
    if (pattern === 'short') ks.push(`/r${i}`);
    else if (pattern === 'long') ks.push(`/api/v${i % 50}/tenants/${i}/users/${i % 1000}/posts/${i}/comments/${i % 100}`);
    else if (pattern === 'shared-prefix') ks.push(`/very/long/common/prefix/that/is/identical/across/keys/${i}`);
    else if (pattern === 'numeric') ks.push(`${i}`);
    else if (pattern === 'mixed-case') ks.push(`/Path${i}/MixedCase${i}/x`);
    else ks.push(`/route/${i}`);
  }
  return ks;
}

const patterns = ['short', 'long', 'shared-prefix', 'numeric', 'mixed-case'];

for (const p of patterns) {
  const keys = buildKeys(p);
  const obj: Record<string, number> = Object.create(null);
  const m = new Map<string, number>();
  for (let i = 0; i < ITERS; i++) {
    obj[keys[i]!] = i;
    m.set(keys[i]!, i);
  }
  let idx = 0;
  bench(`E: ${p.padEnd(14)} object 100k`, () => {
    const k = keys[(idx = (idx + 1) % ITERS)]!;
    do_not_optimize(obj[k]);
  });
  bench(`E: ${p.padEnd(14)} Map 100k`, () => {
    const k = keys[(idx = (idx + 1) % ITERS)]!;
    do_not_optimize(m.get(k));
  });
}

// F: freeze/clone with varying param count
const url = '/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t';
const baseOff = new Int32Array(40);
for (let i = 0; i < 40; i++) baseOff[i] = i % 20;
const names20 = Array.from({ length: 20 }, (_, i) => `p${i}`);
let cnt = 0;

for (const k of [2, 5, 10, 20]) {
  const names = names20.slice(0, k);
  const off = baseOff.slice(0, k * 2);
  const cached: Record<string, string> = {};
  for (let i = 0; i < k; i++) cached[names[i]!] = `v${i}`;
  Object.freeze(cached);

  bench(`F: ${k}-key fresh factory`, () => {
    const o: Record<string, string> = {};
    for (let i = 0; i < k; i++) o[names[i]!] = url.slice(off[i * 2]!, off[i * 2 + 1]!);
    do_not_optimize(o);
  });

  bench(`F: ${k}-key Object.freeze({...})`, () => {
    const o: Record<string, string> = {};
    for (let i = 0; i < k; i++) o[names[i]!] = url.slice(off[i * 2]!, off[i * 2 + 1]!);
    do_not_optimize(Object.freeze(o));
  });

  bench(`F: ${k}-key clone-on-hit (...spread)`, () => {
    do_not_optimize({ ...cached, _: cnt++ });
  });
}

await run({ format: 'mitata' });
