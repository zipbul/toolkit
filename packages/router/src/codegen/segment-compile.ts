import type { SegmentNode } from '../matcher/segment-tree';
import type { MatchFn } from '../matcher/match-state';
import { performance } from 'node:perf_hooks';
import { forEachStaticChild, hasAmbiguousNode, hasAnyStaticChild } from '../matcher/segment-tree';
import {
  recordBail,
  recordCompile,
  recordEmitMs,
  shapeSignature,
  shouldSkipCodegen,
} from './codegen-telemetry';

/**
 * Codegen budget thresholds. Trees exceeding any of these fall back to the
 * iterative walker; the per-node estimate runs once before any source bytes
 * are concatenated.
 */
const MAX_SOURCE_BYTES_PREFERRED = 64 * 1024;
const MAX_SOURCE_BYTES_HARD = 128 * 1024;
const MAX_NODES_DEFAULT = 256;
const MAX_FANOUT = 64;
const APPROX_SOURCE_PER_NODE = 80;

interface CodegenEstimate {
  nodes: number;
  maxFanout: number;
  approxSourceBytes: number;
  testers: number;
  rejection: 'too-large' | 'too-fanout' | 'source-budget' | null;
}

function estimateSegmentTreeCodegen(
  root: SegmentNode,
  nodeCap: number,
): CodegenEstimate {
  let nodes = 0;
  let maxFanout = 0;
  let testers = 0;
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    if (nodes > nodeCap) {
      return {
        nodes,
        maxFanout,
        approxSourceBytes: nodes * APPROX_SOURCE_PER_NODE,
        testers,
        rejection: 'too-large',
      };
    }
    const node = stack.pop()!;
    nodes++;
    let fanoutHere = 0;
    forEachStaticChild(node, (_, child) => {
      stack.push(child);
      fanoutHere++;
    });
    let p = node.paramChild;
    while (p !== null) {
      stack.push(p.next);
      fanoutHere++;
      if (p.tester !== null) testers++;
      p = p.nextSibling;
    }
    if (node.wildcardStore !== null) fanoutHere++;
    if (fanoutHere > maxFanout) maxFanout = fanoutHere;
  }

  let rejection: CodegenEstimate['rejection'] = null;
  if (maxFanout > MAX_FANOUT) rejection = 'too-fanout';
  else if (nodes * APPROX_SOURCE_PER_NODE > MAX_SOURCE_BYTES_PREFERRED) rejection = 'source-budget';

  return {
    nodes,
    maxFanout,
    approxSourceBytes: nodes * APPROX_SOURCE_PER_NODE,
    testers,
    rejection,
  };
}

/**
 * Walk the segment tree once and return a small, deterministic set of paths
 * that exercise each major branch at the root. The set is used as warmup
 * input so JSC IC reaches tier-up across the dominant code paths instead of
 * a single one. Caller is responsible for cap-bounding the depth of each
 * synthesized path; this collector emits at most one per direct child of
 * the root and falls back to the synthetic placeholder for empty trees.
 */
export function collectWarmupPaths(root: SegmentNode, max = 8): string[] {
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
    if (out.length >= max) return prefix;
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
    if (out.length >= max) return;
    out.push(synthForNode(child, '/' + seg));
  });
  if (root.paramChild !== null && out.length < max) {
    out.push(synthForNode(root.paramChild.next, '/__warm__'));
  }
  if (root.wildcardStore !== null && out.length < max) {
    out.push('/__warm__/__warm__');
  }

  if (out.length === 0) out.push('/__zipbul_warmup__');
  return out;
}

export interface CompiledPackage {
  factory: (testers: any[], pass: any, decoder: any) => MatchFn;
  testers: any[];
  /** Shape signature recorded in the codegen telemetry registry. */
  shape: string;
}

/**
 * Compile a segment tree into a flat match function via `new Function()`.
 */
export function compileSegmentTree(root: SegmentNode): CompiledPackage | null {
  // Bail on ambiguous trees: codegen only handles unique-winner trees.
  // Ambiguous trees (static+param collision) fallback to recursive walker.
  if (hasAmbiguousNode(root)) {
    logCodegen({ event: 'bail', reason: 'ambiguous-tree' });
    return null;
  }

  const estimate = estimateSegmentTreeCodegen(root, MAX_NODES_DEFAULT);
  const shape = shapeSignature(estimate.nodes, estimate.maxFanout, estimate.testers);
  if (estimate.rejection !== null) {
    recordBail(shape, estimate.rejection);
    logCodegen({
      event: 'bail',
      reason: estimate.rejection,
      shape,
      nodes: estimate.nodes,
      maxFanout: estimate.maxFanout,
      approxSourceBytes: estimate.approxSourceBytes,
    });
    return null;
  }
  // Per-shape feedback: a previous build for a structurally identical tree
  // already exceeded the observed-compile budget. Skip codegen.
  if (shouldSkipCodegen(shape)) {
    recordBail(shape, 'prior-shape-disabled');
    logCodegen({
      event: 'bail',
      reason: 'prior-shape-disabled',
      shape,
      nodes: estimate.nodes,
    });
    return null;
  }

  const start = performance.now();
  const ctx: EmitContext = {
    bail: false,
    testers: [],
  };

  const body = emitNode(ctx, root, 'pos0');

  if (ctx.bail) {
    const dt = performance.now() - start;
    recordBail(shape, 'emitter-bail');
    recordEmitMs(dt);
    logCodegen({ event: 'bail', reason: 'emitter-bail', shape, emitMs: dt });
    return null;
  }

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

  const emitMs = performance.now() - start;
  recordEmitMs(emitMs);

  if (source.length > MAX_SOURCE_BYTES_HARD) {
    recordBail(shape, 'source-budget-hard');
    logCodegen({
      event: 'bail',
      reason: 'source-budget-hard',
      shape,
      sourceLength: source.length,
      testers: ctx.testers.length,
      emitMs,
    });
    return null;
  }
  if (source.length > MAX_SOURCE_BYTES_PREFERRED) {
    logCodegen({
      event: 'over-preferred',
      shape,
      sourceLength: source.length,
      testers: ctx.testers.length,
      emitMs,
    });
  }

  try {
    const compileStart = performance.now();
    const factory = new Function('testers', 'TESTER_PASS', 'decoder', source) as any;
    const compileMs = performance.now() - compileStart;
    recordCompile(shape, compileMs, source.length);
    logCodegen({
      event: 'compiled',
      shape,
      nodes: estimate.nodes,
      maxFanout: estimate.maxFanout,
      sourceLength: source.length,
      testers: ctx.testers.length,
      emitMs,
      compileMs,
    });
    return { factory, testers: ctx.testers, shape };
  } catch {
    recordBail(shape, 'new-function-error');
    logCodegen({
      event: 'bail',
      reason: 'new-function-error',
      shape,
      sourceLength: source.length,
      testers: ctx.testers.length,
      emitMs,
    });
    return null;
  }
}

function logCodegen(data: Record<string, unknown>): void {
  if (process.env.ZIPBUL_ROUTER_CODEGEN_DIAGNOSTICS === '1') {
    console.log(`codegen=${JSON.stringify(data)}`);
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

  const slashVar = `s${posVar.slice(3).replace(/[^0-9]/g, '')}`;
  const innerPos = `pos${parseInt(posVar.slice(3).split('_')[0] ?? '0') + 1}`;

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
