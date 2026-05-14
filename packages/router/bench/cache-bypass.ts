/* eslint-disable no-console */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

const N = 100_000;
const ITER = 500_000;

const r = new Router<number>();
for (let i = 0; i < N; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
r.build();

const internals = (r as any)[ROUTER_INTERNALS_KEY];
const matchState = internals.matchLayer.matchState;
const tr = internals.matchLayer.trees[0];  // GET

function probe(label: string, fn: () => unknown): void {
  for (let i = 0; i < 50_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < ITER; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / ITER;
  console.log(`  ${label.padEnd(50)} ${ns.toFixed(1).padStart(6)}ns`);
}

console.log('dynamic path matching — cache vs raw walker:');

// Repeated same hit path
{
  const path = `/r${Math.floor(N / 2)}/u/42/p/7`;
  probe('match() — first hit cache miss, subsequent hits', () => r.match('GET', path));
  probe('raw walker(path, state) — no cache', () => tr(path, matchState));
}

// Unique paths each call (no benefit from cache)
{
  let i = 0;
  probe('match() — unique path each call (all miss)', () => { i++; return r.match('GET', `/r${i % N}/u/${i}/p/${i}`); });
  let j = 0;
  probe('raw walker — unique path each call', () => { j++; return tr(`/r${j % N}/u/${j}/p/${j}`, matchState); });
}

// Zipf-like
{
  let k = 0;
  probe('match() — Zipf 90/10 dynamic path', () => {
    k++;
    if (Math.random() < 0.9) return r.match('GET', `/r${k % 10}/u/42/p/7`);
    return r.match('GET', `/r${k % N}/u/${k}/p/${k}`);
  });
  let l = 0;
  probe('raw walker — Zipf 90/10', () => {
    l++;
    if (Math.random() < 0.9) return tr(`/r${l % 10}/u/42/p/7`, matchState);
    return tr(`/r${l % N}/u/${l}/p/${l}`, matchState);
  });
}
