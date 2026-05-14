/* eslint-disable no-console */
/**
 * 정확한 측정:
 * 1. N=1..4 단일 route별 메모리 (per-N cost)
 * 2. RSS settle 여부 (build → +500ms → +3000ms)
 * 3. M routes × N options (multiple routes에서 cumulative cost)
 */
import { Router } from '../src/router';

function rssMB(): number { return process.memoryUsage().rss / 1024 / 1024; }
function heapMB(): number { return process.memoryUsage().heapUsed / 1024 / 1024; }

async function settle(ms: number): Promise<void> {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  await new Promise(r => setTimeout(r, ms));
  if (typeof Bun !== 'undefined') Bun.gc(true);
}

console.log('=== 1. 단일 route N=1..4 per-N cost (settled) ===');
console.log('N | variants | RSS post-build | RSS +500ms | RSS +3000ms | heap settled');
for (const N of [1, 2, 3, 4]) {
  await settle(500);
  const r0_rss = rssMB();
  const r0_heap = heapMB();
  const path = '/' + Array.from({length: N}, (_, i) => `s${i}/:p${i}?`).join('/');
  const r = new Router<number>();
  r.add('GET', path, 1);
  r.build();
  const post_rss = rssMB();
  await settle(500);
  const set500_rss = rssMB();
  await settle(2500);
  const set3000_rss = rssMB();
  const set3000_heap = heapMB();
  console.log(`${N} | ${1<<N} | +${(post_rss-r0_rss).toFixed(2)}MB | +${(set500_rss-r0_rss).toFixed(2)}MB | +${(set3000_rss-r0_rss).toFixed(2)}MB | +${(set3000_heap-r0_heap).toFixed(2)}MB`);
}

console.log('\n=== 2. M routes × N=4 cumulative cost ===');
console.log('M | total variants | RSS settled | per-route');
for (const M of [10, 100, 1000, 10000]) {
  await settle(500);
  const r0_rss = rssMB();
  const r = new Router<number>();
  for (let i = 0; i < M; i++) {
    r.add('GET', `/r${i}/:a?/x${i}/:b?/y${i}/:c?/z${i}/:d?`, i);
  }
  r.build();
  await settle(2000);
  const set_rss = rssMB();
  const totalVar = M * 16;
  console.log(`${M} | ${totalVar} | +${(set_rss-r0_rss).toFixed(1)}MB | ${((set_rss-r0_rss)*1024/M).toFixed(2)}KB/route`);
}

console.log('\n=== 3. M routes × varying N ===');
console.log('M | N | variants/route | total | RSS settled | KB/route');
for (const N of [1, 2, 3, 4]) {
  for (const M of [100, 1000, 10000]) {
    await settle(500);
    const r0_rss = rssMB();
    const r = new Router<number>();
    for (let i = 0; i < M; i++) {
      const segs = Array.from({length: N}, (_, j) => `s${j}_${i}/:p${j}_${i}?`).join('/');
      r.add('GET', `/r${i}/${segs}`, i);
    }
    r.build();
    await settle(1500);
    const set_rss = rssMB();
    console.log(`${M} | ${N} | ${1<<N} | ${M*(1<<N)} | +${(set_rss-r0_rss).toFixed(1)}MB | ${((set_rss-r0_rss)*1024/M).toFixed(2)}KB/route`);
  }
}
