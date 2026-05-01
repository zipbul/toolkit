// Regex anchor / backreference patterns.
export const START_ANCHOR_PATTERN = /^\^/;
export const END_ANCHOR_PATTERN = /\$$/;
export const BACKREFERENCE_PATTERN = /\\(?:\d+|k<[^>]+>)/;

// Path-syntax char codes — single source for hot-path charCodeAt comparisons.
// These mirror the ASCII code points so do NOT renumber.
export const CC_SLASH = 47;        // '/'
export const CC_LPAREN = 40;       // '('
export const CC_RPAREN = 41;       // ')'
export const CC_STAR = 42;         // '*'
export const CC_PLUS = 43;         // '+'
export const CC_COLON = 58;        // ':'
export const CC_QUESTION = 63;     // '?'

// Hard limits — single source for builder validation and matcher pre-allocation.
// MAX_PARAMS must equal the matcher's pre-allocated paramNames/paramValues
// length in src/matcher/match-state.ts; changing one without the other
// silently corrupts dynamic-match output for paths above the threshold.
export const MAX_PARAMS = 32;
// Each optional param doubles the expansion count (2^N). At N=20 the build
// hangs ~5s; N=25 allocates 33M parts arrays. Capped at 10 (1024 expansions,
// milliseconds-level build) — far above realistic APIs and below pathological
// territory.
export const MAX_OPTIONAL = 10;
// Maximum segment count per registered path. 64 is double the param cap and
// covers any realistic REST shape; rejection at registration prevents
// pathological registrations from inflating the segment-tree.
export const MAX_SEGMENTS = 64;
