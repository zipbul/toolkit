import type { SegmentNode } from '../../tree';
import type { DecoderFn, MatchFn, MatchState } from '../../types';

import { TESTER_PASS } from '../../tree';

export function createFactoredWalker(decoder: DecoderFn, keyToTerminal: Map<string, number>, sharedNext: SegmentNode): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) {
      slash1++;
    }
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const looked = keyToTerminal.get(firstSeg);
    if (looked === undefined) {
      return false;
    }

    return walkSharedSubtree(sharedNext, url, slash1 === len ? len : slash1 + 1, len, looked, decoder, state);
  };
}

export function walkSharedSubtree(
  sharedNext: SegmentNode,
  url: string,
  initialPos: number,
  len: number,
  storeOverride: number,
  decoder: DecoderFn,
  state: MatchState,
): boolean {
  let node = sharedNext;
  let pos = initialPos;

  while (pos < len) {
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

    return false;
  }

  if (node.store !== null) {
    state.handlerIndex = storeOverride;
    return true;
  }
  return false;
}
