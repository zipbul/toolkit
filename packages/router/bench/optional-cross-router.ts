/* eslint-disable no-console */
/**
 * N=20 optional path 등록 시 다른 라우터들도 메모리 폭발하는지 측정.
 * 워크로드: 단일 라우트 1개, 20개 연속 optional param.
 */
import FindMyWay from 'find-my-way';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import { addRoute, createRouter as createRou3 } from 'rou3';
import { createRouter as createRadix3 } from 'radix3';
import { Router } from '../src/router';

function rssMB(): number { return process.memoryUsage().rss / 1024 / 1024; }
function heapMB(): number { return process.memoryUsage().heapUsed / 1024 / 1024; }

const N = 20;
const zipbulPath = '/' + Array.from({length: N}, (_, i) => `s${i}/:p${i}?`).join('/');
// find-my-way / rou3 / radix3 / hono trie / hono regexp 호환 형태:
const standardPath = zipbulPath; // :p? 표준
console.log(`Path (N=${N} optional, len=${zipbulPath.length}): ${zipbulPath.slice(0, 80)}...`);
console.log(`Expected expansions: 2^${N} = ${1 << N}`);
console.log();

async function probe(label: string, fn: () => void): Promise<void> {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  const r0 = rssMB();
  const h0 = heapMB();
  const t0 = performance.now();
  try {
    fn();
    const dt = performance.now() - t0;
    if (typeof Bun !== 'undefined') Bun.gc(true);
    const r1 = rssMB();
    const h1 = heapMB();
    console.log(`${label.padEnd(20)} build=${dt.toFixed(0)}ms  rss=+${(r1-r0).toFixed(0)}MB  heap=+${(h1-h0).toFixed(0)}MB`);
  } catch (e: any) {
    console.log(`${label.padEnd(20)} ERROR: ${e.message?.slice(0, 100)}`);
  }
}

await probe('zipbul', () => {
  const r = new Router<string>();
  r.add('GET', zipbulPath, 'h');
  r.build();
  void r.match('GET', '/s0/x');
});

await probe('find-my-way', () => {
  const r = FindMyWay();
  r.on('GET', standardPath, () => 'h');
  void r.find('GET', '/s0/x');
});

await probe('rou3', () => {
  const r = createRou3<string>();
  addRoute(r, 'GET', standardPath, 'h');
});

await probe('radix3', () => {
  const r = createRadix3<any>() as any;
  r.insert('/GET' + standardPath, 'h');
});

await probe('hono-trie', () => {
  const r = new TrieRouter<string>();
  r.add('GET', standardPath, 'h');
});

await probe('hono-regexp', () => {
  const r = new RegExpRouter<string>();
  r.add('GET', standardPath, 'h');
});
