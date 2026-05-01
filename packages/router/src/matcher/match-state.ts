import { MAX_PARAMS } from '../builder/constants';

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
  paramValues: string[];
}

export function createMatchState(): MatchState {
  const paramValues = new Array<string>(MAX_PARAMS);

  for (let i = 0; i < MAX_PARAMS; i++) {
    paramValues[i] = '';
  }

  return {
    handlerIndex: -1,
    paramCount: 0,
    paramValues,
  };
}
