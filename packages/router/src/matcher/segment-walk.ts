import type { MatchState } from './match-state';
import type { DecoderFn } from '../processor/decoder';
import type { RadixMatchFn } from './radix-matcher';
import type { SegmentNode, ParamSegment } from './segment-tree';

import { TESTER_PASS, TESTER_TIMEOUT } from './pattern-tester';

/**
 * Walker for the purpose-built segment tree. Matches rou3/memoirist in spirit:
 * one `path.split('/')` at entry, then O(depth) descent via `Map.get(segment)`
 * per level.
 *
 * Segment *positions* are also precomputed once so wildcards can
 * `url.substring(...)` (cheap) instead of `segs.slice(idx).join('/')` (N allocs).
 */
export function createSegmentWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  decodeParams: boolean,
): RadixMatchFn {
  const decode: (raw: string) => string = decodeParams
    ? raw => (raw.indexOf('%') !== -1 ? decoder(raw) : raw)
    : raw => raw;

  function matchNode(
    node: SegmentNode,
    url: string,
    segs: string[],
    idx: number,
    state: MatchState,
  ): boolean {
    if (idx === segs.length) {
      if (node.store !== null) {
        state.handlerIndex = node.store;

        return true;
      }

      if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
        state.paramNames[state.paramCount] = node.wildcardName!;
        state.paramValues[state.paramCount] = '';
        state.paramCount++;
        state.handlerIndex = node.wildcardStore;

        return true;
      }

      return false;
    }

    const seg = segs[idx]!;

    if (node.staticChildren !== null) {
      const child = node.staticChildren.get(seg);

      if (child !== undefined) {
        if (matchNode(child, url, segs, idx + 1, state)) return true;
        if (state.errorKind) return false;
      }
    }

    if (node.paramChild !== null) {
      if (matchParam(node.paramChild, url, segs, idx, state)) return true;
      if (state.errorKind) return false;
    }

    if (node.wildcardStore !== null) {
      // Compute suffix start from segs lengths (avoids parallel segStarts array).
      let startPos = 0;

      for (let i = 0; i < idx; i++) startPos += segs[i]!.length + 1;

      const remaining = url.substring(startPos);

      if (node.wildcardOrigin === 'multi' && remaining.length === 0) return false;

      state.paramNames[state.paramCount] = node.wildcardName!;
      state.paramValues[state.paramCount] = remaining;
      state.paramCount++;
      state.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  }

  function matchParam(
    param: ParamSegment,
    url: string,
    segs: string[],
    idx: number,
    state: MatchState,
  ): boolean {
    const seg = segs[idx]!;

    if (seg.length === 0) return false;

    const decoded = decode(seg);

    if (param.tester !== null) {
      const r = param.tester(decoded);

      if (r === TESTER_TIMEOUT) {
        state.errorKind = 'regex-timeout';
        state.errorMessage = 'Route parameter regex exceeded time limit';

        return false;
      }

      if (r !== TESTER_PASS) return false;
    }

    const savedPC = state.paramCount;

    state.paramNames[savedPC] = param.name;
    state.paramValues[savedPC] = decoded;
    state.paramCount = savedPC + 1;

    if (matchNode(param.next, url, segs, idx + 1, state)) return true;

    state.paramCount = savedPC;

    return false;
  }

  return function walk(url: string, startIndex: number, state: MatchState): boolean {
    const path = startIndex === 0 ? url : url.substring(startIndex);

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        state.handlerIndex = root.store;

        return true;
      }

      return false;
    }

    const segs = path.split('/');

    return matchNode(root, path, segs, 1, state);
  };
}
