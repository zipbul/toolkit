/**
 * F) `seal()`'s `*`-method expansion uses `sealMethods.includes(r.method)`
 * to dedupe — O(n×m) over (pendingRoutes × sealMethods). For 100k routes
 * with 25 unique custom methods that's 2.5M compares. Replace with a Set
 * for O(n+m) and measure the build-time win across realistic shapes.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const DEFAULT_METHODS = [
  'GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD',
] as const;

interface PendingRoute { method: string; path: string; value: string }

function makePendingMixed(n: number, customCount: number): PendingRoute[] {
  // Build n routes whose methods cover the default 7 + customCount unique
  // custom methods, plus a single `*` registration that triggers expansion.
  const customs: string[] = [];
  for (let i = 0; i < customCount; i++) customs.push(`CUSTOM_${i}`);
  const all = [...DEFAULT_METHODS, ...customs];
  const out: PendingRoute[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ method: all[i % all.length]!, path: `/p/${i}`, value: 'h' });
  }
  // One `*` to trigger the expansion path.
  out.push({ method: '*', path: '/wild', value: 'h' });
  return out;
}

function expansionUsingIncludes(pending: PendingRoute[]): PendingRoute[] {
  const sealMethods: string[] = [...DEFAULT_METHODS];
  for (const r of pending) {
    if (r.method !== '*' && !sealMethods.includes(r.method)) {
      sealMethods.push(r.method);
    }
  }
  const expanded: PendingRoute[] = [];
  for (const r of pending) {
    if (r.method === '*') {
      for (const m of sealMethods) expanded.push({ method: m, path: r.path, value: r.value });
    } else {
      expanded.push(r);
    }
  }
  return expanded;
}

function expansionUsingSet(pending: PendingRoute[]): PendingRoute[] {
  const seen = new Set<string>(DEFAULT_METHODS);
  const sealMethods: string[] = [...DEFAULT_METHODS];
  for (const r of pending) {
    if (r.method !== '*' && !seen.has(r.method)) {
      seen.add(r.method);
      sealMethods.push(r.method);
    }
  }
  const expanded: PendingRoute[] = [];
  for (const r of pending) {
    if (r.method === '*') {
      for (const m of sealMethods) expanded.push({ method: m, path: r.path, value: r.value });
    } else {
      expanded.push(r);
    }
  }
  return expanded;
}

async function main() {
  for (const [label, n, customs] of [
    ['10k routes, 0 custom',   10_000, 0],
    ['10k routes, 25 custom',  10_000, 25],
    ['100k routes, 0 custom',  100_000, 0],
    ['100k routes, 25 custom', 100_000, 25],
  ] as const) {
    const pending = makePendingMixed(n, customs);

    // Sanity — both produce the same expansion length.
    const a = expansionUsingIncludes(pending);
    const b = expansionUsingSet(pending);
    if (a.length !== b.length) {
      console.error('!! mismatch on', label);
      process.exit(1);
    }

    console.log(`\n=== ${label} (pending=${pending.length}) ===`);
    summary(() => {
      bench('Array.includes (current)', () => {
        do_not_optimize(expansionUsingIncludes(pending));
      });
      bench('Set.has', () => {
        do_not_optimize(expansionUsingSet(pending));
      });
    });
  }

  await run();
}

main();
