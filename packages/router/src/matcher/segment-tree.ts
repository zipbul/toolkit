import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';
import type { PatternTesterFn } from './pattern-tester';
import type { PathPart } from '../builder/path-parser';

import { err } from '@zipbul/result';
import { buildPatternTester } from './pattern-tester';

// Insert-time sibling cap. The default mirrors `ROUTER_DEFAULTS.
// maxRegexSiblingsPerSegment` so a registration that doesn't set the
// option matches the historical 32. Callers pass the option-resolved
// value via `insertIntoSegmentTree`'s `regexSiblingCap` parameter so the
// hard limit can be raised (the prior file-scope const ignored the
// option and produced a `regex-sibling-limit` reject even when the
// option was set to a larger value).
const DEFAULT_REGEX_SIBLING_CAP = 32;

/**
 * Segment-based route tree. Each node corresponds to one URL segment
 * (no intra-segment splits). Built at Router.build() directly from
 * registered route parts.
 */
export interface SegmentNode {
  /** Terminal handler index when the URL ends here exactly. */
  store: number | null;
  /** Static children keyed by segment literal. NullProtoObj for property-access
   *  speed. `null` when the node has no static children OR when the only
   *  static child is held in the inline `singleChildKey` slot below. */
  staticChildren: Record<string, SegmentNode> | null;
  /**
   * Inline single-static-child cache. When a node has exactly one static
   * child, the key/next pair lives here rather than in a 1-entry
   * `staticChildren` Record. Saves one `Object.create(null)` per such
   * node and lets the walker resolve via a single string compare instead
   * of a hash lookup. On the second static-child insertion the inline
   * entry is promoted into `staticChildren` and these slots are cleared.
   */
  singleChildKey: string | null;
  singleChildNext: SegmentNode | null;
  /** Head of the param-alternative chain at this position. */
  paramChild: ParamSegment | null;
  /** Wildcard at this position. */
  wildcardStore: number | null;
  wildcardName: string | null;
  wildcardOrigin: 'star' | 'multi' | null;
  /**
   * Compacted single-static-chain prefix produced by post-seal compaction.
   * When set, the matcher must consume each segment in order against the
   * input path before evaluating this node's children. Saves one
   * SegmentNode + one staticChildren map per chain link removed. `null`
   * for un-compacted nodes.
   */
  staticPrefix: string[] | null;
}

/** True when the node holds at least one static child (inline or Record). */
export function hasAnyStaticChild(node: SegmentNode): boolean {
  return node.singleChildKey !== null || node.staticChildren !== null;
}

/** Iterate every static child of `node` regardless of whether the entry
 *  is in the inline cache or the promoted `staticChildren` Record. */
export function forEachStaticChild(
  node: SegmentNode,
  fn: (key: string, child: SegmentNode) => void,
): void {
  if (node.singleChildKey !== null && node.singleChildNext !== null) {
    fn(node.singleChildKey, node.singleChildNext);
  }
  if (node.staticChildren !== null) {
    for (const k in node.staticChildren) fn(k, node.staticChildren[k]!);
  }
}

export interface ParamSegment {
  name: string;
  tester: PatternTesterFn | null;
  /** Source pattern string (or null for unconstrained). Used to detect
   *  same-name conflicts at registration time without comparing compiled
   *  tester object identity. */
  patternSource: string | null;
  /** First routeID that introduced this param. Two siblings sharing the
   *  same ownerRouteID come from one route's optional-param expansion (e.g.
   *  `/users/:a?/:b?` deliberately creates `:a` and `:b` siblings under the
   *  same route) and bypass the unreachable-sibling check below. */
  ownerRouteID: number;
  /** Subtree rooted at this param. */
  next: SegmentNode;
  /** Linked-list pointer to the next param alternative at the same position. */
  nextSibling: ParamSegment | null;
}

/**
 * Tagged-record undo log entries. Hot insertions on `100k wildcard-heavy`
 * historically allocated one closure per mutation (~300k closures per build);
 * each new closure freshly captured the surrounding scope and dominated GC.
 * Replacing the closures with monomorphic plain-object records keeps the
 * memory shape stable (one hidden class per kind) and lets the rollback
 * loop dispatch via a tag instead of a function call.
 */
export const enum UndoKind {
  StaticChildrenInit = 1,
  StaticChildAdd = 2,
  ParamChildSet = 3,
  ParamSiblingAdd = 4,
  WildcardSet = 5,
  StoreSet = 6,
  TesterAdd = 7,
  /**
   * Inverse of WildcardPrefixIndex.commit(). Stored as a tagged record
   * carrying the `CommitPlan` so the registration rollback path does not
   * have to allocate a closure per route during high-volume builds.
   */
  PrefixIndexPlan = 8,
  /** Truncate three parallel state arrays back to a recorded length (terminalHandlers, isWildcardByTerminal, paramsFactories). */
  TerminalArraysTruncate = 9,
  /** Truncate handlers array back to a recorded length. */
  HandlersTruncate = 10,
  /** Truncate state.segmentTrees[mc] back to undefined. */
  SegmentTreeReset = 11,
  /** Truncate state.staticByMethod[mc] back to undefined. */
  StaticBucketReset = 17,
  /** Static-map slot delete (was undefined before). */
  StaticMapDelete = 13,
  /** Inverse of inline single-static-child set: clear key + next on the parent. */
  SingleChildClear = 14,
  /** Inverse of single-static-child promotion to Record: re-set key + next. */
  SingleChildRestore = 15,
  /** Restore a `staticPathMethodMask` entry — set to prevMask (0 means delete). */
  StaticPathMaskRestore = 16,
}

export type UndoRecord =
  | { k: UndoKind.StaticChildrenInit; n: SegmentNode }
  | { k: UndoKind.StaticChildAdd; p: Record<string, SegmentNode>; key: string }
  | { k: UndoKind.ParamChildSet; n: SegmentNode }
  | { k: UndoKind.ParamSiblingAdd; prev: ParamSegment }
  | { k: UndoKind.WildcardSet; n: SegmentNode }
  | { k: UndoKind.StoreSet; n: SegmentNode }
  | { k: UndoKind.TesterAdd; cache: Map<string, PatternTesterFn>; key: string }
  | { k: UndoKind.PrefixIndexPlan; plan: unknown }
  | { k: UndoKind.TerminalArraysTruncate; t: number[]; w: boolean[]; f: Array<unknown>; len: number }
  | { k: UndoKind.HandlersTruncate; arr: unknown[]; len: number }
  | { k: UndoKind.SegmentTreeReset; trees: Array<SegmentNode | null | undefined>; mc: number }
  | { k: UndoKind.StaticBucketReset; buckets: Array<Record<string, unknown> | undefined>; mc: number }
  | { k: UndoKind.StaticMapDelete; map: Record<string, unknown>; key: string }
  | { k: UndoKind.SingleChildClear; n: SegmentNode }
  | { k: UndoKind.SingleChildRestore; n: SegmentNode; key: string; next: SegmentNode }
  | { k: UndoKind.StaticPathMaskRestore; map: Record<string, number>; key: string; prevMask: number };

// All undo entries are tagged records — closures were eliminated to
// keep the entry shape monomorphic and avoid per-entry scope alloc.
export type SegmentTreeUndoLog = UndoRecord[];

let prefixIndexRollback: ((plan: unknown) => void) | null = null;

/**
 * Wire the prefix-index rollback dispatcher. Called once at module
 * initialization from `pipeline/registration.ts`. Decouples the matcher
 * from the pipeline so segment-tree.ts has no upward dependency.
 */
export function setPrefixIndexRollback(fn: (plan: unknown) => void): void {
  prefixIndexRollback = fn;
}

export function applyUndo(entry: UndoRecord): void {
  switch (entry.k) {
    case UndoKind.StaticChildrenInit:
      entry.n.staticChildren = null;
      return;
    case UndoKind.StaticChildAdd:
      delete entry.p[entry.key];
      return;
    case UndoKind.ParamChildSet:
      entry.n.paramChild = null;
      return;
    case UndoKind.ParamSiblingAdd:
      entry.prev.nextSibling = null;
      return;
    case UndoKind.WildcardSet:
      entry.n.wildcardStore = null;
      entry.n.wildcardName = null;
      entry.n.wildcardOrigin = null;
      return;
    case UndoKind.StoreSet:
      entry.n.store = null;
      return;
    case UndoKind.TesterAdd:
      entry.cache.delete(entry.key);
      return;
    case UndoKind.PrefixIndexPlan:
      // Dispatched by registration's caller (which knows the prefix-index
      // module). The matcher layer must not depend on pipeline, so the
      // dispatcher is registered via setPrefixIndexRollback().
      prefixIndexRollback!(entry.plan);
      return;
    case UndoKind.TerminalArraysTruncate:
      entry.t.length = entry.len;
      entry.w.length = entry.len;
      entry.f.length = entry.len;
      return;
    case UndoKind.HandlersTruncate:
      entry.arr.length = entry.len;
      return;
    case UndoKind.SegmentTreeReset:
      delete entry.trees[entry.mc];
      return;
    case UndoKind.StaticBucketReset:
      delete entry.buckets[entry.mc];
      return;
    case UndoKind.StaticMapDelete:
      delete entry.map[entry.key];
      return;
    case UndoKind.SingleChildClear:
      entry.n.singleChildKey = null;
      entry.n.singleChildNext = null;
      return;
    case UndoKind.SingleChildRestore:
      entry.n.singleChildKey = entry.key;
      entry.n.singleChildNext = entry.next;
      return;
    case UndoKind.StaticPathMaskRestore:
      if (entry.prevMask === 0) delete entry.map[entry.key];
      else entry.map[entry.key] = entry.prevMask;
      return;
  }
}

export function createSegmentNode(): SegmentNode {
  return {
    store: null,
    staticChildren: null,
    singleChildKey: null,
    singleChildNext: null,
    paramChild: null,
    wildcardStore: null,
    wildcardName: null,
    wildcardOrigin: null,
    staticPrefix: null,
  };
}

/**
 * Tenant-prefix factor descriptor. When a method's root has many static
 * children (e.g. `tenant-0`, `tenant-1`, ..., `tenant-99999`) whose subtrees
 * are structurally identical except for the terminal handler index, those
 * branches collapse onto a single canonical subtree plus a hash table
 * mapping each first-segment key to its terminal handler index. The walker
 * then resolves match in two steps: hash lookup → walk shared subtree →
 * override leaf store with the looked-up index.
 *
 * Empirical (100k tenant `/tenant-${i}/users/:id/posts/:postId`):
 * 100k separate root branches → 1 shared subtree + 100k Map entries.
 * Object count drops from ~706k to ~103k; RSS drops from 220 MB to ~60 MB.
 */
export interface TenantFactor {
  /** First-segment key → terminal handler index. */
  keyToTerminal: Map<string, number>;
  /** Canonical shared subtree the walker descends after first segment matches. */
  sharedNext: SegmentNode;
}

/**
 * Sidecar storage so we don't widen `SegmentNode`'s hidden class for the
 * common case (most nodes don't have a factor). The walker probes this
 * WeakMap only at root, so it's off the per-segment hot path.
 */
const tenantFactorStore = new WeakMap<SegmentNode, TenantFactor>();

export function getTenantFactor(node: SegmentNode): TenantFactor | undefined {
  return tenantFactorStore.get(node);
}

export function setTenantFactor(node: SegmentNode, factor: TenantFactor): void {
  tenantFactorStore.set(node, factor);
}

/**
 * Detect whether `root.staticChildren` collapses to a tenant factor:
 * many sibling branches with identical structural shape and a single
 * distinct terminal store per branch. Returns the factor descriptor on
 * success, `null` otherwise. Threshold defaults to 1000 siblings to
 * avoid factoring small fanouts (the WeakMap probe + hash lookup costs
 * ~5 ns extra; only worth it when the savings outweigh the per-match
 * tax).
 */
export function detectTenantFactor(root: SegmentNode, minSiblings = 1000): TenantFactor | null {
  if (root.store !== null) return null;
  if (root.paramChild !== null || root.wildcardStore !== null) return null;
  if (root.staticChildren === null) return null;

  const keys: string[] = [];
  for (const k in root.staticChildren) keys.push(k);
  if (keys.length < minSiblings) return null;

  const firstChild = root.staticChildren[keys[0]!]!;
  const baseShape = subtreeShape(firstChild);
  const baseStore = leafStoreOf(firstChild);
  if (baseStore === null) return null;

  const keyToTerminal = new Map<string, number>();
  for (const k of keys) {
    const child = root.staticChildren[k]!;
    if (subtreeShape(child) !== baseShape) return null;
    const store = leafStoreOf(child);
    if (store === null) return null;
    keyToTerminal.set(k, store);
  }
  return { keyToTerminal, sharedNext: firstChild };
}

/**
 * Recursive shape signature of a subtree, EXCLUDING terminal store values
 * so two branches that only differ in `store` collapse to the same hash.
 * Includes paramName, patternSource (regex identity), wildcardOrigin,
 * staticPrefix sequence, and child structure.
 */
function subtreeShape(node: SegmentNode): string {
  const parts: string[] = [];
  parts.push(`ws=${node.wildcardStore === null ? 'n' : 'y'}`);
  parts.push(`wn=${node.wildcardName ?? ''}`);
  parts.push(`wo=${node.wildcardOrigin ?? ''}`);
  parts.push(`sp=${node.staticPrefix === null ? '' : node.staticPrefix.join('\x00')}`);
  if (node.singleChildKey !== null && node.singleChildNext !== null) {
    parts.push(`SC=${node.singleChildKey}\x01${subtreeShape(node.singleChildNext)}`);
  }
  if (node.staticChildren !== null) {
    const childKeys: string[] = [];
    for (const k in node.staticChildren) childKeys.push(k);
    childKeys.sort();
    for (const k of childKeys) parts.push(`S=${k}\x01${subtreeShape(node.staticChildren[k]!)}`);
  }
  let p = node.paramChild;
  while (p !== null) {
    parts.push(`P=${p.name}\x01${p.patternSource ?? ''}\x01${subtreeShape(p.next)}`);
    p = p.nextSibling;
  }
  // Terminal store is intentionally excluded.
  return parts.join('\x02');
}

/**
 * Walk to the unique terminal node and return its `store`. Returns null
 * if there is no unique terminal (multiple stores on the path). The
 * depth bound is a malformed-tree safety net only; the registration
 * layer caps actual segment count via the `maxSegmentCount` option
 * (default 256 in `router.ts:createPathParser`). 64 here doesn't have
 * to match the option — it just bounds the loop.
 */
function leafStoreOf(node: SegmentNode): number | null {
  let cur: SegmentNode = node;
  let depth = 0;
  // Malformed-tree safety net only. The actual segment-count limit is
  // enforced by `maxSegmentCount` (router.ts:createPathParser default
  // 256); we cap descent at 64 here because no valid registered tree
  // can chain a single-static-only path that deep without `store`/
  // multi-child branching breaking the loop sooner.
  while (depth++ < 64) {
    if (cur.store !== null) return cur.store;
    if (cur.paramChild !== null && cur.paramChild.nextSibling === null) {
      cur = cur.paramChild.next;
      continue;
    }
    if (cur.singleChildKey !== null && cur.singleChildNext !== null && cur.staticChildren === null) {
      cur = cur.singleChildNext;
      continue;
    }
    if (cur.staticChildren !== null) {
      let only: SegmentNode | null = null;
      let many = false;
      for (const k in cur.staticChildren) {
        if (only === null) only = cur.staticChildren[k]!;
        else { many = true; break; }
      }
      if (many || only === null) return null;
      cur = only;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * Post-seal compaction. Walks the tree and folds every chain of nodes that
 * each have exactly one static child (and no param/wildcard/store) into the
 * deepest node, recording the path on `staticPrefix`. Returns counters for
 * diagnostics: nodes folded, chains merged.
 */
export function compactSegmentTree(root: SegmentNode): { foldedNodes: number; chains: number } {
  let foldedNodes = 0;
  let chains = 0;
  // Intern shared `staticPrefix` arrays so 100k nodes carrying the same
  // single-element prefix share one array reference instead of allocating
  // 100k 1-entry arrays.
  const prefixIntern = new Map<string, string[]>();
  const internPrefix = (parts: string[]): string[] => {
    const key = parts.join('\x00');
    const existing = prefixIntern.get(key);
    if (existing !== undefined) return existing;
    prefixIntern.set(key, parts);
    return parts;
  };

  // Single-static-child passthrough probe — peeks the inline cache first,
  // then the Record. Avoids any `Object.keys()` allocation.
  function peekSingleStatic(target: SegmentNode): { key: string | null; child: SegmentNode | null; many: boolean } {
    if (target.singleChildKey !== null && target.singleChildNext !== null && target.staticChildren === null) {
      return { key: target.singleChildKey, child: target.singleChildNext, many: false };
    }
    if (target.staticChildren !== null) {
      let only: string | null = null;
      let onlyChild: SegmentNode | null = null;
      let many = false;
      // The Record may contain entries even when an inline child also exists
      // (during build, before promotion); count both.
      if (target.singleChildKey !== null) { only = target.singleChildKey; onlyChild = target.singleChildNext; }
      for (const k in target.staticChildren) {
        if (only === null) { only = k; onlyChild = target.staticChildren[k]!; }
        else { many = true; break; }
      }
      return { key: only, child: onlyChild, many };
    }
    return { key: null, child: null, many: false };
  }

  function foldChainFrom(start: SegmentNode): { target: SegmentNode; folded: string[] } {
    const folded: string[] = [];
    let target = start;
    while (
      hasAnyStaticChild(target) &&
      target.paramChild === null &&
      target.wildcardStore === null &&
      target.store === null &&
      target.staticPrefix === null
    ) {
      const peek = peekSingleStatic(target);
      if (peek.many || peek.key === null || peek.child === null) break;
      folded.push(peek.key);
      target = peek.child;
      foldedNodes++;
    }
    return { target, folded };
  }

  function rewireStaticChild(parent: SegmentNode, key: string, target: SegmentNode): void {
    if (parent.singleChildKey === key) {
      parent.singleChildNext = target;
      return;
    }
    if (parent.staticChildren !== null && key in parent.staticChildren) {
      parent.staticChildren[key] = target;
    }
  }

  const stack: SegmentNode[] = [root];
  const visited = new Set<SegmentNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);

    forEachStaticChild(node, (key, child) => {
      const { target, folded } = foldChainFrom(child);
      if (folded.length > 0) {
        chains++;
        const merged = target.staticPrefix === null
          ? internPrefix(folded)
          : internPrefix([...folded, ...target.staticPrefix]);
        target.staticPrefix = merged;
        rewireStaticChild(node, key, target);
      }
      stack.push(target);
    });

    let p = node.paramChild;
    while (p !== null) {
      const { target, folded } = foldChainFrom(p.next);
      if (folded.length > 0) {
        chains++;
        const merged = target.staticPrefix === null
          ? internPrefix(folded)
          : internPrefix([...folded, ...target.staticPrefix]);
        target.staticPrefix = merged;
        p.next = target;
      }
      stack.push(target);
      p = p.nextSibling;
    }
  }
  return { foldedNodes, chains };
}

/**
 * Detect whether the segment tree has any node where the same URL segment
 * could simultaneously match multiple alternatives — a static child *and* a
 * param/wildcard, or two sibling params. When false, a non-recursive
 * iterative walker can be used safely; otherwise the recursive walker (with
 * backtracking) must run.
 */
export function hasAmbiguousNode(root: SegmentNode): boolean {
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (hasAnyStaticChild(node) && (node.paramChild !== null || node.wildcardStore !== null)) {
      return true;
    }

    if (node.paramChild !== null && node.paramChild.nextSibling !== null) {
      return true;
    }

    forEachStaticChild(node, (_, child) => { stack.push(child); });

    let p = node.paramChild;

    while (p !== null) {
      stack.push(p.next);
      p = p.nextSibling;
    }
  }

  return false;
}

function rollbackUndo(undo: SegmentTreeUndoLog, start: number): void {
  for (let i = undo.length - 1; i >= start; i--) applyUndo(undo[i]!);
  undo.length = start;
}

/**
 * Insert one expanded route (no optional markers) into the segment tree.
 *
 * Hot-path notes:
 *  - Error paths call the free `rollbackUndo()` helper rather than closing
 *    over a per-call `fail` arrow; allocating one closure per route was
 *    observable GC pressure on large builds.
 *  - The literal-segment branch is structured so the common case (existing
 *    literal child on a non-wildcard node) takes a single hash lookup and
 *    no allocation.
 */
export function insertIntoSegmentTree(
  root: SegmentNode,
  parts: PathPart[],
  handlerIndex: number,
  testerCache: Map<string, PatternTesterFn>,
  routeID: number,
  undoLog?: SegmentTreeUndoLog,
  regexSiblingCap: number = DEFAULT_REGEX_SIBLING_CAP,
): Result<void, RouterErrorData> {
  let node = root;
  const undo = undoLog ?? [];
  const undoStart = undo.length;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'static') {
      const segs = part.segments;

      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s]!;
        // Fast path 1: inline single-static-child cache hit (string compare).
        if (node.singleChildKey === seg && node.singleChildNext !== null && node.wildcardStore === null) {
          node = node.singleChildNext;
          continue;
        }
        // Fast path 2: promoted staticChildren Record hit.
        const sc = node.staticChildren;
        if (sc !== null && node.wildcardStore === null) {
          const child = sc[seg];
          if (child !== undefined) { node = child; continue; }
        }

        if (node.wildcardStore !== null) {
          rollbackUndo(undo, undoStart);
          return err({
            kind: 'route-conflict',
            message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
            segment: seg,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        // Inline-cache slot is empty AND no Record yet: store the child
        // inline so a node with exactly one static child never allocates
        // a Record.
        if (node.singleChildKey === null && node.staticChildren === null) {
          const fresh = createSegmentNode();
          node.singleChildKey = seg;
          node.singleChildNext = fresh;
          undo.push({ k: UndoKind.SingleChildClear, n: node });
          node = fresh;
          continue;
        }

        // Either a different inline-cache key already occupies the slot,
        // or the Record was previously promoted. Promote the inline entry
        // (if any) into the Record before adding this new sibling so the
        // walker only has to consult one of inline/Record per node.
        let children = node.staticChildren;
        if (children === null) {
          children = Object.create(null) as Record<string, SegmentNode>;
          node.staticChildren = children;
          undo.push({ k: UndoKind.StaticChildrenInit, n: node });
        }
        if (node.singleChildKey !== null && node.singleChildNext !== null) {
          const promotedKey = node.singleChildKey;
          const promotedNext = node.singleChildNext;
          children[promotedKey] = promotedNext;
          node.singleChildKey = null;
          node.singleChildNext = null;
          undo.push({ k: UndoKind.SingleChildRestore, n: node, key: promotedKey, next: promotedNext });
          undo.push({ k: UndoKind.StaticChildAdd, p: children, key: promotedKey });
        }

        const fresh = createSegmentNode();
        children[seg] = fresh;
        undo.push({ k: UndoKind.StaticChildAdd, p: children, key: seg });
        node = fresh;
      }
    } else if (part.type === 'param') {
      if (node.wildcardStore !== null) {
        rollbackUndo(undo, undoStart);
        return err({
          kind: 'route-conflict',
          message: `Parameter ':${part.name}' conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
          segment: part.name,
          conflictsWith: `*${node.wildcardName}`,
        });
      }

      let tester: PatternTesterFn | null = null;

      if (part.pattern !== null) {
        const cached = testerCache.get(part.pattern);

        if (cached !== undefined) {
          tester = cached;
        } else {
          try {
            const compiled = new RegExp(`^(?:${part.pattern})$`);

            tester = buildPatternTester(part.pattern, compiled);
            testerCache.set(part.pattern, tester);
            undo.push({ k: UndoKind.TesterAdd, cache: testerCache, key: part.pattern });
          } catch (e) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'route-parse',
              message: `Invalid regex pattern in parameter ':${part.name}': ${e instanceof Error ? e.message : String(e)}`,
              segment: part.name,
              suggestion: 'Fix the regex syntax. Anchors are stripped automatically; do not include ^ or $.',
            });
          }
        }
      }

      if (node.paramChild === null) {
        const created: ParamSegment = {
          name: part.name,
          tester,
          patternSource: part.pattern,
          ownerRouteID: routeID,
          next: createSegmentNode(),
          nextSibling: null,
        };
        node.paramChild = created;
        undo.push({ k: UndoKind.ParamChildSet, n: node });
        node = created.next;
      } else {
        let p: ParamSegment | null = node.paramChild;
        let prev: ParamSegment | null = null;
        let matched: ParamSegment | null = null;

        while (p !== null) {
          if (p.name === part.name && p.patternSource === part.pattern) {
            matched = p;
            break;
          }

          if (p.name === part.name && p.patternSource !== part.pattern) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'route-conflict',
              message: `Parameter ':${part.name}' has conflicting regex patterns`,
              segment: part.name,
              conflictsWith: `:${p.name}${p.patternSource !== null ? `(${p.patternSource})` : ''}`,
            });
          }

          if (p.patternSource === null && p.ownerRouteID !== routeID) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'route-conflict',
              message: `Parameter ':${part.name}' is unreachable — earlier sibling ':${p.name}' (registered by a different route) has no regex pattern and matches every value at this position. Add a regex pattern to disambiguate, or remove this route.`,
              segment: part.name,
              conflictsWith: p.name,
            });
          }

          prev = p;
          p = p.nextSibling;
        }

        if (matched === null) {
          let siblingCount = 1;
          let cursor: ParamSegment | null = node.paramChild;
          while (cursor !== null) { siblingCount++; cursor = cursor.nextSibling; }
          if (siblingCount > regexSiblingCap) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'regex-sibling-limit',
              message: `Too many regex/param siblings at the same position (cap ${regexSiblingCap}).`,
              segment: part.name,
              suggestion: `Reduce the number of distinct regex constraints sharing this segment to ${regexSiblingCap} or fewer.`,
            });
          }
          const fresh: ParamSegment = {
            name: part.name,
            tester,
            patternSource: part.pattern,
            ownerRouteID: routeID,
            next: createSegmentNode(),
            nextSibling: null,
          };
          const tail = prev!;
          tail.nextSibling = fresh;
          undo.push({ k: UndoKind.ParamSiblingAdd, prev: tail });
          node = fresh.next;
        } else {
          node = matched.next;
        }
      }
    } else {
      // wildcard — terminal
      if (node.wildcardStore !== null) {
        if (node.wildcardName !== part.name) {
          rollbackUndo(undo, undoStart);
          return err({
            kind: 'route-conflict',
            message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${node.wildcardName}'`,
            segment: part.name,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        rollbackUndo(undo, undoStart);
        return err({
          kind: 'route-duplicate',
          message: 'Wildcard route already exists at this position',
          suggestion: 'Use a different path or HTTP method',
        });
      }

      if (node.paramChild !== null) {
        rollbackUndo(undo, undoStart);
        return err({
          kind: 'route-conflict',
          message: `Wildcard '*${part.name}' conflicts with existing parameter at the same position`,
          segment: part.name,
          conflictsWith: `:${node.paramChild.name}`,
        });
      }

      node.wildcardStore = handlerIndex;
      node.wildcardName = part.name;
      node.wildcardOrigin = part.origin;
      undo.push({ k: UndoKind.WildcardSet, n: node });

      return;
    }
  }

  if (node.store !== null) {
    rollbackUndo(undo, undoStart);
    return err({
      kind: 'route-duplicate',
      message: 'Terminal route already exists at this position',
      suggestion: 'Use a different path or HTTP method',
    });
  }

  node.store = handlerIndex;
  undo.push({ k: UndoKind.StoreSet, n: node });
}
