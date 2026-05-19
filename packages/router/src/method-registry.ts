import type { Result } from '@zipbul/result';

import { err, isErr } from '@zipbul/result';

import type { RouterErrorData } from './types';

import { validateMethodToken } from './builder';
import { RouterErrorKind } from './types';

const DEFAULT_METHODS: ReadonlyArray<readonly [string, number]> = [
  ['GET', 0],
  ['POST', 1],
  ['PUT', 2],
  ['PATCH', 3],
  ['DELETE', 4],
  ['OPTIONS', 5],
  ['HEAD', 6],
] as const;

/**
 * Method-code upper bound. Imposed by `staticPathMethodMask`'s 32-bit Int
 * representation: ECMAScript bitwise ops force operands through ToInt32
 * (ECMA-262 §7.1.7), so `1 << methodCode` for `code ≥ 32` would silently
 * collide with lower bits. BigInt would lift the cap but cost a hot-path
 * boxed-Number per mask op. IANA's HTTP Method Registry (~40 methods, longest
 * `UPDATEREDIRECTREF`) means a tight WebDAV/CalDAV registry plus the 7
 * defaults can approach this; 32 covers ≥99% of real-world routers.
 */
const MAX_METHODS = 32;

interface MethodRegistrySnapshot {
  entries: Array<readonly [string, number]>;
  nextOffset: number;
}

export class MethodRegistry {
  /**
   * Single source of truth: prototype-less Record. Method-name strings
   * ("GET", "POST", …) are non-integer keys, so by ECMA-262 §10.1.11.1
   * (OrdinaryOwnPropertyKeys) a `for…in` walk yields them in insertion
   * order — no parallel `Map` needed. `Object.create(null)` keeps lookup
   * off the `Object.prototype` walk so hot-path access is one IC slot.
   * Measured Map+Record vs Record-only: construction 4.7×, iteration 1.5×,
   * lookup unchanged (within noise) — see `bench/method-research/`.
   *
   * Mutable (not `readonly`) because `restore()` swaps in a fresh
   * Object.create(null) — `delete`-then-reinsert was demonstrated by
   * `bench/method-research/I-restore-dictionary-fix.bench.ts` to push
   * the codeMap into JSC's `UncacheableDictionary` mode after ~10 cycles
   * (StructureID changes, IC chain forks); the swap keeps every fresh
   * registry on the same PropertyAddition chain and makes restore()
   * itself 17.8× faster (1.02µs → 57ns).
   */
  private codeMap: Record<string, number> = Object.create(null) as Record<string, number>;
  private nextOffset: number;
  private codeCount = 0;

  constructor() {
    for (const [method, offset] of DEFAULT_METHODS) {
      this.codeMap[method] = offset;
      this.codeCount++;
    }
    this.nextOffset = DEFAULT_METHODS.length;
  }

  getOrCreate(method: string): Result<number, RouterErrorData> {
    // Lookup-first fast path: only entries that *passed* validation are
    // ever inserted into `codeMap`, so a hit here means the token is
    // already known-valid — skip the per-call tchar walk. Bench
    // `bench/method-research/H-validate-cache.bench.ts` shows 4.43× win
    // at 100k repeated add()s of the same 5 methods.
    const existing = this.codeMap[method];
    if (existing !== undefined) {
      return existing;
    }

    const tokenCheck = validateMethodToken(method);
    if (isErr(tokenCheck)) {
      return tokenCheck;
    }

    if (this.nextOffset >= MAX_METHODS) {
      return err({
        kind: RouterErrorKind.MethodLimit,
        message: `Maximum of ${MAX_METHODS} HTTP methods exceeded. Cannot register method '${method}'.`,
        method,
        suggestion: `Reduce the number of distinct HTTP methods in this router (limit is ${MAX_METHODS}) or split routes across multiple Router instances.`,
      });
    }

    const offset = this.nextOffset++;
    this.codeMap[method] = offset;
    this.codeCount++;
    return offset;
  }

  /**
   * Lookup a method's code or `undefined` if absent. Production code uses
   * `getOrCreate()` (which adds the method on first sight); `get()` is the
   * read-only counterpart used by regression tests to assert codeMap state.
   */
  get(method: string): number | undefined {
    return this.codeMap[method];
  }

  get size(): number {
    return this.codeCount;
  }

  /**
   * Snapshot of `[name, code]` pairs in registration order. Backed by
   * `for…in` over `codeMap` — relies on ECMA-262 §10.1.11.1 insertion-order
   * guarantee for non-integer string keys (HTTP method names always start
   * with ALPHA, so they are never array-index-coerced). Returns a freshly
   * materialized array so callers may iterate it multiple times within a
   * single `build()` (build pipeline walks it twice — once for trees,
   * once for activeMethodCodes filtering).
   */
  getAllCodes(): ReadonlyArray<readonly [string, number]> {
    const out: Array<readonly [string, number]> = [];
    for (const k in this.codeMap) {
      out.push([k, this.codeMap[k]!] as const);
    }
    return out;
  }

  /**
   * Hot-path lookup table — the same prototype-less Record the registry
   * stores internally. Callers must not freeze or mutate it (router
   * consumes it as a closure-captured matchImpl input; freeze would tank
   * JSC inline caches per F22 partition).
   */
  getCodeMap(): Readonly<Record<string, number>> {
    return this.codeMap;
  }

  snapshot(): MethodRegistrySnapshot {
    const entries: Array<readonly [string, number]> = [];
    for (const k in this.codeMap) {
      entries.push([k, this.codeMap[k]!]);
    }
    return { entries, nextOffset: this.nextOffset };
  }

  restore(snapshot: MethodRegistrySnapshot): void {
    // Swap in a fresh prototype-less object instead of `delete`-ing keys.
    // The delete approach demoted the codeMap to UncacheableDictionary
    // after ~10 cycles (see bench I); a fresh swap keeps it on the
    // PropertyAddition chain and is 17.8× faster (1.02µs → 57ns).
    const fresh = Object.create(null) as Record<string, number>;
    let count = 0;
    for (const [method, offset] of snapshot.entries) {
      fresh[method] = offset;
      count++;
    }
    this.codeMap = fresh;
    this.codeCount = count;
    this.nextOffset = snapshot.nextOffset;
  }
}
