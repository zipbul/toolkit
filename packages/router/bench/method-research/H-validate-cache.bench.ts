/**
 * H) `validateMethodToken` is called every `add()` even when the method
 * is one we've already registered. For the very common pattern:
 *
 *   for (const route of routes) router.add('GET', route.path, h);
 *
 * we re-validate "GET" 100k times — 100k char-by-char tchar loops.
 *
 * Hypothesis: short-circuiting the validation when `codeMap[method]`
 * already has an entry skips the loop entirely.
 *
 * Two questions:
 *   1. Does fast-path-by-known short-circuit win?
 *   2. Does maintaining a separate Set of validated tokens (covering
 *      the case of validate-success-but-method-limit-rejected) help?
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

import { MethodRegistry } from '../../src/method-registry';
import { validateMethodToken } from '../../src/builder/method-policy';
import { isErr } from '@zipbul/result';

const REPEATED_METHODS = ['GET', 'POST', 'GET', 'POST', 'PUT'];
const N = 100_000;

// ── Variant 1: current behavior — validate every call ──
function currentValidateAll(reg: MethodRegistry): number {
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const r = reg.getOrCreate(REPEATED_METHODS[i % REPEATED_METHODS.length]!);
    if (!isErr(r)) acc += r;
  }
  return acc;
}

// ── Variant 2: lookup-first, validate only on miss ──
class FastPathRegistry {
  private readonly codeMap: Record<string, number> = Object.create(null);
  private nextOffset = 0;
  constructor() {
    for (const m of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']) {
      this.codeMap[m] = this.nextOffset++;
    }
  }
  getOrCreate(method: string): number {
    const existing = this.codeMap[method];
    if (existing !== undefined) return existing;
    // Only validate on the cold path.
    const v = validateMethodToken(method);
    if (isErr(v)) return -1;
    if (this.nextOffset >= 32) return -1;
    const o = this.nextOffset++;
    this.codeMap[method] = o;
    return o;
  }
}

function fastPathAll(reg: FastPathRegistry): number {
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const r = reg.getOrCreate(REPEATED_METHODS[i % REPEATED_METHODS.length]!);
    if (r >= 0) acc += r;
  }
  return acc;
}

async function main() {
  const reg1 = new MethodRegistry();
  const reg2 = new FastPathRegistry();

  // Warm.
  currentValidateAll(reg1);
  fastPathAll(reg2);

  console.log(`\n=== ${N} repeated add() calls (5 unique known methods) ===`);
  summary(() => {
    bench('current — validate every call', () => {
      do_not_optimize(currentValidateAll(reg1));
    });
    bench('lookup-first — validate only on cold-path', () => {
      do_not_optimize(fastPathAll(reg2));
    });
  });

  await run();
}

main();
