/**
 * Hot-path match state. Shared across synchronous allowedMethods() lookups,
 * and pre-allocated per Router instance for match() hot-path.
 */
export interface MatchState {
  /** The index of the matched handler. -1 if no match. */
  handlerIndex: number;
  /** Current count of matched parameters. */
  paramCount: number;
  /**
   * Flat buffer for [start, end] index pairs of matched parameters.
   */
  paramOffsets: Int32Array;
}

/**
 * Hot-path match function: writes paramOffsets/handlerIndex into `state`.
 * Returns true on match, false otherwise.
 */
export type MatchFn = (url: string, state: MatchState) => boolean;

const DEFAULT_MAX_PARAMS = 64;

export function createMatchState(maxParams: number = DEFAULT_MAX_PARAMS): MatchState {
  // Two slots per parameter (start, end) plus a small headroom slot so
  // codegen-emitted writes that index `paramCount * 2 + 1` cannot fall
  // off the end on the last param.
  const paramOffsets = new Int32Array(Math.max(2, maxParams * 2 + 2));

  return {
    handlerIndex: -1,
    paramCount: 0,
    paramOffsets,
  };
}
