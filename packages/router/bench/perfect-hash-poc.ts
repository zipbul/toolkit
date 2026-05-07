/* POC: perfect-hash plus build-time Bun.hash for the static table. */
/* eslint-disable no-console */
export {};

const N = 100_000;
const ITERS = 5_000_000;

// Generate route-like keys
const keys: string[] = [];
for (let i = 0; i < N; i++) keys.push(`/api/v${i % 50}/users/${i}`);

// 1. Baseline: null-proto object lookup (current)
const objMap: Record<string, number> = Object.create(null);
for (let i = 0; i < N; i++) objMap[keys[i]!] = i;

// 2. Bun.hash → Uint32Array open-address (build-time hash, runtime lookup)
const cap = 1 << Math.ceil(Math.log2(N * 2));  // 2× capacity for low load factor
const hashTable = new Int32Array(cap);
hashTable.fill(-1);
const hashKeys: string[] = new Array(cap);
function bunHashU32(s: string): number {
  return Number(BigInt.asUintN(32, BigInt(Bun.hash(s))));
}
for (let i = 0; i < N; i++) {
  let h = bunHashU32(keys[i]!) & (cap - 1);
  while (hashTable[h] !== -1) h = (h + 1) & (cap - 1);
  hashTable[h] = i;
  hashKeys[h] = keys[i]!;
}

// 3. FKS-style two-level hash: build a small per-bucket mapping; for POC use simple linear
// (skipped — same as #2 with low load factor)

// Probes
function measureLookup(label: string, run: (k: string) => number | undefined): void {
  // warmup
  for (let i = 0; i < 100_000; i++) run(keys[i % N]!);
  const t0 = Bun.nanoseconds();
  let sink = 0;
  for (let i = 0; i < ITERS; i++) {
    const v = run(keys[i % N]!);
    if (v !== undefined) sink += v as number;
  }
  const t1 = Bun.nanoseconds();
  console.log(label.padEnd(48), ((t1 - t0) / ITERS).toFixed(2), 'ns/op', 'sink=' + sink);
}

measureLookup('1. null-proto object lookup', (k) => objMap[k]);

measureLookup('2. Bun.hash → open-address Int32Array', (k) => {
  let h = bunHashU32(k) & (cap - 1);
  while (true) {
    const v = hashTable[h]!;
    if (v === -1) return undefined;
    if (hashKeys[h] === k) return v;
    h = (h + 1) & (cap - 1);
  }
});

// 4. Map<string, number> — for direct comparison
const m = new Map<string, number>();
for (let i = 0; i < N; i++) m.set(keys[i]!, i);
measureLookup('3. Map<string, number>.get', (k) => m.get(k));

// 5. Build-time Bun.hash on full key set — measure build cost
{
  const t0 = Bun.nanoseconds();
  const arr: number[] = [];
  for (let i = 0; i < N; i++) arr.push(bunHashU32(keys[i]!));
  const t1 = Bun.nanoseconds();
  console.log('build: Bun.hash 100k keys'.padEnd(48), 'total', ((t1 - t0) / 1_000_000).toFixed(2), 'ms',
    'avg', ((t1 - t0) / N).toFixed(2), 'ns/key');
}

// 6. Build cost of object table for comparison
{
  const t0 = Bun.nanoseconds();
  const o: Record<string, number> = Object.create(null);
  for (let i = 0; i < N; i++) o[keys[i]!] = i;
  const t1 = Bun.nanoseconds();
  console.log('build: null-proto object 100k'.padEnd(48), 'total', ((t1 - t0) / 1_000_000).toFixed(2), 'ms',
    'avg', ((t1 - t0) / N).toFixed(2), 'ns/key');
}

// 7. Build cost of open-address hash table
{
  const t0 = Bun.nanoseconds();
  const cap2 = 1 << Math.ceil(Math.log2(N * 2));
  const t = new Int32Array(cap2);
  t.fill(-1);
  const tk: string[] = new Array(cap2);
  for (let i = 0; i < N; i++) {
    let h = bunHashU32(keys[i]!) & (cap2 - 1);
    while (t[h] !== -1) h = (h + 1) & (cap2 - 1);
    t[h] = i;
    tk[h] = keys[i]!;
  }
  const t1 = Bun.nanoseconds();
  console.log('build: Bun.hash + open-address'.padEnd(48), 'total', ((t1 - t0) / 1_000_000).toFixed(2), 'ms',
    'avg', ((t1 - t0) / N).toFixed(2), 'ns/key');
}
