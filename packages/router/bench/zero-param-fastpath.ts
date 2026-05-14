/* eslint-disable no-console */
/**
 * #32 small/0-param fast path 측정.
 * 1. 현재 emitter는 매 dynamic-miss path에서 paramsFactories[tIdx] array load + null check.
 *    0-param-only router에서 cfg.hasAnyParam=false 시 array load 회피 가능.
 * 2. line 285 `if (hc === undefined)` 분기 — router.ts pre-allocate 후 dead.
 *
 * 측정: 0-param-only routes (params 없음) match cost 변화.
 * 단 dynamic miss는 0-param이면 거의 없음 (static-only). 측정 어려움.
 *
 * 진짜 측정 영역: 1-shape /:id (0 staticChildren, 1 paramChild) 워크로드.
 *   - paramsFactories[tIdx] 항상 1-param factory 반환
 *   - 워크로드 파라미터 1개 — 0-param 아님
 *
 * 0-param-only 진짜 워크로드: 모든 routes가 static (no `:`, no `*`).
 *   - 매치 시 static table hit (line 205-216), dynamic walker 안 탐.
 *   - 0-param fast path 영향 없음 (이미 static fast path)
 *
 * 결론: 0-param fast path는 dynamic walker가 아닌 static 영역. 이미 빠름.
 *
 * 측정할 가치 있는 시나리오: 1-param /:id 케이스에서 dead branch 제거.
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

function bench(name: string, build: (r: Router<number>) => void, probes: string[]): void {
  const r = new Router<number>();
  build(r);
  r.build();

  for (let w = 0; w < 200_000; w++) r.match('GET', probes[w % probes.length]!);

  const t0 = performance.now();
  for (let m = 0; m < 5_000_000; m++) r.match('GET', probes[m % probes.length]!);
  const ns = ((performance.now() - t0) * 1e6) / 5_000_000;
  console.log(`  ${name.padEnd(35)} match=${ns.toFixed(2)}ns`);
}

console.log('== current ==');
// Static-only (uses static fast path, factory not invoked)
{
  const probes = Array.from({ length: 100 }, (_, i) => `/api/r${i}`);
  bench('100 static (warmed hit)', (r) => {
    for (let i = 0; i < 100; i++) r.add('GET', `/api/r${i}`, i);
  }, probes);
}
// 1-param dynamic (always factory invoked)
{
  const probes = Array.from({ length: 100 }, (_, i) => `/users/u${i}`);
  bench('1-param /:id × 1 (warmed)', (r) => {
    r.add('GET', '/users/:id', 1);
  }, probes);
}
// 1-param + static mix
{
  const probes: string[] = [];
  for (let i = 0; i < 50; i++) probes.push(`/api/r${i}`);
  for (let i = 0; i < 50; i++) probes.push(`/users/u${i}`);
  bench('mix static+1param', (r) => {
    for (let i = 0; i < 100; i++) r.add('GET', `/api/r${i}`, i);
    r.add('GET', '/users/:id', 999);
  }, probes);
}
