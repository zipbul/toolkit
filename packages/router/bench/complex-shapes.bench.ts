import { Memoirist } from 'memoirist';
import { run, bench, do_not_optimize } from 'mitata';
/**
 * Complex / extreme shape benchmarks vs memoirist + rou3.
 *
 * Each (router × shape) pair runs in a fresh child process — JIT code
 * cache, IC state, and RSS baseline are isolated per pair. Pairs the
 * adapter doesn't support (rou3 has no regex/manywild/deep20; memoirist
 * has no regex) are skipped explicitly with a printed reason.
 *
 * End users invoke with no argv; the orchestrator spawns one worker per
 * supported pair.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRouter as createRou3, addRoute, findRoute } from 'rou3';

import { Router } from '../src/router';
import { printEnv } from './helpers';

const ROUTER_NAMES = ['zipbul', 'memoirist', 'rou3'] as const;
type RouterKind = (typeof ROUTER_NAMES)[number];

const SHAPES = [
  'deep10',
  'combo',
  'regex',
  'heavy-param',
  'heavy-static',
  'manywild',
  'deep20',
  'heavy1k-static',
  'heavy1k-param',
  'heavy1k-wildcard',
  'heavy1k-regex',
] as const;
type Shape = (typeof SHAPES)[number];

// ── Shape constants (route + match URL) ──

const DEEP_ROUTE = '/a/:p1/b/:p2/c/:p3/d/:p4/e/:p5/f/:p6/g/:p7/h/:p8/i/:p9/j/:p10';
const DEEP_URL = '/a/v1/b/v2/c/v3/d/v4/e/v5/f/v6/g/v7/h/v8/i/v9/j/v10';
const COMBO_ROUTE = '/api/:version/users/:userId/files/*filepath';
const COMBO_URL = '/api/v2/users/42/files/docs/2024/quarterly-report.pdf';
const REGEX_ROUTE_Z = '/api/:apiVer(\\d+)/orgs/:org/repos/:repo([\\w-]+)/issues/:issueId(\\d+)';
const REGEX_URL = '/api/3/orgs/anthropic/repos/zipbul-toolkit/issues/12345';
const WILD_URL = '/files25/some/deep/nested/path/to/file.tgz';
const HEAVY_PARAM_URL = '/api/v1/projects42/myproj/issues/123/comments/456';
const HEAVY_STATIC_URL = '/api/v1/sys/cfg50';
const HEAVY1K_STATIC_URL = '/static/page100';
const HEAVY1K_PARAM_URL = '/api50/v1/users/42/posts/123/comments/9';
const HEAVY1K_WILD_URL = '/files50/some/deep/file.tgz';
const HEAVY1K_REGEX_URL = '/search50/abc';

const DEEP20_ROUTE = (() => {
  let p = '';
  for (let i = 0; i < 20; i++) {p += `/s${i}/:p${i}`;}
  return p;
})();
const DEEP20_URL = (() => {
  let u = '';
  for (let i = 0; i < 20; i++) {u += `/s${i}/v${i}`;}
  return u;
})();

interface Built {
  match: (url: string) => unknown;
  benchUrl: string;
}

// ── Zipbul per-shape builders ──

function buildZipbul(shape: Shape): Built | null {
  switch (shape) {
    case 'deep10': {
      const r = new Router<number>();
      r.add('GET', DEEP_ROUTE, 1);
      r.build();
      return { match: u => r.match('GET', u), benchUrl: DEEP_URL };
    }
    case 'combo': {
      const r = new Router<number>();
      r.add('GET', COMBO_ROUTE, 1);
      r.build();
      return { match: u => r.match('GET', u), benchUrl: COMBO_URL };
    }
    case 'regex': {
      const r = new Router<number>();
      r.add('GET', REGEX_ROUTE_Z, 1);
      r.build();
      return { match: u => r.match('GET', u), benchUrl: REGEX_URL };
    }
    case 'heavy-param':
    case 'heavy-static': {
      const r = new Router<number>();
      let id = 0;
      for (let i = 0; i < 100; i++) {r.add('GET', `/api/v1/sys/cfg${i}`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/api/v1/users${i}/:userId`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/api/v1/orgs${i}/:org/repos/:repo`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/api/v1/projects${i}/:proj/issues/:issue/comments/:comment`, id++);}
      r.build();
      return {
        match: u => r.match('GET', u),
        benchUrl: shape === 'heavy-param' ? HEAVY_PARAM_URL : HEAVY_STATIC_URL,
      };
    }
    case 'manywild': {
      const r = new Router<number>();
      for (let i = 0; i < 50; i++) {r.add('GET', `/files${i}/*path`, i);}
      r.build();
      return { match: u => r.match('GET', u), benchUrl: WILD_URL };
    }
    case 'deep20': {
      const r = new Router<number>();
      r.add('GET', DEEP20_ROUTE, 1);
      r.build();
      return { match: u => r.match('GET', u), benchUrl: DEEP20_URL };
    }
    case 'heavy1k-static':
    case 'heavy1k-param':
    case 'heavy1k-wildcard':
    case 'heavy1k-regex': {
      const r = new Router<number>();
      let id = 0;
      for (let i = 0; i < 200; i++) {r.add('GET', `/static/page${i}`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/users${i}/:id`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/orgs${i}/:org/repos/:repo`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/search${i}/:q([a-z]+)`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/files${i}/*path`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/api${i}/v1/users/:id/posts/:post/comments/:c`, id++);}
      r.build();
      const benchUrl =
        shape === 'heavy1k-static'
          ? HEAVY1K_STATIC_URL
          : shape === 'heavy1k-param'
            ? HEAVY1K_PARAM_URL
            : shape === 'heavy1k-wildcard'
              ? HEAVY1K_WILD_URL
              : HEAVY1K_REGEX_URL;
      return { match: u => r.match('GET', u), benchUrl };
    }
  }
}

// ── Memoirist per-shape builders ──

function buildMemoirist(shape: Shape): Built | null {
  switch (shape) {
    case 'deep10': {
      const r = new Memoirist<number>();
      r.add('GET', DEEP_ROUTE, 1);
      return { match: u => r.find('GET', u), benchUrl: DEEP_URL };
    }
    case 'combo': {
      const r = new Memoirist<number>();
      r.add('GET', COMBO_ROUTE.replace(/\*\w+/, '*'), 1);
      return { match: u => r.find('GET', u), benchUrl: COMBO_URL };
    }
    case 'regex':
      // memoirist has no regex constraint support — skip explicitly.
      return null;
    case 'heavy-param':
    case 'heavy-static': {
      const r = new Memoirist<number>();
      let id = 0;
      for (let i = 0; i < 100; i++) {r.add('GET', `/api/v1/sys/cfg${i}`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/api/v1/users${i}/:userId`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/api/v1/orgs${i}/:org/repos/:repo`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/api/v1/projects${i}/:proj/issues/:issue/comments/:comment`, id++);}
      return {
        match: u => r.find('GET', u),
        benchUrl: shape === 'heavy-param' ? HEAVY_PARAM_URL : HEAVY_STATIC_URL,
      };
    }
    case 'manywild': {
      const r = new Memoirist<number>();
      for (let i = 0; i < 50; i++) {r.add('GET', `/files${i}/*`, i);}
      return { match: u => r.find('GET', u), benchUrl: WILD_URL };
    }
    case 'deep20': {
      const r = new Memoirist<number>();
      r.add('GET', DEEP20_ROUTE, 1);
      return { match: u => r.find('GET', u), benchUrl: DEEP20_URL };
    }
    case 'heavy1k-static':
    case 'heavy1k-param':
    case 'heavy1k-wildcard':
    case 'heavy1k-regex': {
      const r = new Memoirist<number>();
      let id = 0;
      for (let i = 0; i < 200; i++) {r.add('GET', `/static/page${i}`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/users${i}/:id`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/orgs${i}/:org/repos/:repo`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/search${i}/:q`, id++);}
      for (let i = 0; i < 100; i++) {r.add('GET', `/files${i}/*`, id++);}
      for (let i = 0; i < 200; i++) {r.add('GET', `/api${i}/v1/users/:id/posts/:post/comments/:c`, id++);}
      const benchUrl =
        shape === 'heavy1k-static'
          ? HEAVY1K_STATIC_URL
          : shape === 'heavy1k-param'
            ? HEAVY1K_PARAM_URL
            : shape === 'heavy1k-wildcard'
              ? HEAVY1K_WILD_URL
              : HEAVY1K_REGEX_URL;
      return { match: u => r.find('GET', u), benchUrl };
    }
  }
}

// ── rou3 per-shape builders ──

function buildRou3(shape: Shape): Built | null {
  switch (shape) {
    case 'deep10': {
      const r = createRou3<number>();
      addRoute(r, 'GET', DEEP_ROUTE, 1);
      return { match: u => findRoute(r, 'GET', u), benchUrl: DEEP_URL };
    }
    case 'combo': {
      const r = createRou3<number>();
      addRoute(r, 'GET', COMBO_ROUTE.replace(/\*\w+/, '**'), 1);
      return { match: u => findRoute(r, 'GET', u), benchUrl: COMBO_URL };
    }
    case 'regex':
    case 'manywild':
    case 'deep20':
      // rou3 doesn't support regex constraints, named middle-wildcards, or
      // deep20 param chains within its expressive limits.
      return null;
    case 'heavy-param':
    case 'heavy-static': {
      const r = createRou3<number>();
      let id = 0;
      for (let i = 0; i < 100; i++) {addRoute(r, 'GET', `/api/v1/sys/cfg${i}`, id++);}
      for (let i = 0; i < 200; i++) {addRoute(r, 'GET', `/api/v1/users${i}/:userId`, id++);}
      for (let i = 0; i < 100; i++) {addRoute(r, 'GET', `/api/v1/orgs${i}/:org/repos/:repo`, id++);}
      for (let i = 0; i < 100; i++) {addRoute(r, 'GET', `/api/v1/projects${i}/:proj/issues/:issue/comments/:comment`, id++);}
      return {
        match: u => findRoute(r, 'GET', u),
        benchUrl: shape === 'heavy-param' ? HEAVY_PARAM_URL : HEAVY_STATIC_URL,
      };
    }
    case 'heavy1k-static':
    case 'heavy1k-param':
    case 'heavy1k-wildcard':
    case 'heavy1k-regex': {
      const r = createRou3<number>();
      let id = 0;
      for (let i = 0; i < 200; i++) {addRoute(r, 'GET', `/static/page${i}`, id++);}
      for (let i = 0; i < 200; i++) {addRoute(r, 'GET', `/users${i}/:id`, id++);}
      for (let i = 0; i < 200; i++) {addRoute(r, 'GET', `/orgs${i}/:org/repos/:repo`, id++);}
      for (let i = 0; i < 100; i++) {addRoute(r, 'GET', `/search${i}/:q`, id++);}
      for (let i = 0; i < 100; i++) {addRoute(r, 'GET', `/files${i}/**:path`, id++);}
      for (let i = 0; i < 200; i++) {addRoute(r, 'GET', `/api${i}/v1/users/:id/posts/:post/comments/:c`, id++);}
      const benchUrl =
        shape === 'heavy1k-static'
          ? HEAVY1K_STATIC_URL
          : shape === 'heavy1k-param'
            ? HEAVY1K_PARAM_URL
            : shape === 'heavy1k-wildcard'
              ? HEAVY1K_WILD_URL
              : HEAVY1K_REGEX_URL;
      return { match: u => findRoute(r, 'GET', u), benchUrl };
    }
  }
}

const BUILDERS: Record<RouterKind, (shape: Shape) => Built | null> = {
  zipbul: buildZipbul,
  memoirist: buildMemoirist,
  rou3: buildRou3,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ORCHESTRATOR / WORKER SPLIT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const workerKind = process.argv[2] as RouterKind | undefined;
const workerShape = process.argv[3] as Shape | undefined;
const isWorker = workerKind !== undefined && workerShape !== undefined;

if (!isWorker) {
  printEnv();
  const total = SHAPES.length * ROUTER_NAMES.length;
  console.log(
    `routers=${ROUTER_NAMES.length} shapes=${SHAPES.length} pairs=${total} (each pair runs in a fresh process for JIT/IC/RSS isolation)`,
  );
  const selfPath = fileURLToPath(import.meta.url);
  let failCount = 0;
  for (const shape of SHAPES) {
    for (const router of ROUTER_NAMES) {
      console.log(`\n## ${shape} / ${router}`);
      const child = spawnSync('bun', [selfPath, router, shape], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      if (child.status !== 0) {
        console.error(`pair=${shape}/${router} exited with status ${child.status}`);
        failCount++;
      }
    }
  }
  process.exit(failCount > 0 ? 1 : 0);
}

if (!ROUTER_NAMES.includes(workerKind)) {
  console.error(`Unknown router '${workerKind}'. Valid: ${ROUTER_NAMES.join(', ')}`);
  process.exit(1);
}
if (!SHAPES.includes(workerShape)) {
  console.error(`Unknown shape '${workerShape}'. Valid: ${SHAPES.join(', ')}`);
  process.exit(1);
}

const built = BUILDERS[workerKind](workerShape);
if (built === null) {
  console.log(`skip=true router=${workerKind} shape=${workerShape} reason=unsupported`);
  process.exit(0);
}

// Sanity gate.
const probe = built.match(built.benchUrl);
if (probe === null || probe === undefined) {
  console.log(`sanity=match-null router=${workerKind} shape=${workerShape} url=${JSON.stringify(built.benchUrl)}`);
  process.exit(1);
}
console.log(`sanity=ok router=${workerKind} shape=${workerShape}`);

bench(`${workerShape} — ${workerKind}`, () => {
  do_not_optimize(built.match(built.benchUrl));
});

await run();
