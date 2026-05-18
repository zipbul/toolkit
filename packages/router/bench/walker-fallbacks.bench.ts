// Purpose: verify each walker-selection branch (codegen / iterative / recursive)
// is actually picked for shapes that should land on it. Each bench measures
// its walker on a workload that triggers selection — routes counts and match
// paths differ across the three benches, so the numbers are NOT directly
// comparable to each other; they are per-walker sanity timings.
import { bench, do_not_optimize, run, summary } from 'mitata';

import { getRouterInternals } from '../internal';
import { Router } from '../src/router';
import { printEnv } from './helpers';

printEnv();

function pickedWalkerSource(router: Router<string>): string {
  const trees = (
    getRouterInternals(router) as unknown as {
      matchLayer: { trees: Array<((u: string, s: unknown) => boolean) | null> };
    }
  ).matchLayer.trees;
  const tree = trees.find(t => t != null);

  return tree === undefined || tree === null ? 'none' : tree.toString();
}

function buildCodegenRouter(): Router<string> {
  const r = new Router<string>();
  r.add('GET', '/users/:id', 'user');
  r.build();

  return r;
}

function buildIterativeRouter(): Router<string> {
  const r = new Router<string>();

  for (let i = 0; i < 25; i++) {
    r.add('GET', `/zone${i}/:slug`, `r${i}`);
    r.add('GET', `/zone${i}/:slug/sub/:sub`, `r${i}sub`);
  }

  r.build();

  return r;
}

function buildRecursiveRouter(): Router<string> {
  const r = new Router<string>();
  r.add('GET', '/api/v1/:user', 'v1-user');
  r.add('GET', '/api/:ver/users', 'param-version');
  r.add('GET', '/api/v2/posts/:id', 'v2-post');
  r.add('GET', '/api/:ver/posts/:slug', 'param-post');
  r.build();

  return r;
}

const codegen = buildCodegenRouter();
const iterative = buildIterativeRouter();
const recursive = buildRecursiveRouter();

if (!pickedWalkerSource(codegen).includes('compiledSegmentWalk')) {
  throw new Error('walker bench setup failed: codegen router did not pick compiledSegmentWalk');
}

if (!pickedWalkerSource(iterative).includes('while')) {
  throw new Error('walker bench setup failed: iterative router did not pick iterative walker');
}

if (!pickedWalkerSource(recursive).includes('return match(')) {
  throw new Error('walker bench setup failed: recursive router did not pick recursive walker');
}

summary(() => {
  bench('walker: codegen segment', () => {
    do_not_optimize(codegen.match('GET', '/users/42'));
  });

  bench('walker: iterative fallback', () => {
    do_not_optimize(iterative.match('GET', '/zone10/foo/sub/bar'));
  });

  bench('walker: recursive fallback', () => {
    do_not_optimize(recursive.match('GET', '/api/v9/posts/hello'));
  });
});

await run();
