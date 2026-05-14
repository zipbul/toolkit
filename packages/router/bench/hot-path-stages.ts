/* eslint-disable no-console */
/**
 * Decompose match() hot path into measurable stages. Each row isolates
 * one cost component by choosing inputs that take or skip a stage.
 *
 * The compiled matchImpl for a single-method dynamic router (param
 * shape) emits this sequence:
 *
 *   1. method literal compare          if (method !== "GET") return null;
 *   2. var mc = 0
 *   3. var sp = path
 *   4. trailing-slash trim probe       sp.length > 1 && charCodeAt(len-1) === 47
 *   5. (trim substring alloc)          sp = sp.substring(0, sp.length - 1);
 *   6. hitCache lookup                 hitCacheByMethod[mc].get(sp)
 *   7. (cache hit return)              return { value, params, meta }
 *   8. walker call                     tr0(sp, matchState)
 *   9. matchState.handlerIndex read
 *   10. terminalSlab[slabBase] read
 *   11. paramsFactory call             factory(sp, matchState.paramOffsets)
 *   12. cache.set + Object.freeze
 *   13. return { value, params, meta }
 *
 * Probes:
 *
 *   A. wrong-method (stages 1 only — early return)
 *   B. static hit (1-4 + activeBucket probe — no walker)
 *   C. cache hit on dynamic (1-6)
 *   D. cache miss dynamic (1-13, hot path with all stages)
 *   E. cache miss + trailing slash (adds 5)
 *   F. raw walker call (only 8-11 inside)
 *   G. cache.get cost alone
 *   H. paramsFactory call alone
 */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

function bench(label: string, fn: () => unknown, iter = 5_000_000): number {
  for (let i = 0; i < 200_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(50)} ${ns.toFixed(2).padStart(7)} ns/op`);
  return ns;
}

// === Setup: 100 routes single-method, param shape
const r = new Router<number>();
for (let i = 0; i < 100; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
r.build();
const internals = (r as any)[ROUTER_INTERNALS_KEY];
const matchState = internals.matchLayer.matchState;
const tr = internals.matchLayer.trees[0];

// Static-only router for B
const rs = new Router<number>();
for (let i = 0; i < 100; i++) rs.add('GET', `/static-${i}`, i);
rs.build();

console.log('hot-path stage decomposition (100-route param router):');
console.log('all probes use match() unless noted; values include common overhead.\n');

const path = '/r50/u/42/p/7';
const wrongMethodPath = '/r50/u/42/p/7';
const staticPath = '/static-50';
const slashPath = '/r50/u/42/p/7/';

// A) wrong method
const a = bench('A. wrong-method (stages 1 only)', () => r.match('PATCH', wrongMethodPath));

// B) static hit (different router)
const b = bench('B. static-hit (stages 1-4 + activeBucket lookup)', () => rs.match('GET', staticPath));

// C) cache hit (after warmup, same path repeated)
for (let i = 0; i < 5000; i++) r.match('GET', path);  // ensure cache filled
const c = bench('C. dynamic cache-hit (stages 1-7)', () => r.match('GET', path));

// D) cache miss dynamic — cycle through 100 unique paths so cache misses
let counter = 0;
const d = bench('D. dynamic cache-miss (stages 1-13)', () => {
  counter++;
  return r.match('GET', `/r${counter % 100}/u/${counter}/p/${counter}`);
});

// E) cache hit but trailing slash — forces trim alloc
for (let i = 0; i < 5000; i++) r.match('GET', slashPath);
const e = bench('E. dynamic cache-hit + trailing slash trim', () => r.match('GET', slashPath));

// F) raw walker only
const f = bench('F. raw walker(path, state) only', () => tr(path, matchState));

// G) raw walker with unique path (no cache)
let g_counter = 0;
const g = bench('G. raw walker on unique path each call', () => {
  g_counter++;
  return tr(`/r${g_counter % 100}/u/${g_counter}/p/${g_counter}`, matchState);
});

// H) cache.get only on a 100-entry cache
const hitCache: any = internals.matchLayer.trees;
void hitCache;
// Probe RouterCache via its public API
const { RouterCache } = await import('../src/cache');
const rc = new RouterCache<{ x: number }>(100);
for (let i = 0; i < 100; i++) rc.set(`/r${i}/u/${i}/p/${i}`, { x: i });
let h_counter = 0;
const h = bench('H. RouterCache.get hit (100-entry)', () => rc.get(`/r${(h_counter++) % 100}/u/${h_counter % 100}/p/${h_counter % 100}`));

// I) substring alloc cost (single-char trim)
let i_counter = 0;
const i = bench('I. substring trim alloc only', () => {
  i_counter++;
  const s = '/r' + (i_counter % 100) + '/u/x/p/y/';
  return s.length > 1 && s.charCodeAt(s.length - 1) === 47 ? s.substring(0, s.length - 1) : s;
});

console.log();
console.log('decomposition:');
console.log(`  method dispatch + early return:           ${a.toFixed(2)} ns`);
console.log(`  static bucket lookup overhead:            ${(b - a).toFixed(2)} ns (B-A)`);
console.log(`  cache hit lookup + entry construct:       ${(c - a).toFixed(2)} ns (C-A)`);
console.log(`  trim substring alloc:                     ${(e - c).toFixed(2)} ns (E-C)`);
console.log(`  raw walker work:                          ${f.toFixed(2)} ns`);
console.log(`  raw walker (unique path):                 ${g.toFixed(2)} ns`);
console.log(`  full cache-miss path:                     ${d.toFixed(2)} ns`);
console.log(`  cache.set + freeze + entry alloc:         ${(d - g - a).toFixed(2)} ns approx (D - G - A)`);
console.log(`  RouterCache.get hit alone:                ${h.toFixed(2)} ns`);
console.log(`  substring trim alloc microbench:          ${i.toFixed(2)} ns`);
