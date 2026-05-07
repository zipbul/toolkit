/* eslint-disable no-console */
/**
 * POC: Segment chain compression (B7) — memory-dominant target.
 *
 * Compares two SegmentNode shapes for 100k param routes:
 *  - B1 baseline: per-segment SegmentNode (current). 5-deep route → 5 nodes.
 *  - B7 compressed: linear chain (no fanout) → single CompressedNode with
 *                    parts[] array. 5-deep route → 1 node.
 *
 * Metric: object count, RSS, lookup ns at 100k.
 * Route shape: /tenant-{i}/users/:user/posts/:post (4 segments × 100k = 400k base nodes).
 */
export {};

import { performance } from 'node:perf_hooks';

const N = 100_000;
const ITER = 200_000;

function gc(): void { if (typeof Bun !== 'undefined') Bun.gc(true); }
function mem(): NodeJS.MemoryUsage { gc(); return process.memoryUsage(); }
function diffMb(a: NodeJS.MemoryUsage, b: NodeJS.MemoryUsage) {
  return { rss: (b.rss - a.rss) / 1024 / 1024, heap: (b.heapUsed - a.heapUsed) / 1024 / 1024 };
}

function bench(label: string, fn: () => unknown): number {
  for (let i = 0; i < 20_000; i++) fn();
  const t0 = process.hrtime.bigint();
  let cksm = 0;
  for (let i = 0; i < ITER; i++) if (fn() !== null) cksm++;
  const ns = Number(process.hrtime.bigint() - t0) / ITER;
  console.log(`  ${label.padEnd(36)} ${ns.toFixed(2).padStart(8)} ns/op cksm=${cksm}`);
  return ns;
}

// ─── B1 baseline: per-segment node ───
type B1Node = {
  store: number | null;
  staticChildren: Record<string, B1Node> | null;
  paramChild: { name: string; next: B1Node } | null;
};
function makeB1Node(): B1Node { return { store: null, staticChildren: null, paramChild: null }; }

function buildB1(): { root: B1Node; nodeCount: number; rss: number; heap: number; buildMs: number } {
  const before = mem();
  const t0 = performance.now();
  const root = makeB1Node();
  let count = 1;
  for (let i = 0; i < N; i++) {
    let node = root;
    // static segment "tenant-i"
    if (node.staticChildren === null) node.staticChildren = Object.create(null) as any;
    const key = `tenant-${i}`;
    let child = node.staticChildren![key];
    if (child === undefined) { child = makeB1Node(); count++; node.staticChildren![key] = child; }
    node = child;
    // static "users"
    if (node.staticChildren === null) node.staticChildren = Object.create(null) as any;
    let next = node.staticChildren!['users'];
    if (next === undefined) { next = makeB1Node(); count++; node.staticChildren!['users'] = next; }
    node = next;
    // param :user
    if (node.paramChild === null) { node.paramChild = { name: 'user', next: makeB1Node() }; count++; }
    node = node.paramChild.next;
    // static "posts"
    if (node.staticChildren === null) node.staticChildren = Object.create(null) as any;
    next = node.staticChildren!['posts'];
    if (next === undefined) { next = makeB1Node(); count++; node.staticChildren!['posts'] = next; }
    node = next;
    // param :post
    if (node.paramChild === null) { node.paramChild = { name: 'post', next: makeB1Node() }; count++; }
    node = node.paramChild.next;
    // terminal
    node.store = i;
  }
  const buildMs = performance.now() - t0;
  const after = mem();
  const d = diffMb(before, after);
  return { root, nodeCount: count, rss: d.rss, heap: d.heap, buildMs };
}

function lookupB1(root: B1Node, segments: string[], paramOut: string[]): number | null {
  let node = root;
  let pi = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (node.staticChildren !== null) {
      const c = node.staticChildren[seg];
      if (c !== undefined) { node = c; continue; }
    }
    if (node.paramChild !== null) {
      paramOut[pi++] = seg;
      node = node.paramChild.next;
      continue;
    }
    return null;
  }
  return node.store;
}

// ─── B7 compressed: chain run-length-encoded ───
// A "compressed run" represents a sequence of single-child segments.
// parts[] holds pattern atoms: { type: 'static', value } or { type: 'param', name }
// Branching only at fanout > 1 nodes.
type B7Atom = { type: 'static'; value: string } | { type: 'param'; name: string };
type B7Node = {
  store: number | null;
  // After consuming `runAtoms`, dispatch to staticChildren/paramChild/etc.
  runAtoms: B7Atom[];
  staticChildren: Record<string, B7Node> | null;
  paramChild: { name: string; next: B7Node } | null;
};
function makeB7Node(runAtoms: B7Atom[] = []): B7Node {
  return { store: null, runAtoms, staticChildren: null, paramChild: null };
}

function buildB7(): { root: B7Node; nodeCount: number; rss: number; heap: number; buildMs: number } {
  const before = mem();
  const t0 = performance.now();
  // Strategy: each route has full chain `/tenant-{i}/users/:user/posts/:post`.
  // The first segment "tenant-{i}" branches at root (100k siblings), so root
  // has staticChildren with 100k entries. Each child is a single compressed
  // node holding atoms ["users", :user, "posts", :post] and a terminal store.
  const root = makeB7Node();
  root.staticChildren = Object.create(null) as Record<string, B7Node>;
  let count = 1;
  for (let i = 0; i < N; i++) {
    const compressed = makeB7Node([
      { type: 'static', value: 'users' },
      { type: 'param', name: 'user' },
      { type: 'static', value: 'posts' },
      { type: 'param', name: 'post' },
    ]);
    compressed.store = i;
    root.staticChildren![`tenant-${i}`] = compressed;
    count++;
  }
  const buildMs = performance.now() - t0;
  const after = mem();
  const d = diffMb(before, after);
  return { root, nodeCount: count, rss: d.rss, heap: d.heap, buildMs };
}

function lookupB7(root: B7Node, segments: string[], paramOut: string[]): number | null {
  let node = root;
  let pi = 0;
  let si = 0;
  while (si < segments.length) {
    // Consume runAtoms first
    if (node.runAtoms.length > 0) {
      for (let a = 0; a < node.runAtoms.length; a++) {
        if (si >= segments.length) return null;
        const atom = node.runAtoms[a]!;
        const seg = segments[si++]!;
        if (atom.type === 'static') {
          if (atom.value !== seg) return null;
        } else {
          paramOut[pi++] = seg;
        }
      }
      // Run consumed; check if more segments remain or we hit terminal
      if (si === segments.length) return node.store;
    }
    // Dispatch to children
    const seg = segments[si]!;
    if (node.staticChildren !== null) {
      const c = node.staticChildren[seg];
      if (c !== undefined) { si++; node = c; continue; }
    }
    if (node.paramChild !== null) {
      paramOut[pi++] = seg;
      si++;
      node = node.paramChild.next;
      continue;
    }
    return null;
  }
  return node.store;
}

const probes = [
  ['tenant-0', 'users', '42', 'posts', '7'],
  ['tenant-50000', 'users', 'abc', 'posts', 'xyz'],
  ['tenant-99999', 'users', 'U', 'posts', 'P'],
];

console.log(`bun=${Bun.version} routes=${N} iter=${ITER}`);

console.log(`\n## B1 baseline (per-segment node)`);
const b1 = buildB1();
console.log(`  build=${b1.buildMs.toFixed(1)}ms nodes=${b1.nodeCount} rss=+${b1.rss.toFixed(1)}MiB heap=+${b1.heap.toFixed(1)}MiB`);
const paramBuf = ['', '', '', '', ''];
let i = 0;
bench('warmed hit (3 probe cycle)', () => lookupB1(b1.root, probes[(i++) % probes.length]!, paramBuf));
bench('warmed miss', () => lookupB1(b1.root, ['tenant-x', 'users', 'a', 'posts', 'b'], paramBuf));

console.log(`\n## B7 compressed (chain RLE)`);
const b7 = buildB7();
console.log(`  build=${b7.buildMs.toFixed(1)}ms nodes=${b7.nodeCount} rss=+${b7.rss.toFixed(1)}MiB heap=+${b7.heap.toFixed(1)}MiB`);
i = 0;
bench('warmed hit (3 probe cycle)', () => lookupB7(b7.root, probes[(i++) % probes.length]!, paramBuf));
bench('warmed miss', () => lookupB7(b7.root, ['tenant-x', 'users', 'a', 'posts', 'b'], paramBuf));

console.log(`\n## ratio (B1 / B7)`);
console.log(`  node count : ${b1.nodeCount} / ${b7.nodeCount} = ${(b1.nodeCount/b7.nodeCount).toFixed(2)}x`);
console.log(`  rss        : ${b1.rss.toFixed(1)} / ${b7.rss.toFixed(1)} = ${(b1.rss/b7.rss).toFixed(2)}x`);
console.log(`  heap       : ${b1.heap.toFixed(1)} / ${b7.heap.toFixed(1)} = ${(b1.heap/b7.heap).toFixed(2)}x`);
console.log(`  build      : ${b1.buildMs.toFixed(1)} / ${b7.buildMs.toFixed(1)} = ${(b1.buildMs/b7.buildMs).toFixed(2)}x`);
