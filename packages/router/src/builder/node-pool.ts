import type { NodeKind } from '../schema';

import { Node } from './node';

export class NodePool {
  private readonly stack: Node[] = [];

  acquire(kind: NodeKind, segment: string): Node {
    const node = this.stack.pop();

    if (node) {
      node.resetState(kind, segment);

      return node;
    }

    return new Node(kind, segment);
  }

  release(node: Node): void {
    this.stack.push(node);
  }
}
