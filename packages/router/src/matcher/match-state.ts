import type { MatchState } from '../types';

export function createMatchState(maxParams: number): MatchState {
  const paramOffsets = new Int32Array(Math.max(2, maxParams * 2 + 2));

  return {
    handlerIndex: -1,
    paramCount: 0,
    paramOffsets,
  };
}
