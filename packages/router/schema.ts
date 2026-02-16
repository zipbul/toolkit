export const METHOD_OFFSET = {
  GET: 0,
  POST: 1,
  PUT: 2,
  PATCH: 3,
  DELETE: 4,
  OPTIONS: 5,
  HEAD: 6,
} as const;

export type InternalMethodId = (typeof METHOD_OFFSET)[keyof typeof METHOD_OFFSET];

export enum NodeKind {
  Static = 'static',
  Param = 'param',
  Wildcard = 'wildcard',
}

export const NODE_STRIDE = 8;

export const NODE_OFFSET_META = 0;

export const NODE_OFFSET_METHOD_MASK = 1;
export const NODE_OFFSET_MATCH_FUNC = 2;
export const NODE_OFFSET_STATIC_CHILD_PTR = 3;
export const NODE_OFFSET_STATIC_CHILD_COUNT = 4;
export const NODE_OFFSET_PARAM_CHILD_PTR = 5;
export const NODE_OFFSET_WILDCARD_CHILD_PTR = 6;
export const NODE_OFFSET_METHODS_PTR = 7;

export const PARAM_ENTRY_STRIDE = 2;
export const PARAM_OFFSET_NAME = 0;
export const PARAM_OFFSET_PATTERN = 1;

export const NODE_MASK_KIND = 0xff;
export const NODE_MASK_WILDCARD_ORIGIN = 0xff00;
export const NODE_SHIFT_WILDCARD_ORIGIN = 8;
export const NODE_MASK_PARAM_COUNT = 0xff0000;
export const NODE_SHIFT_PARAM_COUNT = 16;
export const NODE_MASK_METHOD_COUNT = 0xff000000;
export const NODE_SHIFT_METHOD_COUNT = 24;

export interface SerializedPattern {
  source: string;
  flags: string;
}

export interface BinaryRouterLayout {
  readonly nodeBuffer: Uint32Array;

  readonly staticChildrenBuffer: Uint32Array;

  readonly paramChildrenBuffer: Uint32Array;

  readonly paramsBuffer: Uint32Array;

  readonly methodsBuffer: Uint32Array;

  readonly stringTable: Uint8Array;

  readonly stringOffsets: Uint32Array;

  readonly patterns: ReadonlyArray<SerializedPattern>;

  readonly rootIndex: number;
}
