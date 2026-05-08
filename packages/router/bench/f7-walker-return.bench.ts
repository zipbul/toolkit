/**
 * F7: walker boolean-return + state mutation vs walker number-return.
 *
 * Variants:
 *   A: tr(sp, state) returns boolean; on true caller reads state.handlerIndex
 *   B: tr(sp, state) returns number (terminal idx); on >=0 caller uses it directly
 *
 * Tests both monomorphic IC stability and inline call-site folding.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

interface State {
  handlerIndex: number;
  paramOffsets: Int32Array;
}

const STATE: State = { handlerIndex: -1, paramOffsets: new Int32Array(16) };

function walkerA(sp: string, st: State): boolean {
  // Imitate small amount of work
  const c = sp.charCodeAt(0) | 0;
  st.handlerIndex = c & 31;
  return c >= 47;
}
function walkerB(sp: string, _st: State): number {
  const c = sp.charCodeAt(0) | 0;
  if (c < 47) return -1;
  return c & 31;
}

const SP = '/api/v1/users';

function callerA(): number {
  const ok = walkerA(SP, STATE);
  if (ok) {
    const t = STATE.handlerIndex;
    return t * 2 + 1;
  }
  return -1;
}

function callerB(): number {
  const t = walkerB(SP, STATE);
  if (t >= 0) {
    return t * 2 + 1;
  }
  return -1;
}

summary(() => {
  bench('F7 A: bool + state.handlerIndex', () => {
    do_not_optimize(callerA());
  });
  bench('F7 B: number return', () => {
    do_not_optimize(callerB());
  });
});

await run();
