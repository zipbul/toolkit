import { run, bench, summary, do_not_optimize } from 'mitata';

// ── @zipbul/router ──
import { Router } from '../src/router';

// ── find-my-way ──
import FindMyWay from 'find-my-way';

// ── memoirist (Elysia) ──
import { Memoirist } from 'memoirist';

// ── rou3 (H3/Nitro) ──
import { createRouter as createRou3, addRoute, findRoute } from 'rou3';

// ── hono ──
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';

// ── koa-tree-router ──
import KoaTreeRouter from 'koa-tree-router';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTE SETS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type Route = [method: string, path: string, value: number];

// 1) Static routes (100)
const STATIC_ROUTES: Route[] = [];
for (let i = 0; i < 100; i++) {
  STATIC_ROUTES.push(['GET', `/api/v1/resource${i}`, i]);
}

// 2) Parametric routes
const PARAM_ROUTES: Route[] = [
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['GET', '/repos/:owner/:repo/issues/:number', 3],
  ['GET', '/orgs/:org/teams/:team/members/:member', 4],
];

// 3) Wildcard routes
const WILDCARD_ROUTES: Route[] = [
  ['GET', '/static/*path', 1],
  ['GET', '/files/*filepath', 2],
];

// 4) GitHub API-like routes (~65)
const GITHUB_ROUTES: Route[] = [
  // Users
  ['GET', '/user', 1],
  ['GET', '/users/:user', 2],
  ['GET', '/users/:user/repos', 3],
  ['GET', '/users/:user/orgs', 4],
  ['GET', '/users/:user/gists', 5],
  ['GET', '/users/:user/followers', 6],
  ['GET', '/users/:user/following', 7],
  ['GET', '/users/:user/following/:target', 8],
  ['GET', '/users/:user/keys', 9],
  // Repos
  ['GET', '/repos/:owner/:repo', 10],
  ['GET', '/repos/:owner/:repo/commits', 11],
  ['GET', '/repos/:owner/:repo/commits/:sha', 12],
  ['GET', '/repos/:owner/:repo/branches', 13],
  ['GET', '/repos/:owner/:repo/branches/:branch', 14],
  ['GET', '/repos/:owner/:repo/tags', 15],
  ['GET', '/repos/:owner/:repo/contributors', 16],
  ['GET', '/repos/:owner/:repo/languages', 17],
  ['GET', '/repos/:owner/:repo/teams', 18],
  ['GET', '/repos/:owner/:repo/releases', 19],
  ['GET', '/repos/:owner/:repo/releases/:id', 20],
  ['POST', '/repos/:owner/:repo/releases', 21],
  ['GET', '/repos/:owner/:repo/issues', 22],
  ['GET', '/repos/:owner/:repo/issues/:number', 23],
  ['POST', '/repos/:owner/:repo/issues', 24],
  ['GET', '/repos/:owner/:repo/issues/:number/comments', 25],
  ['POST', '/repos/:owner/:repo/issues/:number/comments', 26],
  ['GET', '/repos/:owner/:repo/pulls', 27],
  ['GET', '/repos/:owner/:repo/pulls/:number', 28],
  ['POST', '/repos/:owner/:repo/pulls', 29],
  ['GET', '/repos/:owner/:repo/pulls/:number/commits', 30],
  ['GET', '/repos/:owner/:repo/pulls/:number/files', 31],
  ['GET', '/repos/:owner/:repo/contents/:path', 32],
  ['GET', '/repos/:owner/:repo/stargazers', 33],
  ['GET', '/repos/:owner/:repo/subscribers', 34],
  ['GET', '/repos/:owner/:repo/forks', 35],
  ['POST', '/repos/:owner/:repo/forks', 36],
  ['GET', '/repos/:owner/:repo/hooks', 37],
  ['GET', '/repos/:owner/:repo/hooks/:id', 38],
  ['POST', '/repos/:owner/:repo/hooks', 39],
  ['GET', '/repos/:owner/:repo/collaborators', 40],
  ['GET', '/repos/:owner/:repo/collaborators/:user', 41],
  ['PUT', '/repos/:owner/:repo/collaborators/:user', 42],
  ['DELETE', '/repos/:owner/:repo/collaborators/:user', 43],
  // Orgs
  ['GET', '/orgs/:org', 44],
  ['GET', '/orgs/:org/repos', 45],
  ['GET', '/orgs/:org/members', 46],
  ['GET', '/orgs/:org/members/:user', 47],
  ['GET', '/orgs/:org/teams', 48],
  ['GET', '/orgs/:org/teams/:team', 49],
  ['POST', '/orgs/:org/teams', 50],
  ['GET', '/orgs/:org/teams/:team/members', 51],
  ['GET', '/orgs/:org/teams/:team/repos', 52],
  // Gists
  ['GET', '/gists', 53],
  ['GET', '/gists/:id', 54],
  ['POST', '/gists', 55],
  ['GET', '/gists/:id/comments', 56],
  // Search
  ['GET', '/search/repositories', 57],
  ['GET', '/search/code', 58],
  ['GET', '/search/issues', 59],
  ['GET', '/search/users', 60],
  // Misc
  ['GET', '/notifications', 61],
  ['GET', '/events', 62],
  ['GET', '/feeds', 63],
  ['GET', '/rate_limit', 64],
  ['GET', '/emojis', 65],
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ROUTER ADAPTERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Wildcard path converters
function toFindMyWayPath(path: string): string {
  // /static/*path → /static/*
  return path.replace(/\*\w+/, '*');
}

function toRou3Path(path: string): string {
  // /static/*path → /static/**
  return path.replace(/\*\w+/, '**');
}

function toHonoPath(path: string): string {
  // /static/*path → /static/*
  return path.replace(/\*\w+/, '*');
}

function toKoaTreePath(path: string): string {
  // /static/*path → /static/*filepath (koa-tree-router uses *name)
  return path.replace(/\*\w+/, '*filepath');
}

function toMemoiristPath(path: string): string {
  // /static/*path → /static/*
  return path.replace(/\*\w+/, '*');
}

// ── @zipbul/router ──

function setupZipbul(routes: Route[]): Router<number> {
  const router = new Router<number>();
  for (const [method, path, value] of routes) {
    router.add(method as 'GET', path, value);
  }
  router.build();
  return router;
}

// ── find-my-way ──

function setupFindMyWay(routes: Route[]): ReturnType<typeof FindMyWay> {
  const router = FindMyWay();
  for (const [method, path, value] of routes) {
    router.on(method as 'GET', toFindMyWayPath(path), () => value);
  }
  return router;
}

// ── memoirist ──

function setupMemoirist(routes: Route[]): Memoirist<number> {
  const router = new Memoirist<number>();
  for (const [method, path, value] of routes) {
    router.add(method, toMemoiristPath(path), value);
  }
  return router;
}

// ── rou3 ──

function setupRou3(routes: Route[]) {
  const router = createRou3<number>();
  for (const [method, path, value] of routes) {
    addRoute(router, method, toRou3Path(path), value);
  }
  return router;
}

// ── hono RegExpRouter ──

function setupHonoRegExp(routes: Route[]): RegExpRouter<number> {
  const router = new RegExpRouter<number>();
  for (const [method, path, value] of routes) {
    router.add(method, toHonoPath(path), value);
  }
  return router;
}

// ── hono TrieRouter ──

function setupHonoTrie(routes: Route[]): TrieRouter<number> {
  const router = new TrieRouter<number>();
  for (const [method, path, value] of routes) {
    router.add(method, toHonoPath(path), value);
  }
  return router;
}

// ── koa-tree-router ──

function setupKoaTree(routes: Route[]) {
  const router = new KoaTreeRouter() as any;
  for (const [method, path, value] of routes) {
    router.on(method, toKoaTreePath(path), () => value);
  }
  return router;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PRE-BUILT ROUTERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Static (100 routes)
const zipbulStatic = setupZipbul(STATIC_ROUTES);
const fmwStatic = setupFindMyWay(STATIC_ROUTES);
const memoStatic = setupMemoirist(STATIC_ROUTES);
const rou3Static = setupRou3(STATIC_ROUTES);
const honoRegStatic = setupHonoRegExp(STATIC_ROUTES);
const honoTrieStatic = setupHonoTrie(STATIC_ROUTES);
const koaStatic = setupKoaTree(STATIC_ROUTES);

// Parametric
const zipbulParam = setupZipbul(PARAM_ROUTES);
const fmwParam = setupFindMyWay(PARAM_ROUTES);
const memoParam = setupMemoirist(PARAM_ROUTES);
const rou3Param = setupRou3(PARAM_ROUTES);
const honoRegParam = setupHonoRegExp(PARAM_ROUTES);
const honoTrieParam = setupHonoTrie(PARAM_ROUTES);
const koaParam = setupKoaTree(PARAM_ROUTES);

// Wildcard
const zipbulWild = setupZipbul(WILDCARD_ROUTES);
const fmwWild = setupFindMyWay(WILDCARD_ROUTES);
const memoWild = setupMemoirist(WILDCARD_ROUTES);
const rou3Wild = setupRou3(WILDCARD_ROUTES);
const honoRegWild = setupHonoRegExp(WILDCARD_ROUTES);
const honoTrieWild = setupHonoTrie(WILDCARD_ROUTES);
const koaWild = setupKoaTree(WILDCARD_ROUTES);

// GitHub API (~65 routes)
const zipbulGH = setupZipbul(GITHUB_ROUTES);
const fmwGH = setupFindMyWay(GITHUB_ROUTES);
const memoGH = setupMemoirist(GITHUB_ROUTES);
const rou3GH = setupRou3(GITHUB_ROUTES);
const honoRegGH = setupHonoRegExp(GITHUB_ROUTES);
const honoTrieGH = setupHonoTrie(GITHUB_ROUTES);
const koaGH = setupKoaTree(GITHUB_ROUTES);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  SANITY CHECK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function sanityCheck() {
  // Verify all routers match the same test paths
  const checks: [string, string, string][] = [
    // [method, path, description]
    ['GET', '/api/v1/resource50', 'static'],
    ['GET', '/users/42', 'param-1'],
    ['GET', '/repos/zipbul/toolkit/issues/1', 'param-3'],
    ['GET', '/user', 'github-static'],
    ['GET', '/repos/zipbul/toolkit/commits', 'github-param'],
  ];

  for (const [method, path, desc] of checks) {
    const z = zipbulGH.match(method as 'GET', path) ?? zipbulStatic.match(method as 'GET', path) ?? zipbulParam.match(method as 'GET', path);
    const f = fmwGH.find(method as 'GET', path) ?? fmwStatic.find(method as 'GET', path) ?? fmwParam.find(method as 'GET', path);
    const m = memoGH.find(method, path) ?? memoStatic.find(method, path) ?? memoParam.find(method, path);
    const r = findRoute(rou3GH, method, path) ?? findRoute(rou3Static, method, path) ?? findRoute(rou3Param, method, path);
    const hr = honoRegGH.match(method, path) ?? honoRegStatic.match(method, path) ?? honoRegParam.match(method, path);
    const ht = honoTrieGH.match(method, path) ?? honoTrieStatic.match(method, path) ?? honoTrieParam.match(method, path);
    const k = koaGH.find(method, path) ?? koaStatic.find(method, path) ?? koaParam.find(method, path);

    const allFound = z && f && m && r && hr && ht && k;
    if (!allFound) {
      console.error(`SANITY FAIL [${desc}]: ${method} ${path}`);
      console.error(`  zipbul=${!!z} fmw=${!!f} memo=${!!m} rou3=${!!r} honoReg=${!!hr} honoTrie=${!!ht} koa=${!!k}`);
      process.exit(1);
    }
  }

  console.log('Sanity check passed: all routers match test paths.\n');
}

sanityCheck();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BENCHMARKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Static match (100 routes) ──

summary(() => {
  bench('static — @zipbul/router', () => {
    do_not_optimize(zipbulStatic.match('GET', '/api/v1/resource50'));
  });

  bench('static — find-my-way', () => {
    do_not_optimize(fmwStatic.find('GET', '/api/v1/resource50'));
  });

  bench('static — memoirist', () => {
    do_not_optimize(memoStatic.find('GET', '/api/v1/resource50'));
  });

  bench('static — rou3', () => {
    do_not_optimize(findRoute(rou3Static, 'GET', '/api/v1/resource50'));
  });

  bench('static — hono RegExpRouter', () => {
    do_not_optimize(honoRegStatic.match('GET', '/api/v1/resource50'));
  });

  bench('static — hono TrieRouter', () => {
    do_not_optimize(honoTrieStatic.match('GET', '/api/v1/resource50'));
  });

  bench('static — koa-tree-router', () => {
    do_not_optimize(koaStatic.find('GET', '/api/v1/resource50'));
  });
});

// ── 2. Param match (1-param: /users/:id) ──

summary(() => {
  bench('param1 — @zipbul/router', () => {
    do_not_optimize(zipbulParam.match('GET', '/users/42'));
  });

  bench('param1 — find-my-way', () => {
    do_not_optimize(fmwParam.find('GET', '/users/42'));
  });

  bench('param1 — memoirist', () => {
    do_not_optimize(memoParam.find('GET', '/users/42'));
  });

  bench('param1 — rou3', () => {
    do_not_optimize(findRoute(rou3Param, 'GET', '/users/42'));
  });

  bench('param1 — hono RegExpRouter', () => {
    do_not_optimize(honoRegParam.match('GET', '/users/42'));
  });

  bench('param1 — hono TrieRouter', () => {
    do_not_optimize(honoTrieParam.match('GET', '/users/42'));
  });

  bench('param1 — koa-tree-router', () => {
    do_not_optimize(koaParam.find('GET', '/users/42'));
  });
});

// ── 3. Param match (3-deep: /repos/:owner/:repo/issues/:number) ──

summary(() => {
  bench('param3 — @zipbul/router', () => {
    do_not_optimize(zipbulParam.match('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('param3 — find-my-way', () => {
    do_not_optimize(fmwParam.find('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('param3 — memoirist', () => {
    do_not_optimize(memoParam.find('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('param3 — rou3', () => {
    do_not_optimize(findRoute(rou3Param, 'GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('param3 — hono RegExpRouter', () => {
    do_not_optimize(honoRegParam.match('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('param3 — hono TrieRouter', () => {
    do_not_optimize(honoTrieParam.match('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('param3 — koa-tree-router', () => {
    do_not_optimize(koaParam.find('GET', '/repos/zipbul/toolkit/issues/42'));
  });
});

// ── 4. Wildcard match (/static/*path) ──

summary(() => {
  bench('wild — @zipbul/router', () => {
    do_not_optimize(zipbulWild.match('GET', '/static/js/app.bundle.js'));
  });

  bench('wild — find-my-way', () => {
    do_not_optimize(fmwWild.find('GET', '/static/js/app.bundle.js'));
  });

  bench('wild — memoirist', () => {
    do_not_optimize(memoWild.find('GET', '/static/js/app.bundle.js'));
  });

  bench('wild — rou3', () => {
    do_not_optimize(findRoute(rou3Wild, 'GET', '/static/js/app.bundle.js'));
  });

  bench('wild — hono RegExpRouter', () => {
    do_not_optimize(honoRegWild.match('GET', '/static/js/app.bundle.js'));
  });

  bench('wild — hono TrieRouter', () => {
    do_not_optimize(honoTrieWild.match('GET', '/static/js/app.bundle.js'));
  });

  bench('wild — koa-tree-router', () => {
    do_not_optimize(koaWild.find('GET', '/static/js/app.bundle.js'));
  });
});

// ── 5. GitHub API — static hit (/user) ──

summary(() => {
  bench('gh-static — @zipbul/router', () => {
    do_not_optimize(zipbulGH.match('GET', '/user'));
  });

  bench('gh-static — find-my-way', () => {
    do_not_optimize(fmwGH.find('GET', '/user'));
  });

  bench('gh-static — memoirist', () => {
    do_not_optimize(memoGH.find('GET', '/user'));
  });

  bench('gh-static — rou3', () => {
    do_not_optimize(findRoute(rou3GH, 'GET', '/user'));
  });

  bench('gh-static — hono RegExpRouter', () => {
    do_not_optimize(honoRegGH.match('GET', '/user'));
  });

  bench('gh-static — hono TrieRouter', () => {
    do_not_optimize(honoTrieGH.match('GET', '/user'));
  });

  bench('gh-static — koa-tree-router', () => {
    do_not_optimize(koaGH.find('GET', '/user'));
  });
});

// ── 6. GitHub API — param hit (/repos/:owner/:repo/issues/:number) ──

summary(() => {
  bench('gh-param — @zipbul/router', () => {
    do_not_optimize(zipbulGH.match('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('gh-param — find-my-way', () => {
    do_not_optimize(fmwGH.find('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('gh-param — memoirist', () => {
    do_not_optimize(memoGH.find('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('gh-param — rou3', () => {
    do_not_optimize(findRoute(rou3GH, 'GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('gh-param — hono RegExpRouter', () => {
    do_not_optimize(honoRegGH.match('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('gh-param — hono TrieRouter', () => {
    do_not_optimize(honoTrieGH.match('GET', '/repos/zipbul/toolkit/issues/42'));
  });

  bench('gh-param — koa-tree-router', () => {
    do_not_optimize(koaGH.find('GET', '/repos/zipbul/toolkit/issues/42'));
  });
});

// ── 7. 404 miss (100 routes) ──

summary(() => {
  bench('miss — @zipbul/router', () => {
    do_not_optimize(zipbulStatic.match('GET', '/nonexistent/path/that/does/not/exist'));
  });

  bench('miss — find-my-way', () => {
    do_not_optimize(fmwStatic.find('GET', '/nonexistent/path/that/does/not/exist'));
  });

  bench('miss — memoirist', () => {
    do_not_optimize(memoStatic.find('GET', '/nonexistent/path/that/does/not/exist'));
  });

  bench('miss — rou3', () => {
    do_not_optimize(findRoute(rou3Static, 'GET', '/nonexistent/path/that/does/not/exist'));
  });

  bench('miss — hono RegExpRouter', () => {
    do_not_optimize(honoRegStatic.match('GET', '/nonexistent/path/that/does/not/exist'));
  });

  bench('miss — hono TrieRouter', () => {
    do_not_optimize(honoTrieStatic.match('GET', '/nonexistent/path/that/does/not/exist'));
  });

  bench('miss — koa-tree-router', () => {
    do_not_optimize(koaStatic.find('GET', '/nonexistent/path/that/does/not/exist'));
  });
});

await run();
