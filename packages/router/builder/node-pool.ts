import type { NodeKind } from '../schema';

import { Node } from './node';

const NODE_POOL_STACK: Node[] = [];

export function acquireNode(kind: NodeKind, segment: string): Node {
  const node = NODE_POOL_STACK.pop();

  if (node) {
    node.resetState(kind, segment);

    return node;
  }

  return new Node(kind, segment);
}

export function releaseNode(node: Node): void {
  NODE_POOL_STACK.push(node);
}
