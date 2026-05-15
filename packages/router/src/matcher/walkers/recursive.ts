import type { MatchFn, MatchState } from '../match-state';
import type { DecoderFn } from '../decoder';
import type { ParamSegment, SegmentNode } from '../../tree/segment-tree';

import { TESTER_PASS } from '../../tree/pattern-tester';

/**
 * Recursive backtracking walker. Used when `hasAmbiguousNode(root)` is
 * true — a node that holds both static children and a param/wildcard
 * sibling. The iterative walker can't backtrack across that ambiguity,
 * so we drop to a depth-first match() with rollback on `state.paramCount`.
 *
 * tryMatchParam captures the cursor in `mark` before descending and
 * restores it on miss so that a sibling param attempt sees a clean
 * paramOffsets state.
 */
export function createRecursiveWalker(root: SegmentNode, decoder: DecoderFn): MatchFn {
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
      if (param.tester(val) !== TESTER_PASS) return false;
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

  function match(
    node: SegmentNode,
    path: string,
    pos: number,
    state: MatchState,
    decoder: DecoderFn,
  ): boolean {
    const len = path.length;

    if (node.staticPrefix !== null) {
      const sp = node.staticPrefix;
      for (let i = 0; i < sp.length; i++) {
        const seg = sp[i]!;
        const segLen = seg.length;
        const after = pos + segLen;
        if (after > len) return false;
        if (!path.startsWith(seg, pos)) return false;
        if (after < len && path.charCodeAt(after) !== 47) return false;
        pos = after === len ? len : after + 1;
      }
    }

    if (pos >= len) {
      if (node.store !== null) {
        state.handlerIndex = node.store;
        return true;
      }
      if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = len;
        state.paramOffsets[pc + 1] = len;
        state.paramCount++;
        state.handlerIndex = node.wildcardStore;
        return true;
      }
      return false;
    }

    let end = pos;
    while (end < len && path.charCodeAt(end) !== 47) end++;
    const segLen = end - pos;

    const sck = node.singleChildKey;
    if (
      sck !== null &&
      node.singleChildNext !== null &&
      sck.length === segLen &&
      path.startsWith(sck, pos)
    ) {
      if (match(node.singleChildNext, path, end === len ? len : end + 1, state, decoder)) return true;
    } else if (node.staticChildren !== null) {
      const seg = path.substring(pos, end);
      const child = node.staticChildren[seg];
      if (child !== undefined) {
        if (match(child, path, end === len ? len : end + 1, state, decoder)) return true;
      }
    }

    const head = node.paramChild;
    if (head !== null && segLen > 0) {
      if (tryMatchParam(head, path, pos, end, state, decoder)) return true;

      let p: ParamSegment | null = head.nextSibling;
      while (p !== null) {
        if (tryMatchParam(p, path, pos, end, state, decoder)) return true;
        p = p.nextSibling;
      }
    }

    if (node.wildcardStore !== null) {
      if (node.wildcardOrigin === 'multi' && pos >= len) return false;
      const pc = state.paramCount * 2;
      state.paramOffsets[pc] = pos;
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = node.wildcardStore;
      return true;
    }

    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    if (url === '/') {
      if (root.store !== null) {
        state.handlerIndex = root.store;
        return true;
      }
      if (root.wildcardStore !== null && root.wildcardOrigin === 'star') {
        state.paramOffsets[0] = 1;
        state.paramOffsets[1] = 1;
        state.paramCount = 1;
        state.handlerIndex = root.wildcardStore;
        return true;
      }
      return false;
    }

    return match(root, url, 1, state, decoder);
  };
}
