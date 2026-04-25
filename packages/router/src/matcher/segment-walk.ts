import type { MatchState } from './match-state';
import type { DecoderFn } from '../processor/decoder';
import type { RadixMatchFn } from './radix-matcher';
import type { SegmentNode } from './segment-tree';

import { TESTER_PASS, TESTER_TIMEOUT } from './pattern-tester';
import { hasAmbiguousNode } from './segment-tree';

/**
 * Memoirist-style walker: writes params directly into the pre-allocated
 * `state.params` object on the SUCCESS return path only. Failed branches
 * contribute zero work to the params object — there is no commit/rollback
 * cycle, no state-array fan-out + buildParamsObject post-pass.
 *
 * Caller (compileMatchFn output) MUST set `state.params` to a fresh
 * Object.create(null) before invoking, then read from it after a true return.
 */
export function createSegmentWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  decodeParams: boolean,
): RadixMatchFn {
  // Trees without alternation between static and param/wildcard at the same
  // level can be matched iteratively — no recursion, no backtracking. This
  // saves a function call per segment for the common case (REST routes
  // typically have unique winners at each tree level).
  if (!hasAmbiguousNode(root)) {
    return createIterativeWalker(root, decoder, decodeParams);
  }

  function match(
    node: SegmentNode,
    path: string,
    segs: string[],
    idx: number,
    state: MatchState,
  ): boolean {
    // Fast-iterate pure static descents — common for long prefix chains like
    // /repos/:owner/:repo/issues/:number where multiple levels are static-only
    // between params. Saves a recursive call per static-only level.
    while (
      idx < segs.length
      && node.paramChild === null
      && node.wildcardStore === null
    ) {
      if (node.staticChildren === null) return false;

      const child = node.staticChildren[segs[idx]!];

      if (child === undefined) return false;

      node = child;
      idx++;
    }

    if (idx === segs.length) {
      if (node.store !== null) {
        state.handlerIndex = node.store;

        return true;
      }

      if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
        state.params![node.wildcardName!] = '';
        state.handlerIndex = node.wildcardStore;

        return true;
      }

      return false;
    }

    const seg = segs[idx]!;

    if (node.staticChildren !== null) {
      const child = node.staticChildren[seg];

      if (child !== undefined) {
        if (match(child, path, segs, idx + 1, state)) return true;
        if (state.errorKind !== null) return false;
      }
    }

    const param = node.paramChild;

    if (param !== null && seg.length > 0) {
      const decoded = decodeParams && seg.indexOf('%') !== -1 ? decoder(seg) : seg;

      let pass = true;

      if (param.tester !== null) {
        const r = param.tester(decoded);

        if (r === TESTER_TIMEOUT) {
          state.errorKind = 'regex-timeout';
          state.errorMessage = 'Route parameter regex exceeded time limit';

          return false;
        }

        pass = r === TESTER_PASS;
      }

      if (pass) {
        if (match(param.next, path, segs, idx + 1, state)) {
          state.params![param.name] = decoded;

          return true;
        }

        if (state.errorKind !== null) return false;
      }
    }

    if (node.wildcardStore !== null) {
      if (node.wildcardOrigin === 'multi') {
        let any = false;

        for (let j = idx; j < segs.length; j++) {
          if (segs[j]!.length > 0) { any = true; break; }
        }

        if (!any) return false;
      }

      let startPos = 0;

      for (let i = 0; i < idx; i++) startPos += segs[i]!.length + 1;

      state.params![node.wildcardName!] = path.substring(startPos);
      state.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    const path = url;

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        state.handlerIndex = root.store;

        return true;
      }

      return false;
    }

    const segs = path.split('/');

    return match(root, path, segs, 1, state);
  };
}

/**
 * Iterative walker for trees without static/param ambiguity. No recursion,
 * no backtracking — every level has a single winner so a `while` loop suffices.
 */
function createIterativeWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  decodeParams: boolean,
): RadixMatchFn {
  return function walk(url: string, state: MatchState): boolean {
    const path = url;

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        state.handlerIndex = root.store;

        return true;
      }

      return false;
    }

    const segs = path.split('/');
    const params = state.params!;
    let node = root;
    let idx = 1;
    // Track byte-position in `path` alongside segment index so wildcard capture
    // can substring(pos) directly without re-summing segment lengths.
    let pos = segs[0]!.length + 1;

    while (idx < segs.length) {
      // Wildcard-only fast path: when the current node has nothing but a
      // wildcard, skip segment dereference entirely and capture the suffix.
      if (
        node.staticChildren === null
        && node.paramChild === null
        && node.wildcardStore !== null
      ) {
        if (node.wildcardOrigin === 'multi' && pos >= path.length) return false;

        params[node.wildcardName!] = path.substring(pos);
        state.handlerIndex = node.wildcardStore;

        return true;
      }

      const seg = segs[idx]!;

      if (node.staticChildren !== null) {
        const child = node.staticChildren[seg];

        if (child !== undefined) {
          node = child;
          pos += seg.length + 1;
          idx++;
          continue;
        }
      }

      if (node.paramChild !== null && seg.length > 0) {
        const decoded = decodeParams && seg.indexOf('%') !== -1 ? decoder(seg) : seg;

        if (node.paramChild.tester !== null) {
          const r = node.paramChild.tester(decoded);

          if (r === TESTER_TIMEOUT) {
            state.errorKind = 'regex-timeout';
            state.errorMessage = 'Route parameter regex exceeded time limit';

            return false;
          }

          if (r !== TESTER_PASS) return false;
        }

        params[node.paramChild.name] = decoded;
        node = node.paramChild.next;
        pos += seg.length + 1;
        idx++;
        continue;
      }

      if (node.wildcardStore !== null) {
        if (node.wildcardOrigin === 'multi' && pos >= path.length) return false;

        params[node.wildcardName!] = path.substring(pos);
        state.handlerIndex = node.wildcardStore;

        return true;
      }

      return false;
    }

    if (node.store !== null) {
      state.handlerIndex = node.store;

      return true;
    }

    if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
      params[node.wildcardName!] = '';
      state.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  };
}
