import type { Node } from './node';

import { NodeKind } from '../schema';
import { acquireNode } from './node-pool';
import { StaticChildMap } from './static-child-map';

export function matchStaticParts(parts: readonly string[], segments: readonly string[], startIdx: number): number {
  let matched = 0;
  const limit = Math.min(parts.length, segments.length - startIdx);

  while (matched < limit && segments[startIdx + matched] === parts[matched]) {
    matched++;
  }

  return matched;
}

export function splitStaticChain(node: Node, splitIndex: number): void {
  const parts = node.segmentParts;

  if (parts === undefined || splitIndex <= 0 || splitIndex >= parts.length) {
    return;
  }

  const prefixParts = parts.slice(0, splitIndex);
  const suffixParts = parts.slice(splitIndex);
  const firstSuffix = suffixParts[0];

  if (firstSuffix === undefined || firstSuffix.length === 0) {
    return;
  }

  const suffixNode = acquireNode(NodeKind.Static, suffixParts.length > 1 ? suffixParts.join('/') : firstSuffix);

  if (suffixParts.length > 1) {
    suffixNode.segmentParts = [...suffixParts];
  }

  suffixNode.staticChildren = node.staticChildren;
  suffixNode.paramChildren = node.paramChildren;
  suffixNode.wildcardChild = node.wildcardChild;
  suffixNode.methods = node.methods;
  node.staticChildren = StaticChildMap.fromEntries([[firstSuffix, suffixNode]]);
  node.paramChildren = [];
  node.wildcardChild = undefined;
  node.methods = { byMethod: new Map() };

  const firstPrefix = prefixParts[0];

  if (firstPrefix === undefined || firstPrefix.length === 0) {
    return;
  }

  node.segment = prefixParts.length > 1 ? prefixParts.join('/') : firstPrefix;
  node.segmentParts = prefixParts.length > 1 ? prefixParts : undefined;
}

export function sortParamChildren(node: Node): void {
  if (node.paramChildren.length < 2) {
    return;
  }

  node.paramChildren.sort((a, b) => {
    const weight = (child: Node) => (child.pattern ? 0 : 1);

    const diff = weight(a) - weight(b);

    if (diff !== 0) {
      return diff;
    }

    if (a.pattern && b.pattern) {
      const aLen = a.patternSource?.length ?? 0;
      const bLen = b.patternSource?.length ?? 0;

      if (aLen !== bLen) {
        return bLen - aLen;
      }
    }

    return a.segment.localeCompare(b.segment);
  });
}
