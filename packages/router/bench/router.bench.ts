import { run, bench, boxplot, summary, do_not_optimize } from 'mitata';

import type { HttpMethod } from '@zipbul/shared';

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

// ── 10. Regex param match (7-1) ──

const regexParamRouter = buildRouter([
  ['GET', '/:id(\\d+)', 1],
  ['GET', '/:id(\\d+)/comments', 2],
  ['GET', '/users/:id(\\d+)/posts/:postId(\\d+)', 3],
]);

const regexParamRouterCached = buildRouter([
  ['GET', '/:id(\\d+)', 1],
  ['GET', '/:id(\\d+)/comments', 2],
  ['GET', '/users/:id(\\d+)/posts/:postId(\\d+)', 3],
], { enableCache: true, cacheSize: 500 });

// warm up
regexParamRouterCached.match('GET', '/42');
regexParamRouterCached.match('GET', '/users/42/posts/7');

summary(() => {
  bench('regex param match: /:id(\\d+)', () => {
    do_not_optimize(regexParamRouter.match('GET', '/42'));
  });

  bench('regex param match: 2-deep regex params', () => {
    do_not_optimize(regexParamRouter.match('GET', '/users/42/posts/7'));
  });

  bench('regex param match: /:id(\\d+)/comments', () => {
    do_not_optimize(regexParamRouter.match('GET', '/42/comments'));
  });

  bench('regex param cache hit: /:id(\\d+)', () => {
    do_not_optimize(regexParamRouterCached.match('GET', '/42'));
  });
});

// ── 11. Optional param match (7-2) ──

const optionalParamRouter = buildRouter([
  ['GET', '/:lang?/docs', 1],
  ['GET', '/:lang?/docs/:section', 2],
  ['GET', '/api/:version?/users', 3],
]);

const optionalParamRouterCached = buildRouter([
  ['GET', '/:lang?/docs', 1],
  ['GET', '/:lang?/docs/:section', 2],
  ['GET', '/api/:version?/users', 3],
], { enableCache: true, cacheSize: 500 });

// warm up
optionalParamRouterCached.match('GET', '/en/docs');
optionalParamRouterCached.match('GET', '/docs');

summary(() => {
  bench('optional param match: with lang param (/en/docs)', () => {
    do_not_optimize(optionalParamRouter.match('GET', '/en/docs'));
  });

  bench('optional param match: without lang param (/docs)', () => {
    do_not_optimize(optionalParamRouter.match('GET', '/docs'));
  });

  bench('optional param match: nested /:lang?/docs/:section', () => {
    do_not_optimize(optionalParamRouter.match('GET', '/en/docs/intro'));
  });

  bench('optional param cache hit: with lang', () => {
    do_not_optimize(optionalParamRouterCached.match('GET', '/en/docs'));
  });

  bench('optional param cache hit: without lang', () => {
    do_not_optimize(optionalParamRouterCached.match('GET', '/docs'));
  });
});

// ── 12. Multi-method match (7-3) ──

const multiMethodRouter = buildRouter([
  ['GET', '/api/resources/:id', 1],
  ['POST', '/api/resources/:id', 2],
  ['PUT', '/api/resources/:id', 3],
  ['DELETE', '/api/resources/:id', 4],
  ['PATCH', '/api/resources/:id', 5],
  ['GET', '/api/resources', 10],
  ['POST', '/api/resources', 11],
]);

summary(() => {
  bench('multi-method: GET match', () => {
    do_not_optimize(multiMethodRouter.match('GET', '/api/resources/42'));
  });

  bench('multi-method: POST match', () => {
    do_not_optimize(multiMethodRouter.match('POST', '/api/resources/42'));
  });

  bench('multi-method: DELETE match', () => {
    do_not_optimize(multiMethodRouter.match('DELETE', '/api/resources/42'));
  });

  bench('multi-method: PATCH match', () => {
    do_not_optimize(multiMethodRouter.match('PATCH', '/api/resources/42'));
  });

  bench('multi-method: wrong method (405)', () => {
    do_not_optimize(multiMethodRouter.match('HEAD', '/api/resources/42'));
  });
});

// ── 13. addAll bulk registration (7-4) ──

function generateParamRoutes(count: number): Array<[string, string, number]> {
  const methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE'> = ['GET', 'POST', 'PUT', 'DELETE'];
  const routes: Array<[string, string, number]> = [];

  for (let i = 0; i < count; i++) {
    const method = methods[i % methods.length]!;
    routes.push([method, `/api/v${i % 5}/resource${Math.floor(i / 5)}/:id`, i]);
  }

  return routes;
}

const PARAM_ROUTES_100 = generateParamRoutes(100);
const PARAM_ROUTES_500 = generateParamRoutes(500);
const PARAM_ROUTES_1000 = generateParamRoutes(1000);

boxplot(() => {
  bench('addAll+build 100 static routes', () => {
    const router = new Router<number>();
    router.addAll(STATIC_ROUTES_100 as Array<[HttpMethod, string, number]>);
    do_not_optimize(router.build());
  }).gc('inner');

  bench('addAll+build 500 static routes', () => {
    const router = new Router<number>();
    router.addAll(STATIC_ROUTES_500 as Array<[HttpMethod, string, number]>);
    do_not_optimize(router.build());
  }).gc('inner');

  bench('addAll+build 1000 static routes', () => {
    const router = new Router<number>();
    router.addAll(STATIC_ROUTES_1000 as Array<[HttpMethod, string, number]>);
    do_not_optimize(router.build());
  }).gc('inner');

  bench('addAll+build 100 param routes', () => {
    const router = new Router<number>();
    router.addAll(PARAM_ROUTES_100 as Array<[HttpMethod, string, number]>);
    do_not_optimize(router.build());
  }).gc('inner');

  bench('addAll+build 500 param routes', () => {
    const router = new Router<number>();
    router.addAll(PARAM_ROUTES_500 as Array<[HttpMethod, string, number]>);
    do_not_optimize(router.build());
  }).gc('inner');

  bench('addAll+build 1000 param routes', () => {
    const router = new Router<number>();
    router.addAll(PARAM_ROUTES_1000 as Array<[HttpMethod, string, number]>);
    do_not_optimize(router.build());
  }).gc('inner');
});

await run();
