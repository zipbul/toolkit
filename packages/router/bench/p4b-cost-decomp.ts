/* eslint-disable no-console */
/**
 * P4b cost decomposition. Generates the same 100k wildcard-heavy route set
 * the verification bench uses, then measures four configurations to figure
 * out where the ~500ms is actually going:
 *
 *   1. Full build (prefix-index + segment-tree + codegen + everything else)
 *   2. Registration-only (parsing + prefix-index + segment-tree, no seal())
 *   3. Prefix-index ONLY (no segment-tree insertions, no codegen)
 *   4. Segment-tree ONLY (no prefix-index)
 *   5. PathPart parse cost (no insertion at all)
 *
 * Comparing 3 vs 4 vs 1 isolates which traversal is expensive and how much
 * of the build-time is non-trie work (codegen, snapshot, GC).
 */

import { performance } from 'node:perf_hooks';

import { PathParser } from '../src/builder/path-parser';
import type { PathPart } from '../src/builder/path-parser';
import { Router } from '../src/router';
import {
  WildcardPrefixIndex,
} from '../src/pipeline/wildcard-prefix-index';
import { createSegmentNode, insertIntoSegmentTree } from '../src/matcher/segment-tree';
import type { SegmentTreeUndoLog } from '../src/matcher/segment-tree';
import type { PatternTesterFn } from '../src/matcher/pattern-tester';

function gen100kWildcardHeavy(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let g = 0; g < 1000; g++) {
    for (let b = 0; b < 100; b++) {
      out.push(['GET', `/files/group-${g}/bucket-${b * 1000 + g}/*p`]);
    }
  }
  return out;
}

function memMb(): { rss: number; heap: number } {
  const m = process.memoryUsage();
  return { rss: m.rss / 1e6, heap: m.heapUsed / 1e6 };
}

function gcIfPossible(): void {
  if (typeof globalThis.gc === 'function') globalThis.gc();
}

async function main(): Promise<void> {
  const routes = gen100kWildcardHeavy();
  console.log(`routes=${routes.length}`);

  // 1. full build
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const m0 = memMb();
    const t0 = performance.now();
    const r = new Router<string>();
    for (const [m, p] of routes) r.add(m, p, 'h');
    r.build();
    const dt = performance.now() - t0;
    const m1 = memMb();
    console.log(
      `[1.full-build] run=${i + 1} dt=${dt.toFixed(2)}ms rss+${(m1.rss - m0.rss).toFixed(1)}MB heap+${(m1.heap - m0.heap).toFixed(1)}MB`,
    );
  }

  // 2. registration only (no seal)
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const m0 = memMb();
    const t0 = performance.now();
    const r = new Router<string>();
    for (const [m, p] of routes) r.add(m, p, 'h');
    const dt = performance.now() - t0;
    const m1 = memMb();
    console.log(
      `[2.add-only] run=${i + 1} dt=${dt.toFixed(2)}ms rss+${(m1.rss - m0.rss).toFixed(1)}MB heap+${(m1.heap - m0.heap).toFixed(1)}MB`,
    );
  }

  // pre-parse parts so 3/4/5 don't include parse cost
  const parser = new PathParser({
    caseSensitive: true,
    ignoreTrailingSlash: false,
    maxSegmentLength: 1024,
    maxPathLength: 8192,
    maxSegmentCount: 256,
    maxParams: 64,
    profile: 'secure',
  });
  const parsedParts: Array<PathPart[]> = [];
  for (const [, p] of routes) {
    const r = parser.parse(p) as { parts?: PathPart[]; data?: unknown };
    if (r.data !== undefined) throw new Error('parse failed: ' + JSON.stringify(r.data));
    parsedParts.push(r.parts!);
  }

  // 3. prefix-index only
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const m0 = memMb();
    const t0 = performance.now();
    const idx = new WildcardPrefixIndex(32);
    for (let r = 0; r < parsedParts.length; r++) {
      const meta = {
        routeIndex: r,
        path: routes[r]![1],
        method: 'GET',
        handlerId: r,
        isOptionalExpansion: false,
      };
      const res = idx.planAndCommit(0, parsedParts[r]!, meta);
      if ('data' in (res as { data?: unknown }) && (res as { data?: unknown }).data !== undefined) {
        throw new Error('prefix-index plan err: ' + JSON.stringify((res as { data: unknown }).data));
      }
    }
    const dt = performance.now() - t0;
    const m1 = memMb();
    console.log(
      `[3.prefix-only] run=${i + 1} dt=${dt.toFixed(2)}ms rss+${(m1.rss - m0.rss).toFixed(1)}MB heap+${(m1.heap - m0.heap).toFixed(1)}MB`,
    );
  }

  // 4. segment-tree only
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const m0 = memMb();
    const t0 = performance.now();
    const root = createSegmentNode();
    const undo: SegmentTreeUndoLog = [];
    const testerCache = new Map<string, PatternTesterFn>();
    for (let r = 0; r < parsedParts.length; r++) {
      const res = insertIntoSegmentTree(root, parsedParts[r]!, r, testerCache, r, undo);
      if (res !== undefined) throw new Error('segment-tree insert err');
    }
    const dt = performance.now() - t0;
    const m1 = memMb();
    console.log(
      `[4.seg-tree-only] run=${i + 1} dt=${dt.toFixed(2)}ms rss+${(m1.rss - m0.rss).toFixed(1)}MB heap+${(m1.heap - m0.heap).toFixed(1)}MB undoEntries=${undo.length}`,
    );
  }

  // 1b. break r.build() into seal-vs-buildFromRegistration-vs-compileMatchFn
  console.log('\n--- r.build() phase split ---');
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const r = new Router<string>();
    for (const [m, p] of routes) r.add(m, p, 'h');
    const t0 = performance.now();
    r.build();
    const dt = performance.now() - t0;
    console.log(`[1b.r.build()] run=${i + 1} dt=${dt.toFixed(2)}ms`);
  }

  // 4b. seal phase decomposition with diagnostics
  process.env.ZIPBUL_ROUTER_DIAGNOSTICS = '1';
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const t0 = performance.now();
    const r = new Router<string>();
    for (const [m, p] of routes) r.add(m, p, 'h');
    r.build();
    const dt = performance.now() - t0;
    const internals = (r as unknown as Record<symbol, { registration: { getDiagnostics(): unknown } }>);
    const sym = Object.getOwnPropertySymbols(r).find(s => s.toString().includes('internals'));
    let diag: Record<string, unknown> | null = null;
    if (sym !== undefined) {
      const reg = (r as unknown as Record<symbol, { registration: { getDiagnostics(): Record<string, unknown> | null } }>)[sym]!.registration;
      diag = reg.getDiagnostics();
    }
    console.log(`[4b.seal-diag] run=${i + 1} dt=${dt.toFixed(2)}ms`);
    if (diag !== null) {
      const keys = ['parseMs', 'methodMs', 'wildcardNameMs', 'staticWildcardConflictMs', 'prefixIndexPlanMs', 'staticInsertMs', 'optionalExpandMs', 'dynamicInsertMs', 'factoryMs', 'snapshotMs', 'routeLoopOverheadMs'];
      for (const k of keys) {
        const v = diag[k];
        if (typeof v === 'number') console.log(`  ${k}=${v.toFixed(2)}ms`);
      }
    }
    void internals;
  }
  delete process.env.ZIPBUL_ROUTER_DIAGNOSTICS;

  // 5. parse cost only
  for (let i = 0; i < 3; i++) {
    gcIfPossible();
    const t0 = performance.now();
    const parser2 = new PathParser({
      caseSensitive: true,
      ignoreTrailingSlash: false,
      maxSegmentLength: 1024,
      maxPathLength: 8192,
      maxSegmentCount: 256,
      maxParams: 64,
      profile: 'secure',
    });
    let n = 0;
    for (const [, p] of routes) {
      parser2.parse(p);
      n++;
    }
    const dt = performance.now() - t0;
    console.log(`[5.parse-only] run=${i + 1} dt=${dt.toFixed(2)}ms n=${n}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
