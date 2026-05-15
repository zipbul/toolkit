/**
 * Public surface of the runtime matcher layer (walker dispatcher +
 * decoder + match-state). Cross-directory consumers import from this
 * barrel only. Runtime contract types (MatchFn, MatchState, DecoderFn)
 * live in src/types.ts so codegen can reference them without an
 * upward import on matcher.
 */

export { decoder } from './decoder';
export { createMatchState } from './match-state';
export { createSegmentWalker } from './segment-walk';
