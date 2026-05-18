import { run, bench, boxplot, summary, do_not_optimize } from 'mitata';

import type { HttpMethod } from '@zipbul/shared';

import { Router } from '../src/router';
import type { RouterOptions } from '../src/types';
import { printEnv } from './helpers';

printEnv();

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

const STATIC_ROUTES_100: Array<[string, string, number]> = generateStaticRoutes(100);
const STATIC_ROUTES_500: Array<[string, string, number]> = generateStaticRoutes(500);
const STATIC_ROUTES_1000: Array<[string, string, number]> = generateStaticRoutes(1000);
const MIXED_ROUTES_100: Array<[string, string, number]> = generateMixedRoutes(100);

// ── Pre-built routers ──

// Static lookups hit a hash bucket regardless of table size (compileStaticOnlySingleMethod);
// one router suffices — extra sizes would just confirm the same O(1).
const staticRouter = buildRouter(STATIC_ROUTES_100);

const paramRouter = buildRouter([
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['GET', '/users/:id/posts/:postId/comments/:commentId', 3],
  ['GET', '/orgs/:orgId/teams/:teamId/members/:memberId', 4],
]);

const wildcardRouter = buildRouter([
  ['GET', '/static/*path', 1],
  ['GET', '/files/*filepath', 2],
  ['GET', '/assets/*rest', 3],
]);

const mixedRouter100 = buildRouter(MIXED_ROUTES_100);

// trailingSlash:'ignore' + pathCaseSensitive:false exercise the full option pipeline.
// No collapsed-slash option exists in RouterOptions, so that axis is not benched.
const fullOptionsRouter = buildRouter([
  ['GET', '/users/:id', 1],
  ['GET', '/users/:id/posts/:postId', 2],
  ['POST', '/users/:id/posts', 3],
  ['GET', '/files/*path', 4],
  ['GET', '/static/page', 5],
], {
  trailingSlash: 'ignore',
  pathCaseSensitive: false,
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BENCHMARKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Static route match (single bucket lookup) ──

bench('static match (hash bucket, 100 routes)', () => {
  do_not_optimize(staticRouter.match('GET', '/api/v1/resource50'));
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

// ── 4. Match miss (404, single bucket lookup) ──

bench('404 miss (hash bucket, 100 routes)', () => {
  do_not_optimize(staticRouter.match('GET', '/nonexistent/path'));
});

// ── 5. Mixed route types ──

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
});

// ── 6. Full options pipeline (case-insensitive + trailing slash) ──

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
});

// ── 7. Route registration (add + build) ──

boxplot(() => {
  bench('add+build 100 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_100));
  }).gc('inner');

  bench('add+build 500 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_500));
  }).gc('inner');

  bench('add+build 1000 static routes', () => {
    do_not_optimize(buildRouter(STATIC_ROUTES_1000));
  }).gc('inner');

  bench('add+build 100 mixed routes', () => {
    do_not_optimize(buildRouter(MIXED_ROUTES_100));
  }).gc('inner');
});

// ── 8. Regex param match ──

const regexParamRouter = buildRouter([
  ['GET', '/:id(\\d+)', 1],
  ['GET', '/:id(\\d+)/comments', 2],
  ['GET', '/users/:id(\\d+)/posts/:postId(\\d+)', 3],
]);

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
});

// ── 9. Optional param match ──

const optionalParamRouter = buildRouter([
  ['GET', '/:lang?/docs', 1],
  ['GET', '/:lang?/docs/:section', 2],
  ['GET', '/api/:version?/users', 3],
]);

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
});

// ── 10. Multi-method match ──

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

// ── 11. addAll bulk registration ──

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
