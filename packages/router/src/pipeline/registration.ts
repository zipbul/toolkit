import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type { PathPart } from '../builder/path-parser';
import type { SegmentNode } from '../matcher/segment-tree';
import type { RouterErrorData } from '../types';
import type { PatternTesterFn } from '../matcher/pattern-tester';

import { err, isErr } from '@zipbul/result';
import { OptionalParamDefaults } from '../builder/optional-param-defaults';
import { PathParser } from '../builder/path-parser';
import { expandOptional } from '../builder/route-expand';
import { RouterError } from '../error';
import { MethodRegistry } from '../method-registry';
import { createSegmentNode, insertIntoSegmentTree } from '../matcher/segment-tree';

const ALL_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

/**
 * Output of `Registration.seal()`: the build-time products of the
 * registration phase, ready to be consumed by Router's build/match
 * pipeline. All fields are *internal* — none cross the public API.
 *
 * The router copies these references into its own fields for closure
 * capture by the compiled matchImpl, so the lifetime of every array /
 * record extends past `seal()`.
 */
export interface RegistrationSnapshot<T> {
  staticMap: Record<string, Array<T | undefined>>;
  staticRegistered: Record<string, boolean[]>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  testerCache: Map<string, PatternTesterFn>;
  wildcardNamesByMethod: Map<number, Map<string, string>>;
}

/**
 * Owns the mutable state and validators that accumulate as the user
 * calls `add()` / `addAll()`. Closes via `seal()`, which transfers the
 * accumulated state to Router's build pipeline as a `RegistrationSnapshot`.
 *
 * Extracted from Router (F1) to enforce SRP — registration concerns
 * (parsing, conflict detection, segment-tree population) are now
 * separable from build-time codegen and runtime match dispatch.
 */
export class Registration<T> {
  private readonly methodRegistry: MethodRegistry;
  private readonly pathParser: PathParser;
  private readonly optionalParamDefaults: OptionalParamDefaults;

  /** Path → per-methodCode handler array. Prototype-less for proto-free
   *  O(1) lookup. Slot value alone cannot distinguish "registered with
   *  undefined" from "not registered" — `staticRegistered` tracks the
   *  latter explicitly so callers can register `undefined` (or any value
   *  where T includes it) without it being silently treated as an empty
   *  slot. */
  private staticMap: Record<string, Array<T | undefined>> =
    Object.create(null) as Record<string, Array<T | undefined>>;
  /** Path → method codes that have actually been registered. Parallel
   *  to `staticMap`. Without this, `arr[mc] === undefined` ambiguously
   *  means either "not registered" or "registered with undefined value". */
  private staticRegistered: Record<string, boolean[]> =
    Object.create(null) as Record<string, boolean[]>;
  /** Per-method segment-tree root, populated incrementally as add()
   *  is called. */
  private readonly segmentTrees: Array<SegmentNode | null> = [];
  private readonly handlers: T[] = [];
  /** Per-method wildcard-name index: methodCode → (prefix → wildcardName).
   *  Conflict detection is method-scoped (F9). */
  private readonly wildcardNamesByMethod: Map<number, Map<string, string>> = new Map();
  /** Tester cache shared across registrations so identical regex patterns
   *  compile only once. The router resets this after seal() releases
   *  parser state. */
  private readonly testerCache: Map<string, PatternTesterFn> = new Map();

  private sealed = false;

  constructor(
    methodRegistry: MethodRegistry,
    pathParser: PathParser,
    optionalParamDefaults: OptionalParamDefaults,
  ) {
    this.methodRegistry = methodRegistry;
    this.pathParser = pathParser;
    this.optionalParamDefaults = optionalParamDefaults;
  }

  isSealed(): boolean {
    return this.sealed;
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, value: T): void {
    this.assertNotSealed({ path, method: Array.isArray(method) ? method[0] : method });

    if (Array.isArray(method)) {
      for (const m of method) this.unwrapOrThrow(this.addOne(m, path, value));

      return;
    }

    if (method === '*') {
      for (const m of ALL_METHODS) this.unwrapOrThrow(this.addOne(m, path, value));

      return;
    }

    this.unwrapOrThrow(this.addOne(method, path, value));
  }

  addAll(entries: Array<[HttpMethod, string, T]>): void {
    this.assertNotSealed({ registeredCount: 0 });

    let registeredCount = 0;

    for (const [method, path, value] of entries) {
      const result = this.addOne(method, path, value);

      if (isErr(result)) {
        throw new RouterError({ ...result.data, registeredCount });
      }

      registeredCount++;
    }
  }

  /**
   * Close the registration phase and hand off the accumulated state.
   * After seal(), every `add()` / `addAll()` call throws router-sealed.
   * The returned snapshot's references are still owned by this instance
   * — callers must not mutate them.
   *
   * `wildcardNamesByMethod` is *only* read during add(); the router never
   * touches it post-build. We freeze it here as part of F22's freeze
   * partition (build-only tables are immutable; hot-path tables are
   * intentionally left mutable to avoid JSC IC degradation).
   */
  seal(): RegistrationSnapshot<T> {
    this.sealed = true;

    Object.freeze(this.wildcardNamesByMethod);

    return {
      staticMap: this.staticMap,
      staticRegistered: this.staticRegistered,
      segmentTrees: this.segmentTrees,
      handlers: this.handlers,
      testerCache: this.testerCache,
      wildcardNamesByMethod: this.wildcardNamesByMethod,
    };
  }

  /**
   * Throw `router-sealed` when add()/addAll() is called after seal().
   * `ctx` lets the caller decorate the error with their request context
   * (path/method) or the addAll() registeredCount=0 marker.
   */
  private assertNotSealed(
    ctx: { path?: string; method?: string; registeredCount?: number },
  ): void {
    if (!this.sealed) return;

    throw new RouterError({
      kind: 'router-sealed',
      message: 'Cannot add routes after build(). The router is sealed.',
      suggestion: 'Create a new Router instance to add more routes',
      ...ctx,
    });
  }

  /** Convert an addOne() Err into a thrown RouterError; pass-through on Ok. */
  private unwrapOrThrow(result: Result<void, RouterErrorData>): void {
    if (isErr(result)) throw new RouterError(result.data);
  }

  private addOne(method: HttpMethod, path: string, value: T): Result<void, RouterErrorData> {
    const offsetResult = this.methodRegistry.getOrCreate(method);

    if (isErr(offsetResult)) {
      return err<RouterErrorData>({
        ...offsetResult.data,
        path,
      });
    }

    const parseResult = this.pathParser.parse(path);

    if (isErr(parseResult)) {
      return err<RouterErrorData>({
        ...parseResult.data,
        path,
        method,
      });
    }

    const { parts, normalized, isDynamic } = parseResult;

    // Per-method wildcard-name conflict (cross-method coexistence allowed)
    const wcConflict = this.checkWildcardNameConflict(parts, normalized, offsetResult, method);

    if (isErr(wcConflict)) {
      return wcConflict;
    }

    // Static route conflicting with an existing wildcard *within the same method*
    if (!isDynamic) {
      const wcBlockConflict = this.checkStaticWildcardConflict(normalized, offsetResult, method);

      if (isErr(wcBlockConflict)) {
        return wcBlockConflict;
      }

      let arr = this.staticMap[normalized];
      let registered = this.staticRegistered[normalized];

      if (!arr) {
        arr = [];
        registered = [];
        this.staticMap[normalized] = arr;
        this.staticRegistered[normalized] = registered;
      }

      if (registered![offsetResult]) {
        return err<RouterErrorData>({
          kind: 'route-duplicate',
          message: `Route already exists for ${method} ${normalized}`,
          path,
          method,
          suggestion: 'Use a different path or HTTP method',
        });
      }

      arr[offsetResult] = value;
      registered![offsetResult] = true;
      return;
    }

    const handlerIndex = this.handlers.length;
    this.handlers.push(value);

    const expansion = expandOptional(parts, handlerIndex, this.optionalParamDefaults);

    if (isErr(expansion)) {
      this.handlers.pop();

      return err<RouterErrorData>({ ...expansion.data, path, method });
    }

    if (this.segmentTrees[offsetResult] === undefined || this.segmentTrees[offsetResult] === null) {
      this.segmentTrees[offsetResult] = createSegmentNode();
    }

    const root = this.segmentTrees[offsetResult]!;

    for (const { parts: expParts, handlerIndex: hIdx } of expansion) {
      const insertResult = insertIntoSegmentTree(
        root,
        expParts,
        hIdx,
        this.testerCache,
      );

      if (isErr(insertResult)) {
        this.handlers.pop();

        return err<RouterErrorData>({ ...insertResult.data, path, method });
      }
    }
  }

  private checkWildcardNameConflict(
    parts: PathPart[],
    normalized: string,
    methodCode: number,
    method: string,
  ): Result<void, RouterErrorData> {
    let scope = this.wildcardNamesByMethod.get(methodCode);

    for (const part of parts) {
      if (part.type === 'wildcard') {
        // Build prefix key (path without wildcard)
        const prefix = normalized.replace(/\/[*:].*$/, '');
        const existing = scope?.get(prefix);

        if (existing !== undefined && existing !== part.name) {
          return err<RouterErrorData>({
            kind: 'route-conflict',
            message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${existing}' at path prefix '${prefix}' for method ${method}`,
            segment: part.name,
            conflictsWith: existing,
            method,
          });
        }

        if (scope === undefined) {
          scope = new Map();
          this.wildcardNamesByMethod.set(methodCode, scope);
        }

        scope.set(prefix, part.name);
        break;
      }
    }
  }

  private checkStaticWildcardConflict(
    normalized: string,
    methodCode: number,
    method: string,
  ): Result<void, RouterErrorData> {
    const scope = this.wildcardNamesByMethod.get(methodCode);

    if (scope === undefined) return;

    // Check if any wildcard prefix in this method is a parent of this static route
    for (const [prefix, wildcardName] of scope) {
      if (normalized.startsWith(prefix + '/') || normalized === prefix) {
        return err<RouterErrorData>({
          kind: 'route-conflict',
          message: `Static route '${normalized}' conflicts with existing wildcard at '${prefix}/*' for method ${method}`,
          segment: normalized,
          conflictsWith: `${prefix}/*${wildcardName}`,
          method,
        });
      }
    }
  }
}
