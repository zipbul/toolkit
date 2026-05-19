import FindMyWay from 'find-my-way';
import { TrieRouter } from 'hono/router/trie-router';
import KoaTreeRouter from 'koa-tree-router';
import { Memoirist } from 'memoirist';
import { performance } from 'node:perf_hooks';
import { addRoute, createRouter as createRou3, findRoute } from 'rou3';

import { Router } from '../src/router';
import { printEnv } from './helpers';

printEnv();

type Probe = {
  method: string;
  path: string;
  expect: { kind: 'no-match' } | { kind: 'match'; value: number; params?: Record<string, string> };
};

type Adapter = {
  name: string;
  build: (routes: Array<[string, string, number]>) => any;
  match: (router: any, method: string, path: string) => null | { value: any; params?: any };
};

const adapters: Adapter[] = [
  {
    name: 'zipbul',
    build: rs => {
      const r = new Router<number>();
      for (const [m, p, v] of rs) {
        r.add(m as any, p, v);
      }
      r.build();
      return r;
    },
    match: (r, m, p) => {
      const out = r.match(m, p);
      return out === null ? null : { value: out.value, params: out.params };
    },
  },
  {
    name: 'find-my-way',
    build: rs => {
      const r = FindMyWay({ ignoreTrailingSlash: true });
      for (const [m, p, v] of rs) {
        r.on(m as any, p as string, () => v, v as any);
      }
      return r;
    },
    match: (r, m, p) => {
      const out = r.find(m as any, p);
      if (out === null) {
        return null;
      }
      return { value: out.store as number, params: out.params };
    },
  },
  {
    name: 'rou3',
    build: rs => {
      const r = createRou3<number>();
      for (const [m, p, v] of rs) {
        const path = p.replace(/\*([a-zA-Z_][a-zA-Z0-9_]*)/g, '**:$1');
        addRoute(r, m, path, v);
      }
      return r;
    },
    match: (r, m, p) => {
      const out = findRoute(r, m, p);
      if (out === undefined) {
        return null;
      }
      return { value: out.data!, params: out.params };
    },
  },
  {
    name: 'memoirist',
    build: rs => {
      const r = new Memoirist<number>();
      for (const [m, p, v] of rs) {
        r.add(m, p, v);
      }
      return r;
    },
    match: (r, m, p) => {
      const out = r.find(m, p);
      if (out === null) {
        return null;
      }
      return { value: out.store, params: out.params };
    },
  },
  {
    name: 'koa-tree-router',
    build: rs => {
      const r = new KoaTreeRouter() as any;
      for (const [m, p, v] of rs) {
        r.on(m, p, () => v, { v });
      }
      return r;
    },
    match: (r, m, p) => {
      const out = r.find(m, p);
      if (out === null || out.handle === null) {
        return null;
      }
      const params: Record<string, string> = {};
      if (out.params) {
        for (const { key, value } of out.params) {
          params[key] = value;
        }
      }
      return { value: undefined, params };
    },
  },
  {
    name: 'hono-trie',
    build: rs => {
      const r = new TrieRouter<number>();
      for (const [m, p, v] of rs) {
        r.add(m, p, v);
      }
      return r;
    },
    match: (r, m, p) => {
      const result = r.match(m, p) as any;
      if (!result || !result[0] || result[0].length === 0) {
        return null;
      }
      const handlerEntry = result[0][0];
      const value = handlerEntry[0] as number;
      const paramIdxMap = handlerEntry[1] as Record<string, number>;
      const paramArr = result[1] as any;
      const params: Record<string, string> = {};
      if (paramIdxMap && paramArr) {
        for (const [k, idx] of Object.entries(paramIdxMap)) {
          if (paramArr[idx] !== undefined) {
            params[k] = paramArr[idx] as string;
          }
        }
      }
      return { value, params };
    },
  },
];

function deepEqualParams(a: Record<string, any> | undefined, b: Record<string, any> | undefined): boolean {
  if (a === undefined && b === undefined) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) {
    return false;
  }
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) {
      return false;
    }
    if (a[ak[i]!] !== b[ak[i]!]) {
      return false;
    }
  }
  return true;
}

function runScenario(scenarioName: string, routes: Array<[string, string, number]>, probes: Probe[]): void {
  console.log(`\n=== scenario: ${scenarioName} (routes=${routes.length}, probes=${probes.length}) ===`);
  for (const a of adapters) {
    let r: any;
    const buildStart = performance.now();
    try {
      r = a.build(routes);
    } catch (e) {
      console.log(`  ${a.name.padEnd(18)}: BUILD-FAIL (${(e as Error).message.slice(0, 60)})`);
      continue;
    }
    const buildMs = performance.now() - buildStart;

    let pass = 0,
      fail = 0;
    const fails: string[] = [];
    for (const probe of probes) {
      let res: any;
      try {
        res = a.match(r, probe.method, probe.path);
      } catch (e) {
        fail++;
        fails.push(`${probe.method} ${probe.path} → THROW (${(e as Error).message.slice(0, 30)})`);
        continue;
      }
      if (probe.expect.kind === 'no-match') {
        if (res === null) {
          pass++;
        } else {
          fail++;
          fails.push(`${probe.method} ${probe.path} → expected no-match, got ${JSON.stringify(res).slice(0, 60)}`);
        }
      } else {
        if (res === null) {
          fail++;
          fails.push(`${probe.method} ${probe.path} → expected match, got null`);
          continue;
        }
        const valueMatches = a.name === 'koa-tree-router' ? true : res.value === probe.expect.value;
        const paramsMatch = deepEqualParams(res.params as any, probe.expect.params);
        if (valueMatches && paramsMatch) {
          pass++;
        } else {
          fail++;
          fails.push(
            `${probe.method} ${probe.path} → value=${res.value}, params=${JSON.stringify(res.params)} (expected ${probe.expect.value}, ${JSON.stringify(probe.expect.params)})`,
          );
        }
      }
    }
    console.log(`  ${a.name.padEnd(18)}: build=${buildMs.toFixed(1)}ms  ${pass}/${probes.length} pass  ${fail} fail`);
    for (const f of fails.slice(0, 3)) {
      console.log(`     ✗ ${f}`);
    }
    if (fails.length > 3) {
      console.log(`     ... +${fails.length - 3} more`);
    }
  }
}

const staticRoutes: Array<[string, string, number]> = [];
for (let i = 0; i < 1000; i++) {
  staticRoutes.push(['GET', `/api/v1/resource-${i}`, i]);
}

runScenario('static-1k', staticRoutes, [
  { method: 'GET', path: '/api/v1/resource-0', expect: { kind: 'match', value: 0, params: {} } },
  { method: 'GET', path: '/api/v1/resource-500', expect: { kind: 'match', value: 500, params: {} } },
  { method: 'GET', path: '/api/v1/resource-999', expect: { kind: 'match', value: 999, params: {} } },
  { method: 'GET', path: '/api/v1/missing', expect: { kind: 'no-match' } },
  { method: 'POST', path: '/api/v1/resource-0', expect: { kind: 'no-match' } },
]);

const paramRoutes: Array<[string, string, number]> = [];
for (let i = 0; i < 1000; i++) {
  paramRoutes.push(['GET', `/tenant-${i}/users/:user/posts/:post`, i]);
}

runScenario('param-1k', paramRoutes, [
  { method: 'GET', path: '/tenant-0/users/42/posts/7', expect: { kind: 'match', value: 0, params: { user: '42', post: '7' } } },
  {
    method: 'GET',
    path: '/tenant-500/users/abc/posts/xyz',
    expect: { kind: 'match', value: 500, params: { user: 'abc', post: 'xyz' } },
  },
  { method: 'GET', path: '/tenant-999/users/U/posts/P', expect: { kind: 'match', value: 999, params: { user: 'U', post: 'P' } } },
  { method: 'GET', path: '/tenant-x/users/42/posts/7', expect: { kind: 'no-match' } },
]);

const wildcardRoutes: Array<[string, string, number]> = [];
for (let i = 0; i < 100; i++) {
  wildcardRoutes.push(['GET', `/files/group-${i}/*path`, i]);
}

runScenario('wildcard-100', wildcardRoutes, [
  { method: 'GET', path: '/files/group-0/a/b/c.txt', expect: { kind: 'match', value: 0, params: { path: 'a/b/c.txt' } } },
  { method: 'GET', path: '/files/group-50/x.png', expect: { kind: 'match', value: 50, params: { path: 'x.png' } } },
  {
    method: 'GET',
    path: '/files/group-99/deep/nested/path/file.bin',
    expect: { kind: 'match', value: 99, params: { path: 'deep/nested/path/file.bin' } },
  },
]);

runScenario(
  'wrong-method',
  [
    ['GET', '/x', 1],
    ['POST', '/y', 2],
  ],
  [
    { method: 'GET', path: '/x', expect: { kind: 'match', value: 1, params: {} } },
    { method: 'POST', path: '/x', expect: { kind: 'no-match' } },
    { method: 'PATCH', path: '/x', expect: { kind: 'no-match' } },
    { method: 'POST', path: '/y', expect: { kind: 'match', value: 2, params: {} } },
    { method: 'GET', path: '/y', expect: { kind: 'no-match' } },
  ],
);

runScenario(
  'falsy-values',
  [
    ['GET', '/zero', 0],
    ['GET', '/neg', -1],
  ],
  [
    { method: 'GET', path: '/zero', expect: { kind: 'match', value: 0, params: {} } },
    { method: 'GET', path: '/neg', expect: { kind: 'match', value: -1, params: {} } },
  ],
);
