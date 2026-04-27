/**
 * Complex / extreme shape benchmarks.
 *
 * The comparison bench only covers shallow shapes (1 param, 3-param chain,
 * single-prefix wildcard) — exactly the shapes every router optimizes for.
 * Real APIs have:
 *   - Deep param chains (5-15 levels)
 *   - Wildcards combined with leading params/static
 *   - Optionals deep in the chain
 *   - Regex testers at multiple positions
 *   - Hundreds of distinct prefixes (unlike GH bench's ~11)
 *
 * Compare against memoirist (closest competitor) and rou3 (best static
 * codegen) where they support the shape. find-my-way / koa-tree-router /
 * hono are slower across the board so we omit them here for clarity.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';
import { Router } from '../src/router';
import { Memoirist } from 'memoirist';
import { createRouter as createRou3, addRoute, findRoute } from 'rou3';

// ── Shape 1: Deep param chain (10 params) ──

const DEEP_ROUTE = '/a/:p1/b/:p2/c/:p3/d/:p4/e/:p5/f/:p6/g/:p7/h/:p8/i/:p9/j/:p10';
const DEEP_URL   = '/a/v1/b/v2/c/v3/d/v4/e/v5/f/v6/g/v7/h/v8/i/v9/j/v10';

function setupDeepZipbul() { const r = new Router<number>(); r.add('GET', DEEP_ROUTE, 1); r.build(); return r; }
function setupDeepMemo() { const r = new Memoirist<number>(); r.add('GET', DEEP_ROUTE, 1); return r; }
function setupDeepRou3() { const r = createRou3<number>(); addRoute(r, 'GET', DEEP_ROUTE, 1); return r; }

const deepZ = setupDeepZipbul();
const deepM = setupDeepMemo();
const deepR = setupDeepRou3();

// ── Shape 2: Param + wildcard combined ──

const COMBO_ROUTE = '/api/:version/users/:userId/files/*filepath';
const COMBO_URL   = '/api/v2/users/42/files/docs/2024/quarterly-report.pdf';

function setupComboZ() { const r = new Router<number>(); r.add('GET', COMBO_ROUTE, 1); r.build(); return r; }
function setupComboM() { const r = new Memoirist<number>(); r.add('GET', COMBO_ROUTE.replace(/\*\w+/, '*'), 1); return r; }
function setupComboR() { const r = createRou3<number>(); addRoute(r, 'GET', COMBO_ROUTE.replace(/\*\w+/, '**'), 1); return r; }

const comboZ = setupComboZ();
const comboM = setupComboM();
const comboR = setupComboR();

// ── Shape 3: 4-param chain with regex testers at multiple positions ──

const REGEX_ROUTE = '/api/:apiVer(\\d+)/orgs/:org/repos/:repo([\\w-]+)/issues/:issueId(\\d+)';
const REGEX_URL   = '/api/3/orgs/anthropic/repos/zipbul-toolkit/issues/12345';

function setupRegexZ() { const r = new Router<number>(); r.add('GET', REGEX_ROUTE, 1); r.build(); return r; }
function setupRegexM() {
  const r = new Memoirist<number>();
  // memoirist doesn't support regex constraints directly — use the unconstrained form
  r.add('GET', '/api/:apiVer/orgs/:org/repos/:repo/issues/:issueId', 1);
  return r;
}

const regexZ = setupRegexZ();
const regexM = setupRegexM();

// ── Shape 4: Heavy router with 500 mixed routes (real-API scale) ──

function setup500Z() {
  const r = new Router<number>();
  let id = 0;
  // 100 static
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/sys/cfg${i}`, id++);
  // 200 single-param
  for (let i = 0; i < 200; i++) r.add('GET', `/api/v1/users${i}/:userId`, id++);
  // 100 two-param chain
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/orgs${i}/:org/repos/:repo`, id++);
  // 100 three-param chain
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/projects${i}/:proj/issues/:issue/comments/:comment`, id++);
  r.build();
  return r;
}
function setup500M() {
  const r = new Memoirist<number>();
  let id = 0;
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/sys/cfg${i}`, id++);
  for (let i = 0; i < 200; i++) r.add('GET', `/api/v1/users${i}/:userId`, id++);
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/orgs${i}/:org/repos/:repo`, id++);
  for (let i = 0; i < 100; i++) r.add('GET', `/api/v1/projects${i}/:proj/issues/:issue/comments/:comment`, id++);
  return r;
}
function setup500R() {
  const r = createRou3<number>();
  let id = 0;
  for (let i = 0; i < 100; i++) addRoute(r, 'GET', `/api/v1/sys/cfg${i}`, id++);
  for (let i = 0; i < 200; i++) addRoute(r, 'GET', `/api/v1/users${i}/:userId`, id++);
  for (let i = 0; i < 100; i++) addRoute(r, 'GET', `/api/v1/orgs${i}/:org/repos/:repo`, id++);
  for (let i = 0; i < 100; i++) addRoute(r, 'GET', `/api/v1/projects${i}/:proj/issues/:issue/comments/:comment`, id++);
  return r;
}

const heavyZ = setup500Z();
const heavyM = setup500M();
const heavyR = setup500R();

// ── Shape 5: Very deep wildcard prefix collision ──
// Multiple long-prefix wildcards under same root level

function setupManyWildZ() {
  const r = new Router<number>();
  for (let i = 0; i < 50; i++) r.add('GET', `/files${i}/*path`, i);
  r.build();
  return r;
}
function setupManyWildM() {
  const r = new Memoirist<number>();
  for (let i = 0; i < 50; i++) r.add('GET', `/files${i}/*`, i);
  return r;
}

const wildZ = setupManyWildZ();
const wildM = setupManyWildM();

const WILD_URL = '/files25/some/deep/nested/path/to/file.tgz';

// ── Sanity check ──

function san(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`SANITY FAIL [${label}]: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
}

san('deep-zipbul', deepZ.match('GET', DEEP_URL)?.value, 1);
san('deep-memoirist', deepM.find('GET', DEEP_URL)?.store, 1);
san('combo-zipbul', comboZ.match('GET', COMBO_URL)?.params.filepath, 'docs/2024/quarterly-report.pdf');
san('combo-memoirist', (comboM.find('GET', COMBO_URL)?.params as any)?.['*'], 'docs/2024/quarterly-report.pdf');
san('regex-zipbul', regexZ.match('GET', REGEX_URL)?.params.issueId, '12345');
san('heavy-zipbul', heavyZ.match('GET', '/api/v1/projects42/myproj/issues/123/comments/456')?.params.comment, '456');
san('manywild-zipbul', wildZ.match('GET', WILD_URL)?.params.path, 'some/deep/nested/path/to/file.tgz');
console.log('Sanity OK\n');

// ── Benchmarks ──

summary(() => {
  bench('deep10 — @zipbul', () => { do_not_optimize(deepZ.match('GET', DEEP_URL)); });
  bench('deep10 — memoirist', () => { do_not_optimize(deepM.find('GET', DEEP_URL)); });
  bench('deep10 — rou3', () => { do_not_optimize(findRoute(deepR, 'GET', DEEP_URL)); });
});

summary(() => {
  bench('combo (3-param + wildcard) — @zipbul', () => { do_not_optimize(comboZ.match('GET', COMBO_URL)); });
  bench('combo (3-param + wildcard) — memoirist', () => { do_not_optimize(comboM.find('GET', COMBO_URL)); });
  bench('combo (3-param + wildcard) — rou3', () => { do_not_optimize(findRoute(comboR, 'GET', COMBO_URL)); });
});

summary(() => {
  bench('regex (4 params, 2 testers) — @zipbul', () => { do_not_optimize(regexZ.match('GET', REGEX_URL)); });
  bench('regex (no constraint) — memoirist', () => { do_not_optimize(regexM.find('GET', REGEX_URL)); });
});

summary(() => {
  const url = '/api/v1/projects42/myproj/issues/123/comments/456';
  bench('500-route 3-param hit — @zipbul', () => { do_not_optimize(heavyZ.match('GET', url)); });
  bench('500-route 3-param hit — memoirist', () => { do_not_optimize(heavyM.find('GET', url)); });
  bench('500-route 3-param hit — rou3', () => { do_not_optimize(findRoute(heavyR, 'GET', url)); });
});

summary(() => {
  bench('500-route static hit — @zipbul', () => { do_not_optimize(heavyZ.match('GET', '/api/v1/sys/cfg50')); });
  bench('500-route static hit — memoirist', () => { do_not_optimize(heavyM.find('GET', '/api/v1/sys/cfg50')); });
  bench('500-route static hit — rou3', () => { do_not_optimize(findRoute(heavyR, 'GET', '/api/v1/sys/cfg50')); });
});

summary(() => {
  bench('50-prefix wild — @zipbul', () => { do_not_optimize(wildZ.match('GET', WILD_URL)); });
  bench('50-prefix wild — memoirist', () => { do_not_optimize(wildM.find('GET', WILD_URL)); });
});

// ── Shape 6: 20-deep param chain (extreme depth) ──

let DEEP20_ROUTE = '';
let DEEP20_URL = '';
for (let i = 0; i < 20; i++) {
  DEEP20_ROUTE += `/s${i}/:p${i}`;
  DEEP20_URL += `/s${i}/v${i}`;
}

const deep20Z = (() => { const r = new Router<number>(); r.add('GET', DEEP20_ROUTE, 1); r.build(); return r; })();
const deep20M = (() => { const r = new Memoirist<number>(); r.add('GET', DEEP20_ROUTE, 1); return r; })();

san('deep20-zipbul', deep20Z.match('GET', DEEP20_URL)?.value, 1);
san('deep20-memoirist', deep20M.find('GET', DEEP20_URL)?.store, 1);

summary(() => {
  bench('deep20 — @zipbul', () => { do_not_optimize(deep20Z.match('GET', DEEP20_URL)); });
  bench('deep20 — memoirist', () => { do_not_optimize(deep20M.find('GET', DEEP20_URL)); });
});

// ── Shape 7: Pathological — 1000-route mix with many shapes ──

function setup1kZ() {
  const r = new Router<number>();
  let id = 0;
  for (let i = 0; i < 200; i++) r.add('GET', `/static/page${i}`, id++);
  for (let i = 0; i < 200; i++) r.add('GET', `/users${i}/:id`, id++);
  for (let i = 0; i < 200; i++) r.add('GET', `/orgs${i}/:org/repos/:repo`, id++);
  for (let i = 0; i < 100; i++) r.add('GET', `/search${i}/:q([a-z]+)`, id++);  // regex
  for (let i = 0; i < 100; i++) r.add('GET', `/files${i}/*path`, id++);          // wildcard
  for (let i = 0; i < 200; i++) r.add('GET', `/api${i}/v1/users/:id/posts/:post/comments/:c`, id++);
  r.build();
  return r;
}
function setup1kM() {
  const r = new Memoirist<number>();
  let id = 0;
  for (let i = 0; i < 200; i++) r.add('GET', `/static/page${i}`, id++);
  for (let i = 0; i < 200; i++) r.add('GET', `/users${i}/:id`, id++);
  for (let i = 0; i < 200; i++) r.add('GET', `/orgs${i}/:org/repos/:repo`, id++);
  for (let i = 0; i < 100; i++) r.add('GET', `/search${i}/:q`, id++);  // memoirist no regex
  for (let i = 0; i < 100; i++) r.add('GET', `/files${i}/*`, id++);
  for (let i = 0; i < 200; i++) r.add('GET', `/api${i}/v1/users/:id/posts/:post/comments/:c`, id++);
  return r;
}

const heavy1kZ = setup1kZ();
const heavy1kM = setup1kM();

summary(() => {
  bench('1000-route static hit — @zipbul', () => { do_not_optimize(heavy1kZ.match('GET', '/static/page100')); });
  bench('1000-route static hit — memoirist', () => { do_not_optimize(heavy1kM.find('GET', '/static/page100')); });
});

summary(() => {
  bench('1000-route 3-param chain — @zipbul', () => { do_not_optimize(heavy1kZ.match('GET', '/api50/v1/users/42/posts/123/comments/9')); });
  bench('1000-route 3-param chain — memoirist', () => { do_not_optimize(heavy1kM.find('GET', '/api50/v1/users/42/posts/123/comments/9')); });
});

summary(() => {
  bench('1000-route wildcard — @zipbul', () => { do_not_optimize(heavy1kZ.match('GET', '/files50/some/deep/file.tgz')); });
  bench('1000-route wildcard — memoirist', () => { do_not_optimize(heavy1kM.find('GET', '/files50/some/deep/file.tgz')); });
});

summary(() => {
  bench('1000-route regex param — @zipbul', () => { do_not_optimize(heavy1kZ.match('GET', '/search50/abc')); });
  bench('1000-route regex param — memoirist', () => { do_not_optimize(heavy1kM.find('GET', '/search50/abc')); });
});

await run();
