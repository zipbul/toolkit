/* eslint-disable no-console */

import { performance } from 'node:perf_hooks';

import FindMyWay from 'find-my-way';
import { RegExpRouter } from 'hono/router/reg-exp-router';
import { TrieRouter } from 'hono/router/trie-router';
import KoaTreeRouter from 'koa-tree-router';
import { Memoirist } from 'memoirist';
import { addRoute, createRouter as createRou3, findRoute } from 'rou3';

import { Router } from '../src/router';

type Route = [method: string, path: string, value: number];

const COUNT = 100_000;
const ITER = 200_000;
const target = process.argv[2] ?? 'zipbul';
const scenarioName = process.argv[3] ?? 'static';

function gc(): void {
  if (typeof Bun !== 'undefined') Bun.gc(true);
}

function mem(): NodeJS.MemoryUsage {
  gc();
  return process.memoryUsage();
}

function fmtMem(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage): string {
  const rss = (after.rss - before.rss) / 1024 / 1024;
  const heap = (after.heapUsed - before.heapUsed) / 1024 / 1024;
  const arrayBuffers = (after.arrayBuffers - before.arrayBuffers) / 1024 / 1024;
  return `rss=${rss.toFixed(2)}MB heap=${heap.toFixed(2)}MB arrayBuffers=${arrayBuffers.toFixed(2)}MB`;
}

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function staticRoutes(): Route[] {
  const out: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(['GET', `/api/v1/resource-${i}`, i]);
  }
  return out;
}

function paramRoutes(): Route[] {
  const out: Route[] = [];
  for (let i = 0; i < COUNT; i++) {
    out.push(['GET', `/tenant-${i}/users/:id/posts/:postId`, i]);
  }
  return out;
}

function scenario(): { routes: Route[]; hits: string[]; misses: string[] } {
  if (scenarioName === 'param') {
    return {
      routes: paramRoutes(),
      hits: [
        '/tenant-0/users/42/posts/7',
        '/tenant-50000/users/42/posts/7',
        '/tenant-99999/users/42/posts/7',
      ],
      misses: [
        '/tenant-x/users/42/posts/7',
      ],
    };
  }

  if (scenarioName !== 'static') {
    console.error(`Unknown scenario '${scenarioName}'. Choices: static, param`);
    process.exit(1);
  }

  return {
    routes: staticRoutes(),
    hits: [
      '/api/v1/resource-0',
      '/api/v1/resource-50000',
      '/api/v1/resource-99999',
    ],
    misses: [
      '/api/v1/resource-x',
    ],
  };
}

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < 20_000; i++) fn();

  const start = nowNs();
  let checksum = 0;
  for (let i = 0; i < ITER; i++) {
    const result = fn();
    if (result !== undefined && result !== null) checksum++;
  }
  const ns = Number(nowNs() - start) / ITER;
  console.log(`${name.padEnd(28)} ${ns.toFixed(2)} ns/op checksum=${checksum}`);
}

function measure(name: string, build: (rs: Route[]) => unknown, match: (router: unknown, path: string) => unknown): void {
  const sc = scenario();
  console.log(`baseline=${name} scenario=${scenarioName} routes=${COUNT}`);
  const rs = sc.routes;
  const before = mem();
  const start = performance.now();
  let router: unknown;
  try {
    router = build(rs);
  } catch (error) {
    console.log(`build failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const buildMs = performance.now() - start;
  const after = mem();
  console.log(`build=${buildMs.toFixed(2)}ms mem=${fmtMem(before, after)}`);
  bench('hit first', () => match(router, sc.hits[0]!));
  bench('hit middle', () => match(router, sc.hits[1]!));
  bench('hit last', () => match(router, sc.hits[2]!));
  bench('miss', () => match(router, sc.misses[0]!));
}

const builders: Record<string, () => void> = {
  zipbul: () => measure(
    'zipbul',
    (rs) => {
      const router = new Router<number>();
      for (const [method, path, value] of rs) router.add(method as 'GET', path, value);
      router.build();
      return router;
    },
    (router, path) => (router as Router<number>).match('GET', path),
  ),
  'find-my-way': () => measure(
    'find-my-way',
    (rs) => {
      const router = FindMyWay();
      for (const [method, path, value] of rs) router.on(method as 'GET', path, () => value);
      return router;
    },
    (router, path) => (router as ReturnType<typeof FindMyWay>).find('GET', path),
  ),
  memoirist: () => measure(
    'memoirist',
    (rs) => {
      const router = new Memoirist<number>();
      for (const [method, path, value] of rs) router.add(method, path, value);
      return router;
    },
    (router, path) => (router as Memoirist<number>).find('GET', path),
  ),
  rou3: () => measure(
    'rou3',
    (rs) => {
      const router = createRou3<number>();
      for (const [method, path, value] of rs) addRoute(router, method, path, value);
      return router;
    },
    (router, path) => findRoute(router as ReturnType<typeof createRou3<number>>, 'GET', path),
  ),
  'hono-trie': () => measure(
    'hono-trie',
    (rs) => {
      const router = new TrieRouter<number>();
      for (const [method, path, value] of rs) router.add(method, path, value);
      return router;
    },
    (router, path) => {
      const result = (router as TrieRouter<number>).match('GET', path) as unknown as [unknown[]];
      return result[0].length > 0 ? result : null;
    },
  ),
  'hono-regexp': () => measure(
    'hono-regexp',
    (rs) => {
      const router = new RegExpRouter<number>();
      for (const [method, path, value] of rs) router.add(method, path, value);
      return router;
    },
    (router, path) => {
      const result = (router as RegExpRouter<number>).match('GET', path) as unknown as [unknown[]];
      return result[0].length > 0 ? result : null;
    },
  ),
  'koa-tree-router': () => measure(
    'koa-tree-router',
    (rs) => {
      const router = new KoaTreeRouter() as any;
      for (const [method, path, value] of rs) router.on(method, path, () => value);
      return router;
    },
    (router, path) => {
      const result = (router as any).find('GET', path);
      return result.handle === null ? null : result;
    },
  ),
};

const run = builders[target];
if (run === undefined) {
  console.error(`Unknown baseline '${target}'. Choices: ${Object.keys(builders).join(', ')}`);
  process.exit(1);
}

console.log(`bun=${typeof Bun !== 'undefined' ? Bun.version : 'n/a'} node=${process.version} platform=${process.platform} arch=${process.arch}`);
run();
