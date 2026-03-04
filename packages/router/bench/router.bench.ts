import { run, bench, boxplot, summary, do_not_optimize } from 'mitata';

import { Router } from '../src/router';
import type { RouterOptions } from '../src/types';

// ── Helpers ──

function buildRouter<T>(
  routes: Array<[string, string, T]>,
  options: RouterOptions = {},
): Router<T> {
  const router = new Router<T>(options);

  for (const [method, path, value] of routes) {
    router.add(method as 'GET', path, value);
  }

  router.build();

  return router;
}

function generateStaticRoutes(count: number): Array<[string, string, number]> {
  const routes: Array<[string, string, number]> = [];

  for (let i = 0; i < count; i++) {
    routes.push(['GET', `/api/v1/resource${i}`, i]);
  }

  return routes;
}

function generateMixedRoutes(count: number): Array<[string, string, number]> {
  const routes: Array<[string, string, number]> = [];
  const third = Math.floor(count / 3);

  for (let i = 0; i < third; i++) {
    routes.push(['GET', `/static/path/${i}`, i]);
  }

  for (let i = 0; i < third; i++) {
    routes.push(['GET', `/users/:id/posts/${i}`, third + i]);
  }

  for (let i = 0; i < count - 2 * third; i++) {
    routes.push(['GET', `/files/${i}/*path`, 2 * third + i]);
  }

  return routes;
}

// ── Route sets ──

const STATIC_ROUTES_10: Array<[string, string, number]> = generateStaticRoutes(10);
const STATIC_ROUTES_100: Array<[string, string, number]> = generateStaticRoutes(100);
const STATIC_ROUTES_500: Array<[string, string, number]> = generateStaticRoutes(500);
const STATIC_ROUTES_1000: Array<[string, string, number]> = generateStaticRoutes(1000);
const MIXED_ROUTES_100: Array<[string, string, number]> = generateMixedRoutes(100);

// ── Pre-built routers ──

const staticRouter10 = buildRouter(STATIC_ROUTES_10);
const staticRouter100 = buildRouter(STATIC_ROUTES_100);
const staticRouter500 = buildRouter(STATIC_ROUTES_500);
const staticRouter1000 = buildRouter(STATIC_ROUTES_1000);

const cachedRouter100 = buildRouter(STATIC_ROUTES_100, { enableCache: true, cacheSize: 200 });
const cachedRouter1000 = buildRouter(STATIC_ROUTES_1000, { enableCache: true, cacheSize: 2000 });

const paramRouter = buildRouter([
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['GET', '/users/:id/posts/:postId/comments/:commentId', 3],
  ['GET', '/orgs/:orgId/teams/:teamId/members/:memberId', 4],
]);

const paramRouterCached = buildRouter([
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['GET', '/users/:id/posts/:postId/comments/:commentId', 3],
  ['GET', '/orgs/:orgId/teams/:teamId/members/:memberId', 4],
], { enableCache: true, cacheSize: 1000 });

const wildcardRouter = buildRouter([
  ['GET', '/static/*path', 1],
  ['GET', '/files/*filepath', 2],
  ['GET', '/assets/*rest', 3],
]);

const mixedRouter100 = buildRouter(MIXED_ROUTES_100);
const mixedRouter100Cached = buildRouter(MIXED_ROUTES_100, { enableCache: true, cacheSize: 200 });

const fullOptionsRouter = buildRouter([
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['POST', '/users/:id/posts', 3],
  ['GET', '/files/*path', 4],
  ['GET', '/static/page', 5],
], {
  ignoreTrailingSlash: true,
  collapseSlashes: true,
  caseSensitive: false,
  blockTraversal: true,
  enableCache: true,
  cacheSize: 500,
});

// warm up caches
for (const path of ['/api/v1/resource0', '/api/v1/resource50', '/api/v1/resource99']) {
  cachedRouter100.match('GET', path);
}

for (const path of ['/api/v1/resource0', '/api/v1/resource500', '/api/v1/resource999']) {
  cachedRouter1000.match('GET', path);
}

for (const path of ['/users/42', '/users/42/posts/7', '/users/42/posts/7/comments/1']) {
  paramRouterCached.match('GET', path);
}

for (const path of ['/static/path/0', '/users/1/posts/0', '/files/0/readme.txt']) {
  mixedRouter100Cached.match('GET', path);
}

for (const path of ['/users/42', '/static/page', '/files/docs/readme.md']) {
  fullOptionsRouter.match('GET', path);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BENCHMARKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Static route match ──

summary(() => {
  bench('static match (10 routes)', () => {
    do_not_optimize(staticRouter10.match('GET', '/api/v1/resource5'));
  });

  bench('static match (100 routes)', () => {
    do_not_optimize(staticRouter100.match('GET', '/api/v1/resource50'));
  });

  bench('static match (500 routes)', () => {
    do_not_optimize(staticRouter500.match('GET', '/api/v1/resource250'));
  });

  bench('static match (1000 routes)', () => {
    do_not_optimize(staticRouter1000.match('GET', '/api/v1/resource500'));
  });
});

// ── 2. Parametric route match ──

summary(() => {
  bench('param match: /users/:id', () => {
    do_not_optimize(paramRouter.match('GET', '/users/42'));
  });

  bench('param match: /users/:id/posts/:postId', () => {
    do_not_optimize(paramRouter.match('GET', '/users/42/posts/7'));
  });

  bench('param match: 3-deep params', () => {
    do_not_optimize(paramRouter.match('GET', '/users/42/posts/7/comments/1'));
  });

  bench('param match: 3-deep (org/team/member)', () => {
    do_not_optimize(paramRouter.match('GET', '/orgs/acme/teams/core/members/alice'));
  });
});

// ── 3. Wildcard route match ──

summary(() => {
  bench('wildcard match: short suffix', () => {
    do_not_optimize(wildcardRouter.match('GET', '/static/app.js'));
  });

  bench('wildcard match: deep suffix', () => {
    do_not_optimize(wildcardRouter.match('GET', '/files/a/b/c/d/e/f.txt'));
  });

  bench('wildcard match: very long suffix', () => {
    do_not_optimize(wildcardRouter.match('GET', '/assets/images/2024/01/15/photo-original-large.webp'));
  });
});

// ── 4. Cache hit vs miss ──

summary(() => {
  bench('cache hit (100 routes)', () => {
    do_not_optimize(cachedRouter100.match('GET', '/api/v1/resource50'));
  });

  bench('no-cache (100 routes)', () => {
    do_not_optimize(staticRouter100.match('GET', '/api/v1/resource50'));
  });

  bench('cache hit (1000 routes)', () => {
    do_not_optimize(cachedRouter1000.match('GET', '/api/v1/resource500'));
  });

  bench('no-cache (1000 routes)', () => {
    do_not_optimize(staticRouter1000.match('GET', '/api/v1/resource500'));
  });
});

// ── 5. Cache hit vs miss (parametric) ──

summary(() => {
  bench('param cache hit: /users/:id', () => {
    do_not_optimize(paramRouterCached.match('GET', '/users/42'));
  });

  bench('param no-cache: /users/:id', () => {
    do_not_optimize(paramRouter.match('GET', '/users/42'));
  });

  bench('param cache hit: 3-deep', () => {
    do_not_optimize(paramRouterCached.match('GET', '/users/42/posts/7/comments/1'));
  });

  bench('param no-cache: 3-deep', () => {
    do_not_optimize(paramRouter.match('GET', '/users/42/posts/7/comments/1'));
  });
});

// ── 6. Match miss (404) ──

summary(() => {
  bench('404 miss (10 routes)', () => {
    do_not_optimize(staticRouter10.match('GET', '/nonexistent/path'));
  });

  bench('404 miss (100 routes)', () => {
    do_not_optimize(staticRouter100.match('GET', '/nonexistent/path'));
  });

  bench('404 miss (1000 routes)', () => {
    do_not_optimize(staticRouter1000.match('GET', '/nonexistent/path'));
  });
});

// ── 7. Mixed route types ──

summary(() => {
  bench('mixed static hit (100 routes)', () => {
    do_not_optimize(mixedRouter100.match('GET', '/static/path/15'));
  });

  bench('mixed param hit (100 routes)', () => {
    do_not_optimize(mixedRouter100.match('GET', '/users/42/posts/15'));
  });

  bench('mixed wildcard hit (100 routes)', () => {
    do_not_optimize(mixedRouter100.match('GET', '/files/0/docs/readme.md'));
  });

  bench('mixed cached static hit', () => {
    do_not_optimize(mixedRouter100Cached.match('GET', '/static/path/0'));
  });

  bench('mixed cached param hit', () => {
    do_not_optimize(mixedRouter100Cached.match('GET', '/users/1/posts/0'));
  });
});

// ── 8. Full options pipeline ──

summary(() => {
  bench('full-options static match', () => {
    do_not_optimize(fullOptionsRouter.match('GET', '/Static/Page'));
  });

  bench('full-options param match', () => {
    do_not_optimize(fullOptionsRouter.match('GET', '/Users/42/Posts/7'));
  });

  bench('full-options wildcard match', () => {
    do_not_optimize(fullOptionsRouter.match('GET', '/Files/Docs/README.md'));
  });

  bench('full-options trailing slash', () => {
    do_not_optimize(fullOptionsRouter.match('GET', '/Users/42/'));
  });

  bench('full-options collapsed slashes', () => {
    do_not_optimize(fullOptionsRouter.match('GET', '//Users///42'));
  });
});

// ── 9. Route registration (add + build) ──

boxplot(() => {
  bench('add+build 10 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_10));
  }).gc('inner');

  bench('add+build 100 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_100));
  }).gc('inner');

  bench('add+build 500 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_500));
  }).gc('inner');

  bench('add+build 1000 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_1000));
  }).gc('inner');
});

boxplot(() => {
  bench('add+build 100 mixed routes', () => {
    do_not_optimize(buildRouter(MIXED_ROUTES_100));
  }).gc('inner');

  bench('add+build 100 mixed + cache', () => {
    do_not_optimize(buildRouter(MIXED_ROUTES_100, { enableCache: true }));
  }).gc('inner');
});

await run();
