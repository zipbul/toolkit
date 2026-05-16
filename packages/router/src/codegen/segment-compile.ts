import type { MatchFn, DecoderFn } from '../types';
import {
  forEachStaticChild,
  hasAmbiguousNode,
  hasAnyStaticChild,
  TESTER_PASS,
  type PatternTesterFn,
  type SegmentNode,
} from '../tree';

/**
 * Codegen budget thresholds. Trees exceeding either of these fall back to
 * the iterative walker. The node count gate avoids walking past the JSC-
 * compile sweet spot; the source-bytes gate is the hard `new Function()`
 * safety net checked after emission.
 */
const MAX_SOURCE_BYTES_HARD = 128 * 1024;
const MAX_NODES_DEFAULT = 256;

interface CodegenEstimate {
  nodes: number;
  oversized: boolean;
}

function estimateSegmentTreeCodegen(
  root: SegmentNode,
  nodeCap: number,
): CodegenEstimate {
  let nodes = 0;
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    if (nodes > nodeCap) return { nodes, oversized: true };
    const node = stack.pop()!;
    nodes++;
    forEachStaticChild(node, (_, child) => { stack.push(child); });
    let p = node.paramChild;
    while (p !== null) {
      stack.push(p.next);
      p = p.nextSibling;
    }
  }

  return { nodes, oversized: false };
}

/**
 * Walk the segment tree once and return one synthesized warmup path per
 * direct child of the root. Used by warmup so JSC IC reaches tier-up
 * across every major code path instead of a single one. The per-path
 * depth bound (`16`) is a malformed-tree safety net only.
 */
export function collectWarmupPaths(root: SegmentNode): string[] {
  const out: string[] = [];

  const firstStaticChild = (n: SegmentNode): { key: string; child: SegmentNode } | null => {
    if (n.singleChildKey !== null && n.singleChildNext !== null) {
      return { key: n.singleChildKey, child: n.singleChildNext };
    }
    if (n.staticChildren !== null) {
      for (const seg in n.staticChildren) return { key: seg, child: n.staticChildren[seg]! };
    }
    return null;
  };

  const synthForNode = (node: SegmentNode, prefix: string): string => {
    let path = prefix;
    let n: SegmentNode | null = node;
    let guard = 0;
    while (n !== null && guard++ < 16) {
      const first = firstStaticChild(n);
      if (first !== null) {
        path += '/' + first.key;
        n = first.child;
        continue;
      }
      if (n.paramChild !== null) {
        path += '/__warm__';
        n = n.paramChild.next;
        continue;
      }
      if (n.wildcardStore !== null) {
        path += '/__warm__/__warm__';
        n = null;
        continue;
      }
      break;
    }
    return path;
  };

  forEachStaticChild(root, (seg, child) => {
    out.push(synthForNode(child, '/' + seg));
  });
  if (root.paramChild !== null) {
    out.push(synthForNode(root.paramChild.next, '/__warm__'));
  }
  if (root.wildcardStore !== null) {
    out.push('/__warm__/__warm__');
  }

  if (out.length === 0) out.push('/__zipbul_warmup__');
  return out;
}

export interface CompiledPackage {
  factory: (
    testers: PatternTesterFn[],
    pass: typeof TESTER_PASS,
    decoder: DecoderFn,
  ) => MatchFn;
  testers: PatternTesterFn[];
}

/**
 * Compile a segment tree into a flat match function via `new Function()`.
 */
export function compileSegmentTree(root: SegmentNode): CompiledPackage | null {
  // Bail on ambiguous trees: codegen only handles unique-winner trees.
  // Ambiguous trees (static+param collision) fallback to recursive walker.
  if (hasAmbiguousNode(root)) return null;

  if (estimateSegmentTreeCodegen(root, MAX_NODES_DEFAULT).oversized) return null;

  const ctx: EmitContext = { bail: false, testers: [] };
  const body = emitNode(ctx, root, 'pos0');
  if (ctx.bail) return null;

  const source = `
'use strict';
return function compiledSegmentWalk(url, state) {
  var len = url.length;
  if (len < 2 || url.charCodeAt(0) !== 47) {
    if (len === 1 && url.charCodeAt(0) === 47) {
${emitRootSlashTerminal(root)}
    }
    return false;
  }
  var pos0 = 1;
  state.paramCount = 0;
${body}
  return false;
};`;

  if (source.length > MAX_SOURCE_BYTES_HARD) return null;

  try {
    const factory = new Function('testers', 'TESTER_PASS', 'decoder', source) as CompiledPackage['factory'];
    return { factory, testers: ctx.testers };
  } catch {
    return null;
  }
}

interface EmitContext {
  bail: boolean;
  testers: PatternTesterFn[];
}

export function emitRootSlashTerminal(root: SegmentNode): string {
  if (root.store !== null) {
    return `      state.handlerIndex = ${root.store};\n      return true;`;
  }

  if (root.wildcardStore !== null && root.wildcardOrigin === 'star') {
    return `      state.paramOffsets[0] = 1;\n      state.paramOffsets[1] = 1;\n      state.paramCount = 1;\n      state.handlerIndex = ${root.wildcardStore};\n      return true;`;
  }

  return '      return false;';
}

function emitNode(
  ctx: EmitContext,
  node: SegmentNode,
  posVar: string,
): string {
  // posVar is always 'pos0' at the entry point or `pos${N}` / `pos${N}_s…`
  // from the recursive emitNode calls below, so slice(3).split('_')[0] is
  // always a non-empty digit string. The `?? '0'` fallback the earlier
  // version carried was unreachable.
  const posDigits = posVar.slice(3).split('_')[0]!;
  const slashVar = `s${posDigits}`;
  const innerPos = `pos${parseInt(posDigits) + 1}`;

  let code = emitStaticChildren(ctx, node, posVar, innerPos);
  if (ctx.bail) return '';

  if (node.paramChild !== null) {
    code += emitParamBranch(ctx, node.paramChild, posVar, slashVar, innerPos);
    if (ctx.bail) return '';
  }

  if (node.wildcardStore !== null) {
    code += emitWildcardStore(node, posVar);
  }

  return code;
}

/** Threshold at which `emitStaticChildren` switches from a linear
 *  `if (startsWith) { … }` chain to a `switch (charCodeAt) { case … }`
 *  dispatch. Below this count the chain wins (no switch overhead, JSC
 *  cmovs the comparisons); at and above, the single charCodeAt + jump
 *  table beats N sequential startsWith probes on miss-heavy paths.
 *  The 4 boundary is empirical — verified on github-static/miss and
 *  github-param/miss benches. */
const STATIC_CHILD_DISPATCH_THRESHOLD = 4;

/** Emit one `if (url.startsWith(seg, pos)) { … }` block per static child
 *  of `node`. Sibling-dense nodes (≥ THRESHOLD) get a first-char switch
 *  prelude so a miss returns after a single charCodeAt instead of N
 *  failed startsWith probes. Each block recursively emits the child's
 *  subtree. */
export function emitStaticChildren(
  ctx: EmitContext,
  node: SegmentNode,
  posVar: string,
  innerPos: string,
): string {
  const siblings: Array<{ seg: string; child: SegmentNode }> = [];
  forEachStaticChild(node, (seg, child) => { siblings.push({ seg, child }); });
  if (siblings.length === 0) return '';

  if (siblings.length >= STATIC_CHILD_DISPATCH_THRESHOLD) {
    return emitStaticChildrenSwitch(ctx, siblings, posVar, innerPos);
  }

  let code = '';
  for (const { seg, child } of siblings) {
    if (ctx.bail) return '';
    code += emitStaticChildBlock(ctx, seg, child, posVar, innerPos);
    if (ctx.bail) return '';
  }
  return code;
}

/** Emit `switch (url.charCodeAt(pos)) { case <c>: …; break; … }`. Siblings
 *  sharing a first char are grouped into a single case so the inner blocks
 *  still chain `startsWith` for disambiguation (rare — e.g. `commits` vs
 *  `contents` under the same `:repo`). */
function emitStaticChildrenSwitch(
  ctx: EmitContext,
  siblings: ReadonlyArray<{ seg: string; child: SegmentNode }>,
  posVar: string,
  innerPos: string,
): string {
  const byFirstChar = new Map<number, Array<{ seg: string; child: SegmentNode }>>();
  for (const s of siblings) {
    const code = s.seg.charCodeAt(0);
    let bucket = byFirstChar.get(code);
    if (bucket === undefined) { bucket = []; byFirstChar.set(code, bucket); }
    bucket.push(s);
  }

  let body = '';
  for (const [charCode, bucket] of byFirstChar) {
    let inner = '';
    for (const { seg, child } of bucket) {
      inner += emitStaticChildBlock(ctx, seg, child, posVar, innerPos);
      if (ctx.bail) return '';
    }
    body += `
      case ${charCode}: {${inner}
        break;
      }`;
  }

  return `
    switch (url.charCodeAt(${posVar})) {${body}
    }`;
}

/** Emit the per-sibling `if (startsWith) { … }` block shared by both
 *  the chain and the switch paths. */
function emitStaticChildBlock(
  ctx: EmitContext,
  seg: string,
  child: SegmentNode,
  posVar: string,
  innerPos: string,
): string {
  const segLen = seg.length;
  const nextPos = `${innerPos}_s${seg.replace(/[^a-z0-9]/gi, '_')}`;
  const childInner = emitNode(ctx, child, nextPos);
  if (ctx.bail) return '';
  return `
    if (url.startsWith(${JSON.stringify(seg)}, ${posVar})) {
      var c = url.charCodeAt(${posVar} + ${segLen});
      if (c === 47) { // '/'
        var ${nextPos} = ${posVar} + ${segLen} + 1;
${childInner}
      } else if (c !== c) { // NaN — past end-of-string → terminal
${emitTerminalAt(child)}
      }
    }`;
}

/** Emit param-segment dispatch: scan to next `/`, then either the
 *  strict-terminal fast path, the wildcard-terminal fast path, or the
 *  general descent into `param.next`. Bails if param has siblings
 *  (codegen only handles single-param positions; ambiguous fall through
 *  to the recursive walker). */
export function emitParamBranch(
  ctx: EmitContext,
  param: NonNullable<SegmentNode['paramChild']>,
  posVar: string,
  slashVar: string,
  innerPos: string,
): string {
  if (param.nextSibling !== null) {
    ctx.bail = true;
    return '';
  }

  const next = param.next;
  const nextHasNoStatic = !hasAnyStaticChild(next);
  const strictTerminal = nextHasNoStatic && next.paramChild === null && next.wildcardStore === null && next.store !== null;
  const wildcardTerminal = nextHasNoStatic && next.paramChild === null && next.wildcardStore !== null;
  const testerIdx = param.tester !== null ? ctx.testers.push(param.tester) - 1 : -1;

  // charCodeAt scan beats `indexOf('/', pos)` on short HTTP paths (the
  // common case); see bench/method-research/P-indexof-vs-charcode.bench.ts.
  // The walker uses the same shape — keep emitter aligned. The "no slash
  // found" sentinel is `len` here (matches what the walker emits) instead
  // of `-1`, but we keep `-1` to preserve the wildcardTerminal branch's
  // existing arithmetic guards.
  let code = `
    var ${slashVar} = ${posVar};
    while (${slashVar} < len && url.charCodeAt(${slashVar}) !== 47) ${slashVar}++;
    if (${slashVar} === len) ${slashVar} = -1;`;

  const testerCheck = emitTesterCheck(testerIdx, posVar, slashVar);

  if (strictTerminal) {
    code += emitStrictTerminal(posVar, slashVar, testerCheck, next.store!);
    return code;
  }
  if (wildcardTerminal && next.wildcardOrigin === 'multi') {
    code += emitMultiWildcardTerminal(posVar, slashVar, testerCheck, next.wildcardStore!);
    return code;
  }

  const inner = emitNode(ctx, next, innerPos);
  if (ctx.bail) return '';

  code += `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar}) {
      ${testerCheck}
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = ${slashVar};
      state.paramCount++;
      var ${innerPos} = ${slashVar} + 1;
${inner}
    }`;

  if (next.store !== null) {
    code += emitStrictTerminal(posVar, slashVar, testerCheck, next.store);
  }
  return code;
}

export function emitTesterCheck(testerIdx: number, posVar: string, slashVar: string): string {
  if (testerIdx === -1) return '';
  return `
      if (testers[${testerIdx}](decoder(url.substring(${posVar}, ${slashVar} === -1 ? len : ${slashVar}))) !== TESTER_PASS) return false;`;
}

export function emitStrictTerminal(
  posVar: string,
  slashVar: string,
  testerCheck: string,
  storeIdx: number,
): string {
  return `
    if (${slashVar} === -1 && ${posVar} < len) {
      ${testerCheck}
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = ${storeIdx};
      return true;
    }`;
}

export function emitMultiWildcardTerminal(
  posVar: string,
  slashVar: string,
  testerCheck: string,
  wildcardStoreIdx: number,
): string {
  return `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar} && ${slashVar} + 1 < len) {
      ${testerCheck}
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = ${slashVar};
      state.paramOffsets[pc + 2] = ${slashVar} + 1;
      state.paramOffsets[pc + 3] = len;
      state.paramCount += 2;
      state.handlerIndex = ${wildcardStoreIdx};
      return true;
    }`;
}

export function emitWildcardStore(node: SegmentNode, posVar: string): string {
  const guard = node.wildcardOrigin === 'star' ? `${posVar} <= len` : `${posVar} < len`;
  return `
    if (${guard}) {
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = ${node.wildcardStore};
      return true;
    }`;
}

function emitTerminalAt(node: SegmentNode): string {
  if (node.store !== null) {
    return `        state.handlerIndex = ${node.store};\n        return true;`;
  }

  if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
    return `        var pc = state.paramCount * 2;\n        state.paramOffsets[pc] = url.length;\n        state.paramOffsets[pc + 1] = url.length;\n        state.paramCount++;\n        state.handlerIndex = ${node.wildcardStore};\n        return true;`;
  }

  return '';
}
