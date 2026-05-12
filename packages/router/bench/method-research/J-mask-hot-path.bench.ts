/**
 * J) Isolate `staticPathMethodMask` bit-iteration cost from the rest of
 * `allowedMethods()`. Production currently does:
 *
 *   const mask = (staticPathMethodMask[sp] ?? 0) | 0;
 *   while (mask !== 0) {
 *     const lowest = mask & -mask;
 *     const code = 31 - Math.clz32(lowest);
 *     const name = methodNameByCode[code];
 *     if (name !== undefined) out.push(name);
 *     mask ^= lowest;
 *   }
 *
 * Variants:
 *   1. current (clz32 + lowest-bit iter)
 *   2. for-loop over 0..32 testing `mask & (1 << i)`
 *   3. precomputed `bitNames[mask]` Map<number, readonly string[]>
 *      (for the common case of small distinct mask values)
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

function buildNames(activeMethods: ReadonlyArray<string>): { codeFor: Record<string, number>; nameByCode: string[] } {
  const codeFor: Record<string, number> = Object.create(null);
  const nameByCode: string[] = [];
  for (let i = 0; i < activeMethods.length; i++) {
    codeFor[activeMethods[i]!] = i;
    nameByCode[i] = activeMethods[i]!;
  }
  return { codeFor, nameByCode };
}

function maskFor(activeMethods: ReadonlyArray<string>, registered: ReadonlyArray<string>, codeFor: Record<string, number>): number {
  let mask = 0;
  for (const m of registered) mask |= 1 << codeFor[m]!;
  return mask;
}

function iterClz32(mask: number, names: string[]): string[] {
  const out: string[] = [];
  while (mask !== 0) {
    const lowest = mask & -mask;
    const code = 31 - Math.clz32(lowest);
    const name = names[code];
    if (name !== undefined) out.push(name);
    mask ^= lowest;
  }
  return out;
}

function iterScan(mask: number, names: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 32; i++) {
    if ((mask & (1 << i)) !== 0) {
      const name = names[i];
      if (name !== undefined) out.push(name);
    }
  }
  return out;
}

function buildPrecomputedCache(allActiveMethods: ReadonlyArray<string>, possibleMasks: number[], names: string[]): Map<number, readonly string[]> {
  const cache = new Map<number, readonly string[]>();
  for (const m of possibleMasks) cache.set(m, Object.freeze(iterClz32(m, names)));
  return cache;
}

function iterCache(mask: number, cache: Map<number, readonly string[]>): readonly string[] {
  return cache.get(mask) ?? [];
}

async function main() {
  // Mix scenarios.
  for (const [label, activeCount, registeredPerPath] of [
    ['7 active, 4 registered/path',  7,  4],
    ['7 active, 7 registered/path',  7,  7],
    ['16 active, 8 registered/path', 16, 8],
  ] as const) {
    const active = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD','TRACE','CONNECT','PROPFIND','MKCOL','COPY','MOVE','LOCK','UNLOCK','REPORT'].slice(0, activeCount);
    const { codeFor, nameByCode } = buildNames(active);
    const registered = active.slice(0, registeredPerPath);
    const mask = maskFor(active, registered, codeFor);

    // Precompute cache for all observed masks (we only test one mask
    // per scenario but include the cache cost separately).
    const cache = buildPrecomputedCache(active, [mask], nameByCode);

    const N = 1024;
    console.log(`\n=== ${label} (mask=0b${mask.toString(2)}) ===`);
    summary(() => {
      bench('current — clz32 + lowest-bit iter', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += iterClz32(mask, nameByCode).length;
        do_not_optimize(acc);
      });
      bench('scan — for i 0..32', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += iterScan(mask, nameByCode).length;
        do_not_optimize(acc);
      });
      bench('precomputed cache', () => {
        let acc = 0;
        for (let i = 0; i < N; i++) acc += iterCache(mask, cache).length;
        do_not_optimize(acc);
      });
    });
  }

  await run();
}

main();
