import type { NodeKind } from '../schema';

import { Node } from './node';

export class NodeFactory {
  acquire(kind: NodeKind, segment: string): Node {
    return new Node(kind, segment);
  }
}
