import { Logger } from '@bunner/logger';

import type { HttpMethod } from '../../types';
import type { BinaryRouterLayout } from '../schema';
import type { BuilderConfig } from './types';

import { NodeKind, METHOD_OFFSET } from '../schema';
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
  private readonly logger = new Logger(Builder.name);

  constructor(config: BuilderConfig) {
    this.config = config;
    this.root = acquireNode(NodeKind.Static, '/');
    this.patternUtils = new PatternUtils(config);
  }

  add(method: HttpMethod, segments: string[], handler: T): void {
    const handlerIndex = this.handlers.length;

    this.handlers.push(handler);
    this.addSegments(this.root, 0, new Set<string>(), [], method, handlerIndex, segments);
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
  ): void {
    if (index === segments.length) {
      this.registerRoute(node, method, key, omittedOptionals, segments);

      return;
    }

    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    const charCode = segment.charCodeAt(0);

    if (charCode === 42) {
      this.handleWildcard(node, index, activeParams, omittedOptionals, method, key, segments);

      return;
    }

    if (charCode === 58) {
      this.handleParam(node, index, activeParams, omittedOptionals, method, key, segments);

      return;
    }

    this.handleStatic(node, index, activeParams, omittedOptionals, method, key, segments);
  }

  private registerRoute(node: Node, method: HttpMethod, key: number, omittedOptionals: string[], segments: string[]): void {
    const methodId = METHOD_OFFSET[method];

    if (methodId === undefined) {
      throw new Error(`Invalid HTTP method: ${method}`);
    }

    if (node.methods.byMethod.has(method)) {
      const methodName = method;

      throw new Error(`Route already exists for ${methodName} at path: /${segments.join('/')}`);
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
  ): void {
    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    if (node.staticChildren.size || node.paramChildren.length) {
      throw new Error(`Conflict: adding wildcard '*' at '${this.getPathString(segments, index)}' would shadow existing routes`);
    }

    if (index !== segments.length - 1) {
      throw new Error("Wildcard '*' must be the last segment");
    }

    const name = segment.length > 1 ? segment.slice(1) : '*';

    if (node.wildcardChild) {
      const existing = node.wildcardChild;

      if (existing.wildcardOrigin !== 'star' || existing.segment !== name) {
        throw new Error(`Conflict: wildcard '${existing.segment}' already exists at '${this.getPathString(segments, index)}'`);
      }
    } else {
      this.registerGlobalParamName(name);

      node.wildcardChild = acquireNode(NodeKind.Wildcard, name);
      node.wildcardChild.wildcardOrigin = 'star';
    }

    // Recurse (to register route)
    const release = this.registerParamScope(name, activeParams, segments);

    try {
      this.addSegments(node.wildcardChild, index + 1, activeParams, omittedOptionals, method, key, segments);
    } finally {
      release();
    }
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
  ): void {
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

    // Checking suffixes on 'core' allows handling cases like ':name+?' if theoretically valid?
    // Current parser logic assumes strictly one suffix type primarily,
    // but code structure implies 'core' is stripped iteratively.
    // Original code: if (core.endsWith('+')) ...

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
        throw new Error("Parameter regex must close with '}'");
      }

      patternSrc = core.slice(braceIndex + 1, -1) || undefined;
    }

    if (!name) {
      throw new Error("Parameter segment must have a name, eg ':id'");
    }

    // Validation
    if (isZeroOrMore && isOptional) {
      throw new Error(`Parameter ':${name}*' already allows empty matches; do not combine '*' and '?' suffixes`);
    }

    // Handle Optional Branch (skip this parameter)
    if (isOptional) {
      const nextOmitted = omittedOptionals.length ? [...omittedOptionals, name] : [name];

      // Branch 1: Skip the parameter (recurse to index + 1 on SAME node)
      // Wait, original logic recursed to index + 1 on SAME node ??
      // Original: this.addSegments(node, idx + 1, ...)
      // This treats the current segment as if it didn't exist in the path structure?
      // Yes, optional param means we can match WITHOUT consuming a segment here?
      // No, it handles the case where the URL *omits* the segment.
      // So we map the REST of the segments to THIS node.
      this.addSegments(node, index + 1, activeParams, nextOmitted, method, key, segments);

      // Proceed to Branch 2: Match the parameter (fall through)
    }

    const registerScope = () => this.registerParamScope(name, activeParams, segments);

    // Special Types: Zero-or-more (*) or Multi-segment (+)
    if (isZeroOrMore || isMulti) {
      this.handleComplexParam(
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

      return;
    }

    // Standard Parameter
    const release = registerScope();
    let child = this.findMatchingParamChild(node, name, patternSrc);

    if (child === undefined) {
      // Conflict Checks
      this.ensureNoParamConflict(node, name, patternSrc, segments, index);
      this.registerGlobalParamName(name);

      child = acquireNode(NodeKind.Param, name);

      if (typeof patternSrc === 'string' && patternSrc.length > 0) {
        this.applyParamRegex(child, patternSrc);
      }

      node.paramChildren.push(child);
      sortParamChildren(node);
    }

    try {
      this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);
    } finally {
      release();
    }
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
    registerScope: () => () => void,
  ): void {
    if (index !== segments.length - 1) {
      const label = type === 'zero' ? ':name*' : ':name+';

      throw new Error(`${type === 'zero' ? 'Zero-or-more' : 'Multi-segment'} param '${label}' must be the last segment`);
    }

    if (!node.wildcardChild) {
      this.registerGlobalParamName(name);

      node.wildcardChild = acquireNode(NodeKind.Wildcard, name || '*');
      node.wildcardChild.wildcardOrigin = type;
    } else if (node.wildcardChild.wildcardOrigin !== type || node.wildcardChild.segment !== name) {
      const label = type === 'zero' ? `:${name}*` : `:${name}+`;
      const prefix = type === 'zero' ? 'zero-or-more parameter' : 'multi-parameter';

      throw new Error(
        `Conflict: ${prefix} '${label}' cannot reuse wildcard '${node.wildcardChild.segment}' at '${this.getPathString(segments, index)}'`,
      );
    }

    const release = registerScope();

    try {
      this.addSegments(node.wildcardChild, index + 1, activeParams, omittedOptionals, method, key, segments);
    } finally {
      release();
    }
  }

  private handleStatic(
    node: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): void {
    const segment = segments[index];

    if (segment === undefined) {
      throw new Error(`Missing segment at index ${index}`);
    }

    const child = node.staticChildren.get(segment);

    if (!child && node.wildcardChild) {
      throw new Error(
        `Conflict: adding static segment '${segment}' under existing wildcard at '${this.getPathString(segments, index)}'`,
      );
    }

    if (child) {
      this.handleExistingStatic(child, index, activeParams, omittedOptionals, method, key, segments);

      return;
    }

    // New Static Node
    const newNode = acquireNode(NodeKind.Static, segment);

    node.staticChildren.set(segment, newNode);
    this.addSegments(newNode, index + 1, activeParams, omittedOptionals, method, key, segments);
  }

  private handleExistingStatic(
    child: Node,
    index: number,
    activeParams: Set<string>,
    omittedOptionals: string[],
    method: HttpMethod,
    key: number,
    segments: string[],
  ): void {
    const parts = child.segmentParts ?? [];

    // Note: Logic for 'segmentParts' (chain optimization) might belong here if we implement it fully.
    // For now, consistent with previous logic:
    if (parts.length <= 1) {
      this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);

      return;
    }

    const matched = matchStaticParts(parts, segments, index);

    if (matched < parts.length) {
      splitStaticChain(child, matched);
    }

    if (matched > 1) {
      this.addSegments(child, index + matched, activeParams, omittedOptionals, method, key, segments);

      return;
    }

    this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);
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
  ): void {
    const dup = node.paramChildren.find(c => c.segment === name && (c.pattern?.source ?? '') !== (patternSrc ?? ''));

    if (dup) {
      throw new Error(
        `Conflict: parameter ':${name}' with different regex already exists at '${this.getPathString(segments, index)}'`,
      );
    }

    if (node.wildcardChild) {
      throw new Error(
        `Conflict: adding parameter ':${name}' under existing wildcard at '${this.getPathString(segments, index)}'`,
      );
    }
  }

  private applyParamRegex(node: Node, patternSrc: string): void {
    const normalizedPattern = this.patternUtils.normalizeParamPatternSource(patternSrc);

    this.ensureRegexSafe(normalizedPattern);

    const patternFlags = ''; // flags support could be added here
    const compiledPattern = this.patternUtils.acquireCompiledPattern(normalizedPattern, patternFlags);

    node.pattern = compiledPattern;
    node.patternSource = normalizedPattern;
  }

  /**
   * Scopes a parameter name to the current path branch, detecting duplicates.
   * Returns a cleanup function to remove the scope after recursion.
   */
  private registerParamScope(name: string, activeParams: Set<string>, segments: string[]): () => void {
    if (activeParams.has(name)) {
      throw new Error(`Duplicate parameter name ':${name}' detected in path: /${segments.join('/')}`);
    }

    activeParams.add(name);

    return () => activeParams.delete(name);
  }

  private registerGlobalParamName(name: string): void {
    if (this.config.strictParamNames === true && this.globalParamNames.has(name)) {
      throw new Error(`Parameter ':${name}' already registered (strict uniqueness enabled)`);
    }

    this.globalParamNames.add(name);
  }

  private ensureRegexSafe(patternSrc: string): void {
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
        this.logger.warn(msg);
      } else {
        throw new Error(msg);
      }
    }

    safety.validator?.(patternSrc);
  }

  private getPathString(segments: string[], index: number): string {
    return segments.slice(0, index).join('/') || '/';
  }
}
