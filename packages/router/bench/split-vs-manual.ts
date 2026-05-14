/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';

function splitNative(path: string): string[] {
  const body = path.length > 1 ? path.slice(1) : '';
  return body === '' ? [] : body.split('/');
}

function splitManual(path: string): string[] {
  const segments: string[] = [];
  const len = path.length;
  if (len <= 1) return segments;
  let start = 1;
  for (let i = 1; i < len; i++) {
    if (path.charCodeAt(i) === 47) {
      segments.push(path.substring(start, i));
      start = i + 1;
    }
  }
  segments.push(path.substring(start));
  return segments;
}

const paths = [
  '/r0/users/42/posts/7',
  '/api/v1/resource-50000',
  '/tenant-50000/users/42/posts/7',
  '/files/group-100/bucket-50/path/to/file.txt',
];

function bench(label: string, fn: (p: string) => string[]): number {
  for (const p of paths) for (let i = 0; i < 100_000; i++) fn(p);
  const t0 = performance.now();
  let n = 0;
  for (let it = 0; it < 5_000_000; it++) n += fn(paths[it % paths.length]!).length;
  const ns = ((performance.now() - t0) * 1e6) / 5_000_000;
  console.log(`  ${label.padEnd(40)} ${ns.toFixed(1).padStart(6)} ns/call  (sink ${n})`);
  return ns;
}

console.log('split benchmark:');
const a = bench('native String.split(\'/\')', splitNative);
const b = bench('manual charCodeAt scan', splitManual);
console.log(`diff: ${(a - b).toFixed(1)}ns (manual ${a > b ? '-' : '+'}${Math.abs((a-b)/a*100).toFixed(0)}%)`);
