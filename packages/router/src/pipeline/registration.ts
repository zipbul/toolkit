import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type { PathPart } from '../builder/path-parser';
import type { SegmentNode, SegmentTreeUndoLog } from '../matcher/segment-tree';
import type { RouterErrorData, RouteValidationIssue, RouteParams } from '../types';
import type { PatternTesterFn } from '../matcher/pattern-tester';

import { performance } from 'node:perf_hooks';
import { err, isErr } from '@zipbul/result';
import { OptionalParamDefaults } from '../builder/optional-param-defaults';
import { PathParser } from '../builder/path-parser';
import { expandOptional } from '../builder/route-expand';
import { RouterError } from '../error';
import { MethodRegistry } from '../method-registry';
import { createSegmentNode, insertIntoSegmentTree } from '../matcher/segment-tree';
import { buildDecoder } from '../matcher/decoder';

const WILDCARD_METHOD = '*' as const;

interface PendingRoute<T> {
  method: string;
  path: string;
  value: T;
}

export interface ParamMetadata {
  /** Parameters present in this specific expansion. */
  present: Array<{ name: string; type: 'param' | 'wildcard' }>;
  /** Every parameter name declared by the original route. */
  original: string[];
}

/**
 * Snapshot of build-time products.
 */
export interface RegistrationSnapshot<T> {
  staticMap: Record<string, Array<T | undefined>>;
  staticRegistered: Record<string, boolean[]>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  terminalHandlers: number[];
  isWildcardByTerminal: boolean[];
  paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
  testerCache: Map<string, PatternTesterFn>;
  wildcardNamesByMethod: Map<number, Map<string, string>>;
}

interface BuildState<T> {
  staticMap: Record<string, Array<T | undefined>>;
  staticRegistered: Record<string, boolean[]>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  terminalHandlers: number[];
  isWildcardByTerminal: boolean[];
  paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
  testerCache: Map<string, PatternTesterFn>;
  wildcardNamesByMethod: Map<number, Map<string, string>>;
  routeCounter: number;
  diagnostics: RegistrationDiagnostics | null;
}

export interface RegistrationDiagnostics {
  routes: number;
  staticRoutes: number;
  dynamicRoutes: number;
  expandedRoutes: number;
  wildcardRoutes: number;
  methodMs: number;
  parseMs: number;
  wildcardNameMs: number;
  staticWildcardConflictMs: number;
  staticInsertMs: number;
  optionalExpandMs: number;
  dynamicInsertMs: number;
  factoryMs: number;
  snapshotMs: number;
  wildcardConflictChecks: number;
  wildcardConflictPrefixScans: number;
  segmentNodeCount: number;
  staticChildMapCount: number;
  paramNodeCount: number;
  terminalCount: number;
  paramsFactorySlots: number;
  uniqueParamsFactoryCount: number;
  testerCount: number;
}

/**
 * `add()` records user intent only. `seal()` performs the authoritative
 * validation pass.
 */
export class Registration<T> {
  private readonly methodRegistry: MethodRegistry;
  private readonly pathParser: PathParser;
  private readonly optionalParamDefaults: OptionalParamDefaults;
  private readonly pendingRoutes: Array<PendingRoute<T>> = [];

  private snapshot: RegistrationSnapshot<T> | null = null;
  private diagnostics: RegistrationDiagnostics | null = null;
  private sealed = false;
  private maxExpandedRoutes = 200_000;
  private totalExpandedRoutes = 0;
  private expansionLimitEmitted = false;

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

  get terminalHandlers(): RegistrationSnapshot<T>['terminalHandlers'] | undefined {
    return this.snapshot?.terminalHandlers;
  }

  get isWildcardByTerminal(): RegistrationSnapshot<T>['isWildcardByTerminal'] | undefined {
    return this.snapshot?.isWildcardByTerminal;
  }

  get paramsFactories(): RegistrationSnapshot<T>['paramsFactories'] | undefined {
    return this.snapshot?.paramsFactories;
  }

  get testerCache(): RegistrationSnapshot<T>['testerCache'] | undefined {
    return this.snapshot?.testerCache;
  }

  get wildcardNamesByMethod(): RegistrationSnapshot<T>['wildcardNamesByMethod'] | undefined {
    return this.snapshot?.wildcardNamesByMethod;
  }

  getDiagnostics(): RegistrationDiagnostics | null {
    return this.diagnostics;
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, value: T): void {
    this.assertNotSealed({ path, method: Array.isArray(method) ? method[0] : method });

    if (Array.isArray(method)) {
      for (const m of method) this.pendingRoutes.push({ method: m, path, value });
      return;
    }

    if (method === '*') {
      // Defer expansion to seal() so methods registered after this call
      // (but before seal) are included.
      this.pendingRoutes.push({ method: WILDCARD_METHOD, path, value });
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

  seal(options: { optionalParamBehavior?: 'omit' | 'set-undefined'; maxExpandedRoutes?: number } = {}): RegistrationSnapshot<T> {
    if (this.snapshot !== null) return this.snapshot;

    const pendingRouteCount = this.pendingRoutes.length;
    const methodRegistrySnapshot = this.methodRegistry.snapshot();
    const optionalDefaultsSnapshot = this.optionalParamDefaults.snapshot();
    const state = createBuildState<T>(process.env.ZIPBUL_ROUTER_DIAGNOSTICS === '1');
    const issues: RouteValidationIssue[] = [];
    const undo: SegmentTreeUndoLog = [];

    const factoryCache = new Map<string, (u: string, v: Int32Array) => RouteParams>();
    const omitBehavior = (options.optionalParamBehavior ?? 'set-undefined') === 'omit';
    const decoder = buildDecoder();
    this.maxExpandedRoutes = options.maxExpandedRoutes ?? 200_000;
    this.totalExpandedRoutes = 0;
    this.expansionLimitEmitted = false;

    // Resolve `*`-method registrations against the set of methods present at
    // seal time (built-ins plus any custom token registered before seal).
    {
      const expanded: PendingRoute<T>[] = [];
      const sealMethods = (() => {
        const out: string[] = [];
        for (const [name] of this.methodRegistry.getAllCodes()) out.push(name);
        for (const r of this.pendingRoutes) {
          if (r.method !== WILDCARD_METHOD && !out.includes(r.method)) out.push(r.method);
        }
        return out;
      })();
      for (const r of this.pendingRoutes) {
        if (r.method === WILDCARD_METHOD) {
          for (const m of sealMethods) expanded.push({ method: m, path: r.path, value: r.value });
        } else {
          expanded.push(r);
        }
      }
      this.pendingRoutes.length = 0;
      this.pendingRoutes.push(...expanded);
    }

    for (let i = 0; i < this.pendingRoutes.length; i++) {
      const route = this.pendingRoutes[i]!;
      const mark = undo.length;
      const handlerMark = state.handlers.length;
      const terminalMark = state.terminalHandlers.length;
      const factoryMark = state.paramsFactories.length;
      const optionalMark = this.optionalParamDefaults.snapshot();
      const routeID = state.routeCounter++;
      
      const result = this.compileRoute(
        route, state, undo, routeID, 
        factoryCache, omitBehavior, decoder
      );

      if (isErr(result)) {
        rollback(undo, mark);
        state.handlers.length = handlerMark;
        state.terminalHandlers.length = terminalMark;
        state.isWildcardByTerminal.length = terminalMark;
        state.paramsFactories.length = factoryMark;
        this.optionalParamDefaults.restore(optionalMark);
        state.routeCounter--;
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
    this.pendingRoutes.length = 0; 

    const snapshotStart = nowMs();
    const snapshot: RegistrationSnapshot<T> = {
      staticMap: Object.freeze({ ...state.staticMap }),
      staticRegistered: Object.freeze({ ...state.staticRegistered }),
      segmentTrees: Object.freeze([...state.segmentTrees]) as Array<SegmentNode | null>,
      handlers: state.handlers,
      terminalHandlers: state.terminalHandlers,
      isWildcardByTerminal: state.isWildcardByTerminal,
      paramsFactories: state.paramsFactories,
      testerCache: state.testerCache,
      wildcardNamesByMethod: Object.freeze(new Map(
        [...state.wildcardNamesByMethod].map(([mc, names]) => [mc, Object.freeze(new Map(names))]),
      )),
    };
    addMs(state.diagnostics, 'snapshotMs', snapshotStart);

    this.snapshot = snapshot;
    if (state.diagnostics !== null) {
      const paramsFactorySlots = state.paramsFactories.filter(Boolean);
      state.diagnostics.routes = pendingRouteCount;
      state.diagnostics.terminalCount = state.terminalHandlers.length;
      state.diagnostics.paramsFactorySlots = paramsFactorySlots.length;
      state.diagnostics.uniqueParamsFactoryCount = new Set(paramsFactorySlots).size;
      state.diagnostics.testerCount = state.testerCache.size;
      for (const root of state.segmentTrees) {
        if (root === undefined || root === null) continue;
        const counts = countSegmentTree(root);
        state.diagnostics.segmentNodeCount += counts.nodes;
        state.diagnostics.staticChildMapCount += counts.staticMaps;
        state.diagnostics.paramNodeCount += counts.paramNodes;
      }
      this.diagnostics = state.diagnostics;
    }

    return snapshot;
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
    routeID: number,
    factoryCache: Map<string, (u: string, v: Int32Array) => RouteParams>,
    omitBehavior: boolean,
    decoder: (s: string) => string,
  ): Result<void, RouterErrorData> {
    const methodStart = nowMs();
    const offsetResult = this.methodRegistry.getOrCreate(route.method);
    addMs(state.diagnostics, 'methodMs', methodStart);

    if (isErr(offsetResult)) {
      return err<RouterErrorData>({ ...offsetResult.data, path: route.path });
    }

    const parseStart = nowMs();
    const parseResult = this.pathParser.parse(route.path);
    addMs(state.diagnostics, 'parseMs', parseStart);

    if (isErr(parseResult)) {
      return err<RouterErrorData>({
        ...parseResult.data,
        path: route.path,
        method: route.method,
      });
    }

    const { parts, normalized, isDynamic } = parseResult;
    const methodCode = offsetResult;
    const wildcardNameStart = nowMs();
    const wildcardResult = this.checkWildcardNameConflict(
      parts,
      normalized,
      methodCode,
      route.method,
      state.wildcardNamesByMethod,
      undo,
    );
    addMs(state.diagnostics, 'wildcardNameMs', wildcardNameStart);

    if (isErr(wildcardResult)) return wildcardResult;

    if (!isDynamic) {
      if (state.diagnostics !== null) state.diagnostics.staticRoutes++;
      return this.compileStaticRoute(route, normalized, methodCode, state, undo);
    }

    if (state.diagnostics !== null) state.diagnostics.dynamicRoutes++;
    return this.compileDynamicRoute(
      route, parts, methodCode, state, undo, routeID, 
      factoryCache, omitBehavior, decoder
    );
  }

  private compileStaticRoute(
    route: PendingRoute<T>,
    normalized: string,
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    const conflictStart = nowMs();
    const conflict = this.checkStaticWildcardConflict(
      normalized,
      methodCode,
      route.method,
      state.wildcardNamesByMethod,
      state.diagnostics,
    );
    addMs(state.diagnostics, 'staticWildcardConflictMs', conflictStart);

    if (isErr(conflict)) return conflict;

    const insertStart = nowMs();
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
    addMs(state.diagnostics, 'staticInsertMs', insertStart);
  }

  private compileDynamicRoute(
    route: PendingRoute<T>,
    parts: PathPart[],
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
    routeID: number,
    factoryCache: Map<string, (u: string, v: Int32Array) => RouteParams>,
    omitBehavior: boolean,
    decoder: (s: string) => string,
  ): Result<void, RouterErrorData> {
    const expandStart = nowMs();
    const expansion = expandOptional(parts, -1, this.optionalParamDefaults);
    addMs(state.diagnostics, 'optionalExpandMs', expandStart);

    if (isErr(expansion)) {
      return err<RouterErrorData>({ ...expansion.data, path: route.path, method: route.method });
    }

    const originalNames: string[] = [];
    for (const p of parts) {
      if (p.type === 'param' || p.type === 'wildcard') originalNames.push(p.name);
    }

    let root = state.segmentTrees[methodCode];

    if (root === undefined || root === null) {
      root = createSegmentNode();
      state.segmentTrees[methodCode] = root;
      undo.push(() => { delete state.segmentTrees[methodCode]; });
    }

    const hIdx = state.handlers.length;
    state.handlers.push(route.value);
    undo.push(() => { state.handlers.length = hIdx; });

    for (const { parts: expParts } of expansion) {
      if (++this.totalExpandedRoutes > this.maxExpandedRoutes) {
        if (this.expansionLimitEmitted) return;
        this.expansionLimitEmitted = true;
        return err<RouterErrorData>({
          kind: 'expansion-total-limit',
          message: `Total expanded routes exceed cap ${this.maxExpandedRoutes}.`,
          path: route.path,
          method: route.method,
          suggestion: `Reduce optional-param expansion across the registered routes, or raise maxExpandedRoutes (default 200000).`,
        });
      }
      if (state.diagnostics !== null) state.diagnostics.expandedRoutes++;
      const present: Array<{ name: string; type: 'param' | 'wildcard' }> = [];
      for (const p of expParts) {
        if (p.type === 'param' || p.type === 'wildcard') {
          present.push({ name: p.name, type: p.type });
        }
      }

      const tIdx = state.terminalHandlers.length;
      const isWildcard = expParts.length > 0 && expParts[expParts.length - 1]!.type === 'wildcard';
      if (isWildcard && state.diagnostics !== null) state.diagnostics.wildcardRoutes++;

      let factory: ((u: string, v: Int32Array) => RouteParams) | null = null;
      if (present.length > 0 || (!omitBehavior && originalNames.length > 0)) {
        const factoryStart = nowMs();
        const cacheKey = (omitBehavior ? 'O:' : 'S:') + originalNames.join(',') + '::' + present.map(p => p.name).join(',');
        let cached = factoryCache.get(cacheKey);

        if (cached === undefined) {
          let body: string;
          if (omitBehavior) {
            body = 'var p = { __proto__: null };\n';
            for (let j = 0; j < present.length; j++) {
              const pInfo = present[j]!;
              const start = j * 2;
              const end = j * 2 + 1;
              const val = `u.substring(v[${start}], v[${end}])`;
              body += `p[${JSON.stringify(pInfo.name)}] = ${pInfo.type === 'param' ? `decoder(${val})` : val};\n`;
            }
            body += 'return p;';
          } else {
            const entries: string[] = ['__proto__: null'];
            const presentNames = present.map(p => p.name);
            for (const name of originalNames) {
              const idx = presentNames.indexOf(name);
              if (idx !== -1) {
                const pInfo = present[idx]!;
                const start = idx * 2;
                const end = idx * 2 + 1;
                const val = `u.substring(v[${start}], v[${end}])`;
                entries.push(`${JSON.stringify(name)}: ${pInfo.type === 'param' ? `decoder(${val})` : val}`);
              } else {
                entries.push(`${JSON.stringify(name)}: undefined`);
              }
            }
            body = `return { ${entries.join(', ')} };`;
          }
          cached = new Function('decoder', 'u', 'v', body).bind(null, decoder) as any;
          factoryCache.set(cacheKey, cached!);
        }
        factory = cached!;
        addMs(state.diagnostics, 'factoryMs', factoryStart);
      }

      state.terminalHandlers[tIdx] = hIdx;
      state.isWildcardByTerminal[tIdx] = isWildcard;
      state.paramsFactories[tIdx] = factory;
      undo.push(() => { 
        state.terminalHandlers.length = tIdx;
        state.isWildcardByTerminal.length = tIdx;
        state.paramsFactories.length = tIdx;
      });

      const dynamicInsertStart = nowMs();
      const insertResult = insertIntoSegmentTree(
        root,
        expParts,
        tIdx,
        state.testerCache,
        routeID,
        undo,
      );
      addMs(state.diagnostics, 'dynamicInsertMs', dynamicInsertStart);

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
    diagnostics: RegistrationDiagnostics | null,
  ): Result<void, RouterErrorData> {
    const scope = wildcardNamesByMethod.get(methodCode);

    if (scope === undefined) return;

    if (diagnostics !== null) diagnostics.wildcardConflictChecks++;
    for (const [prefix, wildcardName] of scope) {
      if (diagnostics !== null) diagnostics.wildcardConflictPrefixScans++;
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

function createBuildState<T>(withDiagnostics = false): BuildState<T> {
  return {
    staticMap: Object.create(null) as Record<string, Array<T | undefined>>,
    staticRegistered: Object.create(null) as Record<string, boolean[]>,
    segmentTrees: [],
    handlers: [],
    terminalHandlers: [],
    isWildcardByTerminal: [],
    paramsFactories: [],
    testerCache: new Map(),
    wildcardNamesByMethod: new Map(),
    routeCounter: 0,
    diagnostics: withDiagnostics ? createDiagnostics() : null,
  };
}

function createDiagnostics(): RegistrationDiagnostics {
  return {
    routes: 0,
    staticRoutes: 0,
    dynamicRoutes: 0,
    expandedRoutes: 0,
    wildcardRoutes: 0,
    methodMs: 0,
    parseMs: 0,
    wildcardNameMs: 0,
    staticWildcardConflictMs: 0,
    staticInsertMs: 0,
    optionalExpandMs: 0,
    dynamicInsertMs: 0,
    factoryMs: 0,
    snapshotMs: 0,
    wildcardConflictChecks: 0,
    wildcardConflictPrefixScans: 0,
    segmentNodeCount: 0,
    staticChildMapCount: 0,
    paramNodeCount: 0,
    terminalCount: 0,
    paramsFactorySlots: 0,
    uniqueParamsFactoryCount: 0,
    testerCount: 0,
  };
}

function nowMs(): number {
  return performance.now();
}

function addMs(
  diagnostics: RegistrationDiagnostics | null,
  key: keyof Pick<RegistrationDiagnostics,
    'methodMs' | 'parseMs' | 'wildcardNameMs' | 'staticWildcardConflictMs' |
    'staticInsertMs' | 'optionalExpandMs' | 'dynamicInsertMs' | 'factoryMs' | 'snapshotMs'>,
  start: number,
): void {
  if (diagnostics !== null) diagnostics[key] += performance.now() - start;
}

function countSegmentTree(root: SegmentNode): { nodes: number; staticMaps: number; paramNodes: number } {
  let nodes = 0;
  let staticMaps = 0;
  let paramNodes = 0;
  const stack = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;
    nodes++;
    if (node.staticChildren !== null) {
      staticMaps++;
      for (const key in node.staticChildren) stack.push(node.staticChildren[key]!);
    }
    let param = node.paramChild;
    while (param !== null) {
      paramNodes++;
      stack.push(param.next);
      param = param.nextSibling;
    }
  }

  return { nodes, staticMaps, paramNodes };
}

function rollback(undo: SegmentTreeUndoLog, mark: number): void {
  for (let i = undo.length - 1; i >= mark; i--) {
    undo[i]!();
  }

  undo.length = mark;
}
