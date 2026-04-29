import type { MatchFn, MatchState, MatchStateWithParams } from './match-state';
import type { DecoderFn } from './decoder';
import type { ParamSegment, SegmentNode } from './segment-tree';

import { TESTER_PASS, TESTER_TIMEOUT } from './pattern-tester';
import { hasAmbiguousNode } from './segment-tree';
import { compileSegmentTree } from '../codegen/segment-compile';
import { detectWildCodegenSpec } from '../codegen/walker-strategy';

/**
 * Generate a walker function via `new Function()` for the static-prefix
 * wildcard pattern. Each prefix gets a `startsWith(prefix + '/', 1)` probe —
 * no path.split, no Map lookup, substring only for the captured suffix.
 *
 * Returns null when the tree shape doesn't match (delegates to
 * detectWildCodegenSpec for shape detection).
 */
function tryCodegenStaticPrefixWildcard(root: SegmentNode): MatchFn | null {
  const entries = detectWildCodegenSpec(root);

  if (entries === null) return null;

  // Sequential `startsWith` probes lose to NullProtoObj keyed dispatch past
  // ~8 prefixes (measured at 50 prefixes: codegen ~170 ns vs iterative
  // walker's `staticChildren[seg]` ~30 ns). Bail so the iterative walker
  // takes over for many-prefix routers (file servers with N distinct
  // top-level dirs).
  if (entries.length > 8) return null;

  // Generate the walker source. Each prefix gets a `startsWith(prefix + '/', 1)`
  // fast check — JSC heavily optimizes startsWith and avoids allocation.
  let body = `
    'use strict';
    return function compiledWildWalk(url, state) {
      var len = url.length;
      if (len < 2 || url.charCodeAt(0) !== 47) return false;
  `;

  for (const e of entries) {
    const prefixWithSlash = e.prefix + '/';
    const prefixLen = prefixWithSlash.length;
    const minLen = e.wildcardOrigin === 'multi' ? prefixLen + 1 : prefixLen;
    const sliceStart = prefixLen + 1; // after '/' + prefix + '/'

    body += `
      if (len >= ${minLen + 1} && url.startsWith(${JSON.stringify(prefixWithSlash)}, 1)) {
        state.params[${JSON.stringify(e.wildcardName)}] = url.substring(${sliceStart});
        state.handlerIndex = ${e.wildcardStore};
        return true;
      }`;

    if (e.wildcardOrigin === 'star') {
      // Allow URL to be exactly '/prefix' (no trailing slash) — empty capture
      body += `
      if (len === ${e.prefix.length + 1} && url.startsWith(${JSON.stringify(e.prefix)}, 1)) {
        state.params[${JSON.stringify(e.wildcardName)}] = '';
        state.handlerIndex = ${e.wildcardStore};
        return true;
      }`;
    }
  }

  body += `
      return false;
    };
  `;

  try {
    return new Function(body)() as MatchFn;
  } catch {
    return null;
  }
}

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
): MatchFn {
  // Codegen specialist for static-prefix wildcard trees (file servers).
  // Skips path.split + Map lookup — uses url.startsWith for prefix dispatch.
  const compiledWild = tryCodegenStaticPrefixWildcard(root);

  if (compiledWild !== null) return compiledWild;

  // General segment-tree codegen — emits flat function with startsWith probes
  // for static segments and inline indexOf+substring for params. Bails when
  // tree shape needs backtracking we don't generate (returns null) — caller
  // then falls through to the iterative or recursive walker below.
  const compiledFull = compileSegmentTree(root, decodeParams);

  if (compiledFull !== null) return compiledFull;

  // Trees without alternation between static and param/wildcard at the same
  // level can be matched iteratively — no recursion, no backtracking. This
  // saves a function call per segment for the common case (REST routes
  // typically have unique winners at each tree level).
  if (!hasAmbiguousNode(root)) {
    return createIterativeWalker(root, decoder, decodeParams);
  }

  /**
   * Try matching a single param segment: run the tester (if any),
   * recurse into `match` on success, and assign `state.params[name]
   * = decoded` after the recursion returns true.
   *
   * Returns true on full match; false otherwise. The caller MUST
   * check `state.errorKind` after a false return to propagate
   * regex-timeout — the helper sets `state.errorKind` before
   * returning false in the timeout branch but does not abort the
   * caller's loop on its own.
   *
   * Closure-captured: `match`, `decoder`, `decodeParams`. Used by
   * both the head-fast-path and the sibling-backtracking loop in
   * `match` so the two paths share one definition; pre-D1 each had
   * its own copy because abb90cd worried about JSC not inlining a
   * helper. D1's bench against `param /users/:id` shows JSC FTL
   * inlines this cleanly — extraction is 3-6 ns *faster* than the
   * duplicated form, not slower.
   */
  function tryMatchParam(
    param: ParamSegment,
    decoded: string,
    path: string,
    segs: string[],
    nextIdx: number,
    state: MatchStateWithParams,
  ): boolean {
    if (param.tester !== null) {
      const r = param.tester(decoded);

      if (r === TESTER_TIMEOUT) {
        state.errorKind = 'regex-timeout';
        state.errorMessage = 'Route parameter regex exceeded time limit';

        return false;
      }

      if (r !== TESTER_PASS) return false;
    }

    if (match(param.next, path, segs, nextIdx, state)) {
      state.params[param.name] = decoded;

      return true;
    }

    return false;
  }

  function match(
    node: SegmentNode,
    path: string,
    segs: string[],
    idx: number,
    state: MatchStateWithParams,
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
        state.params[node.wildcardName!] = '';
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

    const head = node.paramChild;

    if (head !== null && seg.length > 0) {
      const decoded = decodeParams ? decoder(seg) : seg;

      if (tryMatchParam(head, decoded, path, segs, idx + 1, state)) return true;
      if (state.errorKind !== null) return false;

      // Sibling backtracking — runs only when nextSibling is set, so the
      // single-param case never enters this loop.
      let p: ParamSegment | null = head.nextSibling;

      while (p !== null) {
        if (tryMatchParam(p, decoded, path, segs, idx + 1, state)) return true;
        if (state.errorKind !== null) return false;
        p = p.nextSibling;
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

      state.params[node.wildcardName!] = path.substring(startPos);
      state.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    // Caller (compileMatchFn / allowedMethods) must set `state.params` before
    // invoking; the contract is documented on MatchStateWithParams. Narrowing
    // here lets every body below write through `state.params` without the
    // non-null assertion that previously masked the invariant.
    const stateP = state as MatchStateWithParams;
    const path = url;

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        stateP.handlerIndex = root.store;

        return true;
      }

      // Star-wildcard at root accepts the empty suffix on `/`; multi requires ≥1 char.
      if (root.wildcardStore !== null && root.wildcardOrigin === 'star') {
        stateP.params[root.wildcardName!] = '';
        stateP.handlerIndex = root.wildcardStore;

        return true;
      }

      return false;
    }

    const segs = path.split('/');

    return match(root, path, segs, 1, stateP);
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
): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    // See createSegmentWalker for the params-non-null invariant.
    const stateP = state as MatchStateWithParams;
    const path = url;

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        stateP.handlerIndex = root.store;

        return true;
      }

      // Star-wildcard at root accepts the empty suffix on `/`; multi requires ≥1 char.
      if (root.wildcardStore !== null && root.wildcardOrigin === 'star') {
        stateP.params[root.wildcardName!] = '';
        stateP.handlerIndex = root.wildcardStore;

        return true;
      }

      return false;
    }

    const segs = path.split('/');
    const params = stateP.params;
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
        stateP.handlerIndex = node.wildcardStore;

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
        const decoded = decodeParams ? decoder(seg) : seg;

        if (node.paramChild.tester !== null) {
          const r = node.paramChild.tester(decoded);

          if (r === TESTER_TIMEOUT) {
            stateP.errorKind = 'regex-timeout';
            stateP.errorMessage = 'Route parameter regex exceeded time limit';

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
        stateP.handlerIndex = node.wildcardStore;

        return true;
      }

      return false;
    }

    if (node.store !== null) {
      stateP.handlerIndex = node.store;

      return true;
    }

    if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
      params[node.wildcardName!] = '';
      stateP.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  };
}
