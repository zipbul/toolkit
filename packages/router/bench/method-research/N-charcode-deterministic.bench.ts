/**
 * N) Re-run B (charCode switch vs Record) with DETERMINISTIC samples
 * — fixed shuffled order, no Math.random per call. The previous B
 * bench produced flipped results across two runs; this isolates the
 * dispatch shape from sample-stream noise.
 *
 * Each scenario uses one fixed pre-built sample array per (methods,
 * miss-ratio) combo. mitata averages many iterations against the SAME
 * input, so results should be stable.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const M7 = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'] as const;
const M14 = [
  ...M7,'TRACE','CONNECT','PROPFIND','PROPPATCH','MKCOL','COPY','MOVE',
] as const;
const M28 = [
  ...M14,'LOCK','UNLOCK','REPORT','SEARCH','BIND','REBIND','UNBIND','ACL',
  'MKCALENDAR','MKWORKSPACE','UPDATE','CHECKOUT','CHECKIN','UNCHECKOUT',
] as const;

const MISS_TOKENS = ['BOGUS','XYZZY','QUUX','PLOVER','BLARG'];

function makeRecord(methods: ReadonlyArray<string>): Record<string, number> {
  const r = Object.create(null) as Record<string, number>;
  for (let i = 0; i < methods.length; i++) r[methods[i]!] = i;
  return r;
}

function makeRecordFn(record: Record<string, number>): (m: string) => number {
  return new Function('codeMap', `
    return function dispatch(method) {
      var mc = codeMap[method];
      if (mc === undefined) return -1;
      return mc;
    };
  `)(record) as (m: string) => number;
}

function makeCharCodeSwitchFn(methods: ReadonlyArray<string>): (m: string) => number {
  type Bucket = Array<[string, number]>;
  const ccGroups = new Map<number, Map<number, Bucket>>();
  for (let i = 0; i < methods.length; i++) {
    const m = methods[i]!;
    const cc = m.charCodeAt(0);
    const len = m.length;
    let lenMap = ccGroups.get(cc);
    if (lenMap === undefined) { lenMap = new Map(); ccGroups.set(cc, lenMap); }
    let bucket = lenMap.get(len);
    if (bucket === undefined) { bucket = []; lenMap.set(len, bucket); }
    bucket.push([m, i]);
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

// Deterministic sample — fixed seed via xorshift
function rng(seed: number) {
  let s = seed;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function makeFixedSamples(methods: ReadonlyArray<string>, missRatio: number, n: number, seed = 0xC0FFEE): string[] {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (r() < missRatio) out.push(MISS_TOKENS[i % MISS_TOKENS.length]!);
    else out.push(methods[i % methods.length]!);
  }
  return out;
}

async function main() {
  const N = 1024;
  for (const [label, methods] of [['7m', M7], ['14m', M14], ['28m', M28]] as const) {
    const recordFn = makeRecordFn(makeRecord(methods));
    const switchFn = makeCharCodeSwitchFn(methods);
    for (const r of [0, 0.1, 0.5, 0.9, 1.0]) {
      const samples = makeFixedSamples(methods, r, N);
      console.log(`\n=== ${label}, MISS=${(r*100).toFixed(0)}% (deterministic) ===`);
      summary(() => {
        bench('Record[]', () => {
          let acc = 0;
          for (let i = 0; i < N; i++) acc += recordFn(samples[i]!);
          do_not_optimize(acc);
        });
        bench('charCode switch', () => {
          let acc = 0;
          for (let i = 0; i < N; i++) acc += switchFn(samples[i]!);
          do_not_optimize(acc);
        });
      });
    }
  }
  await run();
}

main();
