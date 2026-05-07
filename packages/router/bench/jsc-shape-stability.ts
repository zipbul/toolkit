/* JSC object-shape / dictionary-mode evidence microbench. */
/* eslint-disable no-console */
export {};

const N = 100_000;
const ITERS = 1_000_000;

function measure(label: string, run: () => unknown): void {
  // warmup
  for (let i = 0; i < 50_000; i++) run();
  const t0 = Bun.nanoseconds();
  let sink = 0 as unknown;
  for (let i = 0; i < ITERS; i++) sink = run();
  const t1 = Bun.nanoseconds();
  const ns = (t1 - t0) / ITERS;
  console.log(label.padEnd(56), ns.toFixed(2), 'ns/op', 'sink=', String(sink).slice(0, 8));
}

// 1. Sealed null-proto object (router static table style: built once, frozen-ish)
const sealed: Record<string, number> = Object.create(null);
for (let i = 0; i < N; i++) sealed[`/route/${i}`] = i;
Object.preventExtensions(sealed);
const sealedKeys = Object.keys(sealed);
let sealedIdx = 0;
measure('sealed null-proto lookup (100k keys)', () => {
  const k = sealedKeys[(sealedIdx++) % sealedKeys.length]!;
  return sealed[k];
});

// 2. Dynamic null-proto object — keys added/deleted to force dictionary-mode
const dynamic: Record<string, number> = Object.create(null);
for (let i = 0; i < N; i++) dynamic[`/route/${i}`] = i;
for (let i = 0; i < N; i += 2) delete dynamic[`/route/${i}`]; // half deletion → dictionary-mode
for (let i = 0; i < N / 2; i++) dynamic[`/extra/${i}`] = i; // re-add new shape
const dynamicKeys = Object.keys(dynamic);
let dynamicIdx = 0;
measure('dictionary-mode null-proto lookup (post mutation)', () => {
  const k = dynamicKeys[(dynamicIdx++) % dynamicKeys.length]!;
  return dynamic[k];
});

// 3. Map<string, number> for comparison
const m = new Map<string, number>();
for (let i = 0; i < N; i++) m.set(`/route/${i}`, i);
let mapIdx = 0;
measure('Map<string,number> get (100k keys)', () => {
  const k = sealedKeys[(mapIdx++) % sealedKeys.length]!;
  return m.get(k);
});

// 4. Small static set (4 keys) — non-dictionary, fast IC
const small: Record<string, number> = Object.create(null);
small['GET'] = 0;
small['POST'] = 1;
small['PUT'] = 2;
small['DELETE'] = 3;
Object.preventExtensions(small);
const smallKeys = ['GET', 'POST', 'PUT', 'DELETE'];
let smallIdx = 0;
measure('small null-proto lookup (4 keys, IC)', () => {
  const k = smallKeys[(smallIdx++) & 3]!;
  return small[k];
});

// 5. Lookup of NON-EXISTENT key (miss path)
let missIdx = 0;
const missKeys: string[] = [];
for (let i = 0; i < 1024; i++) missKeys.push(`/missing/${i}`);
measure('null-proto MISS lookup (sealed shape)', () => {
  const k = missKeys[(missIdx++) & 1023]!;
  return sealed[k];
});

// 6. JSC structure transition probe: insert keys one by one and time each
{
  const obj: Record<string, number> = Object.create(null);
  const keys: string[] = [];
  for (let i = 0; i < 200; i++) keys.push(`k${i}`);
  const samples: number[] = [];
  for (const k of keys) {
    const t0 = Bun.nanoseconds();
    obj[k] = 1;
    const t1 = Bun.nanoseconds();
    samples.push(t1 - t0);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const max = Math.max(...samples);
  console.log('structure transition (200 keys):'.padEnd(56), 'avg', avg.toFixed(0), 'ns max', max.toFixed(0), 'ns');
}
