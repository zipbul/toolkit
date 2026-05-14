import type { MatchFn, MatchState } from './match-state';
import type { DecoderFn } from './decoder';
import type { ParamSegment, SegmentNode } from './segment-tree';

import type { TenantFactor } from './segment-tree';

import { TESTER_PASS } from './pattern-tester';
import { compactSegmentTree, detectTenantFactor, getTenantFactor, hasAmbiguousNode, setTenantFactor } from './segment-tree';
import { compileSegmentTree, collectWarmupPaths } from '../codegen/segment-compile';
import { detectWildCodegenSpec } from '../codegen/walker-strategy';
import { WARMUP_ITERATIONS } from '../codegen/warmup';

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
  state: MatchState,
): void {
  const paths = collectWarmupPaths(root);
  // Drive JSC IC past its baseline thresholds so the walker is at least
  // baseline-compiled before the first user request lands on it.
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const p of paths) {
      try { walker(p, state); } catch { /* warmup failures are non-fatal */ }
    }
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

  // Every interpolated value flows through `JSON.stringify` (literal
  // prefix) or `Number` (offsets) and the body is a closed template, so
  // the emitted source is always valid JS — no try/catch SyntaxError
  // path is reachable here.
  return new Function(body)() as MatchFn;
}

/**
 * True zero-allocation walker: writes offsets to `state.paramOffsets`.
 */
export function createSegmentWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  warmupState: MatchState,
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

  // Recursive tenant-factor: workloads like `/users/${i}/posts/:postId` keep
  // root.staticChildren = {users: ...} (single child) so detectTenantFactor
  // rejects at root. The real fanout lives one chain hop deeper. Walk any
  // single-static-chain from root, then try detectTenantFactor at the
  // deepest-reachable node. On hit, build a prefixed factored walker that
  // matches the leading static segments before the factor lookup.
  const prefixedFactor = tryDetectPrefixedFactor(root);
  if (prefixedFactor !== null) {
    return createPrefixedFactoredWalker(
      decoder,
      prefixedFactor.prefixSegs,
      prefixedFactor.factor.keyToTerminal,
      prefixedFactor.factor.sharedNext,
    );
  }

  // Multi-prefix recursive factor: root.staticChildren has multiple keys
  // (e.g. `/users/...` + `/api/...`). Try detect-prefixed-factor on each
  // child independently. If every child yields a factor, build a single
  // walker that dispatches on first segment then runs that child's
  // prefix walk + factor lookup.
  const multiPrefixed = tryDetectMultiPrefixFactor(root);
  if (multiPrefixed !== null) {
    return createMultiPrefixFactoredWalker(decoder, multiPrefixed);
  }

  const compiledWild = tryCodegenStaticPrefixWildcard(root);
  if (compiledWild !== null) {
    warmupCompiledWalker(compiledWild, root, warmupState);
    return compiledWild;
  }

  const compiledFullPackage = compileSegmentTree(root);
  if (compiledFullPackage !== null) {
    const compiled = compiledFullPackage.factory(compiledFullPackage.testers, TESTER_PASS, decoder);
    warmupCompiledWalker(compiled, root, warmupState);
    return compiled;
  }

  // Codegen bailed — the tree is large enough that the iterative/recursive
  // path will be used. Run single-static-chain compaction here so the
  // walker pays only one node visit per merged chain rather than one per
  // segment. Compaction is destructive; no codegen attempt may follow.
  compactSegmentTree(root);

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

    // See the comment at the iterative walker for charCodeAt rationale.
    let end = pos;
    while (end < len && path.charCodeAt(end) !== 47) end++;
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

      // charCodeAt scan for the next '/' beats `indexOf('/', pos)` on
      // short HTTP paths (< 64 chars), which dominate production
      // workloads. Bench `bench/method-research/P-indexof-vs-charcode.bench.ts`
      // measures 1.29-2.44× wins for 4-36 char paths; indexOf wins past
      // ~65 chars but those are rare for HTTP request paths.
      let end = pos;
      while (end < len && url.charCodeAt(end) !== 47) end++;
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

    // Locate first '/' after the leading one via charCodeAt scan — same
    // rationale as the per-segment scan inside the walker body.
    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) slash1++;
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const looked = keyToTerminal.get(firstSeg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = sharedNext;
    let pos = slash1 === len ? len : slash1 + 1;

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

      // charCodeAt scan for the next '/' beats `indexOf('/', pos)` on
      // short HTTP paths (< 64 chars), which dominate production
      // workloads. Bench `bench/method-research/P-indexof-vs-charcode.bench.ts`
      // measures 1.29-2.44× wins for 4-36 char paths; indexOf wins past
      // ~65 chars but those are rare for HTTP request paths.
      let end = pos;
      while (end < len && url.charCodeAt(end) !== 47) end++;
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

/**
 * Locate a tenant-factor candidate beneath a single-static-chain root
 * prefix. Walks every single-child static node from `root` and tries
 * `detectTenantFactor` at the deepest reachable node. Workloads like
 * `/users/${i}/posts/:postId` (root.staticChildren = {users}) reject the
 * root-level detector because the fanout lives one chain hop deeper —
 * this scan recovers them. On hit, mutates the deep node to attach the
 * factor and clear its staticChildren/singleChild slots so the prefixed
 * factored walker owns dispatch.
 */
/**
 * Dry-run variant: detects but does not mutate. Returns the deepest
 * reachable node along with the factor candidate so the caller can
 * decide whether to commit. Mutation is split out into
 * `applyPrefixedFactor` so partial-success batch detection (multi-
 * prefix factor below) can roll back cleanly when any sibling fails.
 */
function detectPrefixedFactorDry(
  root: SegmentNode,
): { prefixSegs: string[]; factor: TenantFactor; deepNode: SegmentNode } | null {
  const prefixSegs: string[] = [];
  let cur: SegmentNode = root;

  // Bound the descent to keep this O(prefix depth) rather than O(tree).
  for (let depth = 0; depth < 32; depth++) {
    if (
      cur.paramChild !== null ||
      cur.wildcardStore !== null ||
      cur.store !== null ||
      cur.staticPrefix !== null
    ) {
      break;
    }

    let onlyKey: string | null = null;
    let onlyChild: SegmentNode | null = null;
    let count = 0;

    if (cur.singleChildKey !== null && cur.singleChildNext !== null && cur.staticChildren === null) {
      onlyKey = cur.singleChildKey;
      onlyChild = cur.singleChildNext;
      count = 1;
    } else if (cur.staticChildren !== null) {
      for (const k in cur.staticChildren) {
        count++;
        if (count > 1) break;
        onlyKey = k;
        onlyChild = cur.staticChildren[k]!;
      }
    }

    if (count !== 1 || onlyKey === null || onlyChild === null) break;

    prefixSegs.push(onlyKey);
    cur = onlyChild;
  }

  if (prefixSegs.length === 0) return null;

  const factor = detectTenantFactor(cur);
  if (factor === null) return null;

  return { prefixSegs, factor, deepNode: cur };
}

function applyPrefixedFactor(deepNode: SegmentNode, factor: TenantFactor): void {
  setTenantFactor(deepNode, factor);
  deepNode.staticChildren = null;
  deepNode.singleChildKey = null;
  deepNode.singleChildNext = null;
}

function tryDetectPrefixedFactor(root: SegmentNode): { prefixSegs: string[]; factor: TenantFactor } | null {
  const dry = detectPrefixedFactorDry(root);
  if (dry === null) return null;
  applyPrefixedFactor(dry.deepNode, dry.factor);
  return { prefixSegs: dry.prefixSegs, factor: dry.factor };
}

/**
 * Walker for the prefixed-factor case: match each segment in `prefixSegs`
 * against the leading URL segments, then perform the factor key lookup,
 * then walk the canonical shared subtree. Body after factor lookup is
 * structurally identical to `createFactoredWalker`.
 */
function createPrefixedFactoredWalker(
  decoder: DecoderFn,
  prefixSegs: string[],
  keyToTerminal: Map<string, number>,
  sharedNext: SegmentNode,
): MatchFn {
  const prefixCount = prefixSegs.length;
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    // Walk through the static prefix chain.
    let pos = 1;
    for (let i = 0; i < prefixCount; i++) {
      const seg = prefixSegs[i]!;
      const segLen = seg.length;
      const after = pos + segLen;
      if (after > len) return false;
      if (!url.startsWith(seg, pos)) return false;
      if (after < len && url.charCodeAt(after) !== 47) return false;
      pos = after === len ? len : after + 1;
    }

    if (pos >= len) return false;

    // Factor key segment.
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = end === pos ? '' : url.substring(pos, end);
    const looked = keyToTerminal.get(seg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = sharedNext;
    pos = end === len ? len : end + 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const s = sp[i]!;
          const sLen = s.length;
          const after = pos + sLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(s, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      let endInner = pos;
      while (endInner < len && url.charCodeAt(endInner) !== 47) endInner++;
      const segLen = endInner - pos;

      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
        node = node.singleChildNext;
        pos = endInner === len ? len : endInner + 1;
        continue;
      }
      if (node.staticChildren !== null) {
        const segStr = url.substring(pos, endInner);
        const child = node.staticChildren[segStr];
        if (child !== undefined) {
          node = child;
          pos = endInner === len ? len : endInner + 1;
          continue;
        }
      }

      if (node.paramChild !== null && segLen > 0) {
        if (node.paramChild.tester !== null) {
          const decoded = decoder(url.substring(pos, endInner));
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = endInner;
        state.paramCount++;
        node = node.paramChild.next;
        pos = endInner === len ? len : endInner + 1;
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

interface PrefixedFactorEntry {
  prefixSegs: string[];
  keyToTerminal: Map<string, number>;
  sharedNext: SegmentNode;
}

/**
 * Detect prefixed-factor descriptors for every direct static child of
 * `root`. Returns the per-key map only if (a) root has multiple static
 * children and no other dispatch features (param/wildcard/store), and
 * (b) every child yields a non-null prefixed-factor result. Partial
 * application would force a fall-through walker which the IC cannot
 * unify, so we treat partial as "decline".
 */
function tryDetectMultiPrefixFactor(root: SegmentNode): Map<string, PrefixedFactorEntry> | null {
  if (
    root.paramChild !== null ||
    root.wildcardStore !== null ||
    root.store !== null ||
    root.staticPrefix !== null
  ) {
    return null;
  }

  const childMap = root.staticChildren;
  if (childMap === null) return null;

  // Need at least 2 keys; single-key falls into tryDetectPrefixedFactor above.
  let keyCount = 0;
  for (const _k in childMap) {
    keyCount++;
    if (keyCount > 1) break;
  }
  if (keyCount < 2) return null;

  // Phase 1: dry-run detect every child without mutation. Any failure
  // aborts the whole batch with the tree intact. This is the
  // correctness fix for the previous version, which mutated each
  // child as it was processed and left a partially-factored tree
  // behind whenever a later sibling failed — fall-through walker
  // tiers would then walk an inconsistent tree (some children
  // factored, others not) and silently miscompile.
  type Pending =
    | { type: 'prefixed'; key: string; deepNode: SegmentNode; factor: TenantFactor; prefixSegs: string[] }
    | { type: 'direct'; key: string; child: SegmentNode; factor: TenantFactor };
  const pending: Pending[] = [];
  for (const k in childMap) {
    const child = childMap[k]!;
    const dryPrefixed = detectPrefixedFactorDry(child);
    if (dryPrefixed !== null) {
      pending.push({
        type: 'prefixed',
        key: k,
        deepNode: dryPrefixed.deepNode,
        factor: dryPrefixed.factor,
        prefixSegs: dryPrefixed.prefixSegs,
      });
      continue;
    }
    const direct = detectTenantFactor(child);
    if (direct !== null) {
      pending.push({ type: 'direct', key: k, child, factor: direct });
      continue;
    }
    // Any sibling without a factor candidate aborts the batch — no
    // mutation has happened yet, so the tree is left untouched and
    // the caller falls through to the next walker tier safely.
    return null;
  }

  // Phase 2: every sibling produced a candidate; commit the mutations.
  const out = new Map<string, PrefixedFactorEntry>();
  for (const p of pending) {
    if (p.type === 'prefixed') {
      applyPrefixedFactor(p.deepNode, p.factor);
      out.set(p.key, {
        prefixSegs: p.prefixSegs,
        keyToTerminal: p.factor.keyToTerminal,
        sharedNext: p.factor.sharedNext,
      });
    } else {
      applyPrefixedFactor(p.child, p.factor);
      out.set(p.key, {
        prefixSegs: [],
        keyToTerminal: p.factor.keyToTerminal,
        sharedNext: p.factor.sharedNext,
      });
    }
  }
  return out;
}

/**
 * Walker for the multi-prefix factor case. Dispatches on the first URL
 * segment to one of the per-child prefixed-factor entries, then walks
 * that entry's prefix segments, looks up the factor key, and walks the
 * shared subtree. Body after factor lookup is structurally identical
 * to `createPrefixedFactoredWalker`.
 */
function createMultiPrefixFactoredWalker(
  decoder: DecoderFn,
  childMap: Map<string, PrefixedFactorEntry>,
): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    if (url === '/') return false;

    // First segment selects the prefixed-factor entry.
    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) slash1++;
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const entry = childMap.get(firstSeg);
    if (entry === undefined) return false;

    const prefixSegs = entry.prefixSegs;
    const prefixCount = prefixSegs.length;
    let pos = slash1 === len ? len : slash1 + 1;

    // Walk the per-child static prefix chain.
    for (let i = 0; i < prefixCount; i++) {
      const seg = prefixSegs[i]!;
      const segLen = seg.length;
      const after = pos + segLen;
      if (after > len) return false;
      if (!url.startsWith(seg, pos)) return false;
      if (after < len && url.charCodeAt(after) !== 47) return false;
      pos = after === len ? len : after + 1;
    }

    if (pos >= len) return false;

    // Factor key segment.
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = end === pos ? '' : url.substring(pos, end);
    const looked = entry.keyToTerminal.get(seg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = entry.sharedNext;
    pos = end === len ? len : end + 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const s = sp[i]!;
          const sLen = s.length;
          const after = pos + sLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(s, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      let endInner = pos;
      while (endInner < len && url.charCodeAt(endInner) !== 47) endInner++;
      const segLen = endInner - pos;

      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
        node = node.singleChildNext;
        pos = endInner === len ? len : endInner + 1;
        continue;
      }
      if (node.staticChildren !== null) {
        const segStr = url.substring(pos, endInner);
        const child = node.staticChildren[segStr];
        if (child !== undefined) {
          node = child;
          pos = endInner === len ? len : endInner + 1;
          continue;
        }
      }

      if (node.paramChild !== null && segLen > 0) {
        if (node.paramChild.tester !== null) {
          const decoded = decoder(url.substring(pos, endInner));
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = endInner;
        state.paramCount++;
        node = node.paramChild.next;
        pos = endInner === len ? len : endInner + 1;
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
