import type { MatchFn, MatchState } from './match-state';
import type { DecoderFn } from './decoder';
import type { ParamSegment, SegmentNode } from './segment-tree';

import { TESTER_PASS } from './pattern-tester';
import { hasAmbiguousNode } from './segment-tree';
import { compileSegmentTree } from '../codegen/segment-compile';
import { detectWildCodegenSpec } from '../codegen/walker-strategy';

/**
 * Generate a walker function via `new Function()` for the static-prefix
 * wildcard pattern. Each prefix gets a `startsWith(prefix + '/', 1)` probe.
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
        state.paramOffsets[0] = ${sliceStart};
        state.paramOffsets[1] = len;
        state.paramCount = 1;
        state.handlerIndex = ${e.wildcardStore};
        return true;
      }`;

    if (e.wildcardOrigin === 'star') {
      body += `
      if (len === ${e.prefix.length + 1} && url.startsWith(${JSON.stringify(e.prefix)}, 1)) {
        state.paramOffsets[0] = len;
        state.paramOffsets[1] = len;
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
 * True zero-allocation walker: writes offsets to `state.paramOffsets`.
 */
export function createSegmentWalker(
  root: SegmentNode,
  decoder: DecoderFn,
): MatchFn {
  const compiledWild = tryCodegenStaticPrefixWildcard(root);
  if (compiledWild !== null) return compiledWild;

  const compiledFullPackage = compileSegmentTree(root);
  if (compiledFullPackage !== null) {
    return compiledFullPackage.factory(compiledFullPackage.testers, TESTER_PASS, decoder);
  }

  if (!hasAmbiguousNode(root)) {
    return createIterativeWalker(root, decoder);
  }

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

    const nextSlash = path.indexOf('/', pos);
    const end = nextSlash === -1 ? len : nextSlash;
    const seg = path.substring(pos, end);

    if (node.staticChildren !== null) {
      const child = node.staticChildren[seg];
      if (child !== undefined) {
        if (match(child, path, end === len ? len : end + 1, state, decoder)) return true;
      }
    }

    const head = node.paramChild;
    if (head !== null && seg.length > 0) {
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

function createIterativeWalker(root: SegmentNode, decoder: DecoderFn): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

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

    let node = root;
    let pos = 1;

    while (pos < len) {
      const nextSlash = url.indexOf('/', pos);
      const end = nextSlash === -1 ? len : nextSlash;
      const seg = url.substring(pos, end);

      if (node.staticChildren !== null) {
        const child = node.staticChildren[seg];
        if (child !== undefined) {
          node = child;
          pos = end === len ? len : end + 1;
          continue;
        }
      }

      if (node.paramChild !== null && seg.length > 0) {
        const decoded = decoder(seg);
        if (node.paramChild.tester !== null) {
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
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
  };
}
