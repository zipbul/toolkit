/**
 * F6: codegen walker vs iterative walker (warmed).
 *
 * Two simulated walkers over a static-tree shape:
 *   A: codegen-style — emitted nested if-else with substring + dict lookup
 *      (mirrors segment-compile.ts emitted output).
 *   B: iterative — table-driven loop walking children dict via substring().
 *
 * Sizes: 16 / 256 / 512 segments. Per the project's codegen cap,
 * 16 and 256 are within the codegen tier; 512 forces iterative fallback.
 *
 * NOTE: this bench is a **simulation** (not the real router build),
 * because constructing a 512-node real tree from scratch in a single
 * bench file inflates setup beyond signal noise. The shapes used here
 * preserve the dominant cost driver: depth + per-level dict lookup.
 *
 * Reads as a controlled comparison: both walkers traverse depth-5 paths
 * with N siblings per level so total node count = sum over levels.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const NullProtoObj: { new (): Record<string, number> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, number> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

interface Shape {
  path: string;
  bounds: number[];
  childrenA: Record<string, number>[]; // codegen variant
  childrenB: Record<string, number>[]; // iterative variant (same data)
  depth: number;
}

function buildShape(totalNodes: number): Shape {
  const depth = 5;
  const fanoutPerLevel = Math.max(2, Math.ceil(totalNodes / depth));
  const childrenA: Record<string, number>[] = [];
  const childrenB: Record<string, number>[] = [];
  const pickedSegs: string[] = [];
  for (let lvl = 0; lvl < depth; lvl++) {
    const o1 = new NullProtoObj();
    const o2 = new NullProtoObj();
    for (let i = 0; i < fanoutPerLevel; i++) {
      const seg = `seg_l${lvl}_${i}`;
      o1[seg] = lvl * 1000 + i;
      o2[seg] = lvl * 1000 + i;
    }
    childrenA.push(o1);
    childrenB.push(o2);
    // pick the middle child
    pickedSegs.push(`seg_l${lvl}_${(fanoutPerLevel >>> 1)}`);
  }
  const path = '/' + pickedSegs.join('/');
  const bounds: number[] = [];
  let pos = 1;
  for (const s of pickedSegs) {
    bounds.push(pos, pos + s.length);
    pos += s.length + 1;
  }
  return { path, bounds, childrenA, childrenB, depth };
}

const SHAPES = {
  16: buildShape(16),
  256: buildShape(256),
  512: buildShape(512),
};

// Variant A: "codegen-style" — emit a fully-unrolled nested function via new Function.
// This mirrors what segment-compile.ts produces.
function makeCodegenWalker(shape: Shape): (sp: string) => number {
  const lines: string[] = [];
  lines.push('var pos = 1;');
  for (let lvl = 0; lvl < shape.depth; lvl++) {
    lines.push(`var end${lvl} = sp.indexOf('/', pos);`);
    lines.push(`if (end${lvl} < 0) end${lvl} = sp.length;`);
    lines.push(`var seg${lvl} = sp.substring(pos, end${lvl});`);
    lines.push(`var v${lvl} = c[${lvl}][seg${lvl}];`);
    lines.push(`if (v${lvl} === undefined) return -1;`);
    lines.push(`pos = end${lvl} + 1;`);
  }
  lines.push(`return v${shape.depth - 1};`);
  return new Function('c', `return function(sp){${lines.join('\n')}};`)(shape.childrenA);
}

// Variant B: iterative table-driven walker.
function makeIterativeWalker(shape: Shape): (sp: string) => number {
  const c = shape.childrenB;
  return (sp: string): number => {
    let pos = 1;
    let v = -1;
    for (let lvl = 0; lvl < c.length; lvl++) {
      let end = sp.indexOf('/', pos);
      if (end < 0) end = sp.length;
      const seg = sp.substring(pos, end);
      const cur = c[lvl][seg];
      if (cur === undefined) return -1;
      v = cur;
      pos = end + 1;
    }
    return v;
  };
}

const WALKERS_A = {
  16: makeCodegenWalker(SHAPES[16]),
  256: makeCodegenWalker(SHAPES[256]),
  512: makeCodegenWalker(SHAPES[512]),
};
const WALKERS_B = {
  16: makeIterativeWalker(SHAPES[16]),
  256: makeIterativeWalker(SHAPES[256]),
  512: makeIterativeWalker(SHAPES[512]),
};

// Warmup
for (let i = 0; i < 5000; i++) {
  WALKERS_A[16](SHAPES[16].path);
  WALKERS_A[256](SHAPES[256].path);
  WALKERS_A[512](SHAPES[512].path);
  WALKERS_B[16](SHAPES[16].path);
  WALKERS_B[256](SHAPES[256].path);
  WALKERS_B[512](SHAPES[512].path);
}

for (const n of [16, 256, 512] as const) {
  summary(() => {
    bench(`F6 size=${n}: A codegen walker`, () => {
      do_not_optimize(WALKERS_A[n](SHAPES[n].path));
    });
    bench(`F6 size=${n}: B iterative walker`, () => {
      do_not_optimize(WALKERS_B[n](SHAPES[n].path));
    });
  });
}

await run();
