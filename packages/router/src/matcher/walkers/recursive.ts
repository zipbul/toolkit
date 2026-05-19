import type { ParamSegment, SegmentNode } from '../../tree';
import type { DecoderFn, MatchFn, MatchState } from '../../types';

import { TESTER_PASS, WildcardOrigin } from '../../tree';

function createRecursiveWalker(root: SegmentNode, decoder: DecoderFn): MatchFn {
  function tryMatchParam(
    param: ParamSegment,
    path: string,
    start: number,
    end: number,
    state: MatchState,
    decoder: DecoderFn,
  ): boolean {
    if (param.tester !== null) {
      const val = decoder(path.substring(start, end));
      if (param.tester(val) !== TESTER_PASS) {
        return false;
      }
    }

    const mark = state.paramCount;
    const pc = mark * 2;
    state.paramOffsets[pc] = start;
    state.paramOffsets[pc + 1] = end;
    state.paramCount++;

    if (match(param.next, path, end === path.length ? end : end + 1, state, decoder)) {
      return true;
    }

    state.paramCount = mark;
    return false;
  }

  function match(node: SegmentNode, path: string, pos: number, state: MatchState, decoder: DecoderFn): boolean {
    const len = path.length;

    if (node.staticPrefix !== null) {
      const newPos = consumeStaticPrefixRec(node.staticPrefix, path, pos, len);
      if (newPos < 0) {
        return false;
      }
      pos = newPos;
    }

    if (pos >= len) {
      return matchTerminalAtNode(node, len, state);
    }

    let end = pos;
    while (end < len && path.charCodeAt(end) !== 47) {
      end++;
    }
    const segLen = end - pos;

    if (tryStaticDescent(node, path, pos, end, segLen, len, state, decoder)) {
      return true;
    }

    const head = node.paramChild;
    if (head !== null && segLen > 0) {
      if (tryMatchParam(head, path, pos, end, state, decoder)) {
        return true;
      }
      let p: ParamSegment | null = head.nextSibling;
      while (p !== null) {
        if (tryMatchParam(p, path, pos, end, state, decoder)) {
          return true;
        }
        p = p.nextSibling;
      }
    }

    return tryWildcardCapture(node, pos, len, state);
  }

  function tryStaticDescent(
    node: SegmentNode,
    path: string,
    pos: number,
    end: number,
    segLen: number,
    len: number,
    state: MatchState,
    decoder: DecoderFn,
  ): boolean {
    const sck = node.singleChildKey;
    if (sck !== null && node.singleChildNext !== null && sck.length === segLen && path.startsWith(sck, pos)) {
      return match(node.singleChildNext, path, end === len ? len : end + 1, state, decoder);
    }
    if (node.staticChildren !== null) {
      const seg = path.substring(pos, end);
      const child = node.staticChildren[seg];
      if (child !== undefined) {
        return match(child, path, end === len ? len : end + 1, state, decoder);
      }
    }
    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    return match(root, url, 1, state, decoder);
  };
}

function matchTerminalAtNode(node: SegmentNode, len: number, state: MatchState): boolean {
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

export function consumeStaticPrefixRec(sp: ReadonlyArray<string>, path: string, pos: number, len: number): number {
  for (let i = 0; i < sp.length; i++) {
    const seg = sp[i]!;
    const segLen = seg.length;
    const after = pos + segLen;
    if (after > len) {
      return -1;
    }
    if (!path.startsWith(seg, pos)) {
      return -1;
    }
    if (after < len && path.charCodeAt(after) !== 47) {
      return -1;
    }
    pos = after === len ? len : after + 1;
  }
  return pos;
}

export function tryWildcardCapture(node: SegmentNode, pos: number, len: number, state: MatchState): boolean {
  if (node.wildcardStore === null) {
    return false;
  }
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

export { createRecursiveWalker };
