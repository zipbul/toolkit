/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';

const paths = [
  '/r0/users/42/posts/7',
  '/api/v1/resource-50000',
  '/tenant-50000/users/42/posts/7',
];

function method1(path: string): string {
  // current: split → optionally trim → join
  const segments: string[] = [];
  const len = path.length;
  if (len > 1) {
    let start = 1;
    for (let i = 1; i < len; i++) {
      if (path.charCodeAt(i) === 47) { segments.push(path.substring(start, i)); start = i + 1; }
    }
    segments.push(path.substring(start));
  }
  return segments.length > 0 ? '/' + segments.join('/') : '/';
}

function method2(path: string): string {
  // skip join when path is already canonical (no trailing slash, no case fold)
  const len = path.length;
  if (len <= 1) return path;
  if (path.charCodeAt(len - 1) === 47) {
    return path.substring(0, len - 1);
  }
  return path;
}

let s = 0;
for (let i = 0; i < 200_000; i++) for (const p of paths) s += method1(p).length;
let t0 = performance.now();
for (let i = 0; i < 1_000_000; i++) for (const p of paths) s += method1(p).length;
const m1 = ((performance.now() - t0) * 1e6) / (1_000_000 * paths.length);

for (let i = 0; i < 200_000; i++) for (const p of paths) s += method2(p).length;
t0 = performance.now();
for (let i = 0; i < 1_000_000; i++) for (const p of paths) s += method2(p).length;
const m2 = ((performance.now() - t0) * 1e6) / (1_000_000 * paths.length);

console.log(`method1 (split+join):   ${m1.toFixed(1)} ns/call`);
console.log(`method2 (direct trim):  ${m2.toFixed(1)} ns/call`);
console.log(`saved: ${(m1 - m2).toFixed(1)} ns/call (${((m1-m2)/m1*100).toFixed(0)}%)`);
console.log(`sink: ${s}`);
