import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type { BinaryRouterLayout } from '../schema';
import type { RouterErrData } from '../types';
import type { BuilderConfig } from './types';

import { err, isErr } from '@zipbul/result';
import { NodeKind } from '../schema';
import { MAX_STACK_DEPTH } from '../matcher/constants';
import { assertDefined } from './assert';
import { flatten } from './flattener';
import { Node } from './node';
import { matchStaticParts, splitStaticChain, sortParamChildren } from './node-operations';
import { NodeFactory } from './node-pool';
import { PatternUtils } from './pattern-utils';
import { RouteValidator } from './validator';

export class Builder<T> {
  public root: Node;
  public readonly config: BuilderConfig;
  public readonly handlers: T[] = [];
  private readonly patternUtils: PatternUtils;
  private readonly validator: RouteValidator;
  private readonly pool: NodeFactory = new NodeFactory();

  constructor(config: BuilderConfig) {
    this.config = config;
    this.root = this.pool.acquire(NodeKind.Static, '/');
    this.patternUtils = new PatternUtils(config);
    this.validator = new RouteValidator(config, this.patternUtils);
  }

  add(method: HttpMethod, segments: string[], handler: T): Result<void, RouterErrData> {
    const handlerIndex = this.handlers.length;

    this.handlers.push(handler);

    return this.addSegments(this.root, 0, new Set<string>(), [], method, handlerIndex, segments);
  }

  /** 충돌 검사 전용 등록 — handler를 handlers 배열에 추가하지 않음. 정적 라우트용. */
  addForValidation(method: HttpMethod, segments: string[]): Result<void, RouterErrData> {
    return this.addSegments(this.root, 0, new Set<string>(), [], method, -1, segments);
  }

  build(methodCodes?: ReadonlyMap<string, number>): BinaryRouterLayout {
    return flatten(this.root, methodCodes);
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
    if (index >= MAX_STACK_DEPTH && index < segments.length) {
      return err<RouterErrData>({
        kind: 'segment-limit',
        message: `Route path exceeds maximum depth of ${MAX_STACK_DEPTH} segments (got ${segments.length})`,
        suggestion: `Reduce the number of path segments to ${MAX_STACK_DEPTH} or fewer.`,
      });
    }

    if (index === segments.length) {
      return this.registerRoute(node, method, key, omittedOptionals, segments);
    }

    const segment = segments[index];

    assertDefined(segment, `Missing segment at index ${index}`);

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
        suggestion: `Remove the duplicate route definition or use a different HTTP method.`,
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

    assertDefined(segment, `Missing segment at index ${index}`);

    if (node.staticChildren.size || node.paramChildren.length) {
      const existingNames = [
        ...node.staticChildren.keys(),
        ...node.paramChildren.map(c => `:${c.segment}`),
      ].slice(0, 3).join(', ');

      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: adding wildcard '*' at '${this.validator.getPathString(segments, index)}' would shadow existing routes`,
        segment: '*',
        conflictsWith: existingNames || undefined,
        suggestion: `Register specific routes before the wildcard, or move the wildcard to a deeper path (e.g. '/api/files/*' instead of '/api/*').`,
      });
    }

    if (index !== segments.length - 1) {
      return err<RouterErrData>({
        kind: 'route-parse',
        message: "Wildcard '*' must be the last segment",
        segment: '*',
        suggestion: `Move '*' to the final position, e.g. '/files/*' instead of '/files/*/extra'.`,
      });
    }

    const name = segment.length > 1 ? segment.slice(1) : '*';

    if (node.wildcardChild) {
      const existing = node.wildcardChild;

      if (existing.wildcardOrigin !== 'star' || existing.segment !== name) {
        return err<RouterErrData>({
          kind: 'route-conflict',
          message: `Conflict: wildcard '${existing.segment}' already exists at '${this.validator.getPathString(segments, index)}'`,
          segment: name,
          conflictsWith: existing.segment,
          suggestion: `Use the same wildcard name '${existing.segment}' that was registered first, or choose a different path prefix.`,
        });
      }
    } else {
      this.validator.registerGlobalParamName(name);

      node.wildcardChild = this.pool.acquire(NodeKind.Wildcard, name);
      node.wildcardChild.wildcardOrigin = 'star';
    }

    // Recurse (to register route)
    const releaseResult = this.validator.registerParamScope(name, activeParams, segments);

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

    assertDefined(segment, `Missing segment at index ${index}`);

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
          suggestion: `Close the regex with '}', e.g. ':id{\\d+}' not ':id{\\d+'.`,
        });
      }

      patternSrc = core.slice(braceIndex + 1, -1) || undefined;
    }

    if (!name) {
      return err<RouterErrData>({
        kind: 'route-parse',
        message: "Parameter segment must have a name, eg ':id'",
        segment,
        suggestion: `Add a name after ':', e.g. ':id', ':userId', or ':file{[^/]+}'.`,
      });
    }

    // Validation
    if (isZeroOrMore && isOptional) {
      return err<RouterErrData>({
        kind: 'route-parse',
        message: `Parameter ':${name}*' already allows empty matches; do not combine '*' and '?' suffixes`,
        segment,
        suggestion: `Use ':${name}*' alone — it already matches zero or more segments without needing '?'.`,
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

    const registerScope = () => this.validator.registerParamScope(name, activeParams, segments);

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

    let child = this.validator.findMatchingParamChild(node, name, patternSrc);

    if (child === undefined) {
      // Conflict Checks
      const conflictResult = this.validator.ensureNoParamConflict(node, name, patternSrc, segments, index);

      if (isErr(conflictResult)) {
        releaseResult();

        return conflictResult;
      }

      this.validator.registerGlobalParamName(name);

      child = this.pool.acquire(NodeKind.Param, name);

      if (typeof patternSrc === 'string' && patternSrc.length > 0) {
        const regexResult = this.validator.applyParamRegex(child, patternSrc);

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
      const label = type === 'zero' ? `:${name}*` : `:${name}+`;

      return err<RouterErrData>({
        kind: 'route-parse',
        message: `${type === 'zero' ? 'Zero-or-more' : 'Multi-segment'} param '${label}' must be the last segment`,
        segment: label,
        suggestion: `Move '${label}' to the last segment position, e.g. '/prefix/${label}' instead of '/prefix/${label}/extra'`,
      });
    }

    if (!node.wildcardChild) {
      this.validator.registerGlobalParamName(name);

      node.wildcardChild = this.pool.acquire(NodeKind.Wildcard, name || '*');
      node.wildcardChild.wildcardOrigin = type;
    } else if (node.wildcardChild.wildcardOrigin !== type || node.wildcardChild.segment !== name) {
      const label = type === 'zero' ? `:${name}*` : `:${name}+`;
      const prefix = type === 'zero' ? 'zero-or-more parameter' : 'multi-parameter';

      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: ${prefix} '${label}' cannot reuse wildcard '${node.wildcardChild.segment}' at '${this.validator.getPathString(segments, index)}'`,
        conflictsWith: node.wildcardChild.segment,
        suggestion: `Use the same wildcard name and type as the existing one ('${node.wildcardChild.segment}'), or register this route under a different path prefix`,
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

    assertDefined(segment, `Missing segment at index ${index}`);

    const child = node.staticChildren.get(segment);

    if (!child && node.wildcardChild) {
      return err<RouterErrData>({
        kind: 'route-conflict',
        message: `Conflict: adding static segment '${segment}' under existing wildcard at '${this.validator.getPathString(segments, index)}'`,
        segment,
        suggestion: `Remove the wildcard route or register the static segment '${segment}' at a different path prefix`,
      });
    }

    if (child) {
      return this.handleExistingStatic(child, index, activeParams, omittedOptionals, method, key, segments);
    }

    // New Static Node
    const newNode = this.pool.acquire(NodeKind.Static, segment);

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
      splitStaticChain(child, matched, this.pool);
    }

    if (matched > 1) {
      return this.addSegments(child, index + matched, activeParams, omittedOptionals, method, key, segments);
    }

    return this.addSegments(child, index + 1, activeParams, omittedOptionals, method, key, segments);
  }

  // --- Helpers ---

}
