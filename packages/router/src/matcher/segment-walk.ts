import type { MatchFn, MatchState } from './match-state';
import type { DecoderFn } from './decoder';
import type { ParamSegment, SegmentNode } from './segment-tree';

import { performance } from 'node:perf_hooks';
import { TESTER_PASS } from './pattern-tester';
import { compactSegmentTree, getTenantFactor, hasAmbiguousNode } from './segment-tree';
import { compileSegmentTree, collectWarmupPaths } from '../codegen/segment-compile';
import { detectWildCodegenSpec } from '../codegen/walker-strategy';
import { createMatchState } from './match-state';
import { recordWarmupCall } from '../codegen/codegen-telemetry';

/**
 * Run the freshly-compiled walker once per major branch so JSC IC reaches
 * tier-up across the dominant code paths instead of just one. Without
 * warmup, first-call latency tail is multi-µs even for small trees because
 * tier-up otherwise happens on the user's first request.
 *
 * Single-input warmup is insufficient for trees whose hot work is split
 * across siblings — the IC only generalizes through paths it has actually
 * observed. `collectWarmupPaths()` returns one synthesized path per direct
 * child of the root.
 *
 * Errors from warmup invocations are swallowed: warmup is a best-effort
 * hint to the JIT, not a correctness check.
 */
function warmupCompiledWalker(
  walker: MatchFn,
  root: SegmentNode,
  shape: string | null,
): void {
  const paths = collectWarmupPaths(root);
  const state = createMatchState();
  // Drive JSC IC past its baseline thresholds so the walker is at least
  // baseline-compiled before the first user request lands on it.
  const WARMUP_ITERATIONS = 20;
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const p of paths) {
      try { walker(p, state); } catch { /* warmup failures are non-fatal */ }
    }
  }
  // Record only the final post-tier-up call latency.
  for (const p of paths) {
    const t0 = performance.now();
    try { walker(p, state); } catch { /* warmup failures are non-fatal */ }
    const ns = (performance.now() - t0) * 1e6;
    if (shape !== null) recordWarmupCall(shape, ns);
  }
}

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
  // Tenant-factor short-circuit. When the root carries a factor descriptor
  // (post-seal optimization), staticChildren has been moved into a hash
  // map and the codegen would emit a walker against an empty-looking tree.
  // Skip both wildcard and full-tree codegen and emit the factored walker
  // directly so the non-factored iterative path stays bytecode-identical
  // (zero closure-scope pollution from a factor variable that never fires).
  const factorAtEntry = getTenantFactor(root);
  if (factorAtEntry !== undefined) {
    return createFactoredWalker(root, decoder, factorAtEntry.keyToTerminal, factorAtEntry.sharedNext);
  }

  const compiledWild = tryCodegenStaticPrefixWildcard(root);
  if (compiledWild !== null) {
    warmupCompiledWalker(compiledWild, root, null);
    return compiledWild;
  }

  const compiledFullPackage = compileSegmentTree(root);
  if (compiledFullPackage !== null) {
    const compiled = compiledFullPackage.factory(compiledFullPackage.testers, TESTER_PASS, decoder);
    warmupCompiledWalker(compiled, root, compiledFullPackage.shape);
    return compiled;
  }

  // Codegen bailed — the tree is large enough that the iterative/recursive
  // path will be used. Run single-static-chain compaction here so the
  // walker pays only one node visit per merged chain rather than one per
  // segment. Compaction is destructive; no codegen attempt may follow.
  const stats = compactSegmentTree(root);
  if (process.env.ZIPBUL_ROUTER_CODEGEN_DIAGNOSTICS === '1') {
    // eslint-disable-next-line no-console
    console.log(`compact=foldedNodes=${stats.foldedNodes} chains=${stats.chains}`);
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

    // Compacted single-static chain: walk each prefix segment in order.
    if (node.staticPrefix !== null) {
      const sp = node.staticPrefix;
      for (let i = 0; i < sp.length; i++) {
        const seg = sp[i]!;
        const segLen = seg.length;
        const after = pos + segLen;
        if (after > len) return false;
        if (!path.startsWith(seg, pos)) return false;
        // The segment must be followed by `/` or end-of-string —
        // otherwise we'd accept `seg` as a prefix of a longer segment.
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

    const nextSlash = path.indexOf('/', pos);
    const end = nextSlash === -1 ? len : nextSlash;
    const segLen = end - pos;

    // Single-static-child fast path: probe via offset-based startsWith
    // before paying for `path.substring(pos, end)`. The substring is only
    // allocated when we fall through to the staticChildren Record (which
    // needs the string as an object key).
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
      // Compacted single-static chain on this node — consume its prefix
      // segments before the regular per-segment dispatch.
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const seg = sp[i]!;
          const segLen = seg.length;
          const after = pos + segLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(seg, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      const nextSlash = url.indexOf('/', pos);
      const end = nextSlash === -1 ? len : nextSlash;
      const segLen = end - pos;

      // Single-static-child offset fast path: avoid substring alloc on
      // the most common shape (single static child per node).
      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
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

/**
 * Tenant-factored walker variant. Used when `getTenantFactor(root)` returned
 * a descriptor: dispatches first-segment via `keyToTerminal` Map, then walks
 * the canonical shared subtree, finally overriding the leaf store with the
 * looked-up handler index. Identical body to the iterative walker apart
 * from the entry dispatch and the override applied at the terminal/wildcard
 * branches.
 */
function createFactoredWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  keyToTerminal: Map<string, number>,
  sharedNext: SegmentNode,
): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    if (url === '/') {
      if (root.store !== null) {
        state.handlerIndex = root.store;
        return true;
      }
      return false;
    }

    const slash1 = url.indexOf('/', 1);
    const firstSeg = slash1 === -1 ? url.substring(1) : url.substring(1, slash1);
    const looked = keyToTerminal.get(firstSeg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = sharedNext;
    let pos = slash1 === -1 ? len : slash1 + 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const seg = sp[i]!;
          const segLen = seg.length;
          const after = pos + segLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(seg, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      const nextSlash = url.indexOf('/', pos);
      const end = nextSlash === -1 ? len : nextSlash;
      const segLen = end - pos;

      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
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
        state.handlerIndex = storeOverride;
        return true;
      }

      return false;
    }

    if (node.store !== null) {
      state.handlerIndex = storeOverride;
      return true;
    }

    if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
      const pc = state.paramCount * 2;
      state.paramOffsets[pc] = len;
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = storeOverride;
      return true;
    }

    return false;
  };
}
