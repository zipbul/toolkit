import type { MatchState } from '../types';

export function createMatchState(maxParams: number): MatchState {
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
