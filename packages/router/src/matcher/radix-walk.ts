import type { PatternTesterFn } from '../types';
import type { RadixNode, ParamNode } from '../builder/radix-node';
import type { MatchState } from './match-state';
import type { DecoderFn } from '../processor/decoder';
import type { RadixMatchFn } from './radix-matcher';

export function createRadixWalker(
  root: RadixNode,
  testers: Array<PatternTesterFn | undefined>,
  decoder: DecoderFn,
  decodeParams: boolean,
): RadixMatchFn {
  function decode(raw: string): string {
    return decodeParams && raw.indexOf('%') !== -1 ? decoder(raw) : raw;
  }

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

      // ── Match edge label ──
      if (labelLen > 0) {
        const end = pos + labelLen;

        if (end > url.length) {
          // Trailing-slash + star-wildcard edge case:
          // Label "/files/", URL "/files" (trailing slash stripped by preNormalize).
          // Match all chars except trailing '/', then yield empty wildcard.
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

      // ── Terminal check ──
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

      // ── Static children ──
      if (node.inert !== null) {
        const ch = url.charCodeAt(pos);
        const child = node.inert[ch];

        if (child !== undefined) {
          // Fast path: no params/wildcard → iterate (no backtracking needed)
          if (node.params === null && node.wildcardStore === null) {
            node = child;
            skipCount = 1;
            continue;
          }

          // Slow path: has alternatives → must recurse for backtracking
          if (matchNode(child, url, pos, state)) return true;
          if (state.errorKind) return false;
        }
      }

      // ── Param children ──
      if (node.params !== null) {
        if (matchParams(node.params, url, pos, state)) return true;
        if (state.errorKind) return false;
      }

      // ── Wildcard ──
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
      const tester = param.pattern !== null ? testers[testerIdx++] : undefined;
      let value: string | undefined;

      // Eager decode only when tester needs the value
      if (tester !== undefined) {
        value = decode(url.substring(pos, endIdx));

        try {
          if (!tester(value)) {
            param = param.next;
            continue;
          }
        } catch (e) {
          state.errorKind = 'regex-timeout';
          state.errorMessage = e instanceof Error ? e.message : String(e);
          return false;
        }
      }

      const savedParamCount = state.paramCount;

      if (endIdx === url.length) {
        // Terminal param
        if (param.store !== null) {
          if (value === undefined) value = decode(url.substring(pos, endIdx));

          state.paramNames[state.paramCount] = param.name;
          state.paramValues[state.paramCount] = value;
          state.paramCount++;
          state.handlerIndex = param.store;
          return true;
        }

        // Try continuation (e.g., wildcard child)
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
        // More URL to match — recurse into continuation
        if (matchNode(param.inert, url, endIdx, state)) {
          if (value === undefined) value = decode(url.substring(pos, endIdx));

          // Insert at saved position (before child params)
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

  // Entry point — returned as the RadixMatchFn
  return function walk(url: string, startIndex: number, state: MatchState): boolean {
    return matchNode(root, url, startIndex, state);
  };
}
