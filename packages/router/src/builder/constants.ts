// Regex anchor / backreference patterns.
export const START_ANCHOR_PATTERN = /^\^/;
export const END_ANCHOR_PATTERN = /\$$/;
export const BACKREFERENCE_PATTERN = /\\(?:\d+|k<[^>]+>)/;

// Path-syntax char codes — single source for hot-path charCodeAt comparisons.
// These mirror the ASCII code points so do NOT renumber.
export const CC_SLASH = 47;        // '/'
export const CC_STAR = 42;         // '*'
export const CC_PLUS = 43;         // '+'
export const CC_COLON = 58;        // ':'

// Note — earlier `MAX_OPTIONAL=10`, `MAX_SEGMENTS=64` constants lived
// here but were never imported anywhere. Actual limits are option
// defaults applied in `router.ts:createPathParser` (maxSegmentCount 256)
// and `registration.ts:seal` (maxOptionalExpansions 1024,
// maxRegexSiblingsPerSegment 32). The dead constants were removed; do
// not re-add them without an importer.
