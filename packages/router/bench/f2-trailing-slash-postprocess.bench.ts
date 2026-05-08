/**
 * F2: trailing-slash strict post-walker patch cost.
 *
 * Current emitter.ts:284:
 *   if (!trimSlash && sp.length > 1 && sp.charCodeAt(sp.length-1) === 47
 *       && terminalSlab[base+1] === 0) ok = false;
 *
 * Variants:
 *   A: 4-stage check (current)
 *   B: no check (assume codegen handled it)
 *
 * Two input shapes:
 *   - canonical (no trailing slash) → A short-circuits at 3rd predicate
 *   - has trailing slash → A executes all 4 predicates
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const slab = new Int32Array(8);
slab[0] = 7; slab[1] = 0; // terminal 0: handler 7, non-wildcard
slab[2] = 9; slab[3] = 1; // terminal 1: handler 9, wildcard
const trimSlash = false;

const PATH_NO_SLASH = '/api/v1/users/42';
const PATH_TRAIL = '/api/v1/users/42/';

function variantA(sp: string, tIdx: number): boolean {
  let ok = true;
  const slabBase = tIdx << 1;
  if (!trimSlash && sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47 && slab[slabBase + 1] === 0) {
    ok = false;
  }
  return ok;
}
function variantB(_sp: string, _tIdx: number): boolean {
  return true;
}

summary(() => {
  bench('F2 canonical: A 4-stage check', () => {
    do_not_optimize(variantA(PATH_NO_SLASH, 0));
  });
  bench('F2 canonical: B no check', () => {
    do_not_optimize(variantB(PATH_NO_SLASH, 0));
  });
});

summary(() => {
  bench('F2 trail-slash: A 4-stage check (full eval)', () => {
    do_not_optimize(variantA(PATH_TRAIL, 0));
  });
  bench('F2 trail-slash: B no check', () => {
    do_not_optimize(variantB(PATH_TRAIL, 0));
  });
});

await run();
