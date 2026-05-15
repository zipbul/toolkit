/**
 * Public surface of the route-builder layer (path parsing, optional
 * expansion, validation policy). Cross-directory consumers import from
 * this barrel only.
 */

export { PathParser } from './path-parser';
export {
  MAX_OPTIONAL_SEGMENTS_PER_ROUTE,
  expandOptional,
} from './route-expand';
export { OptionalParamDefaults } from './optional-param-defaults';
export { validateMethodToken } from './method-policy';
