/**
 * Public surface of the runtime matcher layer (walker dispatcher +
 * decoder + match-state). Cross-directory consumers import from this
 * barrel only.
 */

export type { DecoderFn } from './decoder';
export { decoder } from './decoder';

export type { MatchFn, MatchState } from './match-state';
export { createMatchState } from './match-state';

export { createSegmentWalker } from './segment-walk';
