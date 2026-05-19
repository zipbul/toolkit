import type { SegmentNode } from '../../tree';
import type { DecoderFn, MatchFn, MatchState } from '../../types';

import { TESTER_PASS, WildcardOrigin } from '../../tree';

export function createIterativeWalker(root: SegmentNode, decoder: DecoderFn): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    let node = root;
    let pos = 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const newPos = consumeStaticPrefix(node.staticPrefix, url, pos, len);
        if (newPos < 0) {
          return false;
        }
        pos = newPos;
        if (pos >= len) {
          break;
        }
      }

      let end = pos;
      while (end < len && url.charCodeAt(end) !== 47) {
        end++;
      }
      const segLen = end - pos;

      const sck = node.singleChildKey;
      if (sck !== null && node.singleChildNext !== null && sck.length === segLen && url.startsWith(sck, pos)) {
        node = node.singleChildNext;
        pos = end === len ? len : end + 1;
        continue;
      }
      if (node.staticChildren !== null) {
        const seg = url.substring(pos, end);
        const child = node.staticChildren[seg];
        if (child !== undefined) {
          node = child;
          pos = end === len ? len : end + 1;
          continue;
        }
      }

      if (node.paramChild !== null && segLen > 0) {
        if (node.paramChild.tester !== null) {
          const decoded = decoder(url.substring(pos, end));
          if (node.paramChild.tester(decoded) !== TESTER_PASS) {
            return false;
          }
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = end;
        state.paramCount++;
        node = node.paramChild.next;
        pos = end === len ? len : end + 1;
        continue;
      }

      if (node.wildcardStore !== null) {
        if (node.wildcardOrigin === WildcardOrigin.Multi && pos >= len) {
          return false;
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = len;
        state.paramCount++;
        state.handlerIndex = node.wildcardStore;
        return true;
      }

      return false;
    }

    return matchTerminalAtNode(node, len, state);
  };
}

export function consumeStaticPrefix(sp: ReadonlyArray<string>, url: string, pos: number, len: number): number {
  for (let i = 0; i < sp.length; i++) {
    const seg = sp[i]!;
    const segLen = seg.length;
    const after = pos + segLen;
    if (after > len) {
      return -1;
    }
    if (!url.startsWith(seg, pos)) {
      return -1;
    }
    if (after < len && url.charCodeAt(after) !== 47) {
      return -1;
    }
    pos = after === len ? len : after + 1;
  }
  return pos;
}

export function matchTerminalAtNode(node: SegmentNode, len: number, state: MatchState): boolean {
  if (node.store !== null) {
    state.handlerIndex = node.store;
    return true;
  }
  if (node.wildcardStore !== null && node.wildcardOrigin === WildcardOrigin.Star) {
    const pc = state.paramCount * 2;
    state.paramOffsets[pc] = len;
    state.paramOffsets[pc + 1] = len;
    state.paramCount++;
    state.handlerIndex = node.wildcardStore;
    return true;
  }
  return false;
}
