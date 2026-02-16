export type QueryValue = string | QueryArray | QueryValueRecord;

export interface QueryArray extends Array<QueryValue> {}

export interface QueryValueRecord {
  [key: string]: QueryValue;
}

export type QueryContainer = QueryValueRecord | QueryArray;

export type QueryArrayRecord = QueryArray & QueryValueRecord;
