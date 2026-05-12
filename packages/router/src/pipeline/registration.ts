import type { Result } from '@zipbul/result';
import type { PathPart } from '../builder/path-parser';
import type { SegmentNode, SegmentTreeUndoLog } from '../matcher/segment-tree';
import { applyUndo, setPrefixIndexRollback } from '../matcher/segment-tree';
import type { RouterErrorData, RouteParams } from '../types';
import type { RouteValidationIssue } from '../types';
import type { PatternTesterFn } from '../matcher/pattern-tester';

import { performance } from 'node:perf_hooks';
import { err, isErr } from '@zipbul/result';
import { OptionalParamDefaults } from '../builder/optional-param-defaults';
import { PathParser } from '../builder/path-parser';
import { expandOptional } from '../builder/route-expand';
import { RouterError } from '../error';
import { MethodRegistry } from '../method-registry';
import { createSegmentNode, detectTenantFactor, insertIntoSegmentTree, setTenantFactor } from '../matcher/segment-tree';
import { decoder } from '../matcher/decoder';
import { NullProtoObj } from '../internal/null-proto-obj';
import { WildcardPrefixIndex, rollbackPlan, type RouteMeta, type CommitPlan } from './wildcard-prefix-index';

// One-time wiring: dispatch UndoKind.PrefixIndexPlan from segment-tree's
// applyUndo() down into the prefix-index module. Done here so the matcher
// layer has no upward dependency on the pipeline layer.
setPrefixIndexRollback(rollbackPlan as (plan: unknown) => void);
import { IdentityRegistry } from './identity-registry';
import { UndoKind } from '../matcher/segment-tree';

const WILDCARD_METHOD = '*' as const;

/**
 * How many routes to process between full GC + libpas scavenge cycles
 * during the seal route loop. JSC's `proportionalHeapSize` heuristic
 * locks the GC arena capacity to whatever the heap peaks at — letting
 * 100k routes go uninterrupted causes the arena to settle far higher
 * than necessary because transient parser/expand/prefix-index data
 * briefly co-exists with the retained tree. Draining every 10k routes
 * gives back ~17 MB of steady-state RSS at 100k for ~230 ms of build
 * time. The threshold trades build latency for memory; below ~5k the
 * scavenge overhead dominates and below ~1k it explodes the build.
 */
const BUILD_CHUNK_SIZE = 10_000;

interface PendingRoute<T> {
  method: string;
  path: string;
  value: T;
}


/**
 * Snapshot of build-time products.
 *
 * Static-route storage is method-major (`staticByMethod[methodCode][path]`)
 * rather than path-major. The previous shape was
 * `staticMap[path]: Array<T | undefined>` plus a parallel `boolean[]`
 * registered table; that allocated two 1-entry arrays per path and ran
 * ~160ms over a 100k high-fanout build. Method-major keeps allocation to
 * one Record per active method (plus the terminal value entries themselves).
 *
 * `staticPathMethodMask` accumulates a 32-bit bitmask of method codes
 * registered for each static path. `allowedMethods()` reads it as a
 * single property + popcount + bit-iteration via `Math.clz32`, avoiding
 * the per-active-method bucket probe loop.
 */
/**
 * Per-terminal metadata slab packed as `Int32Array`. Two slots per
 * terminal index `t`:
 *   - `slab[t*2]` — handler index into `handlers[]`
 *   - `slab[t*2 + 1]` — `1` if the terminal corresponds to a wildcard
 *     match, `0` otherwise
 * The slab is sized once at seal-time from the build-state arrays;
 * walker reads it as contiguous typed memory.
 */
const TERMINAL_SLOTS = 2;
const TERMINAL_HANDLER_OFFSET = 0;
const TERMINAL_IS_WILDCARD_OFFSET = 1;

export interface RegistrationSnapshot<T> {
  staticByMethod: Array<Record<string, T> | undefined>;
  staticPathMethodMask: Record<string, number>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  terminalSlab: Int32Array;
  paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
  /** True iff any registered route declared a regex pattern tester. The
   *  full tester cache is build-only and not retained on the snapshot. */
  anyTester: boolean;
}

interface BuildState<T> {
  staticByMethod: Array<Record<string, T> | undefined>;
  staticPathMethodMask: Record<string, number>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  /** Build-time growable parallel arrays — converted to a packed
   *  Int32Array slab at seal time. Kept as plain JS arrays during build
   *  so per-route insertion stays O(1) without resizing TypedArrays. */
  terminalHandlers: number[];
  isWildcardByTerminal: boolean[];
  paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
  /** Build-only tester cache (deduped by pattern source). Not retained
   *  on the snapshot — runtime only needs the resulting per-route
   *  testers attached to ParamSegment. */
  testerCache: Map<string, PatternTesterFn>;
  routeCounter: number;
  diagnostics: RegistrationDiagnostics | null;
}

interface RegistrationDiagnostics {
  routes: number;
  staticRoutes: number;
  dynamicRoutes: number;
  expandedRoutes: number;
  wildcardRoutes: number;
  methodMs: number;
  parseMs: number;
  wildcardNameMs: number;
  staticWildcardConflictMs: number;
  prefixIndexPlanMs: number;
  routeLoopOverheadMs: number;
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
  private maxOptionalExpansions = 1024;
  private totalExpandedRoutes = 0;
  private expansionLimitEmitted = false;
  private prefixIndex: WildcardPrefixIndex | null = null;
  private identityRegistry: IdentityRegistry | null = null;
  private routeIdCounter = 0;
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

  get staticByMethod(): RegistrationSnapshot<T>['staticByMethod'] | undefined {
    return this.snapshot?.staticByMethod;
  }

  get segmentTrees(): RegistrationSnapshot<T>['segmentTrees'] | undefined {
    return this.snapshot?.segmentTrees;
  }

  get handlers(): RegistrationSnapshot<T>['handlers'] | undefined {
    return this.snapshot?.handlers;
  }

  get terminalSlab(): RegistrationSnapshot<T>['terminalSlab'] | undefined {
    return this.snapshot?.terminalSlab;
  }

  get paramsFactories(): RegistrationSnapshot<T>['paramsFactories'] | undefined {
    return this.snapshot?.paramsFactories;
  }

  getDiagnostics(): RegistrationDiagnostics | null {
    return this.diagnostics;
  }

  add(method: string | readonly string[], path: string, value: T): void {
    this.assertNotSealed({ path, method: Array.isArray(method) ? method[0] : (method as string) });

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

    this.pendingRoutes.push({ method: method as string, path, value });
  }

  addAll(entries: ReadonlyArray<readonly [string, string, T]>): void {
    this.assertNotSealed({ registeredCount: 0 });

    for (const [method, path, value] of entries) {
      this.pendingRoutes.push({ method, path, value });
    }
  }

  seal(options: {
    optionalParamBehavior?: 'omit' | 'set-undefined';
    maxExpandedRoutes?: number;
    maxOptionalExpansions?: number;
    maxRegexSiblingsPerSegment?: number;
  } = {}): RegistrationSnapshot<T> {
    if (this.snapshot !== null) return this.snapshot;

    const pendingRouteCount = this.pendingRoutes.length;
    const methodRegistrySnapshot = this.methodRegistry.snapshot();
    const optionalDefaultsSnapshot = this.optionalParamDefaults.snapshot();
    const state = createBuildState<T>(process.env.ZIPBUL_ROUTER_DIAGNOSTICS === '1');
    const issues: RouteValidationIssue[] = [];
    const undo: SegmentTreeUndoLog = [];

    const factoryCache = new Map<string, (u: string, v: Int32Array) => RouteParams>();
    const omitBehavior = (options.optionalParamBehavior ?? 'omit') === 'omit';
    this.maxExpandedRoutes = options.maxExpandedRoutes ?? 200_000;
    this.maxOptionalExpansions = options.maxOptionalExpansions ?? 1024;
    this.totalExpandedRoutes = 0;
    this.expansionLimitEmitted = false;
    this.prefixIndex = new WildcardPrefixIndex(options.maxRegexSiblingsPerSegment ?? 32);
    this.identityRegistry = new IdentityRegistry();
    this.routeIdCounter = 0;

    // Resolve `*`-method registrations against the set of methods present at
    // seal time (built-ins plus any custom token registered before seal).
    // Common case (no `*` registrations) skips the whole expansion — at 100k
    // routes that's 100k avoided allocations and one full array copy.
    let hasWildcardMethod = false;
    for (let i = 0; i < this.pendingRoutes.length; i++) {
      if (this.pendingRoutes[i]!.method === WILDCARD_METHOD) {
        hasWildcardMethod = true;
        break;
      }
    }
    if (hasWildcardMethod) {
      const expanded: PendingRoute<T>[] = [];
      // Set-backed dedup: previous `Array.includes` was O(n×m) over
      // (pendingRoutes × sealMethods). Bench `bench/method-research/
      // F-wildcard-includes-vs-set.bench.ts` shows 1.19-2.20× win across
      // 10k/100k routes with 0/25 custom methods (2.7 ms saved at the
      // 100k+25 worst case).
      const sealMethods: string[] = [];
      const seen = new Set<string>();
      for (const [name] of this.methodRegistry.getAllCodes()) {
        sealMethods.push(name);
        seen.add(name);
      }
      for (const r of this.pendingRoutes) {
        if (r.method !== WILDCARD_METHOD && !seen.has(r.method)) {
          seen.add(r.method);
          sealMethods.push(r.method);
        }
      }
      for (const r of this.pendingRoutes) {
        if (r.method === WILDCARD_METHOD) {
          for (const m of sealMethods) expanded.push({ method: m, path: r.path, value: r.value });
        } else {
          expanded.push(r);
        }
      }
      // Replace pendingRoutes contents in place. `push(...expanded)`
      // would spread every element as a function argument — at 100k
      // routes that approaches the engine's arg-list cap (the spec gives
      // no upper bound but JSC traditionally throws RangeError around
      // ~500k args). A simple length swap + index assignment side-steps
      // the cap entirely.
      this.pendingRoutes.length = expanded.length;
      for (let i = 0; i < expanded.length; i++) this.pendingRoutes[i] = expanded[i]!;
    }

    const loopStart = state.diagnostics !== null ? nowMs() : 0;
    // Drain transient build allocations every BUILD_CHUNK_SIZE routes
    // so the JSC heap doesn't peak proportionally to the full route
    // count. The heap-capacity heuristic locks in the high-water mark,
    // so a controlled-growth loop settles to a smaller capacity than
    // a single uninterrupted insert burst.
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

      // Periodic drain: keep the JSC heap below the proportionalHeapSize
      // threshold so the GC arena settles small. Skip the last batch
      // (the snapshot/walker phases will allocate again immediately).
      if ((i + 1) % BUILD_CHUNK_SIZE === 0 && i + 1 < this.pendingRoutes.length) {
        // If every route in this batch (and every batch before it)
        // succeeded, the accumulated undo log is dead weight: a later
        // batch failure throws RouterError and abandons the whole
        // build state anyway (the local `state` goes out of scope, the
        // next build() call constructs a fresh prefix index). Drop it
        // before the GC so the closure-captured PrefixIndex CommitPlan
        // entries become eligible for collection.
        if (issues.length === 0) undo.length = 0;
        // Bun.gc(true) runs JSC's full collect AND mimalloc's fragmented-
        // memory cleanup in one call. Bun.shrink() saved an extra ~8 MB
        // historically but is `@deprecated` in bun-types 1.3.13 and may
        // disappear in a future release; we accept the marginal RSS cost
        // in exchange for forward compatibility.
        Bun.gc(true);
      }
    }
    if (state.diagnostics !== null) state.diagnostics.routeLoopOverheadMs = nowMs() - loopStart;

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
    // Pack the per-terminal parallel arrays into a single Int32Array slab
    // so the runtime walker reads contiguous memory rather than chasing
    // two JS arrays. 2 slots per terminal: handlerIdx, isWildcard.
    const terminalCount = state.terminalHandlers.length;
    const terminalSlab = new Int32Array(terminalCount * TERMINAL_SLOTS);
    for (let t = 0; t < terminalCount; t++) {
      terminalSlab[t * TERMINAL_SLOTS + TERMINAL_HANDLER_OFFSET] = state.terminalHandlers[t]!;
      terminalSlab[t * TERMINAL_SLOTS + TERMINAL_IS_WILDCARD_OFFSET] = state.isWildcardByTerminal[t] ? 1 : 0;
    }

    const snapshot: RegistrationSnapshot<T> = {
      staticByMethod: state.staticByMethod,
      staticPathMethodMask: state.staticPathMethodMask,
      segmentTrees: Object.freeze([...state.segmentTrees]) as Array<SegmentNode | null>,
      handlers: state.handlers,
      terminalSlab,
      paramsFactories: state.paramsFactories,
      anyTester: state.testerCache.size > 0,
    };
    addMs(state.diagnostics, 'snapshotMs', snapshotStart);

    this.snapshot = snapshot;
    // Build-only structures (prefix index, identity registry) are discarded
    // here so they do not retain memory past snapshot publication.
    this.prefixIndex = null;
    this.identityRegistry = null;
    // Tenant-prefix factor detection. When a method's root has a high-fanout
    // sibling group whose subtrees only differ in the terminal handler index,
    // collapse them onto a single canonical subtree + Map<prefix, handler>.
    // Empirical (100k tenant `/tenant-${i}/users/:id/posts/:postId`):
    // 706k objects → 206k objects, RSS 220 MB → ~50 MB once libpas scavenges
    // the orphaned subtrees (~300 ms after Bun.gc).
    let factorApplied = false;
    for (const root of state.segmentTrees) {
      if (root === undefined || root === null) continue;
      const factor = detectTenantFactor(root);
      if (factor !== null) {
        setTenantFactor(root, factor);
        // Drop the original high-fanout staticChildren now that the
        // factor map owns the dispatch — they're no longer reachable
        // from the walker.
        root.staticChildren = null;
        root.singleChildKey = null;
        root.singleChildNext = null;
        factorApplied = true;
      }
    }
    if (factorApplied) Bun.gc(true);
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
    // Same-prefix wildcard-name collisions are detected by the prefix index
    // walk (descendant terminal/wildcard => route-unreachable), so the
    // legacy per-route prefix-regex check is no longer needed.

    if (!isDynamic) {
      if (state.diagnostics !== null) state.diagnostics.staticRoutes++;
      return this.compileStaticRoute(route, parts, normalized, methodCode, state, undo);
    }

    if (state.diagnostics !== null) state.diagnostics.dynamicRoutes++;
    return this.compileDynamicRoute(
      route, parts, methodCode, state, undo, routeID, 
      factoryCache, omitBehavior, decoder
    );
  }

  private compileStaticRoute(
    route: PendingRoute<T>,
    parts: PathPart[],
    normalized: string,
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
  ): Result<void, RouterErrorData> {
    const conflictStart = nowMs();
    const conflict = this.runPrefixIndexPlan(parts, methodCode, route, undo, state);
    addMs(state.diagnostics, 'staticWildcardConflictMs', conflictStart);

    if (isErr(conflict)) return conflict;

    const insertStart = nowMs();
    let bucket = state.staticByMethod[methodCode];
    if (bucket === undefined) {
      bucket = Object.create(null) as Record<string, T>;
      state.staticByMethod[methodCode] = bucket;
      undo.push({
        k: UndoKind.SegmentTreeReset,
        trees: state.staticByMethod as unknown as Array<SegmentNode | null | undefined>,
        mc: methodCode,
      });
    }

    if (normalized in bucket) {
      return err<RouterErrorData>({
        kind: 'route-duplicate',
        message: `Route already exists: ${route.method} ${normalized}`,
        path: route.path,
        method: route.method,
        suggestion: 'Use a different path or HTTP method',
      });
    }

    bucket[normalized] = route.value;
    const prevMask = state.staticPathMethodMask[normalized] ?? 0;
    state.staticPathMethodMask[normalized] = prevMask | (1 << methodCode);
    undo.push({
      k: UndoKind.StaticMapDelete,
      map: bucket as unknown as Record<string, unknown>,
      reg: bucket as unknown as Record<string, unknown>,
      key: normalized,
    });
    // Restore the path's method-mask bit on rollback. Tagged record keeps
    // the prior mask in a monomorphic shape so 100k static-route builds
    // don't allocate 100k distinct closures (each freshly capturing
    // `maskMap`/`maskKey`/`prevMask` in its own scope chain).
    undo.push({
      k: UndoKind.StaticPathMaskRestore,
      map: state.staticPathMethodMask,
      key: normalized,
      prevMask,
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
    const expansion = expandOptional(parts, -1, this.optionalParamDefaults, this.maxOptionalExpansions);
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
      undo.push({ k: UndoKind.SegmentTreeReset, trees: state.segmentTrees, mc: methodCode });
    }

    const hIdx = state.handlers.length;
    state.handlers.push(route.value);
    undo.push({ k: UndoKind.HandlersTruncate, arr: state.handlers, len: hIdx });

    for (const expanded of expansion) {
      const expParts = expanded.parts;
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
      const prefixCheck = this.runPrefixIndexPlan(
        expParts,
        methodCode,
        route,
        undo,
        state,
        hIdx,
        expanded.isOptionalExpansion,
      );
      if (isErr(prefixCheck)) return prefixCheck;
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
            body = 'var p = new NullProtoObj();\n';
            for (let j = 0; j < present.length; j++) {
              const pInfo = present[j]!;
              const start = j * 2;
              const end = j * 2 + 1;
              const val = `u.substring(v[${start}], v[${end}])`;
              body += `p[${JSON.stringify(pInfo.name)}] = ${pInfo.type === 'param' ? `decoder(${val})` : val};\n`;
            }
            body += 'return p;';
          } else {
            const presentNames = present.map(p => p.name);
            body = 'var p = new NullProtoObj();\n';
            for (const name of originalNames) {
              const idx = presentNames.indexOf(name);
              if (idx !== -1) {
                const pInfo = present[idx]!;
                const start = idx * 2;
                const end = idx * 2 + 1;
                const val = `u.substring(v[${start}], v[${end}])`;
                body += `p[${JSON.stringify(name)}] = ${pInfo.type === 'param' ? `decoder(${val})` : val};\n`;
              } else {
                body += `p[${JSON.stringify(name)}] = undefined;\n`;
              }
            }
            body += 'return p;';
          }
          cached = new Function('decoder', 'NullProtoObj', 'u', 'v', body).bind(null, decoder, NullProtoObj) as any;
          factoryCache.set(cacheKey, cached!);
        }
        factory = cached!;
        addMs(state.diagnostics, 'factoryMs', factoryStart);
      }

      state.terminalHandlers[tIdx] = hIdx;
      state.isWildcardByTerminal[tIdx] = isWildcard;
      state.paramsFactories[tIdx] = factory;
      undo.push({
        k: UndoKind.TerminalArraysTruncate,
        t: state.terminalHandlers,
        w: state.isWildcardByTerminal,
        f: state.paramsFactories,
        len: tIdx,
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

  private runPrefixIndexPlan(
    parts: PathPart[],
    methodCode: number,
    route: PendingRoute<T>,
    undo: SegmentTreeUndoLog,
    state: BuildState<T>,
    handlerSlotId: number = -1,
    isOptionalExpansion: boolean = false,
  ): Result<void, RouterErrorData> {
    const idx = this.prefixIndex;
    const registry = this.identityRegistry;
    if (idx === null || registry === null) {
      return err<RouterErrorData>({
        kind: 'router-sealed',
        message: 'Prefix index unavailable: router already sealed.',
        registeredCount: 0,
        suggestion: 'Construct a fresh Router instance to register additional routes.',
      });
    }
    const handlerId = handlerSlotId >= 0 ? handlerSlotId : registry.idFor(route.value);
    const meta: RouteMeta = {
      routeIndex: this.routeIdCounter++,
      path: route.path,
      method: route.method,
      handlerId,
      isOptionalExpansion,
    };
    if (state.diagnostics !== null) state.diagnostics.wildcardConflictChecks++;
    const planStart = state.diagnostics !== null ? nowMs() : 0;
    const planResult = idx.planAndCommit(methodCode, parts, meta);
    if (state.diagnostics !== null) state.diagnostics.prefixIndexPlanMs += nowMs() - planStart;
    if (isErr(planResult)) {
      return err<RouterErrorData>({ ...planResult.data, path: route.path, method: route.method });
    }
    if (planResult === 'alias') return undefined;
    undo.push({
      k: UndoKind.PrefixIndexPlan,
      plan: planResult as CommitPlan,
    });
    return undefined;
  }
}

function createBuildState<T>(withDiagnostics = false): BuildState<T> {
  return {
    staticByMethod: [],
    staticPathMethodMask: Object.create(null) as Record<string, number>,
    segmentTrees: [],
    handlers: [],
    terminalHandlers: [],
    isWildcardByTerminal: [],
    paramsFactories: [],
    testerCache: new Map(),
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
    prefixIndexPlanMs: 0,
    routeLoopOverheadMs: 0,
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
    // Inline single-static-child cache (T32). The diagnostic must
    // follow it, otherwise the reported node count silently undercounts
    // every compacted chain.
    if (node.singleChildNext !== null) stack.push(node.singleChildNext);
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
    applyUndo(undo[i]!);
  }

  undo.length = mark;
}
