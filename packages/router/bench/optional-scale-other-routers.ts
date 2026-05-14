/* eslint-disable no-console */
/**
 * 다른 explosion-based router들도 cumulative variant scale에서 메모리 폭발하나?
 * 워크로드: M=1000 routes × N=4 mid-optional (variants per route = 16)
 */
import FindMyWay from 'find-my-way';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import { addRoute, createRouter as createRou3 } from 'rou3';
import { Router } from '../src/router';

function rssMB(): number { return process.memoryUsage().rss / 1024 / 1024; }

async function settle(ms: number): Promise<void> {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  await new Promise(r => setTimeout(r, ms));
  if (typeof Bun !== 'undefined') Bun.gc(true);
}

const M = 1000;
const N = 4;
console.log(`Workload: ${M} routes × ${N} optional (16 variants/route = ${M*16} total)\n`);

async function probe(label: string, fn: () => void): Promise<void> {
  await settle(500);
  const r0 = rssMB();
  const t0 = performance.now();
  try {
    fn();
    const dt = performance.now() - t0;
    await settle(2000);
    const r1 = rssMB();
    console.log(`${label.padEnd(20)} build=${dt.toFixed(0)}ms  RSS settled=+${(r1-r0).toFixed(1)}MB`);
  } catch (e: any) {
    const m = e.message?.slice(0, 80) ?? 'err';
    console.log(`${label.padEnd(20)} ERROR: ${m}`);
  }
}

await probe('zipbul (explosion)', () => {
  const r = new Router<number>();
  for (let i = 0; i < M; i++) {
    r.add('GET', `/r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?`, i);
  }
  r.build();
});

await probe('find-my-way (last-only)', () => {
  const r = FindMyWay();
  // find-my-way: only last-position optional. simulate by registering 16 variants manually.
  for (let i = 0; i < M; i++) {
    // 16 variants of /r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?
    for (let mask = 0; mask < 16; mask++) {
      const a = (mask & 1) ? '/:a' : '';
      const b = (mask & 2) ? '/:b' : '';
      const c = (mask & 4) ? '/:c' : '';
      const d = (mask & 8) ? '/:d' : '';
      r.on('GET', `/r${i}${a}/x${i}${b}/y${i}${c}/z${i}${d}`, () => i);
    }
  }
});

await probe('rou3 (explosion)', () => {
  const r = createRou3<number>();
  // rou3는 modifier expansion 자동 — 단일 add. 단 mid-optional 의미 X.
  for (let i = 0; i < M; i++) {
    addRoute(r, 'GET', `/r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?`, i);
  }
});

await probe('hono-trie (silent)', () => {
  const r = new TrieRouter<number>();
  for (let i = 0; i < M; i++) {
    r.add('GET', `/r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?`, i);
  }
});

await probe('hono-regexp (silent)', () => {
  const r = new RegExpRouter<number>();
  for (let i = 0; i < M; i++) {
    r.add('GET', `/r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?`, i);
  }
});

// Compare: same M but with M=10000
console.log(`\n--- M=10000 × N=4 ---`);
const M2 = 10000;
await probe('zipbul (10k×16)', () => {
  const r = new Router<number>();
  for (let i = 0; i < M2; i++) {
    r.add('GET', `/r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?`, i);
  }
  r.build();
});
await probe('find-my-way (10k×16 explicit)', () => {
  const r = FindMyWay();
  for (let i = 0; i < M2; i++) {
    for (let mask = 0; mask < 16; mask++) {
      const a = (mask & 1) ? '/:a' : '';
      const b = (mask & 2) ? '/:b' : '';
      const c = (mask & 4) ? '/:c' : '';
      const d = (mask & 8) ? '/:d' : '';
      r.on('GET', `/r${i}${a}/x${i}${b}/y${i}${c}/z${i}${d}`, () => i);
    }
  }
});
