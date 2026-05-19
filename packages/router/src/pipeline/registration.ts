import type { Result } from '@zipbul/result';

import { err, isErr } from '@zipbul/result';

import type { FactoryCache } from '../codegen';
import type { PathPart, PatternTesterFn, SegmentNode, SegmentTreeUndoLog } from '../tree';
import type { RouteParams, RouteValidationIssue, RouterErrorData } from '../types';
import type { RouteMeta, CommitPlan } from './wildcard-prefix-index';

import { OptionalParamDefaults, PathParser, expandOptional, MAX_OPTIONAL_SEGMENTS_PER_ROUTE } from '../builder';
import { computePresentBitmask, createFactoryCache, getOrCreateSuperFactory } from '../codegen';
import { RouterError } from '../error';
import { decoder } from '../matcher';
import { MethodRegistry } from '../method-registry';
import {
  applyUndo,
  createSegmentNode,
  detectTenantFactor,
  insertIntoSegmentTree,
  PathPartType,
  pushStaticBucketResetUndo,
  pushStaticMapDeleteUndo,
  setTenantFactor,
  UndoKind,
} from '../tree';
import { RouterErrorKind } from '../types';
import { IdentityRegistry } from './identity-registry';
import { packTerminalSlab } from './terminal-slab';
import { WILDCARD_METHOD, expandWildcardMethodRoutes } from './wildcard-method-expand';
import { WildcardPrefixIndex, rollbackPlan } from './wildcard-prefix-index';

const BUILD_CHUNK_SIZE = 10_000;

interface PendingRoute<T> {
  method: string;
  path: string;
  value: T;
}

interface RegistrationSnapshot<T> {
  staticByMethod: Array<Record<string, T> | undefined>;
  staticPathMethodMask: Record<string, number>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  terminalSlab: Int32Array;
  paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
  maxParamsObserved: number;
}

interface BuildState<T> {
  staticByMethod: Array<Record<string, T> | undefined>;
  staticPathMethodMask: Record<string, number>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  terminalHandlers: number[];
  isWildcardByTerminal: boolean[];
  paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
  presentBitmaskByTerminal: number[];
  testerCache: Map<string, PatternTesterFn>;
  routeCounter: number;
  maxParamsObserved: number;
}

class Registration<T> {
  private readonly methodRegistry: MethodRegistry;
  private readonly pathParser: PathParser;
  private readonly optionalParamDefaults: OptionalParamDefaults;
  private readonly pendingRoutes: Array<PendingRoute<T>> = [];

  private snapshot: RegistrationSnapshot<T> | null = null;
  private sealed = false;
  private prefixIndex: WildcardPrefixIndex | null = null;
  private identityRegistry: IdentityRegistry | null = null;
  private routeIdCounter = 0;

  constructor(methodRegistry: MethodRegistry, pathParser: PathParser, optionalParamDefaults: OptionalParamDefaults) {
    this.methodRegistry = methodRegistry;
    this.pathParser = pathParser;
    this.optionalParamDefaults = optionalParamDefaults;
  }

  isSealed(): boolean {
    return this.sealed;
  }

  add(method: string | readonly string[], path: string, value: T): void {
    this.assertNotSealed({ path, method: Array.isArray(method) ? method[0] : (method as string) });

    if (Array.isArray(method)) {
      for (const m of method) {
        this.pendingRoutes.push({ method: m, path, value });
      }
      return;
    }

    if (method === '*') {
      this.pendingRoutes.push({ method: WILDCARD_METHOD, path, value });
      return;
    }

    this.pendingRoutes.push({ method: method as string, path, value });
  }

  addAll(entries: ReadonlyArray<readonly [string, string, T]>): void {
    this.assertNotSealed({ registeredCount: 0 });

    for (const [method, path, value] of entries) {
      this.pendingRoutes.push({ method, path, value });
    }
  }

  seal(
    options: {
      omitMissingOptional?: boolean;
    } = {},
  ): RegistrationSnapshot<T> {
    if (this.snapshot !== null) {
      return this.snapshot;
    }

    const methodRegistrySnapshot = this.methodRegistry.snapshot();
    const optionalDefaultsSnapshot = this.optionalParamDefaults.snapshot();
    const state = createBuildState<T>();
    const undo: SegmentTreeUndoLog = [];
    const omitBehavior = options.omitMissingOptional ?? true;

    this.prefixIndex = new WildcardPrefixIndex();
    this.identityRegistry = new IdentityRegistry();
    this.routeIdCounter = 0;

    expandWildcardMethodRoutes(this.pendingRoutes, this.methodRegistry);

    const issues = this.compileAllRoutes(state, undo, omitBehavior);

    if (issues.length > 0) {
      this.abortBuild(undo, methodRegistrySnapshot, optionalDefaultsSnapshot, issues);
    }

    this.sealed = true;
    this.pendingRoutes.length = 0;

    const snapshot = this.packSnapshot(state);
    this.snapshot = snapshot;
    this.prefixIndex = null;
    this.identityRegistry = null;

    applyTenantFactors(state.segmentTrees);

    return snapshot;
  }

  private compileAllRoutes(state: BuildState<T>, undo: SegmentTreeUndoLog, omitBehavior: boolean): RouteValidationIssue[] {
    const issues: RouteValidationIssue[] = [];
    const factoryCache: FactoryCache = createFactoryCache();

    for (let i = 0; i < this.pendingRoutes.length; i++) {
      const route = this.pendingRoutes[i]!;
      const mark = undo.length;
      const handlerMark = state.handlers.length;
      const terminalMark = state.terminalHandlers.length;
      const factoryMark = state.paramsFactories.length;
      const optionalMark = this.optionalParamDefaults.snapshot();
      const routeID = state.routeCounter++;

      const result = this.compileRoute(route, state, undo, routeID, factoryCache, omitBehavior, decoder);

      if (isErr(result)) {
        rollback(undo, mark);
        state.handlers.length = handlerMark;
        state.terminalHandlers.length = terminalMark;
        state.isWildcardByTerminal.length = terminalMark;
        state.paramsFactories.length = factoryMark;
        state.presentBitmaskByTerminal.length = terminalMark;
        this.optionalParamDefaults.restore(optionalMark);
        state.routeCounter--;
        issues.push({
          index: i,
          method: route.method,
          path: route.path,
          error: { ...result.data, method: route.method, path: route.path },
        });
      }

      if ((i + 1) % BUILD_CHUNK_SIZE === 0 && i + 1 < this.pendingRoutes.length) {
        if (issues.length === 0) {
          undo.length = 0;
        }
        Bun.gc(true);
      }
    }

    return issues;
  }

  private abortBuild(
    undo: SegmentTreeUndoLog,
    methodRegistrySnapshot: ReturnType<MethodRegistry['snapshot']>,
    optionalDefaultsSnapshot: ReturnType<OptionalParamDefaults['snapshot']>,
    issues: RouteValidationIssue[],
  ): never {
    rollback(undo, 0);
    this.methodRegistry.restore(methodRegistrySnapshot);
    this.optionalParamDefaults.restore(optionalDefaultsSnapshot);
    this.prefixIndex = null;
    this.identityRegistry = null;

    throw new RouterError({
      kind: RouterErrorKind.RouteValidation,
      message: `${issues.length} route(s) failed validation during build().`,
      errors: issues,
    });
  }

  private packSnapshot(state: BuildState<T>): RegistrationSnapshot<T> {
    const terminalSlab = packTerminalSlab(state.terminalHandlers, state.isWildcardByTerminal, state.presentBitmaskByTerminal);

    return {
      staticByMethod: state.staticByMethod,
      staticPathMethodMask: state.staticPathMethodMask,
      segmentTrees: Object.freeze([...state.segmentTrees]) as Array<SegmentNode | null>,
      handlers: state.handlers,
      terminalSlab,
      paramsFactories: state.paramsFactories,
      maxParamsObserved: state.maxParamsObserved,
    };
  }

  private assertNotSealed(ctx: { path?: string; method?: string; registeredCount?: number }): void {
    if (!this.sealed) {
      return;
    }

    throw new RouterError({
      kind: RouterErrorKind.RouterSealed,
      message: 'Cannot add routes after build(). The router is sealed.',
      suggestion: 'Create a new Router instance to add more routes',
      ...ctx,
    });
  }

  private compileRoute(
    route: PendingRoute<T>,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
    routeID: number,
    factoryCache: FactoryCache,
    omitBehavior: boolean,
    decoder: (s: string) => string,
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

    if (!isDynamic) {
      return this.compileStaticRoute(route, parts, normalized, methodCode, state, undo);
    }

    return this.compileDynamicRoute(route, parts, methodCode, state, undo, routeID, factoryCache, omitBehavior, decoder);
  }

  private compileStaticRoute(
    route: PendingRoute<T>,
    parts: PathPart[],
    normalized: string,
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    const conflict = this.runPrefixIndexPlan(parts, methodCode, route, undo);

    if (isErr(conflict)) {
      return conflict;
    }

    let bucket = state.staticByMethod[methodCode];
    if (bucket === undefined) {
      bucket = Object.create(null) as Record<string, T>;
      state.staticByMethod[methodCode] = bucket;
      pushStaticBucketResetUndo(undo, state.staticByMethod, methodCode);
    }

    if (normalized in bucket) {
      return err<RouterErrorData>({
        kind: RouterErrorKind.RouteDuplicate,
        message: `Route already exists: ${route.method} ${normalized}`,
        path: route.path,
        method: route.method,
        suggestion: 'Use a different path or HTTP method',
      });
    }

    bucket[normalized] = route.value;
    const prevMask = state.staticPathMethodMask[normalized] ?? 0;
    state.staticPathMethodMask[normalized] = prevMask | (1 << methodCode);
    pushStaticMapDeleteUndo(undo, bucket, normalized);
    undo.push({
      k: UndoKind.StaticPathMaskRestore,
      map: state.staticPathMethodMask,
      key: normalized,
      prevMask,
    });
    return undefined;
  }

  private compileDynamicRoute(
    route: PendingRoute<T>,
    parts: PathPart[],
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
    routeID: number,
    factoryCache: FactoryCache,
    omitBehavior: boolean,
    decoder: (s: string) => string,
  ): Result<void, RouterErrorData> {
    const shape = collectRouteShape(parts);
    const capCheck = checkDynamicRouteCaps(route, shape);
    if (capCheck !== undefined) {
      return err(capCheck);
    }

    const root = ensureSegmentTreeRoot(state, methodCode, undo);
    const hIdx = pushHandler(state, route.value, undo);
    const expansion = expandOptional(parts, -1, this.optionalParamDefaults);

    for (const expanded of expansion) {
      const prefixCheck = this.runPrefixIndexPlan(expanded.parts, methodCode, route, undo, hIdx, expanded.isOptionalExpansion);
      if (isErr(prefixCheck)) {
        return prefixCheck;
      }

      const tIdx = recordExpansionTerminal(state, expanded.parts, shape, hIdx, factoryCache, omitBehavior, decoder, undo);

      const insertResult = insertIntoSegmentTree(root, expanded.parts, tIdx, state.testerCache, routeID, undo);
      if (isErr(insertResult)) {
        const data = insertResult.data;
        if (data.kind === RouterErrorKind.RouteDuplicate) {
          data.message = `Route already exists: ${route.method} ${route.path}`;
        }
        return err<RouterErrorData>({ ...data, path: route.path, method: route.method });
      }
    }
    return undefined;
  }

  private runPrefixIndexPlan(
    parts: PathPart[],
    methodCode: number,
    route: PendingRoute<T>,
    undo: SegmentTreeUndoLog,
    handlerSlotId: number = -1,
    isOptionalExpansion: boolean = false,
  ): Result<void, RouterErrorData> {
    const idx = this.prefixIndex!;
    const registry = this.identityRegistry!;
    const handlerId = handlerSlotId >= 0 ? handlerSlotId : registry.idFor(route.value);
    const meta: RouteMeta = {
      routeIndex: this.routeIdCounter++,
      path: route.path,
      method: route.method,
      handlerId,
      isOptionalExpansion,
    };
    const planResult = idx.planAndCommit(methodCode, parts, meta);
    if (isErr(planResult)) {
      return err<RouterErrorData>({ ...planResult.data, path: route.path, method: route.method });
    }
    if (planResult === 'alias') {
      return undefined;
    }
    undo.push({
      k: UndoKind.PrefixIndexPlan,
      rollback: rollbackPlan as (plan: unknown) => void,
      plan: planResult as CommitPlan,
    });
    return undefined;
  }
}

function createBuildState<T>(): BuildState<T> {
  return {
    staticByMethod: [],
    staticPathMethodMask: Object.create(null) as Record<string, number>,
    segmentTrees: [],
    handlers: [],
    terminalHandlers: [],
    isWildcardByTerminal: [],
    paramsFactories: [],
    presentBitmaskByTerminal: [],
    testerCache: new Map(),
    routeCounter: 0,
    maxParamsObserved: 0,
  };
}

function applyTenantFactors(segmentTrees: ReadonlyArray<SegmentNode | null>): void {
  let factorApplied = false;
  for (const root of segmentTrees) {
    if (root === undefined || root === null) {
      continue;
    }
    const factor = detectTenantFactor(root);
    if (factor === null) {
      continue;
    }
    setTenantFactor(root, factor);
    root.staticChildren = null;
    root.singleChildKey = null;
    root.singleChildNext = null;
    factorApplied = true;
  }
  if (factorApplied) {
    Bun.gc(true);
  }
}

function rollback(undo: SegmentTreeUndoLog, mark: number): void {
  for (let i = undo.length - 1; i >= mark; i--) {
    applyUndo(undo[i]!);
  }

  undo.length = mark;
}

interface RouteShape {
  originalNames: ReadonlyArray<string>;
  originalTypes: ReadonlyArray<PathPartType.Param | PathPartType.Wildcard>;
  optionalCount: number;
}

function collectRouteShape(parts: ReadonlyArray<PathPart>): RouteShape {
  const originalNames: string[] = [];
  const originalTypes: Array<PathPartType.Param | PathPartType.Wildcard> = [];
  let optionalCount = 0;
  for (const p of parts) {
    if (p.type === PathPartType.Param) {
      originalNames.push(p.name);
      originalTypes.push(PathPartType.Param);
      if (p.optional) {
        optionalCount++;
      }
    } else if (p.type === PathPartType.Wildcard) {
      originalNames.push(p.name);
      originalTypes.push(PathPartType.Wildcard);
    }
  }
  return { originalNames, originalTypes, optionalCount };
}

function checkDynamicRouteCaps(route: { path: string }, shape: RouteShape): RouterErrorData | undefined {
  if (shape.optionalCount > MAX_OPTIONAL_SEGMENTS_PER_ROUTE) {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Route has ${shape.optionalCount} optional segments; maximum is ${MAX_OPTIONAL_SEGMENTS_PER_ROUTE} to cap expansion variants before 2^N growth.`,
      path: route.path,
      suggestion: `Reduce optional segments to ${MAX_OPTIONAL_SEGMENTS_PER_ROUTE} or fewer, or register explicit routes for the rare combinations.`,
    };
  }
  if (shape.originalNames.length > 31) {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Route has ${shape.originalNames.length} capturing segments; maximum is 31 (Int32 bitmask ceiling).`,
      path: route.path,
      suggestion: 'Reduce the number of :param/*wildcard segments per route.',
    };
  }
  return undefined;
}

function ensureSegmentTreeRoot<T>(state: BuildState<T>, methodCode: number, undo: SegmentTreeUndoLog): SegmentNode {
  const existing = state.segmentTrees[methodCode];
  if (existing !== undefined && existing !== null) {
    return existing;
  }
  const fresh = createSegmentNode();
  state.segmentTrees[methodCode] = fresh;
  undo.push({ k: UndoKind.SegmentTreeReset, trees: state.segmentTrees, mc: methodCode });
  return fresh;
}

function pushHandler<T>(state: BuildState<T>, value: T, undo: SegmentTreeUndoLog): number {
  const hIdx = state.handlers.length;
  state.handlers.push(value);
  undo.push({ k: UndoKind.HandlersTruncate, arr: state.handlers, len: hIdx });
  return hIdx;
}

function recordExpansionTerminal<T>(
  state: BuildState<T>,
  expParts: ReadonlyArray<PathPart>,
  shape: RouteShape,
  hIdx: number,
  factoryCache: FactoryCache,
  omitBehavior: boolean,
  decoder: (s: string) => string,
  undo: SegmentTreeUndoLog,
): number {
  const present: Array<{ name: string; type: PathPartType.Param | PathPartType.Wildcard }> = [];
  for (const p of expParts) {
    if (p.type === PathPartType.Param || p.type === PathPartType.Wildcard) {
      present.push({ name: p.name, type: p.type });
    }
  }
  if (present.length > state.maxParamsObserved) {
    state.maxParamsObserved = present.length;
  }

  const tIdx = state.terminalHandlers.length;
  const isWildcard = expParts.length > 0 && expParts[expParts.length - 1]!.type === PathPartType.Wildcard;
  const presentBitmask = computePresentBitmask(shape.originalNames, present);
  const factory =
    present.length > 0 || (!omitBehavior && shape.originalNames.length > 0)
      ? getOrCreateSuperFactory(factoryCache, shape.originalNames, shape.originalTypes, omitBehavior, decoder)
      : null;

  state.terminalHandlers[tIdx] = hIdx;
  state.isWildcardByTerminal[tIdx] = isWildcard;
  state.paramsFactories[tIdx] = factory;
  state.presentBitmaskByTerminal[tIdx] = presentBitmask;
  undo.push({
    k: UndoKind.TerminalArraysTruncate,
    t: state.terminalHandlers,
    w: state.isWildcardByTerminal,
    f: state.paramsFactories,
    b: state.presentBitmaskByTerminal,
    len: tIdx,
  });
  return tIdx;
}

export { checkDynamicRouteCaps, collectRouteShape, Registration };
export type { RegistrationSnapshot };
