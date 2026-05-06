/* Tier 2 — Cuckoo/FKS perfect hash, sealed/frozen prototype, realistic walker, JSC flag exploration */
/* eslint-disable no-console */
import { bench, run, do_not_optimize } from 'mitata';

const N = 100_000;
const keys: string[] = [];
for (let i = 0; i < N; i++) keys.push(`/api/v${i % 50}/users/${i}`);

// =================================================================
// G. Cuckoo hash (2 tables, 2 hash functions, BFS displacement on insert)
// =================================================================
function cuckooBuild(ks: string[]): {
  t1: Int32Array; k1: string[]; t2: Int32Array; k2: string[]; cap: number;
} {
  const cap = 1 << Math.ceil(Math.log2(ks.length * 2));
  const t1 = new Int32Array(cap); t1.fill(-1);
  const k1: string[] = new Array(cap);
  const t2 = new Int32Array(cap); t2.fill(-1);
  const k2: string[] = new Array(cap);

  function h1(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h) & (cap - 1);
  }
  function h2(s: string): number {
    let h = 0xdeadbeef;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
    return Math.abs(h) & (cap - 1);
  }

  const MAX_KICKS = 500;
  for (let i = 0; i < ks.length; i++) {
    let key: string | undefined = ks[i];
    let val: number = i;
    let table = 1;
    for (let kicks = 0; kicks < MAX_KICKS; kicks++) {
      if (table === 1) {
        const slot = h1(key!);
        if (t1[slot] === -1) { t1[slot] = val; k1[slot] = key!; key = undefined; break; }
        const evictedV = t1[slot]!;
        const evictedK = k1[slot]!;
        t1[slot] = val; k1[slot] = key!;
        key = evictedK; val = evictedV; table = 2;
      } else {
        const slot = h2(key!);
        if (t2[slot] === -1) { t2[slot] = val; k2[slot] = key!; key = undefined; break; }
        const evictedV = t2[slot]!;
        const evictedK = k2[slot]!;
        t2[slot] = val; k2[slot] = key!;
        key = evictedK; val = evictedV; table = 1;
      }
    }
    if (key !== undefined) throw new Error('Cuckoo build failed at ' + i);
  }
  return { t1, k1, t2, k2, cap };
}

const cuckoo = cuckooBuild(keys);
function cuckooLookup(s: string): number | undefined {
  // h1
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const slot1 = Math.abs(h) & (cuckoo.cap - 1);
  if (cuckoo.k1[slot1] === s) return cuckoo.t1[slot1];
  // h2
  h = 0xdeadbeef;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  const slot2 = Math.abs(h) & (cuckoo.cap - 1);
  if (cuckoo.k2[slot2] === s) return cuckoo.t2[slot2];
  return undefined;
}

// =================================================================
// H. Sealed object + frozen prototype chain
// =================================================================
const sealedFrozen: Record<string, number> = Object.create(null);
for (let i = 0; i < N; i++) sealedFrozen[keys[i]!] = i;
Object.freeze(sealedFrozen);

const sealedNonFrozen: Record<string, number> = Object.create(null);
for (let i = 0; i < N; i++) sealedNonFrozen[keys[i]!] = i;
Object.preventExtensions(sealedNonFrozen);

const plainObj: Record<string, number> = Object.create(null);
for (let i = 0; i < N; i++) plainObj[keys[i]!] = i;

const m = new Map<string, number>();
for (let i = 0; i < N; i++) m.set(keys[i]!, i);

let idx = 0;

// =================================================================
// J. Realistic walker shape (segment-trie-style if-chain with multi-segment)
// =================================================================
function makeRealisticWalker(routes: Array<{ segments: string[]; handlerId: number }>): string {
  let body = `return function match(url, state) {
    state.paramCount = 0;
    const len = url.length;
    let pos = 0;
    if (len === 0 || url.charCodeAt(0) !== 47) return false;
    pos = 1;`;
  // build a trie-like nested if structure
  const tree: Record<string, unknown> = {};
  for (const r of routes) {
    let t: Record<string, unknown> = tree;
    for (let i = 0; i < r.segments.length; i++) {
      const seg = r.segments[i]!;
      if (!t[seg]) t[seg] = i === r.segments.length - 1 ? { __h: r.handlerId } : {};
      t = t[seg] as Record<string, unknown>;
    }
  }
  function emitNode(t: Record<string, unknown>, depth: number): string {
    let out = '';
    for (const seg of Object.keys(t)) {
      if (seg === '__h') {
        out += `if (pos === len) { state.handlerIndex = ${t[seg]}; return true; }\n`;
        continue;
      }
      const segLen = seg.length;
      const child = t[seg] as Record<string, unknown>;
      out += `if (len - pos >= ${segLen} && url.startsWith('${seg}', pos)) {
        const saved${depth} = pos;
        pos += ${segLen};
        if (pos < len && url.charCodeAt(pos) === 47) pos += 1;
        ${emitNode(child, depth + 1)}
        pos = saved${depth};
      }\n`;
    }
    return out;
  }
  body += emitNode(tree, 0);
  body += 'return false; }';
  return body;
}

const realisticRoutes: Array<{ segments: string[]; handlerId: number }> = [];
for (let i = 0; i < 64; i++) {
  realisticRoutes.push({ segments: [`api`, `v${i % 4}`, `users`, `${i}`], handlerId: i });
}
const realisticSrc = makeRealisticWalker(realisticRoutes);
const realisticFn = new Function(realisticSrc)() as (url: string, state: { paramCount: number; handlerIndex: number }) => boolean;
const state = { paramCount: 0, handlerIndex: -1 };

// Probes
bench('plain null-proto object lookup', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(plainObj[k]);
});
bench('sealed (preventExtensions) lookup', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(sealedNonFrozen[k]);
});
bench('frozen object lookup', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(sealedFrozen[k]);
});
bench('Map<string,number>.get', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(m.get(k));
});
bench('Cuckoo hash lookup (2 tables, custom djb2/FNV)', () => {
  const k = keys[(idx = (idx + 1) % N)]!;
  do_not_optimize(cuckooLookup(k));
});

bench('realistic walker (64 routes, 4 segments deep)', () => {
  const route = realisticRoutes[(idx = (idx + 1) % 64)]!;
  do_not_optimize(realisticFn('/' + route.segments.join('/'), state));
});

await run({ format: 'mitata' });
