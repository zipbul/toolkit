/**
 * Public surface of the route-builder layer (path parsing, optional
 * expansion, validation policy). Cross-directory consumers import from
 * this barrel only.
 */

export type { ParseResult, PathParserConfig } from './path-parser';
export { PathParser } from './path-parser';

export type { ExpandedRoute } from './route-expand';
export {
  MAX_OPTIONAL_SEGMENTS_PER_ROUTE,
  countOptionalSegments,
  expandOptional,
} from './route-expand';

export { OptionalParamDefaults } from './optional-param-defaults';
export { validateMethodToken } from './method-policy';
export { validatePathChars } from './path-policy';
export { assessRegexSafety } from './regex-safety';
export { normalizeParamPatternSource } from './pattern-utils';
