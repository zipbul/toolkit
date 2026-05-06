import { MAX_PARAMS } from '../builder/constants';

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

export function createMatchState(): MatchState {
  // 32 parameters max, 2 slots per parameter (start, end)
  const paramOffsets = new Int32Array(MAX_PARAMS * 2);

  return {
    handlerIndex: -1,
    paramCount: 0,
    paramOffsets,
  };
}
