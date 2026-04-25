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

const MAX_PARAMS = 32;

export function createMatchState(): MatchState {
  return {
    handlerIndex: -1,
    paramCount: 0,
    paramNames: new Array<string>(MAX_PARAMS),
    paramValues: new Array<string>(MAX_PARAMS),
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
