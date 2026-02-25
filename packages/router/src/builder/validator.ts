import type { Result } from '@zipbul/result';
import type { RouterErrData } from '../types';
import type { Node } from './node';
import type { BuilderConfig } from './types';
import type { PatternUtils } from './pattern-utils';

import { err, isErr } from '@zipbul/result';
import { MAX_PARAMS } from '../matcher/constants';
import { assessRegexSafety } from './regex-safety';

export class RouteValidator {
  private readonly globalParamNames = new Set<string>();
  private readonly config: BuilderConfig;
  private readonly patternUtils: PatternUtils;

  constructor(config: BuilderConfig, patternUtils: PatternUtils) {
    this.config = config;
    this.patternUtils = patternUtils;
  }

  findMatchingParamChild(node: Node, name: string, patternSrc?: string): Node | undefined {
    return node.paramChildren.find(c => c.segment === name && (c.pattern?.source ?? undefined) === (patternSrc ?? undefined));
  }

  ensureNoParamConflict(
    node: Node,
    name: string,
    patternSrc: string | undefined,
    segments: string[],
    index: number,
  ): Result<void, RouterErrData> {
    const dup = node.paramChildren.find(c => c.segment === name && (c.pattern?.source ?? '') !== (patternSrc ?? ''));

    if (dup) {
      const existingPat = dup.patternSource ? `{${dup.patternSource}}` : '(no regex)';
      const incomingPat = patternSrc ? `{${patternSrc}}` : '(no regex)';

      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: parameter ':${name}' with different regex already exists at '${this.getPathString(segments, index)}'`,
        segment: `:${name}${incomingPat}`,
        conflictsWith: `:${name}${existingPat}`,
        suggestion: `Use the same regex pattern for ':${name}' across all routes at this path position`,
      });
    }

    if (node.wildcardChild) {
      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: adding parameter ':${name}' under existing wildcard at '${this.getPathString(segments, index)}'`,
        segment: `:${name}`,
        conflictsWith: node.wildcardChild.segment,
        suggestion: `Remove the wildcard route at this position, or use a different path prefix for the parameter ':${name}'`,
      });
    }
  }

  applyParamRegex(node: Node, patternSrc: string): Result<void, RouterErrData> {
    const normalizeResult = this.patternUtils.normalizeParamPatternSource(patternSrc);

    if (isErr(normalizeResult)) {
      return normalizeResult;
    }

    const normalizedPattern = normalizeResult;

    const safetyResult = this.ensureRegexSafe(normalizedPattern);

    if (isErr(safetyResult)) {
      return safetyResult;
    }

    const patternFlags = '';
    const compiledPattern = this.patternUtils.acquireCompiledPattern(normalizedPattern, patternFlags);

    node.pattern = compiledPattern;
    node.patternSource = normalizedPattern;
  }

  registerParamScope(name: string, activeParams: Set<string>, segments: string[]): Result<() => void, RouterErrData> {
    if (activeParams.has(name)) {
      return err<RouterErrData>({
        kind: 'param-duplicate',
        message: `Duplicate parameter name ':${name}' detected in path: /${segments.join('/')}`,
        segment: name,
      });
    }

    if (activeParams.size >= MAX_PARAMS) {
      return err<RouterErrData>({
        kind: 'param-duplicate',
        message: `Route path exceeds maximum of ${MAX_PARAMS} parameters (got ${activeParams.size + 1}) in path: /${segments.join('/')}`,
        segment: name,
        suggestion: `Reduce the number of parameters to ${MAX_PARAMS} or fewer.`,
      });
    }

    activeParams.add(name);

    return () => activeParams.delete(name);
  }

  registerGlobalParamName(name: string): void {
    this.globalParamNames.add(name);
  }

  ensureRegexSafe(patternSrc: string): Result<void, RouterErrData> {
    const safety = this.config.regexSafety;

    if (safety === undefined) {
      return;
    }

    const result = assessRegexSafety(patternSrc, {
      maxLength: safety.maxLength ?? 250,
      forbidBacktrackingTokens: safety.forbidBacktrackingTokens ?? true,
      forbidBackreferences: safety.forbidBackreferences ?? true,
    });

    if (!result.safe) {
      const msg = `Unsafe route regex '${patternSrc}' (${result.reason})`;

      if (safety.mode === 'warn') {
        this.config.onWarn?.({ kind: 'regex-unsafe', message: msg, segment: patternSrc });
      } else {
        return err<RouterErrData>({
          kind: 'regex-unsafe',
          message: msg,
          segment: patternSrc,
          suggestion: `Simplify the regex to avoid catastrophic backtracking, or set regexSafety.mode: 'warn'`,
        });
      }
    }

    safety.validator?.(patternSrc);
  }

  getPathString(segments: string[], index: number): string {
    return segments.slice(0, index).join('/') || '/';
  }
}
