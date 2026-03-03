export interface MatchState {
  handlerIndex: number;
  paramCount: number;
  paramNames: string[];
  paramValues: string[];
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
    errorKind: null,
    errorMessage: null,
  };
}

export function resetMatchState(state: MatchState): void {
  state.handlerIndex = -1;
  state.paramCount = 0;
  state.errorKind = null;
  state.errorMessage = null;
}
