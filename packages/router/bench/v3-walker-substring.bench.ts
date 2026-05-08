/**
 * V3: substring vs offset-only for static child lookup.
 *
 * Scenario: segment-walk.ts — `var seg = path.substring(pos, end); var child = staticChildren[seg];`
 * depth 5, fanout 4.
 *
 * Variants:
 *   A: baseline — substring() then dictionary lookup
 *   B: per-child startsWith(childKey, pos) + boundary check, iterate until match
 *   C: substring kept (sanity that short-string fast path is consistent)
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, number> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, number> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

// Build a depth-5 path. At each segment we have fanout=4 static children.
// We pick the third (index 2) child at every level.
const SEGMENTS_PER_LEVEL = [
  ['alpha', 'bravo', 'charlie', 'delta'],
  ['echo', 'foxtrot', 'golf', 'hotel'],
  ['india', 'juliett', 'kilo', 'lima'],
  ['mike', 'november', 'oscar', 'papa'],
  ['quebec', 'romeo', 'sierra', 'tango'],
];

// Pre-build path: take SEGMENTS_PER_LEVEL[i][2] at each level
const PATH_PARTS = SEGMENTS_PER_LEVEL.map(s => s[2]);
const PATH = '/' + PATH_PARTS.join('/');

// Pre-compute segment boundaries [start, end] pairs (skipping the leading '/')
const BOUNDS: number[] = [];
{
  let pos = 1;
  for (let i = 0; i < PATH_PARTS.length; i++) {
    const start = pos;
    const end = pos + PATH_PARTS[i].length;
    BOUNDS.push(start, end);
    pos = end + 1;
  }
}

// Build per-level NullProtoObj children dictionaries (string -> dummy node id)
const CHILDREN_DICT: Record<string, number>[] = SEGMENTS_PER_LEVEL.map((segs, levelIdx) => {
  const o = new NullProtoObj();
  for (let i = 0; i < segs.length; i++) o[segs[i]] = levelIdx * 100 + i;
  return o;
});

// Variant A: substring + dictionary lookup
function variantA(): number {
  let acc = 0;
  for (let lvl = 0; lvl < 5; lvl++) {
    const start = BOUNDS[lvl * 2];
    const end = BOUNDS[lvl * 2 + 1];
    const seg = PATH.substring(start, end);
    const v = CHILDREN_DICT[lvl][seg];
    acc += v;
  }
  return acc;
}

// Variant B: per-child startsWith + boundary check (no allocation)
// We also keep an array of [key, value] pairs per level for iteration.
const CHILDREN_PAIRS: [string, number][][] = SEGMENTS_PER_LEVEL.map((segs, levelIdx) =>
  segs.map((s, i) => [s, levelIdx * 100 + i] as [string, number]),
);

function variantB(): number {
  let acc = 0;
  for (let lvl = 0; lvl < 5; lvl++) {
    const start = BOUNDS[lvl * 2];
    const end = BOUNDS[lvl * 2 + 1];
    const len = end - start;
    const pairs = CHILDREN_PAIRS[lvl];
    for (let i = 0; i < pairs.length; i++) {
      const k = pairs[i][0];
      if (
        k.length === len &&
        PATH.startsWith(k, start) &&
        (end === PATH.length || PATH.charCodeAt(end) === 47)
      ) {
        acc += pairs[i][1];
        break;
      }
    }
  }
  return acc;
}

// Variant C: substring kept (same as A but in different closure to avoid IC sharing)
function variantC(): number {
  let acc = 0;
  for (let lvl = 0; lvl < 5; lvl++) {
    const start = BOUNDS[lvl * 2];
    const end = BOUNDS[lvl * 2 + 1];
    const seg = PATH.substring(start, end);
    const v = CHILDREN_DICT[lvl][seg];
    acc += v;
  }
  return acc;
}

summary(() => {
  bench('V3-A: substring + dict lookup (baseline)', () => {
    do_not_optimize(variantA());
  });
  bench('V3-B: startsWith + boundary check (no alloc)', () => {
    do_not_optimize(variantB());
  });
  bench('V3-C: substring + dict lookup (control)', () => {
    do_not_optimize(variantC());
  });
});

await run();
