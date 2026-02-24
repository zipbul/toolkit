import type { RouteMethods } from './types';

import { NodeKind } from '../schema';
import { StaticChildMap } from './static-child-map';

export class Node {
  kind: NodeKind;
  segment: string;

  staticChildren: StaticChildMap = new StaticChildMap();
  paramChildren: Node[] = [];
  wildcardChild: Node | undefined;
  methods: RouteMethods = { byMethod: new Map() };

  pattern: RegExp | undefined;
  patternSource: string | undefined;
  patternTester: ((value: string) => boolean) | undefined;
  segmentParts: string[] | undefined;
  wildcardOrigin: 'star' | 'multi' | 'zero' | undefined;
  paramSortScore: number | undefined;

  constructor(kind: NodeKind, segment: string) {
    this.kind = kind;
    this.segment = segment;
  }

  resetState(kind: NodeKind, segment: string): void {
    this.kind = kind;
    this.segment = segment;
    this.staticChildren = new StaticChildMap();

    if (this.paramChildren.length) {
      this.paramChildren.length = 0;
    }

    this.wildcardChild = undefined;

    this.methods.byMethod.clear();

    this.pattern = undefined;
    this.patternSource = undefined;
    this.patternTester = undefined;
    this.segmentParts = undefined;
    this.wildcardOrigin = undefined;
    this.paramSortScore = undefined;
  }
}
