/**
 * B) Re-evaluate charCode-switch vs Record[method] across realistic
 * MISS ratios. Earlier bench showed charCode switch *5.27× faster on
 * 7-method MISS path*; we then dismissed it citing "hit-dominant
 * workloads" — a hand-waved assumption. Measure across MISS ratios
 * 0% / 10% / 50% / 90% / 100%, and across active-method counts.
 *
 * If a non-trivial MISS ratio (say 10-20%) flips the verdict, we should
 * emit charCode-switch dispatch for the small-method-count case.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const M7  = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'] as const;
const M14 = [
  ...M7,
  'TRACE','CONNECT','PROPFIND','PROPPATCH','MKCOL','COPY','MOVE',
] as const;
const M28 = [
  ...M14,
  'LOCK','UNLOCK','REPORT','SEARCH','BIND','REBIND','UNBIND','ACL',
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

function makeMixedSamples(methods: ReadonlyArray<string>, missRatio: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.random() < missRatio) out.push(MISS_TOKENS[i % MISS_TOKENS.length]!);
    else out.push(methods[i % methods.length]!);
  }
  return out;
}

async function main() {
  const N = 1024;
  const ratios = [0.0, 0.1, 0.5, 0.9, 1.0];

  for (const [label, methods] of [
    ['7 methods', M7], ['14 methods', M14], ['28 methods', M28],
  ] as const) {
    const recordFn = makeRecordFn(makeRecord(methods));
    const switchFn = makeCharCodeSwitchFn(methods);

    for (const r of ratios) {
      const samples = makeMixedSamples(methods, r, N);
      console.log(`\n=== ${label}, MISS ratio ${(r * 100).toFixed(0)}% ===`);
      summary(() => {
        bench('Record[method]', () => {
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
