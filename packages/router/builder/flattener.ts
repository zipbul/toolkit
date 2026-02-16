import type { BinaryRouterLayout, SerializedPattern } from '../schema';
import type { Node } from './node';
import type { MethodEntry } from './types';

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

export class Flattener {
  static flatten(root: Node): BinaryRouterLayout {
    const nodes: Node[] = [];
    const nodeToIndex = new Map<Node, number>();
    const queue: Node[] = [root];

    while (queue.length) {
      const node = queue.shift();

      if (!node) {
        continue;
      }

      if (nodeToIndex.has(node)) {
        continue;
      }

      nodeToIndex.set(node, nodes.length);
      nodes.push(node);

      const staticEntries = Array.from(node.staticChildren.entries());

      staticEntries.sort((a, b) => (a[0] < b[0] ? -1 : 1));

      for (const [, child] of staticEntries) {
        queue.push(child);
      }

      for (const child of node.paramChildren) {
        queue.push(child);
      }

      if (node.wildcardChild) {
        queue.push(node.wildcardChild);
      }
    }

    const nodeBuffer = new Uint32Array(nodes.length * NODE_STRIDE);
    const staticChildrenList: number[] = [];
    const paramChildrenList: number[] = [];
    const paramsList: number[] = [];
    const methodsList: number[] = [0];
    const stringList: string[] = [];
    const stringMap = new Map<string, number>();
    const patterns: SerializedPattern[] = [];
    const patternMap = new Map<string, number>();

    const getStringId = (str: string): number => {
      let id = stringMap.get(str);

      if (id === undefined) {
        id = stringList.length;

        stringList.push(str);
        stringMap.set(str, id);
      }

      return id;
    };

    const getPatternId = (source: string, flags: string): number => {
      const key = `${flags}|${source}`;
      let id = patternMap.get(key);

      if (id === undefined) {
        id = patterns.length;

        patterns.push({ source, flags });
        patternMap.set(key, id);
      }

      return id;
    };

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (!node) {
        continue;
      }

      const base = i * NODE_STRIDE;
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

      nodeBuffer[base + NODE_OFFSET_META] = meta;

      let methodMask = 0;

      if (methodCount > 0) {
        const sortedEntries: MethodEntry[] = [];

        for (const [method, key] of node.methods.byMethod.entries()) {
          const mCodeNum = METHOD_OFFSET[method];

          if (mCodeNum !== undefined) {
            if (mCodeNum < 31) {
              methodMask |= 1 << mCodeNum;
            }

            sortedEntries.push({ code: mCodeNum, key });
          }
        }

        sortedEntries.sort((a, b) => a.code - b.code);

        nodeBuffer[base + NODE_OFFSET_METHODS_PTR] = methodsList.length;

        for (const entry of sortedEntries) {
          methodsList.push(entry.code);
          methodsList.push(entry.key);
        }
      } else {
        nodeBuffer[base + NODE_OFFSET_METHODS_PTR] = 0;
      }

      nodeBuffer[base + NODE_OFFSET_METHOD_MASK] = methodMask;

      if (node.staticChildren.size > 0) {
        nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_PTR] = staticChildrenList.length;
        nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_COUNT] = node.staticChildren.size;

        const staticEntries = Array.from(node.staticChildren.entries());

        staticEntries.sort((a, b) => (a[0] < b[0] ? -1 : 1));

        for (const [seg, child] of staticEntries) {
          staticChildrenList.push(getStringId(seg));

          const childIndex = nodeToIndex.get(child);

          if (childIndex !== undefined) {
            staticChildrenList.push(childIndex);
          }
        }
      } else {
        nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_PTR] = 0;
        nodeBuffer[base + NODE_OFFSET_STATIC_CHILD_COUNT] = 0;
      }

      if (node.paramChildren.length > 0) {
        nodeBuffer[base + NODE_OFFSET_PARAM_CHILD_PTR] = paramChildrenList.length;

        for (const child of node.paramChildren) {
          const childIndex = nodeToIndex.get(child);

          if (childIndex !== undefined) {
            paramChildrenList.push(childIndex);
          }
        }
      } else {
        nodeBuffer[base + NODE_OFFSET_PARAM_CHILD_PTR] = 0;
      }

      if (node.wildcardChild !== undefined) {
        const childIndex = nodeToIndex.get(node.wildcardChild);

        nodeBuffer[base + NODE_OFFSET_WILDCARD_CHILD_PTR] = childIndex ?? 0;
      } else {
        nodeBuffer[base + NODE_OFFSET_WILDCARD_CHILD_PTR] = 0;
      }

      if (node.kind === NodeKind.Param) {
        const paramIdx = paramsList.length / PARAM_ENTRY_STRIDE;

        paramsList.push(getStringId(node.segment));

        let patternId = 0xffffffff;

        if (typeof node.patternSource === 'string' && node.patternSource.length > 0) {
          patternId = getPatternId(node.patternSource, node.pattern?.flags ?? '');
        }

        paramsList.push(patternId);

        nodeBuffer[base + NODE_OFFSET_MATCH_FUNC] = paramIdx;
      } else {
        nodeBuffer[base + NODE_OFFSET_MATCH_FUNC] = getStringId(node.segment);
      }
    }

    const encoder = new TextEncoder();
    const offsets: number[] = [];
    const encodedChunks: Uint8Array[] = [];
    let currentOffset = 0;

    for (const str of stringList) {
      offsets.push(currentOffset);

      const encoded = encoder.encode(str);

      encodedChunks.push(encoded);

      currentOffset += encoded.length;
    }

    offsets.push(currentOffset);

    const stringTable = new Uint8Array(currentOffset);
    let ptr = 0;

    for (const chunk of encodedChunks) {
      stringTable.set(chunk, ptr);

      ptr += chunk.length;
    }

    return {
      nodeBuffer,
      staticChildrenBuffer: Uint32Array.from(staticChildrenList),
      paramChildrenBuffer: Uint32Array.from(paramChildrenList),
      paramsBuffer: Uint32Array.from(paramsList),
      methodsBuffer: Uint32Array.from(methodsList),
      stringTable,
      stringOffsets: Uint32Array.from(offsets),
      patterns,
      rootIndex: 0,
    };
  }
}
