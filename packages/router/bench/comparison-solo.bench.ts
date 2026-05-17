/**
 * Production-realistic cross-router comparison.
 *
 * Unlike `comparison.bench.ts` which registers all 7 adapters into the
 * same mitata block (exposing every router to IC polymorphism from the
 * others), this bench measures **one router at a time within isolated
 * scenarios**. Each bench wraps a closure capturing a single adapter
 * instance, so JSC keeps the match call site monomorphic — the shape a
 * real HTTP server sees.
 *
 * mitata cross-router runs are useful for stress-testing IC poly
 * resilience; solo runs reflect what production sees when a single
 * Router instance handles every request. Treat solo as the
 * production-realistic baseline and cross-router as the IC-poly
 * stress test.
 */
import { bench, run } from 'mitata';
import { Router as Zipbul } from '../index.ts';
import { Memoirist } from 'memoirist';
import { default as FindMyWay } from 'find-my-way';
import { addRoute, createRouter, findRoute } from 'rou3';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import KoaTreeRouter from 'koa-tree-router';

const STATIC: Array<[string, string]> = [];
for (let i = 0; i < 100; i++) STATIC.push(['GET', `/api/v1/resource${i}`]);

const PARAM: Array<[string, string]> = [
  ['GET', '/users/:id'],
  ['POST', '/users/:id'],
  ['GET', '/repos/:owner/:repo/issues/:id'],
];

const WILDCARD: Array<[string, string]> = [
  ['GET', '/static/*path'],
  ['GET', '/files/*path'],
];

const GITHUB: Array<[string, string]> = [
  ['GET','/user'],['GET','/users/:user'],['GET','/users/:user/repos'],
  ['GET','/users/:user/orgs'],['GET','/users/:user/gists'],['GET','/users/:user/followers'],
  ['GET','/users/:user/following'],['GET','/users/:user/following/:target'],['GET','/users/:user/keys'],
  ['GET','/repos/:owner/:repo'],['GET','/repos/:owner/:repo/commits'],
  ['GET','/repos/:owner/:repo/commits/:sha'],['GET','/repos/:owner/:repo/branches'],
  ['GET','/repos/:owner/:repo/branches/:branch'],['GET','/repos/:owner/:repo/tags'],
  ['GET','/repos/:owner/:repo/contributors'],['GET','/repos/:owner/:repo/languages'],
  ['GET','/repos/:owner/:repo/teams'],['GET','/repos/:owner/:repo/releases'],
  ['GET','/repos/:owner/:repo/releases/:id'],['POST','/repos/:owner/:repo/releases'],
  ['GET','/repos/:owner/:repo/issues'],['GET','/repos/:owner/:repo/issues/:number'],
  ['POST','/repos/:owner/:repo/issues'],['GET','/repos/:owner/:repo/issues/:number/comments'],
  ['POST','/repos/:owner/:repo/issues/:number/comments'],['GET','/repos/:owner/:repo/pulls'],
  ['GET','/repos/:owner/:repo/pulls/:number'],['POST','/repos/:owner/:repo/pulls'],
  ['GET','/repos/:owner/:repo/pulls/:number/commits'],['GET','/repos/:owner/:repo/pulls/:number/files'],
  ['GET','/repos/:owner/:repo/contents/:path'],['GET','/repos/:owner/:repo/stargazers'],
  ['GET','/repos/:owner/:repo/subscribers'],['GET','/repos/:owner/:repo/forks'],
  ['POST','/repos/:owner/:repo/forks'],['GET','/repos/:owner/:repo/hooks'],
  ['GET','/repos/:owner/:repo/hooks/:id'],['POST','/repos/:owner/:repo/hooks'],
  ['GET','/repos/:owner/:repo/collaborators'],['GET','/repos/:owner/:repo/collaborators/:user'],
  ['PUT','/repos/:owner/:repo/collaborators/:user'],['DELETE','/repos/:owner/:repo/collaborators/:user'],
  ['GET','/orgs/:org'],['GET','/orgs/:org/repos'],['GET','/orgs/:org/members'],
  ['GET','/orgs/:org/members/:user'],['GET','/orgs/:org/teams'],['GET','/orgs/:org/teams/:team'],
  ['POST','/orgs/:org/teams'],['GET','/orgs/:org/teams/:team/members'],
  ['GET','/orgs/:org/teams/:team/repos'],['GET','/gists'],['GET','/gists/:id'],
  ['POST','/gists'],['GET','/gists/:id/comments'],['GET','/search/repositories'],
  ['GET','/search/code'],['GET','/search/issues'],['GET','/search/users'],
  ['GET','/notifications'],['GET','/events'],['GET','/feeds'],
  ['GET','/rate_limit'],['GET','/emojis'],
];

function setupAll(routes: Array<[string, string]>) {
  const zipbul = new Zipbul<number>();
  for (let i = 0; i < routes.length; i++) zipbul.add(routes[i]![0] as 'GET', routes[i]![1], i);
  zipbul.build();
  const memo = new Memoirist<number>();
  for (let i = 0; i < routes.length; i++) memo.add(routes[i]![0], routes[i]![1], i);
  const fmw = FindMyWay();
  for (let i = 0; i < routes.length; i++) fmw.on(routes[i]![0] as 'GET', routes[i]![1].replace(/\/\*[^/]+$/, '/*'), () => i);
  const rou3 = createRouter<number>();
  for (let i = 0; i < routes.length; i++) addRoute(rou3, routes[i]![0], routes[i]![1], i);
  const honoR = new RegExpRouter<number>();
  for (let i = 0; i < routes.length; i++) honoR.add(routes[i]![0], routes[i]![1].replace(/\*[^/]+$/, '*'), i);
  honoR.match('GET', '/');
  const koa = new KoaTreeRouter() as any;
  for (let i = 0; i < routes.length; i++) koa.on(routes[i]![0], routes[i]![1], () => i);
  return { zipbul, memo, fmw, rou3, honoR, koa };
}

const sStatic = setupAll(STATIC);
const sParam = setupAll(PARAM);
const sWild = setupAll(WILDCARD);
const sGitHub = setupAll(GITHUB);

const scenarios: Array<[string, any, string, string]> = [
  ['static/hit-0', sStatic, 'GET', '/api/v1/resource0'],
  ['static/hit-1', sStatic, 'GET', '/api/v1/resource50'],
  ['static/hit-2', sStatic, 'GET', '/api/v1/resource99'],
  ['static/miss', sStatic, 'GET', '/api/v1/missing'],
  ['static/wrong-method', sStatic, 'POST', '/api/v1/resource50'],
  ['param-1/hit', sParam, 'GET', '/users/42'],
  ['param-1/miss', sParam, 'GET', '/missing/42'],
  ['param-1/wrong-method', sParam, 'DELETE', '/users/42'],
  ['param-3/hit', sParam, 'GET', '/repos/zipbul/toolkit/issues/42'],
  ['param-3/miss', sParam, 'GET', '/repos/zipbul/toolkit/missing/42'],
  ['param-3/wrong-method', sParam, 'DELETE', '/repos/zipbul/toolkit/issues/42'],
  ['wildcard/hit-0', sWild, 'GET', '/static/js/app.bundle.js'],
  ['wildcard/hit-1', sWild, 'GET', '/files/uploads/2024/photo.jpg'],
  ['wildcard/miss', sWild, 'GET', '/missing/path/here'],
  ['wildcard/wrong-method', sWild, 'POST', '/static/js/app.bundle.js'],
  ['github-static/hit', sGitHub, 'GET', '/user'],
  ['github-static/miss', sGitHub, 'GET', '/missing'],
  ['github-static/wrong-method', sGitHub, 'POST', '/user'],
  ['github-param/hit', sGitHub, 'GET', '/repos/zipbul/toolkit/issues/42'],
  ['github-param/miss', sGitHub, 'GET', '/repos/zipbul/toolkit/missing/42'],
  ['github-param/wrong-method', sGitHub, 'DELETE', '/repos/zipbul/toolkit/issues/42'],
  ['miss/miss', sStatic, 'GET', '/nonexistent/path/that/does/not/exist'],
  ['miss/wrong-method', sStatic, 'POST', '/nonexistent/path'],
];

for (const [label, s, m, p] of scenarios) {
  bench(`${label.padEnd(28)} zipbul`, () => s.zipbul.match(m, p));
  bench(`${label.padEnd(28)} memoirist`, () => s.memo.find(m, p));
  bench(`${label.padEnd(28)} rou3`, () => findRoute(s.rou3, m, p));
  bench(`${label.padEnd(28)} hono-regex`, () => s.honoR.match(m, p));
  bench(`${label.padEnd(28)} koa-tree`, () => s.koa.find(m, p));
}

await run();
