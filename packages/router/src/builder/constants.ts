// Regex anchor patterns — used by pattern-utils to reject user-supplied
// `^` / `$` anchors at parse time (the router wraps every pattern in
// `^(?:...)$`, so accepting user anchors would double-anchor or
// silently contradict the wrapper).
export const START_ANCHOR_PATTERN = /^\^/;
export const END_ANCHOR_PATTERN = /\$$/;

// Path-syntax char codes — single source for hot-path charCodeAt comparisons.
// These mirror the ASCII code points so do NOT renumber.
export const CC_SLASH = 47; // '/'
export const CC_STAR = 42; // '*'
export const CC_PLUS = 43; // '+'
export const CC_COLON = 58; // ':'
