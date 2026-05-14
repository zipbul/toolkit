/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';

const originalNames = ['id', 'postId'];
const present = [{ name: 'id' }, { name: 'postId' }];
const omitBehavior = true;

function method1(): string {
  return (omitBehavior ? 'O:' : 'S:') + originalNames.join(',') + '::' + present.map(p => p.name).join(',');
}

function method2(): string {
  let key = omitBehavior ? 'O:' : 'S:';
  for (let i = 0; i < originalNames.length; i++) {
    if (i > 0) key += ',';
    key += originalNames[i];
  }
  key += '::';
  for (let i = 0; i < present.length; i++) {
    if (i > 0) key += ',';
    key += present[i]!.name;
  }
  return key;
}

let s = 0;
for (let i = 0; i < 200_000; i++) s += method1().length;
let t0 = performance.now();
for (let i = 0; i < 5_000_000; i++) s += method1().length;
const m1 = ((performance.now() - t0) * 1e6) / 5_000_000;

for (let i = 0; i < 200_000; i++) s += method2().length;
t0 = performance.now();
for (let i = 0; i < 5_000_000; i++) s += method2().length;
const m2 = ((performance.now() - t0) * 1e6) / 5_000_000;

console.log(`method1 (join+map):       ${m1.toFixed(1)} ns/call`);
console.log(`method2 (manual concat):  ${m2.toFixed(1)} ns/call`);
console.log(`diff: ${(m1 - m2).toFixed(1)} ns (${((m1-m2)/m1*100).toFixed(0)}%)`);
console.log(`sink: ${s}`);
