/**
 * Method dispatch micro-bench — measures the relative cost of the four
 * candidate dispatch shapes the router could emit:
 *
 *   1. single-method literal `if (method !== "GET") return null;`
 *   2. multi-method `methodCodes[method]` (current production shape)
 *   3. switch on `method.charCodeAt(0)` with disambiguation by length
 *   4. perfect hash (FNV-1a32 over method, then table indexed by hash)
 *
 * Run across 7 / 16 / 32 active methods. The 7-method case is the realistic
 * default (HTTP/1.1 verbs); 16 and 32 stress what happens when WebDAV-style
 * registries are pulled in.
 *
 * Hot-path assumption: the caller passes a method string the router
 * recognizes most of the time. We bench the hit path. A separate "miss"
 * path is also measured because shape 3 (charCode switch) handles miss
 * differently from shapes 1/2/4.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const METHODS_7 = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'] as const;
const METHODS_16 = [
  ...METHODS_7,
  'TRACE','CONNECT','PROPFIND','PROPPATCH','MKCOL','COPY','MOVE','LOCK',
] as const;
const METHODS_32 = [
  ...METHODS_16,
  'UNLOCK','REPORT','SEARCH','BIND','REBIND','UNBIND','ACL','MKCALENDAR',
  'MKWORKSPACE','UPDATE','CHECKOUT','CHECKIN','UNCHECKOUT','MERGE',
  'BASELINE-CONTROL','MKACTIVITY',
] as const;

type Methods = readonly string[];

// Build a prototype-less Record (the production shape).
function buildRecord(methods: Methods): Record<string, number> {
  const r = Object.create(null) as Record<string, number>;
  for (let i = 0; i < methods.length; i++) r[methods[i]!] = i;
  return r;
}

// Codegen helpers — mirror what emitter.ts would produce.

function makeSingleMethodFn(name: string): (m: string) => number {
  // Equivalent to `if (method !== "GET") return -1; return 0;`
  return new Function('method', `
    if (method !== ${JSON.stringify(name)}) return -1;
    return 0;
  `) as (m: string) => number;
}

function makeRecordFn(record: Record<string, number>): (m: string) => number {
  // Equivalent to `var mc = methodCodes[method]; if (mc === undefined) return -1;`
  return new Function('methodCodes', `
    return function dispatch(method) {
      var mc = methodCodes[method];
      if (mc === undefined) return -1;
      return mc;
    };
  `)(record) as (m: string) => number;
}

// charCode switch — discriminates by first char + length when first char collides.
// Build a perfect discriminator over the active set. Returns code or -1.
function makeCharCodeSwitchFn(methods: Methods): (m: string) => number {
  // Group methods by (charCode0, length). When a (cc, len) pair maps to a
  // single method, dispatch is `return code;`. When multiple methods share
  // the pair (e.g. GET/PUT both length 3 — but cc differs), we need full
  // string compare on tie. Method names that share both first char and
  // length need a chain of `===` checks.
  type Bucket = Array<[string, number]>;
  const groups = new Map<string, Bucket>(); // key: `${cc}:${len}`
  for (let i = 0; i < methods.length; i++) {
    const m = methods[i]!;
    const k = `${m.charCodeAt(0)}:${m.length}`;
    let g = groups.get(k);
    if (g === undefined) { g = []; groups.set(k, g); }
    g.push([m, i]);
  }
  // Emit a switch on charCode0, with nested length-switch.
  const ccGroups = new Map<number, Map<number, Bucket>>();
  for (const [k, g] of groups) {
    const [ccStr, lenStr] = k.split(':');
    const cc = Number(ccStr);
    const len = Number(lenStr);
    let lenMap = ccGroups.get(cc);
    if (lenMap === undefined) { lenMap = new Map(); ccGroups.set(cc, lenMap); }
    lenMap.set(len, g);
  }
  let body = 'switch (method.charCodeAt(0)) {\n';
  for (const [cc, lenMap] of ccGroups) {
    body += `  case ${cc}: switch (method.length) {\n`;
    for (const [len, bucket] of lenMap) {
      body += `    case ${len}:\n`;
      if (bucket.length === 1) {
        const [name, code] = bucket[0]!;
        body += `      return method === ${JSON.stringify(name)} ? ${code} : -1;\n`;
      } else {
        for (const [name, code] of bucket) {
          body += `      if (method === ${JSON.stringify(name)}) return ${code};\n`;
        }
        body += `      return -1;\n`;
      }
    }
    body += `    default: return -1;\n  }\n`;
  }
  body += `  default: return -1;\n}`;
  return new Function('method', body) as (m: string) => number;
}

// Perfect hash via FNV-1a32 — build a table keyed by hash modulo a prime.
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function makePerfectHashFn(methods: Methods): (m: string) => number {
  // Find the smallest table size where every method hashes uniquely.
  const n = methods.length;
  for (let size = n; size <= n * 8; size++) {
    const table = new Array(size).fill(null) as Array<[string, number] | null>;
    let ok = true;
    for (let i = 0; i < methods.length; i++) {
      const m = methods[i]!;
      const slot = fnv1a32(m) % size;
      if (table[slot] !== null) { ok = false; break; }
      table[slot] = [m, i];
    }
    if (ok) {
      // Emit the lookup using captured table.
      const fn = (method: string): number => {
        let h = 0x811c9dc5;
        for (let i = 0; i < method.length; i++) {
          h ^= method.charCodeAt(i);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        const slot = (h >>> 0) % size;
        const entry = table[slot];
        if (entry === null) return -1;
        return entry[0] === method ? entry[1] : -1;
      };
      return fn;
    }
  }
  throw new Error('no perfect hash found within 8x');
}

// ── Generate hit-path samples (mix of all active methods, randomized) ──
function makeSamples(methods: Methods, n = 1000): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(methods[i % methods.length]!);
  // Shuffle so JIT doesn't specialize on order.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const MISS = 'BOGUS';

async function main() {
  for (const [label, methods] of [
    ['7 methods (default)', METHODS_7 as Methods] as const,
    ['16 methods', METHODS_16 as Methods] as const,
    ['32 methods', METHODS_32 as Methods] as const,
  ]) {
    const record = buildRecord(methods);
    const recordFn = makeRecordFn(record);
    const switchFn = makeCharCodeSwitchFn(methods);
    const hashFn = makePerfectHashFn(methods);
    const samples = makeSamples(methods, 1024);
    const N = samples.length;

    console.log(`\n=== ${label} — hit path ===`);
    summary(() => {
      bench('Record[method]   (current)', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += recordFn(samples[i]!);
        do_not_optimize(acc);
      });
      bench('charCode switch', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += switchFn(samples[i]!);
        do_not_optimize(acc);
      });
      bench('perfect hash (FNV)', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += hashFn(samples[i]!);
        do_not_optimize(acc);
      });
    });

    console.log(`\n=== ${label} — miss path ('BOGUS') ===`);
    summary(() => {
      bench('Record[method]   (current)', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += recordFn(MISS);
        do_not_optimize(acc);
      });
      bench('charCode switch', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += switchFn(MISS);
        do_not_optimize(acc);
      });
      bench('perfect hash (FNV)', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += hashFn(MISS);
        do_not_optimize(acc);
      });
    });
  }

  console.log('\n=== single-method literal compare (only meaningful @ 1 active) ===');
  {
    const single = makeSingleMethodFn('GET');
    const recordFn = makeRecordFn(buildRecord(['GET']));
    const samples = makeSamples(['GET'], 1024);
    const N = samples.length;
    summary(() => {
      bench('Record[method]   (1-method)', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += recordFn(samples[i]!);
        do_not_optimize(acc);
      });
      bench('literal !== compare (1-method)', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += single(samples[i]!);
        do_not_optimize(acc);
      });
    });
  }

  await run();
}

main();
