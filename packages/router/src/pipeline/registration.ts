import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type { PathPart } from '../builder/path-parser';
import type { SegmentNode, SegmentTreeUndoLog } from '../matcher/segment-tree';
import type { RouterErrorData, RouteValidationIssue } from '../types';
import type { PatternTesterFn } from '../matcher/pattern-tester';

import { err, isErr } from '@zipbul/result';
import { OptionalParamDefaults } from '../builder/optional-param-defaults';
import { PathParser } from '../builder/path-parser';
import { expandOptional } from '../builder/route-expand';
import { RouterError } from '../error';
import { MethodRegistry } from '../method-registry';
import { createSegmentNode, insertIntoSegmentTree } from '../matcher/segment-tree';

const ALL_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

interface PendingRoute<T> {
  method: string;
  path: string;
  value: T;
}

interface BuildState<T> {
  staticMap: Record<string, Array<T | undefined>>;
  staticRegistered: Record<string, boolean[]>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  testerCache: Map<string, PatternTesterFn>;
  wildcardNamesByMethod: Map<number, Map<string, string>>;
}

/**
 * Output of `Registration.seal()`: the build-time products of the
 * registration phase, ready to be consumed by Router's build/match
 * pipeline. All fields are internal and owned by the sealed registration.
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
 * `add()` records user intent only. `seal()` performs the authoritative
 * validation pass and publishes compiled state atomically only when every
 * route is valid. This keeps registration semantics strict without needing
 * route rollback as a public concept.
 */
export class Registration<T> {
  private readonly methodRegistry: MethodRegistry;
  private readonly pathParser: PathParser;
  private readonly optionalParamDefaults: OptionalParamDefaults;
  private readonly pendingRoutes: Array<PendingRoute<T>> = [];

  private snapshot: RegistrationSnapshot<T> | null = null;
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

  get staticMap(): RegistrationSnapshot<T>['staticMap'] | undefined {
    return this.snapshot?.staticMap;
  }

  get staticRegistered(): RegistrationSnapshot<T>['staticRegistered'] | undefined {
    return this.snapshot?.staticRegistered;
  }

  get segmentTrees(): RegistrationSnapshot<T>['segmentTrees'] | undefined {
    return this.snapshot?.segmentTrees;
  }

  get handlers(): RegistrationSnapshot<T>['handlers'] | undefined {
    return this.snapshot?.handlers;
  }

  get testerCache(): RegistrationSnapshot<T>['testerCache'] | undefined {
    return this.snapshot?.testerCache;
  }

  get wildcardNamesByMethod(): RegistrationSnapshot<T>['wildcardNamesByMethod'] | undefined {
    return this.snapshot?.wildcardNamesByMethod;
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, value: T): void {
    this.assertNotSealed({ path, method: Array.isArray(method) ? method[0] : method });

    if (Array.isArray(method)) {
      for (const m of method) this.pendingRoutes.push({ method: m, path, value });
      return;
    }

    if (method === '*') {
      for (const m of ALL_METHODS) this.pendingRoutes.push({ method: m, path, value });
      return;
    }

    this.pendingRoutes.push({ method, path, value });
  }

  addAll(entries: Array<[HttpMethod, string, T]>): void {
    this.assertNotSealed({ registeredCount: 0 });

    for (const [method, path, value] of entries) {
      this.pendingRoutes.push({ method, path, value });
    }
  }

  /**
   * Validate every pending route, aggregate every invalid route, then publish
   * the compiled snapshot exactly once. On failure no compiled snapshot is
   * exposed and the method/optional-default registries are restored.
   */
  seal(): RegistrationSnapshot<T> {
    if (this.snapshot !== null) return this.snapshot;

    const methodRegistrySnapshot = this.methodRegistry.snapshot();
    const optionalDefaultsSnapshot = this.optionalParamDefaults.snapshot();
    const state = createBuildState<T>();
    const issues: RouteValidationIssue[] = [];
    const undo: SegmentTreeUndoLog = [];

    for (let i = 0; i < this.pendingRoutes.length; i++) {
      const route = this.pendingRoutes[i]!;
      const mark = undo.length;
      const handlerMark = state.handlers.length;
      const optionalMark = this.optionalParamDefaults.snapshot();
      const result = this.compileRoute(route, state, undo);

      if (isErr(result)) {
        rollback(undo, mark);
        state.handlers.length = handlerMark;
        this.optionalParamDefaults.restore(optionalMark);
        issues.push({
          index: i,
          method: route.method,
          path: route.path,
          error: { ...result.data, method: route.method, path: route.path },
        });
      }
    }

    if (issues.length > 0) {
      rollback(undo, 0);
      this.methodRegistry.restore(methodRegistrySnapshot);
      this.optionalParamDefaults.restore(optionalDefaultsSnapshot);

      throw new RouterError({
        kind: 'route-validation',
        message: `${issues.length} route(s) failed validation during build().`,
        errors: issues,
      });
    }

    this.sealed = true;
    Object.freeze(state.wildcardNamesByMethod);

    this.snapshot = {
      staticMap: Object.freeze({ ...state.staticMap }),
      staticRegistered: Object.freeze({ ...state.staticRegistered }),
      segmentTrees: Object.freeze([...state.segmentTrees]),
      handlers: state.handlers, // intentional: handlers stay mutable for JIT IC
      testerCache: state.testerCache,
      wildcardNamesByMethod: Object.freeze(new Map(
        [...state.wildcardNamesByMethod].map(([mc, names]) => [mc, Object.freeze(new Map(names))]),
      )),
    };

    return this.snapshot;
  }

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

  private compileRoute(
    route: PendingRoute<T>,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    const offsetResult = this.methodRegistry.getOrCreate(route.method);

    if (isErr(offsetResult)) {
      return err<RouterErrorData>({ ...offsetResult.data, path: route.path });
    }

    const parseResult = this.pathParser.parse(route.path);

    if (isErr(parseResult)) {
      return err<RouterErrorData>({
        ...parseResult.data,
        path: route.path,
        method: route.method,
      });
    }

    const { parts, normalized, isDynamic } = parseResult;
    const methodCode = offsetResult;
    const wildcardResult = this.checkWildcardNameConflict(
      parts,
      normalized,
      methodCode,
      route.method,
      state.wildcardNamesByMethod,
      undo,
    );

    if (isErr(wildcardResult)) return wildcardResult;

    if (!isDynamic) {
      return this.compileStaticRoute(route, normalized, methodCode, state, undo);
    }

    return this.compileDynamicRoute(route, parts, methodCode, state, undo);
  }

  private compileStaticRoute(
    route: PendingRoute<T>,
    normalized: string,
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    const conflict = this.checkStaticWildcardConflict(
      normalized,
      methodCode,
      route.method,
      state.wildcardNamesByMethod,
    );

    if (isErr(conflict)) return conflict;

    let arr = state.staticMap[normalized];
    let registered = state.staticRegistered[normalized];

    if (arr === undefined) {
      arr = [];
      registered = [];
      state.staticMap[normalized] = arr;
      state.staticRegistered[normalized] = registered;
      undo.push(() => {
        delete state.staticMap[normalized];
        delete state.staticRegistered[normalized];
      });
    }

    if (registered![methodCode]) {
      return err<RouterErrorData>({
        kind: 'route-duplicate',
        message: `Route already exists: ${route.method} ${normalized}`,
        path: route.path,
        method: route.method,
        suggestion: 'Use a different path or HTTP method',
      });
    }

    const previousValue = arr[methodCode];
    const previousRegistered = registered![methodCode] ?? false;
    arr[methodCode] = route.value;
    registered![methodCode] = true;
    undo.push(() => {
      arr[methodCode] = previousValue;
      registered![methodCode] = previousRegistered;
    });
  }

  private compileDynamicRoute(
    route: PendingRoute<T>,
    parts: PathPart[],
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    const handlerIndex = state.handlers.length;
    state.handlers.push(route.value);
    undo.push(() => { state.handlers.length = handlerIndex; });

    const expansion = expandOptional(parts, handlerIndex, this.optionalParamDefaults);

    if (isErr(expansion)) {
      return err<RouterErrorData>({ ...expansion.data, path: route.path, method: route.method });
    }

    let root = state.segmentTrees[methodCode];

    if (root === undefined || root === null) {
      root = createSegmentNode();
      state.segmentTrees[methodCode] = root;
      undo.push(() => { delete state.segmentTrees[methodCode]; });
    }

    for (const { parts: expParts, handlerIndex: hIdx } of expansion) {
      const insertResult = insertIntoSegmentTree(
        root,
        expParts,
        hIdx,
        state.testerCache,
        undo,
      );

      if (isErr(insertResult)) {
        const data = insertResult.data;

        if (data.kind === 'route-duplicate') {
          data.message = `Route already exists: ${route.method} ${route.path}`;
        }

        return err<RouterErrorData>({ ...data, path: route.path, method: route.method });
      }
    }
  }

  private checkWildcardNameConflict(
    parts: PathPart[],
    normalized: string,
    methodCode: number,
    method: string,
    wildcardNamesByMethod: Map<number, Map<string, string>>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    let scope = wildcardNamesByMethod.get(methodCode);

    for (const part of parts) {
      if (part.type !== 'wildcard') continue;

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
        wildcardNamesByMethod.set(methodCode, scope);
        undo.push(() => { wildcardNamesByMethod.delete(methodCode); });
      }

      const previous = scope.get(prefix);
      scope.set(prefix, part.name);
      undo.push(() => {
        if (previous === undefined) {
          scope!.delete(prefix);
        } else {
          scope!.set(prefix, previous);
        }
      });
      break;
    }
  }

  private checkStaticWildcardConflict(
    normalized: string,
    methodCode: number,
    method: string,
    wildcardNamesByMethod: Map<number, Map<string, string>>,
  ): Result<void, RouterErrorData> {
    const scope = wildcardNamesByMethod.get(methodCode);

    if (scope === undefined) return;

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

function createBuildState<T>(): BuildState<T> {
  return {
    staticMap: Object.create(null) as Record<string, Array<T | undefined>>,
    staticRegistered: Object.create(null) as Record<string, boolean[]>,
    segmentTrees: [],
    handlers: [],
    testerCache: new Map(),
    wildcardNamesByMethod: new Map(),
  };
}

function rollback(undo: SegmentTreeUndoLog, mark: number): void {
  for (let i = undo.length - 1; i >= mark; i--) {
    undo[i]!();
  }

  undo.length = mark;
}
