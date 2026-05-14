import type { Result } from '@zipbul/result';
import type { PathPart } from '../builder/path-parser';
import type { SegmentNode, SegmentTreeUndoLog } from '../matcher/segment-tree';
import { applyUndo, setPrefixIndexRollback } from '../matcher/segment-tree';
import type { RouterErrorData, RouteParams } from '../types';
import type { RouteValidationIssue } from '../types';
import type { PatternTesterFn } from '../matcher/pattern-tester';

import { err, isErr } from '@zipbul/result';
import { OptionalParamDefaults } from '../builder/optional-param-defaults';
import { PathParser } from '../builder/path-parser';
import { countOptionalSegments, expandOptional, MAX_OPTIONAL_SEGMENTS_PER_ROUTE } from '../builder/route-expand';
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
 * Per-terminal metadata slab packed as `Int32Array`. Three slots per
 * terminal index `t`:
 *   - `slab[t*3]` — handler index into `handlers[]`
 *   - `slab[t*3 + 1]` — `1` if the terminal corresponds to a wildcard
 *     match, `0` otherwise
 *   - `slab[t*3 + 2]` — present-param bitmask. Bit `i` set ⇔ originalNames[i]
 *     is present in this expansion variant. The compiled super-factory uses
 *     this mask to select which originalName receives a captured value vs.
 *     undefined, eliminating the need for a per-variant factory function
 *     (factoryCache size goes from O(2^N) variants to O(1) per route shape).
 */
const TERMINAL_SLOTS = 3;
const TERMINAL_HANDLER_OFFSET = 0;
const TERMINAL_IS_WILDCARD_OFFSET = 1;
const TERMINAL_PRESENT_BITMASK_OFFSET = 2;

export interface RegistrationSnapshot<T> {
  staticByMethod: Array<Record<string, T> | undefined>;
  staticPathMethodMask: Record<string, number>;
  segmentTrees: Array<SegmentNode | null>;
  handlers: T[];
  terminalSlab: Int32Array;
  paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
  /** True iff any registered route declared a regex pattern tester. The
   *  full tester cache is build-only and not retained on the snapshot. */
  anyTester: boolean;
  /** Maximum param count observed across every expanded route. Used at
   *  build-time to size the runtime `MatchState.paramOffsets` Int32Array
   *  exactly — no user option, no arbitrary fallback. */
  maxParamsObserved: number;
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
  paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
  /** Per-terminal presentBitmask (build-time growable, packed into
   *  terminalSlab at seal). Bit i set ⇔ originalNames[i] is captured. */
  presentBitmaskByTerminal: number[];
  /** Build-only tester cache (deduped by pattern source). Not retained
   *  on the snapshot — runtime only needs the resulting per-route
   *  testers attached to ParamSegment. */
  testerCache: Map<string, PatternTesterFn>;
  routeCounter: number;
  /** Tracks max present-param count across every expanded route so the
   *  runtime paramOffsets buffer is sized exactly. */
  maxParamsObserved: number;
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
  private sealed = false;
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
  } = {}): RegistrationSnapshot<T> {
    if (this.snapshot !== null) return this.snapshot;

    const methodRegistrySnapshot = this.methodRegistry.snapshot();
    const optionalDefaultsSnapshot = this.optionalParamDefaults.snapshot();
    const state = createBuildState<T>();
    const issues: RouteValidationIssue[] = [];
    const undo: SegmentTreeUndoLog = [];

    const factoryCache = new Map<string, (presentBitmask: number, u: string, v: Int32Array) => RouteParams>();
    const omitBehavior = (options.optionalParamBehavior ?? 'omit') === 'omit';
    this.prefixIndex = new WildcardPrefixIndex();
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

    // Pack the per-terminal parallel arrays into a single Int32Array slab
    // so the runtime walker reads contiguous memory rather than chasing
    // three JS arrays. 3 slots per terminal: handlerIdx, isWildcard,
    // presentBitmask. The bitmask drives the super-factory body's per-name
    // gate, replacing what used to be 2^N distinct factory functions.
    const terminalCount = state.terminalHandlers.length;
    const terminalSlab = new Int32Array(terminalCount * TERMINAL_SLOTS);
    for (let t = 0; t < terminalCount; t++) {
      terminalSlab[t * TERMINAL_SLOTS + TERMINAL_HANDLER_OFFSET] = state.terminalHandlers[t]!;
      terminalSlab[t * TERMINAL_SLOTS + TERMINAL_IS_WILDCARD_OFFSET] = state.isWildcardByTerminal[t] ? 1 : 0;
      terminalSlab[t * TERMINAL_SLOTS + TERMINAL_PRESENT_BITMASK_OFFSET] = state.presentBitmaskByTerminal[t] ?? 0;
    }

    const snapshot: RegistrationSnapshot<T> = {
      staticByMethod: state.staticByMethod,
      staticPathMethodMask: state.staticPathMethodMask,
      segmentTrees: Object.freeze([...state.segmentTrees]) as Array<SegmentNode | null>,
      handlers: state.handlers,
      terminalSlab,
      paramsFactories: state.paramsFactories,
      anyTester: state.testerCache.size > 0,
      maxParamsObserved: state.maxParamsObserved,
    };

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
    factoryCache: Map<string, (presentBitmask: number, u: string, v: Int32Array) => RouteParams>,
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
    // Same-prefix wildcard-name collisions are detected by the prefix index
    // walk (descendant terminal/wildcard => route-unreachable), so the
    // legacy per-route prefix-regex check is no longer needed.

    if (!isDynamic) {
      return this.compileStaticRoute(route, parts, normalized, methodCode, state, undo);
    }

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
    const conflict = this.runPrefixIndexPlan(parts, methodCode, route, undo);

    if (isErr(conflict)) return conflict;

    let bucket = state.staticByMethod[methodCode];
    if (bucket === undefined) {
      bucket = Object.create(null) as Record<string, T>;
      state.staticByMethod[methodCode] = bucket;
      undo.push({
        k: UndoKind.StaticBucketReset,
        buckets: state.staticByMethod as unknown as Array<Record<string, unknown> | undefined>,
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
  }

  private compileDynamicRoute(
    route: PendingRoute<T>,
    parts: PathPart[],
    methodCode: number,
    state: BuildState<T>,
    undo: SegmentTreeUndoLog,
    routeID: number,
    factoryCache: Map<string, (presentBitmask: number, u: string, v: Int32Array) => RouteParams>,
    omitBehavior: boolean,
    decoder: (s: string) => string,
  ): Result<void, RouterErrorData> {
    const optionalCount = countOptionalSegments(parts);
    if (optionalCount > MAX_OPTIONAL_SEGMENTS_PER_ROUTE) {
      return err({
        kind: 'route-parse',
        message: `Route has ${optionalCount} optional segments; maximum is ${MAX_OPTIONAL_SEGMENTS_PER_ROUTE} to cap expansion variants before 2^N growth.`,
        path: route.path,
        suggestion: `Reduce optional segments to ${MAX_OPTIONAL_SEGMENTS_PER_ROUTE} or fewer, or register explicit routes for the rare combinations.`,
      });
    }

    const expansion = expandOptional(parts, -1, this.optionalParamDefaults);

    const originalNames: string[] = [];
    const originalTypes: Array<'param' | 'wildcard'> = [];
    for (const p of parts) {
      if (p.type === 'param' || p.type === 'wildcard') {
        originalNames.push(p.name);
        originalTypes.push(p.type);
      }
    }

    // presentBitmask is a 32-bit Int32. `1 << 31` already lands on the
    // sign bit, and `1 << 32` wraps to 1 in V8/JSC. With more than 31
    // capturing segments the super-factory's per-name gate would alias
    // and silently miscompile, so reject at registration time. Real
    // production routes routinely sit at 1-3 params; 31 is the JSC
    // bitmask ceiling, well above any observed pattern.
    if (originalNames.length > 31) {
      return err({
        kind: 'route-parse',
        message: `Route has ${originalNames.length} capturing segments; maximum is 31 (Int32 bitmask ceiling).`,
        path: route.path,
        suggestion: 'Reduce the number of :param/*wildcard segments per route.',
      });
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
      const prefixCheck = this.runPrefixIndexPlan(
        expParts,
        methodCode,
        route,
        undo,
        hIdx,
        expanded.isOptionalExpansion,
      );
      if (isErr(prefixCheck)) return prefixCheck;
      const present: Array<{ name: string; type: 'param' | 'wildcard' }> = [];
      for (const p of expParts) {
        if (p.type === 'param' || p.type === 'wildcard') {
          present.push({ name: p.name, type: p.type });
        }
      }
      if (present.length > state.maxParamsObserved) {
        state.maxParamsObserved = present.length;
      }

      const tIdx = state.terminalHandlers.length;
      const isWildcard = expParts.length > 0 && expParts[expParts.length - 1]!.type === 'wildcard';

      // Compute presentBitmask: bit i set ⇔ originalNames[i] is captured
      // by this expansion variant. The super-factory uses this mask at
      // match-time to gate per-name assignment, so one factory function
      // serves every variant of a given route shape (factory count goes
      // from O(2^N) variants to O(1) per route shape).
      let presentBitmask = 0;
      for (let origIdx = 0; origIdx < originalNames.length; origIdx++) {
        const origName = originalNames[origIdx]!;
        for (let p = 0; p < present.length; p++) {
          if (present[p]!.name === origName) {
            presentBitmask |= (1 << origIdx);
            break;
          }
        }
      }

      let factory: ((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null = null;
      if (present.length > 0 || (!omitBehavior && originalNames.length > 0)) {
        // cacheKey is variant-independent: one super-factory per route shape
        // (omitBehavior + originalNames + originalTypes). All 2^N variants
        // of an optional-heavy route share the same compiled function.
        let cacheKey = omitBehavior ? 'O:' : 'S:';
        for (let n = 0; n < originalNames.length; n++) {
          if (n > 0) cacheKey += ',';
          cacheKey += originalNames[n]!;
          cacheKey += originalTypes[n] === 'wildcard' ? '#w' : '#p';
        }
        let cached = factoryCache.get(cacheKey);

        if (cached === undefined) {
          // Super-factory body: walks originalNames in order, gates each
          // assignment on the corresponding bit in `m` (presentBitmask).
          // `s` is a sliding paramOffsets cursor — only the present slots
          // were filled by the walker, so absent ones must be skipped.
          // omitBehavior=true: drop absent entirely (no key written).
          // omitBehavior=false: write `undefined` for absent.
          let body = 'var p = new NullProtoObj();\nvar s = 0;\n';
          for (let n = 0; n < originalNames.length; n++) {
            const name = originalNames[n]!;
            const isWild = originalTypes[n] === 'wildcard';
            const val = `u.substring(v[s*2], v[s*2+1])`;
            const assign = isWild ? val : `decoder(${val})`;
            body += `if (m & ${1 << n}) { p[${JSON.stringify(name)}] = ${assign}; s++; }`;
            if (!omitBehavior) {
              body += ` else { p[${JSON.stringify(name)}] = undefined; }`;
            }
            body += '\n';
          }
          body += 'return p;';
          cached = new Function('decoder', 'NullProtoObj', 'm', 'u', 'v', body).bind(null, decoder, NullProtoObj) as any;
          factoryCache.set(cacheKey, cached!);
        }
        factory = cached!;
      }

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

      const insertResult = insertIntoSegmentTree(
        root,
        expParts,
        tIdx,
        state.testerCache,
        routeID,
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
    // Only callers are `compileStaticRoute` and `compileDynamicRoute`,
    // both invoked from `seal()`'s route loop strictly between
    // `this.prefixIndex = new WildcardPrefixIndex()` /
    // `this.identityRegistry = new IdentityRegistry()` and the
    // `this.prefixIndex = null` reset at the tail of `seal()`. A second
    // `seal()` call short-circuits at the `if (this.snapshot !== null)`
    // guard before either ever runs again, so by construction these
    // fields are non-null at this call site.
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
    if (planResult === 'alias') return undefined;
    undo.push({
      k: UndoKind.PrefixIndexPlan,
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

function rollback(undo: SegmentTreeUndoLog, mark: number): void {
  for (let i = undo.length - 1; i >= mark; i--) {
    applyUndo(undo[i]!);
  }

  undo.length = mark;
}
