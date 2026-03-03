import type { ResolvedQueryParserOptions } from './types';

export const DEFAULT_QUERY_PARSER_OPTIONS: ResolvedQueryParserOptions = {
  depth: 5,
  maxParams: 1000,
  nesting: false,
  arrayLimit: 20,
  duplicates: 'first',
  strict: false,
  urlEncoded: false,
};

/** Keys that must never be written to any parsed object (prototype pollution prevention). */
export const POISONED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);
