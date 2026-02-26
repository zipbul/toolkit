import type { BinaryRouterLayout, SerializedPattern } from '../schema';
import type { Node } from './node';
import type { MethodEntry } from './types';

import { assertDefined } from './assert';

import {
  NodeKind,
  NODE_MASK_KIND,
  NODE_MASK_METHOD_COUNT,
  NODE_MASK_PARAM_COUNT,
  NODE_MASK_WILDCARD_ORIGIN,
  NODE_OFFSET_MATCH_FUNC,
  NODE_OFFSET_META,
  NODE_OFFSET_METHODS_PTR,
  NODE_OFFSET_METHOD_MASK,
  NODE_OFFSET_PARAM_CHILD_PTR,
  NODE_OFFSET_STATIC_CHILD_COUNT,
  NODE_OFFSET_STATIC_CHILD_PTR,
  NODE_OFFSET_WILDCARD_CHILD_PTR,
  NODE_SHIFT_METHOD_COUNT,
  NODE_SHIFT_PARAM_COUNT,
  NODE_SHIFT_WILDCARD_ORIGIN,
  NODE_STRIDE,
  METHOD_OFFSET,
  PARAM_ENTRY_STRIDE,
} from '../schema';

interface BufferSizes {
  staticChildEntries: number;
  paramChildEntries: number;
  paramEntries: number;
  methodEntries: number;
}

interface FlattenContext {
  nodes: Node[];
  nodeToIndex: Map<Node, number>;
  nodeBuffer: Uint32Array;
  staticChildrenBuffer: Uint32Array;
  staticChildrenPtr: number;
  paramChildrenBuffer: Uint32Array;
  paramChildrenPtr: number;
  paramsBuffer: Uint32Array;
  paramsPtr: number;
  methodsBuffer: Uint32Array;
  methodsPtr: number;
  stringMap: Map<string, number>;
  stringList: string[];
  patternMap: Map<string, number>;
  patterns: SerializedPattern[];
}

/** Node trie → BinaryRouterLayout 변환. */
export function flatten(root: Node, methodCodes?: ReadonlyMap<string, number>): BinaryRouterLayout {
  const { nodes, nodeToIndex } = collectNodes(root);
  const sizes = calculateBufferSizes(nodes);
  // methodsBuffer[0] = 0 (sentinel) — Uint32Array 기본값으로 초기화됨
  const methodsBuffer = new Uint32Array(sizes.methodEntries);

  const ctx: FlattenContext = {
    nodes,
    nodeToIndex,
    nodeBuffer: new Uint32Array(nodes.length * NODE_STRIDE),
    staticChildrenBuffer: new Uint32Array(sizes.staticChildEntries),
    staticChildrenPtr: 0,
    paramChildrenBuffer: new Uint32Array(sizes.paramChildEntries),
    paramChildrenPtr: 0,
    paramsBuffer: new Uint32Array(sizes.paramEntries),
    paramsPtr: 0,
    methodsBuffer,
    methodsPtr: 1, // index 0은 sentinel (이미 0)
    stringMap: new Map(),
    stringList: [],
    patternMap: new Map(),
    patterns: [],
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (node) {
      flattenNode(node, i, ctx, methodCodes);
    }
  }

  const { stringTable, stringOffsets } = buildStringTable(ctx.stringList);

  return {
    nodeBuffer: ctx.nodeBuffer,
    staticChildrenBuffer: ctx.staticChildrenBuffer,
    paramChildrenBuffer: ctx.paramChildrenBuffer,
    paramsBuffer: ctx.paramsBuffer,
    methodsBuffer: ctx.methodsBuffer,
    stringTable,
    stringOffsets,
    decodedStrings: ctx.stringList,
    patterns: ctx.patterns,
    rootIndex: 0,
  };
}

/** BFS로 노드 순서 결정 + nodeToIndex 맵 생성 (4-6: shift() → head 포인터 O(1)). */
function collectNodes(root: Node): { nodes: Node[]; nodeToIndex: Map<Node, number> } {
  const nodes: Node[] = [];
  const nodeToIndex = new Map<Node, number>();
  const queue: Node[] = [root];
  let head = 0;

  while (head < queue.length) {
    const node = queue[head++];

    if (!node || nodeToIndex.has(node)) {
      continue;
    }

    nodeToIndex.set(node, nodes.length);
    nodes.push(node);

    for (const [, child] of node.staticChildren) {
      queue.push(child);
    }

    for (const child of node.paramChildren) {
      queue.push(child);
    }

    if (node.wildcardChild) {
      queue.push(node.wildcardChild);
    }
  }

  return { nodes, nodeToIndex };
}

/**
 * 각 버퍼의 총 엔트리 수 사전 계산 — TypedArray 단일 할당 (4-3).
 * nodes 배열을 한 번 순회해 staticChildren/paramChildren/params/methods 크기 산출.
 */
function calculateBufferSizes(nodes: Node[]): BufferSizes {
  let staticChildEntries = 0;
  let paramChildEntries = 0;
  let paramEntries = 0;
  let methodEntries = 1; // index 0은 sentinel

  for (const node of nodes) {
    staticChildEntries += node.staticChildren.size * 2; // (stringId, nodeIdx) 쌍
    paramChildEntries += node.paramChildren.length;

    if (node.kind === NodeKind.Param) {
      paramEntries += PARAM_ENTRY_STRIDE; // (nameId, patternId)
    }

    methodEntries += node.methods.byMethod.size * 2; // (code, key) 쌍
  }

  return { staticChildEntries, paramChildEntries, paramEntries, methodEntries };
}

/** 단일 노드를 바이너리 레이아웃으로 변환. */
function flattenNode(
  node: Node, index: number, ctx: FlattenContext,
  methodCodes?: ReadonlyMap<string, number>,
): void {
  const base = index * NODE_STRIDE;
  const kindCode = node.kind === NodeKind.Static ? 0 : node.kind === NodeKind.Param ? 1 : 2;
  let wildcardOriginCode = 0;

  if (node.wildcardOrigin === 'multi') {
    wildcardOriginCode = 1;
  } else if (node.wildcardOrigin === 'zero') {
    wildcardOriginCode = 2;
  }

  const paramCount = node.paramChildren.length;
  const methodCount = node.methods.byMethod.size;
  let meta = kindCode & NODE_MASK_KIND;

  meta |= (wildcardOriginCode << NODE_SHIFT_WILDCARD_ORIGIN) & NODE_MASK_WILDCARD_ORIGIN;
  meta |= (paramCount << NODE_SHIFT_PARAM_COUNT) & NODE_MASK_PARAM_COUNT;
  meta |= (methodCount << NODE_SHIFT_METHOD_COUNT) & NODE_MASK_METHOD_COUNT;

  ctx.nodeBuffer[base + NODE_OFFSET_META] = meta;

  flattenMethods(node, base, ctx, methodCodes);
  flattenStaticChildren(node, base, ctx);
  flattenParamChildren(node, base, ctx);
  flattenWildcardChild(node, base, ctx);

  if (node.kind === NodeKind.Param) {
    const paramIdx = ctx.paramsPtr / PARAM_ENTRY_STRIDE;

    ctx.paramsBuffer[ctx.paramsPtr++] = getStringId(node.segment, ctx);

    let patternId = 0xffffffff;

    if (typeof node.patternSource === 'string' && node.patternSource.length > 0) {
      patternId = getPatternId(node.patternSource, node.pattern?.flags ?? '', ctx);
    }

    ctx.paramsBuffer[ctx.paramsPtr++] = patternId;
    ctx.nodeBuffer[base + NODE_OFFSET_MATCH_FUNC] = paramIdx;
  } else {
    ctx.nodeBuffer[base + NODE_OFFSET_MATCH_FUNC] = getStringId(node.segment, ctx);
  }
}

/** 메서드 엔트리들을 methodsList에 기록. */
function flattenMethods(
  node: Node, base: number, ctx: FlattenContext,
  methodCodes?: ReadonlyMap<string, number>,
): void {
  const methodCount = node.methods.byMethod.size;
  let methodMask = 0;

  if (methodCount > 0) {
    const sortedEntries: MethodEntry[] = [];

    for (const [method, key] of node.methods.byMethod.entries()) {
      const mCodeNum = methodCodes?.get(method as string) ?? METHOD_OFFSET[method];

      if (mCodeNum !== undefined) {
        if (mCodeNum < 31) {
          methodMask |= 1 << mCodeNum;
        }

        sortedEntries.push({ code: mCodeNum, key });
      }
    }

    sortedEntries.sort((a, b) => a.code - b.code);

    ctx.nodeBuffer[base + NODE_OFFSET_METHODS_PTR] = ctx.methodsPtr;

    for (const entry of sortedEntries) {
      ctx.methodsBuffer[ctx.methodsPtr++] = entry.code;
      ctx.methodsBuffer[ctx.methodsPtr++] = entry.key;
    }
  } else {
    ctx.nodeBuffer[base + NODE_OFFSET_METHODS_PTR] = 0;
  }

  ctx.nodeBuffer[base + NODE_OFFSET_METHOD_MASK] = methodMask;
}

/** 정적 자식 노드들을 staticChildrenList에 기록. */
function flattenStaticChildren(node: Node, base: number, ctx: FlattenContext): void {
  if (node.staticChildren.size > 0) {
    ctx.nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_PTR] = ctx.staticChildrenPtr;
    ctx.nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_COUNT] = node.staticChildren.size;

    const staticEntries = Array.from(node.staticChildren.entries());

    staticEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    for (const [seg, child] of staticEntries) {
      ctx.staticChildrenBuffer[ctx.staticChildrenPtr++] = getStringId(seg, ctx);

      const childIndex = ctx.nodeToIndex.get(child);

      assertDefined(childIndex, `Static child node not found in nodeToIndex for segment '${seg}'`);
      ctx.staticChildrenBuffer[ctx.staticChildrenPtr++] = childIndex;
    }
  } else {
    ctx.nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_PTR] = 0;
    ctx.nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_COUNT] = 0;
  }
}

/** 파라미터 자식 노드들을 paramChildrenList에 기록. */
function flattenParamChildren(node: Node, base: number, ctx: FlattenContext): void {
  if (node.paramChildren.length > 0) {
    ctx.nodeBuffer[base + NODE_OFFSET_PARAM_CHILD_PTR] = ctx.paramChildrenPtr;

    for (const child of node.paramChildren) {
      const childIndex = ctx.nodeToIndex.get(child);

      assertDefined(childIndex, `Param child node not found in nodeToIndex for segment '${child.segment}'`);
      ctx.paramChildrenBuffer[ctx.paramChildrenPtr++] = childIndex;
    }
  } else {
    ctx.nodeBuffer[base + NODE_OFFSET_PARAM_CHILD_PTR] = 0;
  }
}

/** 와일드카드 자식 노드를 nodeBuffer에 기록. */
function flattenWildcardChild(node: Node, base: number, ctx: FlattenContext): void {
  if (node.wildcardChild !== undefined) {
    const childIndex = ctx.nodeToIndex.get(node.wildcardChild);

    assertDefined(childIndex, `Wildcard child node not found in nodeToIndex for segment '${node.wildcardChild.segment}'`);
    ctx.nodeBuffer[base + NODE_OFFSET_WILDCARD_CHILD_PTR] = childIndex;
  } else {
    ctx.nodeBuffer[base + NODE_OFFSET_WILDCARD_CHILD_PTR] = 0;
  }
}

/**
 * 문자열 테이블 직렬화 (stringList → Uint8Array + offsets).
 * Bun.ArrayBufferSink로 네이티브 UTF-8 인코딩 (B-2).
 * stringOffsets 사전 할당으로 중간 number[] 제거 (M-5).
 */
function buildStringTable(stringList: string[]): {
  stringTable: Uint8Array;
  stringOffsets: Uint32Array;
} {
  const count = stringList.length;
  const stringOffsets = new Uint32Array(count + 1);

  const sink = new Bun.ArrayBufferSink();

  sink.start({ asUint8Array: true });

  let currentOffset = 0;

  for (let i = 0; i < count; i++) {
    stringOffsets[i] = currentOffset;

    const written = sink.write(stringList[i]!);

    currentOffset += written;
  }

  stringOffsets[count] = currentOffset;

  const stringTable = sink.end() as Uint8Array;

  return { stringTable, stringOffsets };
}

function getStringId(str: string, ctx: FlattenContext): number {
  let id = ctx.stringMap.get(str);

  if (id === undefined) {
    id = ctx.stringList.length;

    ctx.stringList.push(str);
    ctx.stringMap.set(str, id);
  }

  return id;
}

function getPatternId(source: string, flags: string, ctx: FlattenContext): number {
  const key = `${flags}|${source}`;
  let id = ctx.patternMap.get(key);

  if (id === undefined) {
    id = ctx.patterns.length;

    ctx.patterns.push({ source, flags });
    ctx.patternMap.set(key, id);
  }

  return id;
}
