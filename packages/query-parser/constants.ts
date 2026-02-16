import type { QueryParserOptions } from './interfaces';

export const DEFAULT_QUERY_PARSER_OPTIONS: Required<QueryParserOptions> = {
  depth: 5,
  parameterLimit: 1000,
  parseArrays: false, // Default strict, user must opt-in
  arrayLimit: 20,
  hppMode: 'first',
  strictMode: false,
};
