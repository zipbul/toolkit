import type { PatternTesterFn } from '../types';
import type { RadixNode, ParamNode } from '../builder/radix-node';
import type { DecoderFn } from '../processor/decoder';
import type { RadixMatchFn } from './radix-matcher';

/**
 * Compile a radix tree into a flat match function via `new Function()`.
 *
 * Control flow: every "try this alternative" is wrapped in a
 * `do { ... } while (false)` block. Miss = `break` (exit the block; the
 * caller falls through to the next alternative). Success = `return true`.
 * After optimistic param commits, code placed immediately *after* the inner
 * block rolls back state on fall-through.
 *
 * Returns `null` when the tree uses features outside the supported subset.
 *
 * Supported:
 *   - Static labels (any length)
 *   - Static inert branching (emitted as switch on charCode)
 *   - Single param per position (ParamNode.next must be null)
 *   - Regex param patterns (dispatched via closure-bound testers array)
 *   - Star and multi wildcards
 *
 * Unsupported (bails to null):
 *   - Multiple param alternatives (param.next !== null)
 */
export function compileRadixTree(
  root: RadixNode,
  testers: Array<PatternTesterFn | undefined>,
  decoder: DecoderFn,
  decodeParams: boolean,
): RadixMatchFn | null {
  const ctx: CompileCtx = {
    counter: 0,
    testerIdx: 0,
    bail: false,
    decodeParams,
  };

  const body = emitNode(ctx, root, 'pos0');

  if (ctx.bail) return null;

  // TESTER codes are inlined as numeric literals (1 = PASS, 2 = TIMEOUT) to
  // avoid an import from pattern-tester in the generated scope.
  // State arrays are hoisted to locals to skip per-access property reads in the
  // hot path; paramCount is tracked as a local and only written back to state
  // at terminal commits.
  const source = `
'use strict';
return function compiledWalk(url, state) {
  var len = url.length;
  var pos0 = 0;
  var pn = state.paramNames;
  var pv = state.paramValues;
${body}
  return false;
};
`;

  // Large generated bodies lose JIT tier-up in V8/JSC and run slower than the
  // interpreted walker. Empirically anything beyond ~6KB regresses on 60+ route
  // sets. Bail so the caller falls back to the interpreter.
  if (source.length > 6000) return null;

  try {
    const factory = new Function('testers', 'decode', source);
    const decodeFn: (raw: string) => string = decodeParams
      ? raw => {
        if (raw.indexOf('%') === -1) return raw;

        try {
          return decoder(raw);
        } catch {
          return raw;
        }
      }
      : raw => raw;

    return factory(testers, decodeFn) as RadixMatchFn;
  } catch {
    return null;
  }
}

interface CompileCtx {
  counter: number;
  testerIdx: number;
  bail: boolean;
  decodeParams: boolean;
}

/**
 * Inline the decode operation on a raw value expression. Avoids a closure
 * function-call per param when decoding is enabled; reduces to identity when
 * decoding is disabled.
 */
function inlineDecode(ctx: CompileCtx, rawExpr: string, rawVar: string): string {
  if (!ctx.decodeParams) return rawExpr;

  return `(${rawVar}.indexOf('%') === -1 ? ${rawVar} : decode(${rawVar}))`;
}

function fresh(ctx: CompileCtx, name: string): string {
  ctx.counter++;

  return `${name}${ctx.counter}`;
}

/**
 * Emit a code block that:
 *   - Reads current position from `posVar`
 *   - On full match: `return true`
 *   - On miss: `break` out of the enclosing `do { ... } while (false)` block
 *
 * The caller is responsible for wrapping the emitted body in a
 * `do { ... } while (false)` when branching is required.
 */
function emitNode(ctx: CompileCtx, node: RadixNode, posVar: string): string {
  if (ctx.bail) return '';

  let code = '';

  // ── Label match ──
  if (node.part.length > 0) {
    code += emitLabelMatch(node, posVar);
  }

  // ── Terminal on exact end ──
  if (node.store !== null) {
    code += `
  if (${posVar} === len) {
    state.handlerIndex = ${node.store};
    return true;
  }`;
  }

  // ── Star wildcard terminal (empty capture at end) ──
  if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
    code += `
  if (${posVar} === len) {
    pn[state.paramCount] = ${JSON.stringify(node.wildcardName!)};
    pv[state.paramCount] = '';
    state.paramCount++;
    state.handlerIndex = ${node.wildcardStore};
    return true;
  }`;
  }

  // ── Static inert children (switch on next charCode) ──
  if (node.inert !== null) {
    const entries: Array<[number, RadixNode]> = [];

    for (const key of Object.keys(node.inert)) {
      entries.push([Number(key), node.inert[Number(key)]!]);
    }

    if (entries.length > 0) {
      code += `
  if (${posVar} < len) {
    switch (url.charCodeAt(${posVar})) {`;

      for (const [ch, child] of entries) {
        const childPos = fresh(ctx, 'pos');
        const childBody = emitNode(ctx, child, childPos);

        if (ctx.bail) return '';

        code += `
      case ${ch}: do {
        var ${childPos} = ${posVar};
${childBody}
      } while (false); break;`;
      }

      code += `
    }
  }`;
    }
  }

  // ── Param child ──
  if (node.params !== null) {
    if (node.params.next !== null) {
      ctx.bail = true;

      return '';
    }

    code += emitParam(ctx, node.params, posVar);

    if (ctx.bail) return '';
  }

  // ── Wildcard (non-empty suffix) ──
  if (node.wildcardStore !== null) {
    const guard =
      node.wildcardOrigin === 'multi'
        ? `${posVar} < len`
        : `${posVar} <= len`;

    code += `
  if (${guard}) {
    pn[state.paramCount] = ${JSON.stringify(node.wildcardName!)};
    pv[state.paramCount] = url.substring(${posVar});
    state.paramCount++;
    state.handlerIndex = ${node.wildcardStore};
    return true;
  }`;
  }

  return code;
}

function emitLabelMatch(node: RadixNode, posVar: string): string {
  const label = node.part;
  const labelLen = label.length;

  // Trailing-slash + star-wildcard edge case: URL is label minus the '/'.
  let starEdge = '';

  if (
    label.charCodeAt(labelLen - 1) === 47 &&
    node.wildcardStore !== null &&
    node.wildcardOrigin === 'star'
  ) {
    const partialChecks: string[] = [];

    for (let i = 0; i < labelLen - 1; i++) {
      partialChecks.push(`url.charCodeAt(${posVar}+${i}) !== ${label.charCodeAt(i)}`);
    }

    const partial = partialChecks.length > 0 ? partialChecks.join(' || ') : 'false';

    starEdge = `
  if (${posVar} + ${labelLen} === len + 1) {
    if (!(${partial})) {
      pn[state.paramCount] = ${JSON.stringify(node.wildcardName!)};
      pv[state.paramCount] = '';
      state.paramCount++;
      state.handlerIndex = ${node.wildcardStore};
      return true;
    }
    break;
  }`;
  }

  // Build full-label char comparisons
  const checks: string[] = [];

  for (let i = 0; i < labelLen; i++) {
    checks.push(`url.charCodeAt(${posVar}+${i}) !== ${label.charCodeAt(i)}`);
  }

  return `
  if (${posVar} + ${labelLen} > len) {${starEdge}
    break;
  }
  if (${checks.join(' || ')}) break;
  ${posVar} += ${labelLen};`;
}

function emitParam(ctx: CompileCtx, param: ParamNode, posVar: string): string {
  const slashVar = fresh(ctx, 'slash');
  const endVar = fresh(ctx, 'end');
  const savedPC = fresh(ctx, 'savedPC');
  const testerIdx = param.pattern !== null ? ctx.testerIdx++ : -1;
  const valVar = param.pattern !== null ? fresh(ctx, 'val') : null;
  const rVar = param.pattern !== null ? fresh(ctx, 'r') : null;

  const rawVar = fresh(ctx, 'raw');

  let code = `
  do {
    var ${slashVar} = url.indexOf('/', ${posVar});
    var ${endVar} = ${slashVar} === -1 ? len : ${slashVar};
    if (${endVar} === ${posVar}) break;
    var ${rawVar} = url.substring(${posVar}, ${endVar});`;

  // Regex tester check (eager value extraction when pattern present)
  if (param.pattern !== null && valVar !== null && rVar !== null) {
    code += `
    var ${valVar} = ${inlineDecode(ctx, rawVar, rawVar)};
    var ${rVar} = testers[${testerIdx}](${valVar});
    if (${rVar} === 2) { state.errorKind = 'regex-timeout'; state.errorMessage = 'Route parameter regex exceeded time limit'; return false; }
    if (${rVar} !== 1) break;`;
  }

  const valueExpr = valVar !== null
    ? valVar
    : inlineDecode(ctx, rawVar, rawVar);

  code += `
    var ${savedPC} = state.paramCount;
    pn[${savedPC}] = ${JSON.stringify(param.name)};
    pv[${savedPC}] = ${valueExpr};
    state.paramCount = ${savedPC} + 1;`;

  // Terminal — commit handler, return
  if (param.store !== null) {
    code += `
    if (${endVar} === len) {
      state.handlerIndex = ${param.store};
      return true;
    }`;
  }

  // Continuation — recurse into inert subtree
  if (param.inert !== null) {
    const innerPos = fresh(ctx, 'pos');
    const innerBody = emitNode(ctx, param.inert, innerPos);

    if (ctx.bail) return '';

    code += `
    do {
      var ${innerPos} = ${endVar};
${innerBody}
    } while (false);`;
  }

  // Fell through → rollback
  code += `
    state.paramCount = ${savedPC};
  } while (false);`;

  return code;
}
