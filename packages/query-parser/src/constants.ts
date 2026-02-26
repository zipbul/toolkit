import type { ResolvedQueryParserOptions } from './types';

export const DEFAULT_QUERY_PARSER_OPTIONS: ResolvedQueryParserOptions = {
  depth: 5,
  parameterLimit: 1000,
  parseArrays: false,
  arrayLimit: 20,
  hppMode: 'first',
  strictMode: false,
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
