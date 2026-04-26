import type { SegmentNode } from './segment-tree';
import type { RadixMatchFn } from './radix-matcher';

/**
 * Compile a segment tree into a flat match function via `new Function()`.
 *
 * Strategy: emit straight-line code per route, using `url.startsWith` for
 * static segments and inline `indexOf`/`substring` for param capture.
 * Trailing-slash discipline matches the iterative walker: a param at a node
 * with a `.next.store` only matches when `indexOf('/', pos)` returns -1
 * (strict terminal) — a real slash means the URL has more content the route
 * doesn't expect.
 *
 * Bails (returns null) for tree shapes outside our subset:
 *   - Ambiguous nodes (static + paramChild/wildcard at same position with
 *     potential collision) — needs backtracking we don't generate
 *   - ParamNode chains with .next continuations holding param siblings
 *   - Source size > MAX_SOURCE chars (JIT tier-up regression risk)
 *
 * Caller MUST set `state.params = Object.create(null)` before invoking.
 */

const MAX_SOURCE = 8000;

export function compileSegmentTree(
  root: SegmentNode,
  decodeParams: boolean,
): RadixMatchFn | null {
  // Empirically (this host, JSC), wide fanout regresses even with the
  // charCode-switch dispatch path because the iterative walker's O(1)
  // Map.get on `staticChildren[seg]` outperforms a switch+startsWith chain.
  // Cap at 2 — small static-only branches still benefit from codegen.
  if (hasWideFanout(root, 2)) return null;

  const ctx: Ctx = {
    counter: 0,
    bail: false,
    testers: [],
    decodeParams,
  };

  const body = emitNode(ctx, root, 'pos0', 0);

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
  var params = state.params;
  var pos0 = 1;
${body}
  return false;
};`;

  if (source.length > MAX_SOURCE) return null;

  try {
    const factory = new Function('testers', source) as (
      testers: unknown[],
    ) => RadixMatchFn;

    return factory(ctx.testers);
  } catch {
    return null;
  }
}

interface Ctx {
  counter: number;
  bail: boolean;
  testers: unknown[];
  decodeParams: boolean;
}

function hasWideFanout(root: SegmentNode, max: number): boolean {
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (node.staticChildren !== null) {
      let count = 0;

      for (const k in node.staticChildren) {
        count++;
        stack.push(node.staticChildren[k]!);
      }

      if (count > max) return true;
    }

    if (node.paramChild !== null) stack.push(node.paramChild.next);
  }

  return false;
}

function fresh(ctx: Ctx, name: string): string {
  ctx.counter++;

  return `${name}${ctx.counter}`;
}

function emitRootSlashTerminal(root: SegmentNode): string {
  if (root.store !== null) {
    return `      state.handlerIndex = ${root.store};\n      return true;`;
  }

  return '      return false;';
}

/**
 * Emit code that matches `node` starting at byte position `posVar`. On success,
 * the emitted code commits state.handlerIndex and `return true`. On failure,
 * falls through to the caller (which may try another sibling).
 *
 * `justAfterSlash` indicates whether `posVar` is positioned immediately after
 * a separator '/' that the caller just consumed. In that context, an "URL
 * ends here" match against a bare-store node would actually be matching a
 * trailing-slash URL onto a route that does NOT have a trailing slash — which
 * is a semantic mismatch when `ignoreTrailingSlash=false` (when the option is
 * true, the outer matchImpl trimmed the slash before invoking the walker, so
 * `posVar === len` here genuinely means end-of-URL). To stay correct under
 * BOTH option settings, we skip the bare-store check at slash-boundary
 * positions; star-wildcard children at the same node still match (their emit
 * handles the empty-capture case explicitly).
 */
function emitNode(ctx: Ctx, node: SegmentNode, posVar: string, depth: number, justAfterSlash = false): string {
  if (ctx.bail) return '';

  // Defensive bail for any ambiguity that can require backtracking.
  if (node.staticChildren !== null && node.paramChild !== null) {
    ctx.bail = true;

    return '';
  }

  let code = '';

  // Terminal store at exact end of URL. Suppressed when we just crossed a
  // slash boundary — that "end" would be a trailing-slash position, which
  // shouldn't match a route ending at a non-slash terminal.
  if (node.store !== null && !justAfterSlash) {
    code += `
  if (${posVar} === len) {
    state.handlerIndex = ${node.store};
    return true;
  }`;
  }

  // Static descents — group by first char, dispatch via switch when >2.
  // JSC compiles a numeric switch with consecutive-ish cases into a jump
  // table; sequential startsWith probes scale O(N) past 2 children.
  if (node.staticChildren !== null) {
    const keys = Object.keys(node.staticChildren);

    if (keys.length > 2) {
      // Group keys by their first charCode for switch dispatch.
      const groups = new Map<number, string[]>();

      for (const key of keys) {
        const ch = key.charCodeAt(0);
        const list = groups.get(ch);

        if (list === undefined) groups.set(ch, [key]);
        else list.push(key);
      }

      code += `
  if (${posVar} < len) switch (url.charCodeAt(${posVar})) {`;

      for (const [ch, group] of groups) {
        code += `
    case ${ch}: {`;

        for (const key of group) {
          const child = node.staticChildren[key]!;
          const prefixWithSlash = key + '/';
          const childPos = fresh(ctx, 'pos');
          // Just consumed `key + '/'` — recurse into child in slash-boundary
          // context so a bare-store at child won't match trailing-slash URLs.
          const inner = emitNode(ctx, child, childPos, depth + 1, true);

          if (ctx.bail) return '';

          code += `
      if (url.startsWith(${JSON.stringify(prefixWithSlash)}, ${posVar})) {
        var ${childPos} = ${posVar} + ${prefixWithSlash.length};
${inner}
      }`;

          const exactBody = emitTerminalAt(child);

          if (exactBody !== '') {
            code += `
      if (len === ${posVar} + ${key.length} && url.startsWith(${JSON.stringify(key)}, ${posVar})) {
${exactBody}
      }`;
          }
        }

        code += `
      break;
    }`;
      }

      code += `
  }`;
    } else {
      // Few children — direct startsWith probes are fine.
      for (const key of keys) {
        const child = node.staticChildren[key]!;
        const prefixWithSlash = key + '/';
        const childPos = fresh(ctx, 'pos');
        // Slash-boundary context after consuming `key + '/'` (see emitNode doc).
        const inner = emitNode(ctx, child, childPos, depth + 1, true);

        if (ctx.bail) return '';

        code += `
  if (url.startsWith(${JSON.stringify(prefixWithSlash)}, ${posVar})) {
    var ${childPos} = ${posVar} + ${prefixWithSlash.length};
${inner}
  }`;

        const exactBody = emitTerminalAt(child);

        if (exactBody !== '') {
          code += `
  if (len === ${posVar} + ${key.length} && url.startsWith(${JSON.stringify(key)}, ${posVar})) {
${exactBody}
  }`;
        }
      }
    }
  }

  // Param child — single per position, no .next siblings supported here.
  if (node.paramChild !== null) {
    const param = node.paramChild;
    const next = param.next;
    const slashVar = fresh(ctx, 'slash');
    const valVar = fresh(ctx, 'val');
    const innerPos = fresh(ctx, 'pos');

    // Strict terminal: route ends at this param. Only match when no further '/'.
    const strictTerminal = next.store !== null
      && next.staticChildren === null
      && next.paramChild === null
      && next.wildcardStore === null;

    // Strict wildcard at next: route is /:param/*x.
    const wildcardTerminal = next.wildcardStore !== null
      && next.store === null
      && next.staticChildren === null
      && next.paramChild === null;

    let testerIdx = -1;

    if (param.tester !== null) {
      ctx.testers.push(param.tester);
      testerIdx = ctx.testers.length - 1;
    }

    code += `
  {
    var ${slashVar} = url.indexOf('/', ${posVar});`;

    if (strictTerminal) {
      // Match only when no further slash AND there's a value to capture.
      code += `
    if (${slashVar} === -1 && ${posVar} < len) {
      var ${valVar} = url.substring(${posVar});${decodeBlock(ctx, valVar)}${testerBlock(ctx, valVar, testerIdx, '          ')}
      params[${JSON.stringify(param.name)}] = ${valVar};
      state.handlerIndex = ${next.store};
      return true;
    }`;
    } else if (wildcardTerminal && next.wildcardOrigin === 'multi') {
      // /:param/*x where x is multi (1+ segments)
      code += `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar} && ${slashVar} + 1 < len) {
      var ${valVar} = url.substring(${posVar}, ${slashVar});${decodeBlock(ctx, valVar)}${testerBlock(ctx, valVar, testerIdx, '          ')}
      params[${JSON.stringify(param.name)}] = ${valVar};
      params[${JSON.stringify(next.wildcardName!)}] = url.substring(${slashVar} + 1);
      state.handlerIndex = ${next.wildcardStore};
      return true;
    }`;
    } else {
      // Generic continuation: capture value up to the slash, advance past it,
      // recurse into next. innerPos sits at slash+1 — same slash-boundary
      // context as a static descent — so bare-store at `next` must not fire
      // for a trailing-slash URL (covered by the justAfterSlash flag).
      const inner = emitNode(ctx, next, innerPos, depth + 1, true);

      if (ctx.bail) return '';

      // Codegen only handles non-ambiguous trees (we bail on staticChildren +
      // paramChild collision), so no backtracking can pollute params. Failed
      // branches simply return false from the generated function. We commit
      // the param value optimistically — never need to restore.
      code += `
    if (${slashVar} !== -1 && ${slashVar} > ${posVar}) {
      var ${valVar} = url.substring(${posVar}, ${slashVar});${decodeBlock(ctx, valVar)}${testerBlock(ctx, valVar, testerIdx, '        ')}
      var ${innerPos} = ${slashVar} + 1;
      params[${JSON.stringify(param.name)}] = ${valVar};
${inner}
    }`;

      // Also handle case where slash === -1 but next node has its own store.
      if (next.store !== null) {
        code += `
    if (${slashVar} === -1 && ${posVar} < len) {
      var ${valVar}_t = url.substring(${posVar});${decodeBlock(ctx, valVar + '_t')}${testerBlock(ctx, valVar + '_t', testerIdx, '          ')}
      params[${JSON.stringify(param.name)}] = ${valVar}_t;
      state.handlerIndex = ${next.store};
      return true;
    }`;
      }
    }

    code += `
  }`;
  }

  // Wildcard at this position (the node itself is a wildcard host)
  if (node.wildcardStore !== null) {
    if (node.wildcardOrigin === 'star') {
      code += `
  if (${posVar} <= len) {
    state.params[${JSON.stringify(node.wildcardName!)}] = ${posVar} === len ? '' : url.substring(${posVar});
    state.handlerIndex = ${node.wildcardStore};
    return true;
  }`;
    } else {
      // multi: must have at least one char of suffix
      code += `
  if (${posVar} < len) {
    state.params[${JSON.stringify(node.wildcardName!)}] = url.substring(${posVar});
    state.handlerIndex = ${node.wildcardStore};
    return true;
  }`;
    }
  }

  return code;
}

function decodeBlock(ctx: Ctx, valVar: string): string {
  if (!ctx.decodeParams) return '';

  return `
        if (${valVar}.indexOf('%') !== -1) { try { ${valVar} = decodeURIComponent(${valVar}); } catch (_e) {} }`;
}

function testerBlock(ctx: Ctx, valVar: string, testerIdx: number, _indent: string): string {
  if (testerIdx < 0) return '';

  ctx.counter++;

  const r = `tr_${ctx.counter}`;

  return `
        var ${r} = testers[${testerIdx}](${valVar});
        if (${r} === 2) { state.errorKind = 'regex-timeout'; state.errorMessage = 'Route parameter regex exceeded time limit'; return false; }
        if (${r} !== 1) break;`;
}

function emitTerminalAt(node: SegmentNode): string {
  if (node.store !== null) {
    return `    state.handlerIndex = ${node.store};\n    return true;`;
  }

  if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
    return `    state.params[${JSON.stringify(node.wildcardName!)}] = '';\n    state.handlerIndex = ${node.wildcardStore};\n    return true;`;
  }

  return '';
}
