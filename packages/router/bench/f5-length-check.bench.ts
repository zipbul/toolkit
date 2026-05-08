/**
 * F5: runtime path length check at hot-path entry.
 *
 * Current: `if (path.length > 8192) return null;`
 *
 * Variants:
 *   A: with check (current)
 *   B: no check
 *
 * Inputs: path-length 100, 1000, 8000.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

function makePath(n: number): string {
  let s = '/';
  while (s.length < n) s += 'a';
  return s.slice(0, n);
}

const PATHS = {
  100: makePath(100),
  1000: makePath(1000),
  8000: makePath(8000),
};

const MAX = 8192;

function variantA(path: string): number {
  if (path.length > MAX) return -1;
  return path.charCodeAt(0); // sentinel work, avoid full elision
}
function variantB(path: string): number {
  return path.charCodeAt(0);
}

for (const n of [100, 1000, 8000] as const) {
  summary(() => {
    bench(`F5 len=${n}: A length-guard`, () => {
      do_not_optimize(variantA(PATHS[n]));
    });
    bench(`F5 len=${n}: B no guard`, () => {
      do_not_optimize(variantB(PATHS[n]));
    });
  });
}

await run();
