import type { MatchFn, MatchState } from './match-state';
import type { DecoderFn } from './decoder';
import type { ParamSegment, SegmentNode } from './segment-tree';

import { TESTER_PASS } from './pattern-tester';
import { hasAmbiguousNode } from './segment-tree';
import { compileSegmentTree } from '../codegen/segment-compile';
import { detectWildCodegenSpec } from '../codegen/walker-strategy';

/**
 * Generate a walker function via `new Function()` for the static-prefix
 * wildcard pattern. Each prefix gets a `startsWith(prefix + '/', 1)` probe —
 * no path.split, no Map lookup, substring only for the captured suffix.
 */
function tryCodegenStaticPrefixWildcard(root: SegmentNode): MatchFn | null {
  const entries = detectWildCodegenSpec(root);

  if (entries === null || entries.length > 8) return null;

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
    const sliceStart = prefixLen + 1;

    body += `
      if (len >= ${minLen + 1} && url.startsWith(${JSON.stringify(prefixWithSlash)}, 1)) {
        state.paramValues[0] = url.substring(${sliceStart});
        state.paramCount = 1;
        state.handlerIndex = ${e.wildcardStore};
        return true;
      }`;

    if (e.wildcardOrigin === 'star') {
      body += `
      if (len === ${e.prefix.length + 1} && url.startsWith(${JSON.stringify(e.prefix)}, 1)) {
        state.paramValues[0] = '';
        state.paramCount = 1;
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
 * High-performance walker: writes params to the pre-allocated
 * `state.paramValues` buffer during traversal.
 */
export function createSegmentWalker(
  root: SegmentNode,
  decoder: DecoderFn,
): MatchFn {
  const compiledWild = tryCodegenStaticPrefixWildcard(root);

  if (compiledWild !== null) return compiledWild;

  const compiledFull = compileSegmentTree(root);

  if (compiledFull !== null) return compiledFull;

  if (!hasAmbiguousNode(root)) {
    return createIterativeWalker(root, decoder);
  }

  function tryMatchParam(
    param: ParamSegment,
    decoded: string,
    path: string,
    segs: string[],
    nextIdx: number,
    state: MatchState,
  ): boolean {
    if (param.tester !== null) {
      if (param.tester(decoded) !== TESTER_PASS) return false;
    }

    const mark = state.paramCount;
    state.paramValues[state.paramCount++] = decoded;

    if (match(param.next, path, segs, nextIdx, state)) {
      return true;
    }

    state.paramCount = mark;

    return false;
  }

  function match(
    node: SegmentNode,
    path: string,
    segs: string[],
    idx: number,
    state: MatchState,
  ): boolean {
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
        state.paramValues[state.paramCount++] = '';
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
      }
    }

    const head = node.paramChild;

    if (head !== null && seg.length > 0) {
      const decoded = decoder(seg);

      if (tryMatchParam(head, decoded, path, segs, idx + 1, state)) return true;

      let p: ParamSegment | null = head.nextSibling;

      while (p !== null) {
        if (tryMatchParam(p, decoded, path, segs, idx + 1, state)) return true;
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

      state.paramValues[state.paramCount++] = path.substring(startPos);
      state.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    const path = url;
    state.paramCount = 0;

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        state.handlerIndex = root.store;

        return true;
      }

      if (root.wildcardStore !== null && root.wildcardOrigin === 'star') {
        state.paramValues[0] = '';
        state.paramCount = 1;
        state.handlerIndex = root.wildcardStore;

        return true;
      }

      return false;
    }

    const segs = path.split('/');

    return match(root, path, segs, 1, state);
  };
}

function createIterativeWalker(
  root: SegmentNode,
  decoder: DecoderFn,
): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    const path = url;
    state.paramCount = 0;

    if (path.length === 1 && path.charCodeAt(0) === 47) {
      if (root.store !== null) {
        state.handlerIndex = root.store;

        return true;
      }

      if (root.wildcardStore !== null && root.wildcardOrigin === 'star') {
        state.paramValues[0] = '';
        state.paramCount = 1;
        state.handlerIndex = root.wildcardStore;

        return true;
      }

      return false;
    }

    const segs = path.split('/');
    const values = state.paramValues;
    let node = root;
    let idx = 1;
    let pos = segs[0]!.length + 1;

    while (idx < segs.length) {
      if (
        node.staticChildren === null
        && node.paramChild === null
        && node.wildcardStore !== null
      ) {
        if (node.wildcardOrigin === 'multi' && pos >= path.length) return false;

        values[state.paramCount++] = path.substring(pos);
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
        const decoded = decoder(seg);

        if (node.paramChild.tester !== null) {
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
        }

        values[state.paramCount++] = decoded;
        node = node.paramChild.next;
        pos += seg.length + 1;
        idx++;
        continue;
      }

      if (node.wildcardStore !== null) {
        if (node.wildcardOrigin === 'multi' && pos >= path.length) return false;

        values[state.paramCount++] = path.substring(pos);
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
      values[state.paramCount++] = '';
      state.handlerIndex = node.wildcardStore;

      return true;
    }

    return false;
  };
}
