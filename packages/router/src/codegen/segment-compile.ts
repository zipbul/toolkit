import type { PatternTesterFn, SegmentNode } from '../tree';
import type { DecoderFn, MatchFn } from '../types';

import { TESTER_PASS, WildcardOrigin, forEachStaticChild, hasAmbiguousNode, hasAnyStaticChild } from '../tree';

const MAX_SOURCE_BYTES_HARD = 128 * 1024;
const MAX_NODES_DEFAULT = 256;

interface CodegenEstimate {
  nodes: number;
  oversized: boolean;
}

function estimateSegmentTreeCodegen(root: SegmentNode, nodeCap: number): CodegenEstimate {
  let nodes = 0;
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    if (nodes > nodeCap) {
      return { nodes, oversized: true };
    }
    const node = stack.pop()!;
    nodes++;
    forEachStaticChild(node, (_, child) => {
      stack.push(child);
    });
    let p = node.paramChild;
    while (p !== null) {
      stack.push(p.next);
      p = p.nextSibling;
    }
  }

  return { nodes, oversized: false };
}

function collectWarmupPaths(root: SegmentNode): string[] {
  const out: string[] = [];

  const firstStaticChild = (n: SegmentNode): { key: string; child: SegmentNode } | null => {
    if (n.singleChildKey !== null && n.singleChildNext !== null) {
      return { key: n.singleChildKey, child: n.singleChildNext };
    }
    if (n.staticChildren !== null) {
      for (const seg in n.staticChildren) {
        return { key: seg, child: n.staticChildren[seg]! };
      }
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

  if (out.length === 0) {
    out.push('/__zipbul_warmup__');
  }
  return out;
}

interface CompiledPackage {
  factory: (testers: PatternTesterFn[], pass: typeof TESTER_PASS, decoder: DecoderFn) => MatchFn;
  testers: PatternTesterFn[];
}

function compileSegmentTree(root: SegmentNode): CompiledPackage | null {
  if (hasAmbiguousNode(root)) {
    return null;
  }

  if (estimateSegmentTreeCodegen(root, MAX_NODES_DEFAULT).oversized) {
    return null;
  }

  const ctx: EmitContext = { bail: false, testers: [], pendingParams: [] };
  const body = emitNode(ctx, root, 'pos0');
  if (ctx.bail) {
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

  if (source.length > MAX_SOURCE_BYTES_HARD) {
    return null;
  }

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
  pendingParams: Array<readonly [string, string]>;
}

function emitFlushPendingWrites(
  pending: ReadonlyArray<readonly [string, string]>,
  extra: ReadonlyArray<readonly [string, string]> = [],
): string {
  let s = '';
  let i = 0;
  for (const [start, end] of pending) {
    s += `state.paramOffsets[${i * 2}] = ${start};\n`;
    s += `state.paramOffsets[${i * 2 + 1}] = ${end};\n`;
    i++;
  }
  for (const [start, end] of extra) {
    s += `state.paramOffsets[${i * 2}] = ${start};\n`;
    s += `state.paramOffsets[${i * 2 + 1}] = ${end};\n`;
    i++;
  }
  s += `state.paramCount = ${i};\n`;
  return s;
}

function emitRootSlashTerminal(root: SegmentNode): string {
  if (root.store !== null) {
    return `      state.handlerIndex = ${root.store};\n      return true;`;
  }

  if (root.wildcardStore !== null && root.wildcardOrigin === WildcardOrigin.Star) {
    return `      state.paramOffsets[0] = 1;\n      state.paramOffsets[1] = 1;\n      state.paramCount = 1;\n      state.handlerIndex = ${root.wildcardStore};\n      return true;`;
  }

  return '      return false;';
}

function emitNode(ctx: EmitContext, node: SegmentNode, posVar: string): string {
  const posDigits = posVar.slice(3).split('_')[0]!;
  const slashVar = `s${posDigits}`;
  const innerPos = `pos${parseInt(posDigits) + 1}`;

  let code = emitStaticChildren(ctx, node, posVar, innerPos);
  if (ctx.bail) {
    return '';
  }

  if (node.paramChild !== null) {
    code += emitParamBranch(ctx, node.paramChild, posVar, slashVar, innerPos);
    if (ctx.bail) {
      return '';
    }
  }

  if (node.wildcardStore !== null) {
    code += emitWildcardStore(ctx, node, posVar);
  }

  return code;
}

const STATIC_CHILD_DISPATCH_THRESHOLD = 4;

function emitStaticChildren(ctx: EmitContext, node: SegmentNode, posVar: string, innerPos: string): string {
  const siblings: Array<{ seg: string; child: SegmentNode }> = [];
  forEachStaticChild(node, (seg, child) => {
    siblings.push({ seg, child });
  });
  if (siblings.length === 0) {
    return '';
  }

  if (siblings.length >= STATIC_CHILD_DISPATCH_THRESHOLD) {
    return emitStaticChildrenSwitch(ctx, siblings, posVar, innerPos);
  }

  let code = '';
  for (const { seg, child } of siblings) {
    if (ctx.bail) {
      return '';
    }
    code += emitStaticChildBlock(ctx, seg, child, posVar, innerPos);
    if (ctx.bail) {
      return '';
    }
  }
  return code;
}

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
    if (bucket === undefined) {
      bucket = [];
      byFirstChar.set(code, bucket);
    }
    bucket.push(s);
  }

  let body = '';
  for (const [charCode, bucket] of byFirstChar) {
    let inner = '';
    for (const { seg, child } of bucket) {
      inner += emitStaticChildBlock(ctx, seg, child, posVar, innerPos);
      if (ctx.bail) {
        return '';
      }
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

function emitStaticChildBlock(ctx: EmitContext, seg: string, child: SegmentNode, posVar: string, innerPos: string): string {
  const segLen = seg.length;
  const nextPos = `${innerPos}_s${seg.replace(/[^a-z0-9]/gi, '_')}`;
  const childInner = emitNode(ctx, child, nextPos);
  if (ctx.bail) {
    return '';
  }
  return `
    if (url.startsWith(${JSON.stringify(seg)}, ${posVar})) {
      var c = url.charCodeAt(${posVar} + ${segLen});
      if (c === 47) { // '/'
        var ${nextPos} = ${posVar} + ${segLen} + 1;
${childInner}
      } else if (c !== c) { // NaN — past end-of-string → terminal
${emitTerminalAt(ctx, child)}
      }
    }`;
}

function emitParamBranch(
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

  let code = `
    var ${slashVar} = ${posVar};
    while (${slashVar} < len && url.charCodeAt(${slashVar}) !== 47) ${slashVar}++;
    if (${slashVar} === len) ${slashVar} = -1;`;

  const testerCheck = emitTesterCheck(testerIdx, posVar, slashVar);

  if (strictTerminal) {
    code += emitStrictTerminal(ctx, posVar, slashVar, testerCheck, next.store!);
    return code;
  }
  if (wildcardTerminal && next.wildcardOrigin === WildcardOrigin.Multi) {
    code += emitMultiWildcardTerminal(ctx, posVar, slashVar, testerCheck, next.wildcardStore!);
    return code;
  }

  ctx.pendingParams.push([posVar, slashVar] as const);
  const inner = emitNode(ctx, next, innerPos);
  ctx.pendingParams.pop();
  if (ctx.bail) {
    return '';
  }

  code += `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar}) {
      ${testerCheck}
      var ${innerPos} = ${slashVar} + 1;
${inner}
    }`;

  if (next.store !== null) {
    code += emitStrictTerminal(ctx, posVar, slashVar, testerCheck, next.store);
  }
  return code;
}

function emitTesterCheck(testerIdx: number, posVar: string, slashVar: string): string {
  if (testerIdx === -1) {
    return '';
  }
  return `
      if (testers[${testerIdx}](decoder(url.substring(${posVar}, ${slashVar} === -1 ? len : ${slashVar}))) !== TESTER_PASS) return false;`;
}

function emitStrictTerminal(ctx: EmitContext, posVar: string, slashVar: string, testerCheck: string, storeIdx: number): string {
  const flush = emitFlushPendingWrites(ctx.pendingParams, [[posVar, 'len']]);
  return `
    if (${slashVar} === -1 && ${posVar} < len) {
      ${testerCheck}
      ${flush}state.handlerIndex = ${storeIdx};
      return true;
    }`;
}

function emitMultiWildcardTerminal(
  ctx: EmitContext,
  posVar: string,
  slashVar: string,
  testerCheck: string,
  wildcardStoreIdx: number,
): string {
  const flush = emitFlushPendingWrites(ctx.pendingParams, [
    [posVar, slashVar],
    [`${slashVar} + 1`, 'len'],
  ]);
  return `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar} && ${slashVar} + 1 < len) {
      ${testerCheck}
      ${flush}state.handlerIndex = ${wildcardStoreIdx};
      return true;
    }`;
}

function emitWildcardStore(ctx: EmitContext, node: SegmentNode, posVar: string): string {
  const guard = node.wildcardOrigin === WildcardOrigin.Star ? `${posVar} <= len` : `${posVar} < len`;
  const flush = emitFlushPendingWrites(ctx.pendingParams, [[posVar, 'len']]);
  return `
    if (${guard}) {
      ${flush}state.handlerIndex = ${node.wildcardStore};
      return true;
    }`;
}

function emitTerminalAt(ctx: EmitContext, node: SegmentNode): string {
  if (node.store !== null) {
    const flush = emitFlushPendingWrites(ctx.pendingParams);
    return `        ${flush}state.handlerIndex = ${node.store};\n        return true;`;
  }

  if (node.wildcardStore !== null && node.wildcardOrigin === WildcardOrigin.Star) {
    const flush = emitFlushPendingWrites(ctx.pendingParams, [['url.length', 'url.length']]);
    return `        ${flush}state.handlerIndex = ${node.wildcardStore};\n        return true;`;
  }

  return '';
}

export {
  collectWarmupPaths,
  compileSegmentTree,
  emitMultiWildcardTerminal,
  emitRootSlashTerminal,
  emitStrictTerminal,
  emitTesterCheck,
  emitWildcardStore,
};
