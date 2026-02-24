import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type { BinaryRouterLayout } from '../schema';
import type { RouterErrData } from '../types';
import type { BuilderConfig } from './types';

import { err, isErr } from '@zipbul/result';
import { NodeKind } from '../schema';
import { Flattener } from './flattener';
import { Node } from './node';
import { matchStaticParts, splitStaticChain, sortParamChildren } from './node-operations';
import { acquireNode } from './node-pool';
import { PatternUtils } from './pattern-utils';
import { assessRegexSafety } from './regex-safety';

export class Builder<T> {
  public root: Node;
  public readonly config: BuilderConfig;
  public readonly handlers: T[] = [];
  private readonly globalParamNames = new Set<string>();
  private readonly patternUtils: PatternUtils;

  constructor(config: BuilderConfig) {
    this.config = config;
    this.root = acquireNode(NodeKind.Static, '/');
    this.patternUtils = new PatternUtils(config);
  }

  add(method: HttpMethod, segments: string[], handler: T): Result<void, RouterErrData> {
    const handlerIndex = this.handlers.length;

    this.handlers.push(handler);

    return this.addSegments(this.root, 0, new Set<string>(), [], method, handlerIndex, segments);
  }

  build(): BinaryRouterLayout {
    return Flattener.flatten(this.root);
  }

  private addSegments(
    node: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): Result<void, RouterErrData> {
    if (index === segments.length) {
      return this.registerRoute(node, method, key, omittedOptionals, segments);
    }

    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    const charCode = segment.charCodeAt(0);

    if (charCode === 42) {
      return this.handleWildcard(node, index, activeParams, omittedOptionals, method, key, segments);
    }

    if (charCode === 58) {
      return this.handleParam(node, index, activeParams, omittedOptionals, method, key, segments);
    }

    return this.handleStatic(node, index, activeParams, omittedOptionals, method, key, segments);
  }

  private registerRoute(node: Node, method: HttpMethod, key: number, omittedOptionals: string[], segments: string[]): Result<void, RouterErrData> {
    if (node.methods.byMethod.has(method)) {
      return err<RouterErrData>({
        kind: 'route-duplicate',
        message: `Route already exists for ${method} at path: /${segments.join('/')}`,
      });
    }

    node.methods.byMethod.set(method, key);

    if (omittedOptionals.length && this.config.optionalParamDefaults) {
      this.config.optionalParamDefaults.record(key, omittedOptionals);
    }
  }

  private handleWildcard(
    node: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): Result<void, RouterErrData> {
    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    if (node.staticChildren.size || node.paramChildren.length) {
      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: adding wildcard '*' at '${this.getPathString(segments, index)}' would shadow existing routes`,
        segment: '*',
      });
    }

    if (index !== segments.length - 1) {
      return err<RouterErrData>({
        kind: 'route-parse',
        message: "Wildcard '*' must be the last segment",
        segment: '*',
      });
    }

    const name = segment.length > 1 ? segment.slice(1) : '*';

    if (node.wildcardChild) {
      const existing = node.wildcardChild;

      if (existing.wildcardOrigin !== 'star' || existing.segment !== name) {
        return err<RouterErrData>({
          kind: 'route-conflict',
          message: `Conflict: wildcard '${existing.segment}' already exists at '${this.getPathString(segments, index)}'`,
          segment: name,
          conflictsWith: existing.segment,
        });
      }
    } else {
      const globalResult = this.registerGlobalParamName(name);

      if (isErr(globalResult)) {
        return globalResult;
      }

      node.wildcardChild = acquireNode(NodeKind.Wildcard, name);
      node.wildcardChild.wildcardOrigin = 'star';
    }

    // Recurse (to register route)
    const releaseResult = this.registerParamScope(name, activeParams, segments);

    if (isErr(releaseResult)) {
      return releaseResult;
    }

    const result = this.addSegments(node.wildcardChild, index + 1, activeParams, omittedOptionals, method, key, segments);

    releaseResult();

    return result;
  }

  /**
   * Processes a Parameter segment (e.g., ":id", ":id?", ":file+").
   */
  private handleParam(
    node: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): Result<void, RouterErrData> {
    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    // Parse decorators (?, +, *)
    let core = segment;
    let isOptional = false;
    let isMulti = false;
    let isZeroOrMore = false;

    if (segment.endsWith('?')) {
      isOptional = true;
      core = segment.slice(0, -1);
    }

    if (core.endsWith('+')) {
      isMulti = true;
      core = core.slice(0, -1);
    }

    if (core.endsWith('*')) {
      isZeroOrMore = true;
      core = core.slice(0, -1);
    }

    // Extract Regex
    const braceIndex = core.indexOf('{');
    let name = '';
    let patternSrc: string | undefined;

    if (braceIndex === -1) {
      name = core.slice(1);
    } else {
      name = core.slice(1, braceIndex);

      if (!core.endsWith('}')) {
        return err<RouterErrData>({
          kind: 'route-parse',
          message: "Parameter regex must close with '}'",
          segment,
        });
      }

      patternSrc = core.slice(braceIndex + 1, -1) || undefined;
    }

    if (!name) {
      return err<RouterErrData>({
        kind: 'route-parse',
        message: "Parameter segment must have a name, eg ':id'",
        segment,
      });
    }

    // Validation
    if (isZeroOrMore && isOptional) {
      return err<RouterErrData>({
        kind: 'route-parse',
        message: `Parameter ':${name}*' already allows empty matches; do not combine '*' and '?' suffixes`,
        segment,
      });
    }

    // Handle Optional Branch (skip this parameter)
    if (isOptional) {
      const nextOmitted = omittedOptionals.length ? [...omittedOptionals, name] : [name];

      const optResult = this.addSegments(node, index + 1, activeParams, nextOmitted, method, key, segments);

      if (isErr(optResult)) {
        return optResult;
      }
    }

    const registerScope = () => this.registerParamScope(name, activeParams, segments);

    // Special Types: Zero-or-more (*) or Multi-segment (+)
    if (isZeroOrMore || isMulti) {
      return this.handleComplexParam(
        node,
        index,
        name,
        isZeroOrMore ? 'zero' : 'multi',
        activeParams,
        omittedOptionals,
        method,
        key,
        segments,
        registerScope,
      );
    }

    // Standard Parameter
    const releaseResult = registerScope();

    if (isErr(releaseResult)) {
      return releaseResult;
    }

    let child = this.findMatchingParamChild(node, name, patternSrc);

    if (child === undefined) {
      // Conflict Checks
      const conflictResult = this.ensureNoParamConflict(node, name, patternSrc, segments, index);

      if (isErr(conflictResult)) {
        releaseResult();

        return conflictResult;
      }

      const globalResult = this.registerGlobalParamName(name);

      if (isErr(globalResult)) {
        releaseResult();

        return globalResult;
      }

      child = acquireNode(NodeKind.Param, name);

      if (typeof patternSrc === 'string' && patternSrc.length > 0) {
        const regexResult = this.applyParamRegex(child, patternSrc);

        if (isErr(regexResult)) {
          releaseResult();

          return regexResult;
        }
      }

      node.paramChildren.push(child);
      sortParamChildren(node);
    }

    const addResult = this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);

    releaseResult();

    return addResult;
  }

  /**
   * Helper for * and + parameters which act like wildcards.
   */
  private handleComplexParam(
    node: Node,
    index: number,
    name: string,
    type: 'zero' | 'multi',
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
    registerScope: () => Result<() => void, RouterErrData>,
  ): Result<void, RouterErrData> {
    if (index !== segments.length - 1) {
      const label = type === 'zero' ? ':name*' : ':name+';

      return err<RouterErrData>({
        kind: 'route-parse',
        message: `${type === 'zero' ? 'Zero-or-more' : 'Multi-segment'} param '${label}' must be the last segment`,
      });
    }

    if (!node.wildcardChild) {
      const globalResult = this.registerGlobalParamName(name);

      if (isErr(globalResult)) {
        return globalResult;
      }

      node.wildcardChild = acquireNode(NodeKind.Wildcard, name || '*');
      node.wildcardChild.wildcardOrigin = type;
    } else if (node.wildcardChild.wildcardOrigin !== type || node.wildcardChild.segment !== name) {
      const label = type === 'zero' ? `:${name}*` : `:${name}+`;
      const prefix = type === 'zero' ? 'zero-or-more parameter' : 'multi-parameter';

      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: ${prefix} '${label}' cannot reuse wildcard '${node.wildcardChild.segment}' at '${this.getPathString(segments, index)}'`,
        conflictsWith: node.wildcardChild.segment,
      });
    }

    const releaseResult = registerScope();

    if (isErr(releaseResult)) {
      return releaseResult;
    }

    const result = this.addSegments(node.wildcardChild, index + 1, activeParams, omittedOptionals, method, key, segments);

    releaseResult();

    return result;
  }

  private handleStatic(
    node: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): Result<void, RouterErrData> {
    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    const child = node.staticChildren.get(segment);

    if (!child && node.wildcardChild) {
      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: adding static segment '${segment}' under existing wildcard at '${this.getPathString(segments, index)}'`,
        segment,
      });
    }

    if (child) {
      return this.handleExistingStatic(child, index, activeParams, omittedOptionals, method, key, segments);
    }

    // New Static Node
    const newNode = acquireNode(NodeKind.Static, segment);

    node.staticChildren.set(segment, newNode);

    return this.addSegments(newNode, index + 1, activeParams, omittedOptionals, method, key, segments);
  }

  private handleExistingStatic(
    child: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): Result<void, RouterErrData> {
    const parts = child.segmentParts ?? [];

    if (parts.length <= 1) {
      return this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);
    }

    const matched = matchStaticParts(parts, segments, index);

    if (matched < parts.length) {
      splitStaticChain(child, matched);
    }

    if (matched > 1) {
      return this.addSegments(child, index + matched, activeParams, omittedOptionals, method, key, segments);
    }

    return this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);
  }

  // --- Helpers ---

  private findMatchingParamChild(node: Node, name: string, patternSrc?: string): Node | undefined {
    // Exact match on Name and Regex Source
    return node.paramChildren.find(c => c.segment === name && (c.pattern?.source ?? undefined) === (patternSrc ?? undefined));
  }

  private ensureNoParamConflict(
    node: Node,
    name: string,
    patternSrc: string | undefined,
    segments: string[],
    index: number,
  ): Result<void, RouterErrData> {
    const dup = node.paramChildren.find(c => c.segment === name && (c.pattern?.source ?? '') !== (patternSrc ?? ''));

    if (dup) {
      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: parameter ':${name}' with different regex already exists at '${this.getPathString(segments, index)}'`,
        segment: `:${name}`,
      });
    }

    if (node.wildcardChild) {
      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: adding parameter ':${name}' under existing wildcard at '${this.getPathString(segments, index)}'`,
        segment: `:${name}`,
        conflictsWith: node.wildcardChild.segment,
      });
    }
  }

  private applyParamRegex(node: Node, patternSrc: string): Result<void, RouterErrData> {
    const normalizeResult = this.patternUtils.normalizeParamPatternSource(patternSrc);

    if (isErr(normalizeResult)) {
      return normalizeResult;
    }

    const normalizedPattern = normalizeResult;

    const safetyResult = this.ensureRegexSafe(normalizedPattern);

    if (isErr(safetyResult)) {
      return safetyResult;
    }

    const patternFlags = ''; // flags support could be added here
    const compiledPattern = this.patternUtils.acquireCompiledPattern(normalizedPattern, patternFlags);

    node.pattern = compiledPattern;
    node.patternSource = normalizedPattern;
  }

  /**
   * Scopes a parameter name to the current path branch, detecting duplicates.
   * Returns a cleanup function to remove the scope after recursion.
   */
  private registerParamScope(name: string, activeParams: Set<string>, segments: string[]): Result<() => void, RouterErrData> {
    if (activeParams.has(name)) {
      return err<RouterErrData>({
        kind: 'param-duplicate',
        message: `Duplicate parameter name ':${name}' detected in path: /${segments.join('/')}`,
        segment: name,
      });
    }

    activeParams.add(name);

    return () => activeParams.delete(name);
  }

  private registerGlobalParamName(name: string): Result<void, RouterErrData> {
    if (this.config.strictParamNames === true && this.globalParamNames.has(name)) {
      return err<RouterErrData>({
        kind: 'param-strict',
        message: `Parameter ':${name}' already registered (strict uniqueness enabled)`,
        segment: name,
      });
    }

    this.globalParamNames.add(name);
  }

  private ensureRegexSafe(patternSrc: string): Result<void, RouterErrData> {
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
        console.warn(msg);
      } else {
        return err<RouterErrData>({
          kind: 'regex-unsafe',
          message: msg,
        });
      }
    }

    safety.validator?.(patternSrc);
  }

  private getPathString(segments: string[], index: number): string {
    return segments.slice(0, index).join('/') || '/';
  }
}
