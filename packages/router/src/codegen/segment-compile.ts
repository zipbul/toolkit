import type { SegmentNode } from '../matcher/segment-tree';
import type { MatchFn } from '../matcher/match-state';
import { performance } from 'node:perf_hooks';
import { TESTER_PASS } from '../matcher/pattern-tester';
import { hasAmbiguousNode } from '../matcher/segment-tree';

/**
 * Source budget for the codegen specialist.
 */
const MAX_SOURCE = 8000;

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
  if (hasAmbiguousNode(root)) {
    logCodegen({ event: 'bail', reason: 'ambiguous-tree' });
    return null;
  }

  const start = performance.now();
  const ctx: EmitContext = {
    bail: false,
    testers: [],
  };

  const body = emitNode(ctx, root, 'pos0', false);

  if (ctx.bail) {
    logCodegen({ event: 'bail', reason: 'emitter-bail', emitMs: performance.now() - start });
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

  if (source.length > MAX_SOURCE) {
    logCodegen({
      event: 'bail',
      reason: 'source-budget',
      sourceLength: source.length,
      testers: ctx.testers.length,
      emitMs,
    });
    return null;
  }

  try {
    const compileStart = performance.now();
    const factory = new Function('testers', 'TESTER_PASS', 'decoder', source) as any;
    const compileMs = performance.now() - compileStart;
    logCodegen({
      event: 'compiled',
      sourceLength: source.length,
      testers: ctx.testers.length,
      emitMs,
      compileMs,
    });
    return { factory, testers: ctx.testers };
  } catch {
    logCodegen({
      event: 'bail',
      reason: 'new-function-error',
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
  justAfterSlash: boolean,
): string {
  let code = '';

  const slashVar = `s${posVar.slice(3).replace(/[^0-9]/g, '')}`;
  const innerPos = `pos${parseInt(posVar.slice(3).split('_')[0] ?? '0') + 1}`;

  // 1. Static children
  if (node.staticChildren !== null) {
    for (const seg in node.staticChildren) {
      const child = node.staticChildren[seg]!;
      const segLen = seg.length;
      const nextPos = `${innerPos}_s${seg.replace(/[^a-z0-9]/gi, '_')}`;

      code += `
    if (url.startsWith(${JSON.stringify(seg)}, ${posVar})) {
      var c = url.charCodeAt(${posVar} + ${segLen});
      if (c === 47) { // '/'
        var ${nextPos} = ${posVar} + ${segLen} + 1;
${emitNode(ctx, child, nextPos, true)}
      } else if (isNaN(c)) { // terminal
${emitTerminalAt(child)}
      }
    }`;
    }
  }

  // 2. Param child
  const param = node.paramChild;
  if (param !== null) {
    if (param.nextSibling !== null) {
      ctx.bail = true; 
      return '';
    }

    const next = param.next;
    const testerIdx = param.tester !== null ? ctx.testers.push(param.tester) - 1 : -1;
    const strictTerminal = next.staticChildren === null && next.paramChild === null && next.wildcardStore === null && next.store !== null;
    const wildcardTerminal = next.staticChildren === null && next.paramChild === null && next.wildcardStore !== null;

    code += `
    var ${slashVar} = url.indexOf('/', ${posVar});`;

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
      const inner = emitNode(ctx, next, innerPos, true);
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
