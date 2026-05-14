/* eslint-disable no-console */
/**
 * Strip one expression at a time from the compiled matchImpl and measure
 * the diff. The bench builds a 100-route param router (codegen-fit so
 * the walker is a single native function), then compiles match variants
 * by patching the emitter source after `new Function(...)` would have
 * produced the canonical body.
 */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';
import { RouterCache } from '../src/cache';

const r = new Router<number>();
for (let i = 0; i < 100; i++) r.add('GET', `/r${i}/u/:id/p/:pid`, i);
r.build();
const internals = (r as any)[ROUTER_INTERNALS_KEY];
const original = internals.matchImpl.toString();

function compile(body: string): any {
  return new Function(
    'activeBucket', 'tr0', 'staticOutputsByMethod', 'methodCodes', 'trees', 'matchState', 'handlers',
    'hitCacheByMethod', 'RouterCache',
    'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'terminalSlab', 'paramsFactories',
    `return function match(method, path) {\n${body}\n};`,
  );
}

// Reconstruct the same args list the emitter would have passed
const internalsObj = (r as any)[ROUTER_INTERNALS_KEY];
const matchLayer = internalsObj.matchLayer;
const trs = matchLayer.trees;
const tr0 = trs[0];
const matchState = matchLayer.matchState;
const snap = internalsObj.registration.snapshot;
const args = [
  Object.create(null),                              // activeBucket (no static)
  tr0,                                              // tr0 — first method's walker
  snap.staticByMethod,                              // staticOutputsByMethod
  internalsObj.methodCodes ?? { GET: 0 },           // methodCodes
  trs,                                              // trees
  matchState,                                       // matchState
  snap.handlers,                                    // handlers
  internalsObj._hitCache ?? [],                     // hitCacheByMethod
  RouterCache,                                      // RouterCache
  Object.freeze({}),                                // EMPTY_PARAMS
  Object.freeze({ source: 'cache' }),               // CACHE_META
  Object.freeze({ source: 'dynamic' }),             // DYNAMIC_META
  snap.terminalSlab,                                // terminalSlab
  snap.paramsFactories,                             // paramsFactories
];

function buildVariant(body: string): (m: string, p: string) => any {
  return compile(body)(...args);
}

function bench(label: string, fn: (m: string, p: string) => any, iter = 5_000_000): number {
  const path = '/r50/u/42/p/7';
  for (let i = 0; i < 200_000; i++) fn('GET', path);
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn('GET', path);
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(50)} ${ns.toFixed(2).padStart(6)} ns/op`);
  return ns;
}

// Variant 0: full body (cache miss path — never hits cache since we don't preload)
const fullBody = `
if (method !== "GET") return null;
var mc = 0;
var sp = path;
var hc = hitCacheByMethod[mc];
if (hc !== undefined) {
  var cached = hc.get(sp);
  if (cached !== undefined) return { value: cached.value, params: cached.params, meta: CACHE_META };
}
var ok = tr0 !== null ? tr0(sp, matchState) : false;
var tIdx = matchState.handlerIndex;
var slabBase = tIdx << 1;
if (!ok) return null;
var hIdx = terminalSlab[slabBase];
var factory = paramsFactories[tIdx];
var params = (factory !== undefined && factory !== null) ? factory(sp, matchState.paramOffsets) : EMPTY_PARAMS;
var val = handlers[hIdx];
if (hc === undefined) { hc = new RouterCache(1000); hitCacheByMethod[mc] = hc; }
if (params !== EMPTY_PARAMS) Object.freeze(params);
hc.set(sp, { value: val, params: params });
return { value: val, params: params, meta: DYNAMIC_META };
`;

const v0 = buildVariant(fullBody);

// Variant 1: cache hit (preload)
const v0Hot = buildVariant(fullBody);
for (let i = 0; i < 50_000; i++) v0Hot('GET', '/r50/u/42/p/7');

// Variant 2: no cache lookup (skip hc.get)
const noCacheLookup = fullBody.replace(/var hc[\s\S]*?if \(cached !== undefined\) return.*?\n\}/, 'var hc;');
const v2 = buildVariant(noCacheLookup);

// Variant 3: no walker call (always false)
const noWalker = fullBody.replace('var ok = tr0 !== null ? tr0(sp, matchState) : false;', 'var ok = false;');
const v3 = buildVariant(noWalker);

// Variant 4: no factory call (always EMPTY_PARAMS)
const noFactory = fullBody.replace(/var params = .*?EMPTY_PARAMS;/, 'var params = EMPTY_PARAMS;');
const v4 = buildVariant(noFactory);

// Variant 5: no freeze + no cache write
const noFreezeNoCacheWrite = fullBody
  .replace(/if \(params !== EMPTY_PARAMS\) Object\.freeze\(params\);\n/, '')
  .replace(/if \(hc === undefined\)[\s\S]*?hc\.set\(sp,.*?\);\n/, '');
const v5 = buildVariant(noFreezeNoCacheWrite);

// Variant 6: no return object alloc (return val instead)
const noReturnAlloc = fullBody.replace(/return \{ value: val, params: params, meta: DYNAMIC_META \};/, 'return val;');
const v6 = buildVariant(noReturnAlloc);

console.log('match expression-strip diff (100-route param, /r50/u/42/p/7):\n');
const base = bench('baseline (full body, cache miss path)', v0);
bench('cache hit (preloaded)', v0Hot);
const a = bench('no cache lookup', v2);
const b = bench('no walker call', v3);
const c = bench('no paramsFactory call', v4);
const d = bench('no freeze + no cache write', v5);
const e = bench('no return-object alloc', v6);

console.log('\ndiff vs baseline:');
console.log(`  cache lookup cost:        ${(base - a).toFixed(2)} ns`);
console.log(`  walker call cost:         ${(base - b).toFixed(2)} ns`);
console.log(`  factory call cost:        ${(base - c).toFixed(2)} ns`);
console.log(`  freeze + cache write:     ${(base - d).toFixed(2)} ns`);
console.log(`  return object alloc:      ${(base - e).toFixed(2)} ns`);
console.log(`  total stripped (full bypass): ${base.toFixed(2)} ns`);
