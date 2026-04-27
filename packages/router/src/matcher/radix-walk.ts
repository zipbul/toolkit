import type { PatternTesterFn } from '../types';
import type { RadixNode, ParamNode } from '../builder/radix-node';
import type { MatchState } from './match-state';
import type { DecoderFn } from '../processor/decoder';
import type { RadixMatchFn } from './radix-matcher';

import { TESTER_PASS, TESTER_TIMEOUT } from './pattern-tester';
import { compileRadixTree } from './radix-compile';

export function createRadixWalker(
  root: RadixNode,
  testers: Array<PatternTesterFn | undefined>,
  decoder: DecoderFn,
  decodeParams: boolean,
): RadixMatchFn {
  // Attempt JIT-compiled walker first — falls through to the interpreter on
  // unsupported tree shapes or `new Function()` failures (e.g. strict CSP).
  const compiled = compileRadixTree(root, testers, decoder, decodeParams);

  if (compiled !== null) return compiled;

  // Specialize decode strategy at build time to eliminate branches in the hot loop.
  // decoder() already short-circuits on no-% — outer gate is dead overhead
  // (~6%, bench/percent-gate.bench.ts).
  const decode: (raw: string) => string = decodeParams ? decoder : raw => raw;

  // When no route uses a regex pattern, dispatch to the simple walker that omits
  // the tester branch, errorKind propagation, and related overhead.
  if (testers.length === 0) {
    return createSimpleWalker(root, decode);
  }

  return createFullWalker(root, testers, decode);
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple walker — no regex testers, no errorKind channel
// ─────────────────────────────────────────────────────────────────────────────

function createSimpleWalker(
  root: RadixNode,
  decode: (raw: string) => string,
): RadixMatchFn {
  function matchNode(
    initialNode: RadixNode,
    url: string,
    initialPos: number,
    state: MatchState,
  ): boolean {
    let node = initialNode;
    let pos = initialPos;
    let skipCount = 0;

    for (;;) {
      const label = node.part;
      const labelLen = label.length;

      if (labelLen > 0) {
        const end = pos + labelLen;

        if (end > url.length) {
          if (
            end === url.length + 1 &&
            label.charCodeAt(labelLen - 1) === 47 &&
            node.wildcardStore !== null &&
            node.wildcardOrigin === 'star'
          ) {
            for (let i = skipCount; i < labelLen - 1; i++) {
              if (url.charCodeAt(pos + i) !== label.charCodeAt(i)) return false;
            }

            state.paramNames[state.paramCount] = node.wildcardName!;
            state.paramValues[state.paramCount] = '';
            state.paramCount++;
            state.handlerIndex = node.wildcardStore;
            return true;
          }

          return false;
        }

        if (labelLen < 15) {
          for (let i = skipCount; i < labelLen; i++) {
            if (url.charCodeAt(pos + i) !== label.charCodeAt(i)) return false;
          }
        } else {
          if (url.substring(pos, end) !== label) return false;
        }

        pos = end;
      }

      if (pos === url.length) {
        if (node.store !== null) {
          state.handlerIndex = node.store;
          return true;
        }

        if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
          state.paramNames[state.paramCount] = node.wildcardName!;
          state.paramValues[state.paramCount] = '';
          state.paramCount++;
          state.handlerIndex = node.wildcardStore;
          return true;
        }

        return false;
      }

      if (node.inert !== null) {
        const ch = url.charCodeAt(pos);
        const child = node.inert[ch];

        if (child !== undefined) {
          if (node.params === null && node.wildcardStore === null) {
            node = child;
            skipCount = 1;
            continue;
          }

          if (matchNode(child, url, pos, state)) return true;
        }
      }

      if (node.params !== null) {
        if (matchParamsSimple(node.params, url, pos, state)) return true;
      }

      if (node.wildcardStore !== null) {
        const suffix = url.substring(pos);

        if (node.wildcardOrigin === 'multi' && suffix.length === 0) return false;

        state.paramNames[state.paramCount] = node.wildcardName!;
        state.paramValues[state.paramCount] = suffix;
        state.paramCount++;
        state.handlerIndex = node.wildcardStore;
        return true;
      }

      return false;
    }
  }

  function matchParamsSimple(
    paramHead: ParamNode,
    url: string,
    pos: number,
    state: MatchState,
  ): boolean {
    const slashIdx = url.indexOf('/', pos);
    const endIdx = slashIdx === -1 ? url.length : slashIdx;

    if (endIdx === pos) return false;

    // In simple mode, each ParamNode.next chain has at most one element (no
    // regex-differentiated alternatives). We still iterate defensively but
    // value computation is unconditional.
    let param: ParamNode | null = paramHead;

    while (param !== null) {
      const savedParamCount = state.paramCount;

      if (endIdx === url.length) {
        if (param.store !== null) {
          const value = decode(url.substring(pos, endIdx));

          state.paramNames[state.paramCount] = param.name;
          state.paramValues[state.paramCount] = value;
          state.paramCount++;
          state.handlerIndex = param.store;
          return true;
        }

        if (param.inert !== null) {
          if (matchNode(param.inert, url, endIdx, state)) {
            const value = decode(url.substring(pos, endIdx));

            state.paramNames[savedParamCount] = param.name;
            state.paramValues[savedParamCount] = value;
            state.paramCount++;
            return true;
          }

          state.paramCount = savedParamCount;
        }
      } else if (param.inert !== null) {
        if (matchNode(param.inert, url, endIdx, state)) {
          const value = decode(url.substring(pos, endIdx));

          for (let j = state.paramCount; j > savedParamCount; j--) {
            state.paramNames[j] = state.paramNames[j - 1]!;
            state.paramValues[j] = state.paramValues[j - 1]!;
          }

          state.paramNames[savedParamCount] = param.name;
          state.paramValues[savedParamCount] = value;
          state.paramCount++;
          return true;
        }

        state.paramCount = savedParamCount;
      }

      param = param.next;
    }

    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    return matchNode(root, url, 0, state);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full walker — regex testers + errorKind channel for timeout propagation
// ─────────────────────────────────────────────────────────────────────────────

function createFullWalker(
  root: RadixNode,
  testers: Array<PatternTesterFn | undefined>,
  decode: (raw: string) => string,
): RadixMatchFn {
  function matchNode(
    initialNode: RadixNode,
    url: string,
    initialPos: number,
    state: MatchState,
  ): boolean {
    let node = initialNode;
    let pos = initialPos;
    let skipCount = 0;

    for (;;) {
      const label = node.part;
      const labelLen = label.length;

      if (labelLen > 0) {
        const end = pos + labelLen;

        if (end > url.length) {
          if (
            end === url.length + 1 &&
            label.charCodeAt(labelLen - 1) === 47 &&
            node.wildcardStore !== null &&
            node.wildcardOrigin === 'star'
          ) {
            for (let i = skipCount; i < labelLen - 1; i++) {
              if (url.charCodeAt(pos + i) !== label.charCodeAt(i)) return false;
            }

            state.paramNames[state.paramCount] = node.wildcardName!;
            state.paramValues[state.paramCount] = '';
            state.paramCount++;
            state.handlerIndex = node.wildcardStore;
            return true;
          }

          return false;
        }

        if (labelLen < 15) {
          for (let i = skipCount; i < labelLen; i++) {
            if (url.charCodeAt(pos + i) !== label.charCodeAt(i)) return false;
          }
        } else {
          if (url.substring(pos, end) !== label) return false;
        }

        pos = end;
      }

      if (pos === url.length) {
        if (node.store !== null) {
          state.handlerIndex = node.store;
          return true;
        }

        if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
          state.paramNames[state.paramCount] = node.wildcardName!;
          state.paramValues[state.paramCount] = '';
          state.paramCount++;
          state.handlerIndex = node.wildcardStore;
          return true;
        }

        return false;
      }

      if (node.inert !== null) {
        const ch = url.charCodeAt(pos);
        const child = node.inert[ch];

        if (child !== undefined) {
          if (node.params === null && node.wildcardStore === null) {
            node = child;
            skipCount = 1;
            continue;
          }

          if (matchNode(child, url, pos, state)) return true;
          if (state.errorKind) return false;
        }
      }

      if (node.params !== null) {
        if (matchParams(node.params, url, pos, state)) return true;
        if (state.errorKind) return false;
      }

      if (node.wildcardStore !== null) {
        const suffix = url.substring(pos);

        if (node.wildcardOrigin === 'multi' && suffix.length === 0) return false;

        state.paramNames[state.paramCount] = node.wildcardName!;
        state.paramValues[state.paramCount] = suffix;
        state.paramCount++;
        state.handlerIndex = node.wildcardStore;
        return true;
      }

      return false;
    }
  }

  function matchParams(
    paramHead: ParamNode,
    url: string,
    pos: number,
    state: MatchState,
  ): boolean {
    const slashIdx = url.indexOf('/', pos);
    const endIdx = slashIdx === -1 ? url.length : slashIdx;

    if (endIdx === pos) return false;

    let param: ParamNode | null = paramHead;
    let testerIdx = 0;

    while (param !== null) {
      let value: string | undefined;

      if (param.pattern !== null) {
        value = decode(url.substring(pos, endIdx));

        const r = testers[testerIdx++]!(value);

        if (r === TESTER_TIMEOUT) {
          state.errorKind = 'regex-timeout';
          state.errorMessage = `Route parameter regex exceeded time limit`;
          return false;
        }

        if (r !== TESTER_PASS) {
          param = param.next;
          continue;
        }
      }

      const savedParamCount = state.paramCount;

      if (endIdx === url.length) {
        if (param.store !== null) {
          if (value === undefined) value = decode(url.substring(pos, endIdx));

          state.paramNames[state.paramCount] = param.name;
          state.paramValues[state.paramCount] = value;
          state.paramCount++;
          state.handlerIndex = param.store;
          return true;
        }

        if (param.inert !== null) {
          if (matchNode(param.inert, url, endIdx, state)) {
            if (value === undefined) value = decode(url.substring(pos, endIdx));

            state.paramNames[savedParamCount] = param.name;
            state.paramValues[savedParamCount] = value;
            state.paramCount++;
            return true;
          }

          if (state.errorKind) return false;
          state.paramCount = savedParamCount;
        }
      } else if (param.inert !== null) {
        if (matchNode(param.inert, url, endIdx, state)) {
          if (value === undefined) value = decode(url.substring(pos, endIdx));

          for (let j = state.paramCount; j > savedParamCount; j--) {
            state.paramNames[j] = state.paramNames[j - 1]!;
            state.paramValues[j] = state.paramValues[j - 1]!;
          }

          state.paramNames[savedParamCount] = param.name;
          state.paramValues[savedParamCount] = value;
          state.paramCount++;
          return true;
        }

        if (state.errorKind) return false;
        state.paramCount = savedParamCount;
      }

      param = param.next;
    }

    return false;
  }

  return function walk(url: string, state: MatchState): boolean {
    return matchNode(root, url, 0, state);
  };
}
