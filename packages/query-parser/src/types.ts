import type { QueryParserOptions } from './interfaces';

export type QueryValue = string | QueryArray | QueryValueRecord;

export interface QueryArray extends Array<QueryValue> {}

export interface QueryValueRecord {
  [key: string]: QueryValue;
}

export type QueryContainer = QueryValueRecord | QueryArray;

/**
 * Fully resolved query-parser options with all defaults applied.
 */
export type ResolvedQueryParserOptions = Required<QueryParserOptions>;
