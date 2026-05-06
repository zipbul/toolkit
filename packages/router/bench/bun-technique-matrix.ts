/* eslint-disable no-console */

type BenchResult = {
  name: string;
  ns: number;
  checksum: number;
  note: string;
};

const ITER = 1_000_000;
const BUILD_ITER = 100_000;
let sink = 0;

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function bench(name: string, fn: () => number, iterations = ITER, note = ''): BenchResult {
  for (let i = 0; i < 20_000; i++) sink ^= fn();

  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < iterations; i++) checksum = (checksum + fn()) | 0;
  const end = nowNs();

  sink ^= checksum;

  return {
    name,
    ns: Number(end - start) / iterations,
    checksum,
    note,
  };
}

function memSnapshot(): NodeJS.MemoryUsage {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  return process.memoryUsage();
}

function memDelta(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage): string {
  const rss = (after.rss - before.rss) / 1024 / 1024;
  const heap = (after.heapUsed - before.heapUsed) / 1024 / 1024;
  const buffers = (after.arrayBuffers - before.arrayBuffers) / 1024 / 1024;
  return `rss=${rss.toFixed(2)}MB heap=${heap.toFixed(2)}MB arrayBuffers=${buffers.toFixed(2)}MB`;
}

function printGroup(title: string, rows: BenchResult[]): void {
  console.log(`\n## ${title}`);
  for (const row of rows) {
    console.log(`${row.name.padEnd(44)} ${row.ns.toFixed(2).padStart(10)} ns/op  checksum=${String(row.checksum).padStart(11)}  ${row.note}`);
  }
}

function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const methodObj = Object.create(null) as Record<string, number>;
for (let i = 0; i < methods.length; i++) methodObj[methods[i]!] = i;
const methodMap = new Map(methods.map((m, i) => [m, i]));

function methodSwitch(m: string): number {
  switch (m) {
    case 'GET': return 0;
    case 'POST': return 1;
    case 'PUT': return 2;
    case 'PATCH': return 3;
    case 'DELETE': return 4;
    case 'OPTIONS': return 5;
    case 'HEAD': return 6;
    default: return -1;
  }
}

const routeCount = 4096;
const paths = Array.from({ length: routeCount }, (_, i) => `/api/v1/resource${i}`);
const hitPath = paths[2048]!;
const missPath = '/api/v1/nope';

const directObj = Object.create(null) as Record<string, number>;
for (let i = 0; i < paths.length; i++) directObj[paths[i]!] = i;

const byLen = Object.create(null) as Record<number, Record<string, number>>;
for (let i = 0; i < paths.length; i++) {
  const p = paths[i]!;
  byLen[p.length] ??= Object.create(null) as Record<string, number>;
  byLen[p.length]![p] = i;
}

const firstLastBitmap = new Uint32Array(128);
for (const p of paths) {
  firstLastBitmap[p.charCodeAt(1)!] = 1;
  firstLastBitmap[p.charCodeAt(p.length - 1)!] = 1;
}

const hashSize = 8192;
const hashKeys = new Array<string | undefined>(hashSize);
const hashVals = new Int32Array(hashSize).fill(-1);
for (let i = 0; i < paths.length; i++) {
  const p = paths[i]!;
  let idx = fnv32(p) & (hashSize - 1);
  while (hashKeys[idx] !== undefined) idx = (idx + 1) & (hashSize - 1);
  hashKeys[idx] = p;
  hashVals[idx] = i;
}

function hashLookup(p: string): number {
  let idx = fnv32(p) & (hashSize - 1);
  for (let probe = 0; probe < 8; probe++) {
    const key = hashKeys[idx];
    if (key === p) return hashVals[idx]!;
    if (key === undefined) return -1;
    idx = (idx + 1) & (hashSize - 1);
  }
  return -1;
}

function packedKey(p: string): number {
  return (p.length << 24) ^ (p.charCodeAt(1) << 16) ^ (p.charCodeAt(p.length - 1) << 8) ^ (fnv32(p) & 0xff);
}

const packedObj = Object.create(null) as Record<number, number>;
for (let i = 0; i < paths.length; i++) packedObj[packedKey(paths[i]!)] = i;

function makeFanout(size: number): {
  keys: string[];
  arrVals: number[];
  obj: Record<string, number>;
  map: Map<string, number>;
  tableKeys: Array<string | undefined>;
  tableVals: Int32Array;
  hit: string;
} {
  const keys = Array.from({ length: size }, (_, i) => `seg${i}`);
  const arrVals = keys.map((_, i) => i);
  const obj = Object.create(null) as Record<string, number>;
  const map = new Map<string, number>();
  const cap = 1 << Math.ceil(Math.log2(size * 2));
  const tableKeys = new Array<string | undefined>(cap);
  const tableVals = new Int32Array(cap).fill(-1);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    obj[k] = i;
    map.set(k, i);
    let idx = fnv32(k) & (cap - 1);
    while (tableKeys[idx] !== undefined) idx = (idx + 1) & (cap - 1);
    tableKeys[idx] = k;
    tableVals[idx] = i;
  }
  return { keys, arrVals, obj, map, tableKeys, tableVals, hit: keys[size - 1]! };
}

function fanoutHashLookup(f: ReturnType<typeof makeFanout>, key: string): number {
  const mask = f.tableKeys.length - 1;
  let idx = fnv32(key) & mask;
  for (;;) {
    const k = f.tableKeys[idx];
    if (k === key) return f.tableVals[idx]!;
    if (k === undefined) return -1;
    idx = (idx + 1) & mask;
  }
}

const fan4 = makeFanout(4);
const fan16 = makeFanout(16);
const fan64 = makeFanout(64);

function arrayScan(keys: string[], vals: number[], hit: string): number {
  for (let i = 0; i < keys.length; i++) if (keys[i] === hit) return vals[i]!;
  return -1;
}

const plainNums = Array.from({ length: 1024 }, (_, i) => i);
const typedNums = new Uint32Array(plainNums);
const dataBuffer = new ArrayBuffer(plainNums.length * 4);
const dataView = new DataView(dataBuffer);
for (let i = 0; i < plainNums.length; i++) dataView.setUint32(i * 4, i, true);

const pooled = new ArrayBuffer(BUILD_ITER * 8);

const byteText = '/api/v1/resource2048';
const encoder = new TextEncoder();
const encoded = encoder.encode(byteText);

function charScan(s: string): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return sum;
}

function byteScan(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += bytes[i]!;
  return sum;
}

const staticSpecialized = new Function('p', `
  if (p === "/api/v1/resource2048") return 2048;
  if (p === "/api/v1/resource1") return 1;
  if (p === "/api/v1/resource2") return 2;
  return -1;
`) as (p: string) => number;

const reDigits = /^\d+$/;
function digitsFast(s: string): number {
  if (s.length === 0) return 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return 0;
  }
  return 1;
}

const nestedMethod: Array<Record<string, number>> = methods.map(() => directObj);
const byPathThenMethod = Object.create(null) as Record<string, Int32Array>;
for (let i = 0; i < paths.length; i++) {
  const arr = new Int32Array(8).fill(-1);
  arr[0] = i;
  byPathThenMethod[paths[i]!] = arr;
}

const methodFlags = new Uint32Array(routeCount);
const methodBoolArrays = Array.from({ length: routeCount }, () => {
  const arr = new Array<boolean>(8).fill(false);
  arr[0] = true;
  arr[3] = true;
  return arr;
});
const methodSetArrays = Array.from({ length: routeCount }, () => new Set<number>([0, 3]));
const methodStringSets = Array.from({ length: routeCount }, () => new Set<string>(['GET', 'PATCH']));
for (let i = 0; i < methodFlags.length; i++) methodFlags[i] = (1 << 0) | (1 << 3);

const terminalFastTag = 2048;
const terminalPolyTag = -1;
const terminalPolyHandlers = new Int32Array([2048, -1, -1, 4096, -1, -1, -1, -1]);

function terminalArrayLookup(mc: number): number {
  return terminalPolyHandlers[mc]!;
}

function terminalTagged(tag: number, mc: number): number {
  if (tag >= 0) return tag;
  return terminalPolyHandlers[mc]!;
}

const cacheConcat = new Map<string, number>();
const cacheNested = new Map<string, number>();
cacheConcat.set(`GET ${hitPath}`, 1);
cacheNested.set(hitPath, 1);

function normalizeAlways(p: string): string {
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) return p.slice(0, -1);
  return p.toLowerCase();
}

function normalizeFast(p: string): string {
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (i === p.length - 1 && c === 47 && p.length > 1)) return normalizeAlways(p);
  }
  return p;
}

function throwValidation(i: number): number {
  try {
    if ((i & 15) === 0) throw new Error('bad');
    return 1;
  } catch {
    return 0;
  }
}

function issueValidation(i: number): number {
  if ((i & 15) === 0) return 0;
  return 1;
}

const mono = Array.from({ length: 1024 }, (_, i) => ({ a: i, b: i + 1, c: i + 2 }));
const poly = Array.from({ length: 1024 }, (_, i) => (
  i % 3 === 0 ? { a: i, b: i + 1, c: i + 2 } :
  i % 3 === 1 ? { a: i, b: i + 1, d: i + 2 } :
  { a: i, e: i + 1, f: i + 2 }
));

const paramUrl = '/users/123456/posts/abcdef';
const paramOffsets = new Int32Array([7, 13, 20, 26]);

function allocParams(): number {
  const p = {
    __proto__: null,
    id: paramUrl.substring(paramOffsets[0]!, paramOffsets[1]!),
    post: paramUrl.substring(paramOffsets[2]!, paramOffsets[3]!),
  };
  return p.id.length + p.post.length;
}

function offsetOnly(): number {
  return paramOffsets[1]! - paramOffsets[0]! + paramOffsets[3]! - paramOffsets[2]!;
}

const rows1 = [
  bench('method object lookup', () => methodObj.PATCH),
  bench('method Map.get', () => methodMap.get('PATCH') ?? -1),
  bench('method switch dispatch', () => methodSwitch('PATCH')),
];

const rows2 = [
  bench('direct object static hit', () => directObj[hitPath] ?? -1),
  bench('length bucket static hit', () => byLen[hitPath.length]![hitPath] ?? -1),
  bench('first/last bitmap miss prefilter', () => {
    const p = missPath;
    if (firstLastBitmap[p.charCodeAt(1)!] === 0 || firstLastBitmap[p.charCodeAt(p.length - 1)!] === 0) return -1;
    return directObj[p] ?? -1;
  }),
  bench('packed key lookup hit', () => packedObj[packedKey(hitPath)] ?? -1),
  bench('open-address hash lookup hit', () => hashLookup(hitPath)),
];

const rows3 = [
  bench('fanout4 array scan', () => arrayScan(fan4.keys, fan4.arrVals, fan4.hit)),
  bench('fanout4 object lookup', () => fan4.obj[fan4.hit] ?? -1),
  bench('fanout4 Map.get', () => fan4.map.get(fan4.hit) ?? -1),
  bench('fanout4 open-address hash', () => fanoutHashLookup(fan4, fan4.hit)),
  bench('fanout16 array scan', () => arrayScan(fan16.keys, fan16.arrVals, fan16.hit)),
  bench('fanout16 object lookup', () => fan16.obj[fan16.hit] ?? -1),
  bench('fanout16 Map.get', () => fan16.map.get(fan16.hit) ?? -1),
  bench('fanout16 open-address hash', () => fanoutHashLookup(fan16, fan16.hit)),
  bench('fanout64 array scan', () => arrayScan(fan64.keys, fan64.arrVals, fan64.hit)),
  bench('fanout64 object lookup', () => fan64.obj[fan64.hit] ?? -1),
  bench('fanout64 Map.get', () => fan64.map.get(fan64.hit) ?? -1),
  bench('fanout64 open-address hash', () => fanoutHashLookup(fan64, fan64.hit)),
];

const rows4 = [
  bench('plain array indexed read', () => plainNums[512]!),
  bench('Uint32Array indexed read', () => typedNums[512]!),
  bench('DataView getUint32 read', () => dataView.getUint32(512 * 4, true)),
  bench('new ArrayBuffer per build unit', () => new Int32Array(8)[0]!, BUILD_ITER),
  bench('pooled ArrayBuffer view unit', () => new Int32Array(pooled, 0, 8)[0]!, BUILD_ITER),
  bench('pooled Int32Array indexed unit', () => typedNums[sink & 1023]!, BUILD_ITER),
  bench('bitmap+popcount rank', () => popcount32(0xffff & ((1 << 12) - 1))),
];

const rows5 = [
  bench('charCode string scan', () => charScan(byteText)),
  bench('TextEncoder.encode per match', () => byteScan(encoder.encode(byteText))),
  bench('pre-encoded byte scan', () => byteScan(encoded)),
  bench('Bun.hash string', () => Number(Bun.hash(byteText) & 0xffffn)),
  bench('JS fnv32 string hash', () => fnv32(byteText) & 0xffff),
  bench('String#indexOf slash', () => byteText.indexOf('/')),
  bench('manual slash scan', () => {
    for (let i = 0; i < byteText.length; i++) {
      if (byteText.charCodeAt(i) === 47) return i;
    }
    return -1;
  }),
  bench('string length read', () => byteText.length),
  bench('toLowerCase unchanged ascii', () => byteText.toLowerCase().length),
  bench('manual lowercase unchanged ascii', () => {
    for (let i = 0; i < byteText.length; i++) {
      const c = byteText.charCodeAt(i);
      if (c >= 65 && c <= 90) return byteText.toLowerCase().length;
    }
    return byteText.length;
  }),
];

const rows6 = [
  bench('generic object static lookup', () => directObj[hitPath] ?? -1),
  bench('build-time specialized equality', () => staticSpecialized(hitPath)),
  bench('regex digit constraint', () => reDigits.test('123456') ? 1 : 0),
  bench('charCode digit constraint', () => digitsFast('123456')),
  bench('method outside then path', () => nestedMethod[methodObj.GET]![hitPath] ?? -1),
  bench('path first then method array', () => byPathThenMethod[hitPath]![0]!),
  bench('method bool array availability', () => methodBoolArrays[2048]![3] ? 1 : 0),
  bench('method bitmask availability', () => (methodFlags[2048]! & (1 << 3)) !== 0 ? 1 : 0),
  bench('method Set<number> availability', () => methodSetArrays[2048]!.has(3) ? 1 : 0),
  bench('method Set<string> availability', () => methodStringSets[2048]!.has('PATCH') ? 1 : 0),
  bench('terminal direct handler index', () => terminalFastTag),
  bench('terminal array method lookup', () => terminalArrayLookup(3)),
  bench('terminal tagged fast path', () => terminalTagged(terminalFastTag, 3)),
  bench('terminal tagged poly path', () => terminalTagged(terminalPolyTag, 3)),
];

const rows7 = [
  bench('cache key concat lookup', () => cacheConcat.get(`GET ${hitPath}`) ?? -1),
  bench('per-method cache path lookup', () => cacheNested.get(hitPath) ?? -1),
  bench('normalize always', () => normalizeAlways(hitPath).length),
  bench('normalize fast path', () => normalizeFast(hitPath).length),
  bench('throw/catch validation', () => throwValidation(sink++), BUILD_ITER),
  bench('issue-array validation', () => issueValidation(sink++), BUILD_ITER),
  bench('monomorphic shape read', () => mono[sink & 1023]!.a),
  bench('polymorphic shape read', () => poly[sink & 1023]!.a),
  bench('substring param allocation', () => allocParams()),
  bench('offset-only param accounting', () => offsetOnly()),
];

printGroup('method dispatch', rows1);
printGroup('static lookup / prefilter / hash', rows2);
printGroup('adaptive child layout candidates', rows3);
printGroup('buffer / bitmap / allocation primitives', rows4);
printGroup('byte/hash primitives', rows5);
printGroup('code specialization / constraints / method placement', rows6);
printGroup('cache / normalize / validation / shape / params', rows7);

const beforeAlloc = memSnapshot();
const allocations: unknown[] = [];
for (let i = 0; i < 500_000; i++) allocations.push({ a: i, b: String(i), c: null });
const afterAlloc = memSnapshot();
allocations.length = 0;

const beforeBuffer = memSnapshot();
const buffer = new Int32Array(500_000 * 8);
for (let i = 0; i < buffer.length; i++) buffer[i] = i;
const afterBuffer = memSnapshot();

console.log('\n## retained memory sample');
console.log(`object nodes 500k approx delta: ${memDelta(beforeAlloc, afterAlloc)}`);
console.log(`Int32Array 500k*8 approx delta: ${memDelta(beforeBuffer, afterBuffer)}`);
console.log(`sink=${sink}`);
