/**
 * Function shape produced by every walker (segment-recursive, segment-iterative,
 * segment-codegen, wildcard-codegen). Returns true when the URL matches a
 * registered route; on success the walker has populated state.handlerIndex
 * and (for segment paths) state.params.
 */
export type MatchFn = (url: string, state: MatchState) => boolean;

export interface MatchState {
  handlerIndex: number;
  paramCount: number;
  paramNames: string[];
  paramValues: string[];
  /** Optional params target — walker writes directly here when set, instead
   *  of using the paramNames/paramValues arrays. Allows match() to pre-allocate
   *  the result params object once and skip the post-walk build step. */
  params: Record<string, string | undefined> | null;
  /** Error propagation from matcher closures (replaces Result<boolean>) */
  errorKind: string | null;
  errorMessage: string | null;
}

/**
 * Refined `MatchState` where `params` is guaranteed non-null. Segment-tree
 * walkers require this invariant — caller (compileMatchFn / allowedMethods)
 * assigns `state.params = new ParamsCtor()` before invocation. Encoding the
 * contract in the type lets walker bodies write `state.params[name] = ...`
 * without non-null assertions, and a future caller change that forgets the
 * assignment fails at compile time instead of producing a runtime crash.
 */
export type MatchStateWithParams = MatchState & {
  params: Record<string, string | undefined>;
};

const MAX_PARAMS = 32;

export function createMatchState(): MatchState {
  // Pre-fill the param arrays with empty strings so they're packed (no holes).
  // JSC otherwise treats `new Array(N)` as having `N` holes which trigger
  // prototype-chain walks on every read — slow path for the segment walker's
  // hot loop.
  const paramNames = new Array<string>(MAX_PARAMS);
  const paramValues = new Array<string>(MAX_PARAMS);

  for (let i = 0; i < MAX_PARAMS; i++) {
    paramNames[i] = '';
    paramValues[i] = '';
  }

  return {
    handlerIndex: -1,
    paramCount: 0,
    paramNames,
    paramValues,
    params: null,
    errorKind: null,
    errorMessage: null,
  };
}

export function resetMatchState(state: MatchState): void {
  state.handlerIndex = -1;
  state.paramCount = 0;
  state.params = null;
  state.errorKind = null;
  state.errorMessage = null;
}
