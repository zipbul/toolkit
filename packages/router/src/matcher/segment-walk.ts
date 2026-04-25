import type { MatchState } from './match-state';
import type { DecoderFn } from '../processor/decoder';
import type { RadixMatchFn } from './radix-matcher';
import type { SegmentNode } from './segment-tree';

import { TESTER_PASS, TESTER_TIMEOUT } from './pattern-tester';
import { hasAmbiguousNode } from './segment-tree';

/**
 * Detect & build a codegen walker for the static-prefix wildcard pattern:
 *   root -> staticChildren[name] -> wildcardStore (no further descent)
 *
 * Generates a flat function that uses url.startsWith(prefix, 1) per known
 * prefix — no path.split, no Map.get, no substring for the prefix lookup.
 * Substring is only invoked once for the captured wildcard suffix.
 *
 * Returns null when the tree shape doesn't match.
 */
function tryCodegenStaticPrefixWildcard(root: SegmentNode): RadixMatchFn | null {
  if (root.paramChild !== null || root.wildcardStore !== null || root.store !== null) return null;
  if (root.staticChildren === null) return null;

  type Entry = {
    prefix: string;
    wildcardOrigin: 'star' | 'multi';
    wildcardName: string;
    wildcardStore: number;
  };
  const entries: Entry[] = [];

  for (const key in root.staticChildren) {
    const child = root.staticChildren[key]!;

    if (child.staticChildren !== null) return null;
    if (child.paramChild !== null) return null;
    if (child.store !== null) return null;
    if (child.wildcardStore === null) return null;

    entries.push({
      prefix: key,
      wildcardOrigin: child.wildcardOrigin!,
      wildcardName: child.wildcardName!,
      wildcardStore: child.wildcardStore,
    });
  }

  if (entries.length === 0) return null;

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
    return new Function(body)() as RadixMatchFn;
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
): RadixMatchFn {
  // Codegen specialist for static-prefix wildcard trees (file servers).
  // Skips path.split + Map lookup — uses url.startsWith for prefix dispatch.
  const compiledWild = tryCodegenStaticPrefixWildcard(root);

  if (compiledWild !== null) return compiledWild;

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
