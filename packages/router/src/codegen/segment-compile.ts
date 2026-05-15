import type { SegmentNode } from '../matcher/segment-tree';
import type { MatchFn } from '../matcher/match-state';
import { forEachStaticChild, hasAnyStaticChild } from '../matcher/segment-tree';
import { hasAmbiguousNode } from '../matcher/segment-tree-traversal';

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
  factory: (testers: any[], pass: any, decoder: any) => MatchFn;
  testers: any[];
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
    const factory = new Function('testers', 'TESTER_PASS', 'decoder', source) as any;
    return { factory, testers: ctx.testers };
  } catch {
    return null;
  }
}

interface EmitContext {
  bail: boolean;
  testers: any[];
}

function emitRootSlashTerminal(root: SegmentNode): string {
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
  let code = '';

  // posVar is always 'pos0' at the entry point or `pos${N}` / `pos${N}_s…`
  // from the recursive emitNode calls below, so slice(3).split('_')[0] is
  // always a non-empty digit string. The `?? '0'` fallback the earlier
  // version carried was unreachable.
  const posDigits = posVar.slice(3).split('_')[0]!;
  const slashVar = `s${posDigits}`;
  const innerPos = `pos${parseInt(posDigits) + 1}`;

  // 1. Static children — iterate the inline cache and the Record uniformly.
  forEachStaticChild(node, (seg, child) => {
    const segLen = seg.length;
    const nextPos = `${innerPos}_s${seg.replace(/[^a-z0-9]/gi, '_')}`;

    code += `
    if (url.startsWith(${JSON.stringify(seg)}, ${posVar})) {
      var c = url.charCodeAt(${posVar} + ${segLen});
      if (c === 47) { // '/'
        var ${nextPos} = ${posVar} + ${segLen} + 1;
${emitNode(ctx, child, nextPos)}
      } else if (c !== c) { // NaN — past end-of-string → terminal
${emitTerminalAt(child)}
      }
    }`;
  });

  // 2. Param child
  const param = node.paramChild;
  if (param !== null) {
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
    code += `
    var ${slashVar} = ${posVar};
    while (${slashVar} < len && url.charCodeAt(${slashVar}) !== 47) ${slashVar}++;
    if (${slashVar} === len) ${slashVar} = -1;`;

    const testerCheck = testerIdx === -1 ? '' : `
      if (testers[${testerIdx}](decoder(url.substring(${posVar}, ${slashVar} === -1 ? len : ${slashVar}))) !== TESTER_PASS) return false;`;

    if (strictTerminal) {
      code += `
    if (${slashVar} === -1 && ${posVar} < len) {
      ${testerCheck}
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = ${next.store};
      return true;
    }`;
    } else if (wildcardTerminal && next.wildcardOrigin === 'multi') {
      code += `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar} && ${slashVar} + 1 < len) {
      ${testerCheck}
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = ${slashVar};
      state.paramOffsets[pc + 2] = ${slashVar} + 1;
      state.paramOffsets[pc + 3] = len;
      state.paramCount += 2;
      state.handlerIndex = ${next.wildcardStore};
      return true;
    }`;
    } else {
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
        code += `
    if (${slashVar} === -1 && ${posVar} < len) {
      ${testerCheck}
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = ${next.store};
      return true;
    }`;
      }
    }
  }

  // 3. Wildcard Store
  if (node.wildcardStore !== null) {
    if (node.wildcardOrigin === 'star') {
      code += `
    if (${posVar} <= len) {
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = ${node.wildcardStore};
      return true;
    }`;
    } else {
      code += `
    if (${posVar} < len) {
      var pc = state.paramCount * 2;
      state.paramOffsets[pc] = ${posVar};
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = ${node.wildcardStore};
      return true;
    }`;
    }
  }

  return code;
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
