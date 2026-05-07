/* eslint-disable no-console */
/**
 * POC: method availability bitmask vs current per-method-tree iteration
 * for `allowedMethods()` cold path + wrong-method check on hot path.
 *
 * §4 line 220 Confirmed within <=32 methods (§1 2.18 ns vs Set 3.43-9.66).
 * §13 phase grep: 0 work item assignment found.
 *
 * This POC measures end-to-end allowedMethods() and hot-path wrong-method
 * detection cost, not just the primitive lookup.
 */
export {};

const N = 100_000;
const ITER = 1_000_000;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'CONNECT'];

function bench(label: string, fn: () => unknown): number {
  for (let i = 0; i < 50_000; i++) fn();
  const t0 = process.hrtime.bigint();
  let cksm = 0;
  for (let i = 0; i < ITER; i++) {
    const v = fn();
    if (v) cksm++;
  }
  const ns = Number(process.hrtime.bigint() - t0) / ITER;
  console.log(`  ${label.padEnd(48)} ${ns.toFixed(2).padStart(8)} ns/op cksm=${cksm}`);
  return ns;
}

// Build N routes, each with a random subset of 1-4 methods registered.
type Route = { path: string; methods: number[] }; // methods = method codes
const routes: Route[] = [];
for (let i = 0; i < N; i++) {
  const path = `/api/v1/resource-${i}`;
  const methodCount = 1 + (i % 4);
  const ms: number[] = [];
  for (let j = 0; j < methodCount; j++) ms.push((i + j) % METHODS.length);
  routes.push({ path, methods: ms });
}

// ─── Approach A: per-method tree iteration (current zipbul) ───
// staticOutputsByMethod = Array<Record<path, true> | undefined>, indexed by methodCode.
// allowedMethods(path) iterates over all 8 method codes and checks bucket presence.
const staticByMethod: Array<Record<string, true> | undefined> = new Array(METHODS.length);
for (const r of routes) {
  for (const mc of r.methods) {
    let bucket = staticByMethod[mc];
    if (bucket === undefined) {
      bucket = Object.create(null) as Record<string, true>;
      staticByMethod[mc] = bucket;
    }
    bucket[r.path] = true;
  }
}

function allowedMethodsA(path: string): number[] {
  const out: number[] = [];
  for (let mc = 0; mc < METHODS.length; mc++) {
    const bucket = staticByMethod[mc];
    if (bucket !== undefined && bucket[path] === true) out.push(mc);
  }
  return out;
}

function wrongMethodA(method: number, path: string): boolean {
  const bucket = staticByMethod[method];
  return bucket !== undefined && bucket[path] === true;
}

// ─── Approach B: per-path bitmask ───
// pathToMask = Map<path, uint32 bitmask>. allowedMethods = popcount + bit iteration.
// wrong-method check = single AND.
const pathToMask = new Map<string, number>();
for (const r of routes) {
  let mask = 0;
  for (const mc of r.methods) mask |= (1 << mc);
  pathToMask.set(r.path, mask);
}

function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

function allowedMethodsB(path: string): number[] {
  const mask = pathToMask.get(path);
  if (mask === undefined) return [];
  const out: number[] = new Array(popcount32(mask));
  let i = 0;
  let m = mask;
  while (m !== 0) {
    const bit = m & -m; // lowest set bit
    out[i++] = 31 - Math.clz32(bit);
    m ^= bit;
  }
  return out;
}

function wrongMethodB(method: number, path: string): boolean {
  const mask = pathToMask.get(path);
  if (mask === undefined) return false;
  return (mask & (1 << method)) !== 0;
}

// ─── Approach C: per-path bitmask in null-proto object ───
const pathToMaskObj: Record<string, number> = Object.create(null);
for (const r of routes) {
  let mask = 0;
  for (const mc of r.methods) mask |= (1 << mc);
  pathToMaskObj[r.path] = mask;
}

function allowedMethodsC(path: string): number[] {
  const mask = pathToMaskObj[path];
  if (mask === undefined) return [];
  const out: number[] = new Array(popcount32(mask));
  let i = 0;
  let m = mask;
  while (m !== 0) {
    const bit = m & -m;
    out[i++] = 31 - Math.clz32(bit);
    m ^= bit;
  }
  return out;
}

function wrongMethodC(method: number, path: string): boolean {
  const mask = pathToMaskObj[path];
  return mask !== undefined && (mask & (1 << method)) !== 0;
}

console.log(`bun=${Bun.version} routes=${N} methods=${METHODS.length} iter=${ITER}`);

// Probes
const probePaths: string[] = [];
for (let i = 0; i < 100; i++) {
  probePaths.push(routes[Math.floor((i / 100) * N)]!.path);
}

console.log(`\n## allowedMethods(path) — cold path semantic`);
let i = 0;
const a1 = bench('A: per-method tree iteration (current)', () => {
  return allowedMethodsA(probePaths[(i++) % probePaths.length]!);
});
i = 0;
const b1 = bench('B: per-path Map bitmask + popcount', () => {
  return allowedMethodsB(probePaths[(i++) % probePaths.length]!);
});
i = 0;
const c1 = bench('C: per-path object bitmask + popcount', () => {
  return allowedMethodsC(probePaths[(i++) % probePaths.length]!);
});

console.log(`\n## wrong-method check (hot path; method != registered)`);
i = 0;
const a2 = bench('A: per-method tree boolean lookup', () => {
  const r = routes[(i++) % N]!;
  const wrongM = (r.methods[0]! + 1) % METHODS.length;
  return wrongMethodA(wrongM, r.path);
});
i = 0;
const b2 = bench('B: per-path Map mask AND', () => {
  const r = routes[(i++) % N]!;
  const wrongM = (r.methods[0]! + 1) % METHODS.length;
  return wrongMethodB(wrongM, r.path);
});
i = 0;
const c2 = bench('C: per-path object mask AND', () => {
  const r = routes[(i++) % N]!;
  const wrongM = (r.methods[0]! + 1) % METHODS.length;
  return wrongMethodC(wrongM, r.path);
});

console.log(`\n## allowedMethods ratios`);
console.log(`  B vs A: ${(a1/b1).toFixed(2)}× (Map bitmask ${b1<a1?'faster':'slower'})`);
console.log(`  C vs A: ${(a1/c1).toFixed(2)}× (object bitmask ${c1<a1?'faster':'slower'})`);
console.log(`\n## wrong-method ratios`);
console.log(`  B vs A: ${(a2/b2).toFixed(2)}× (Map bitmask ${b2<a2?'faster':'slower'})`);
console.log(`  C vs A: ${(a2/c2).toFixed(2)}× (object bitmask ${c2<a2?'faster':'slower'})`);
