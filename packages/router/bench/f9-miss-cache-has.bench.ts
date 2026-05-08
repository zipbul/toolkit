/**
 * F9: miss-cache `has()` cost on every match.
 *
 * Current emitter.ts:238:
 *   var ms = missCacheByMethod[mc];
 *   if (ms !== undefined && ms.has(sp)) return null;
 *
 * Variants:
 *   A: with miss-cache check (current)
 *   B: no miss-cache check
 *
 * Sweeps: miss-cache 0%/50%/100% full with the queried path NOT a member
 * (i.e., common case: miss cache is "small relative to traffic").
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

class RouterMissCache {
  private readonly index: Map<string, number> = new Map();
  private readonly keys: Array<string | undefined>;
  private readonly capacity: number;
  private hand = 0;
  private count = 0;
  constructor(maxSize = 1000) {
    this.capacity = 1 << 10;
    this.keys = new Array(this.capacity);
    void maxSize;
  }
  has(key: string): boolean { return this.index.has(key); }
  add(key: string): void {
    if (this.index.has(key)) return;
    let slot: number;
    if (this.count < this.capacity) slot = this.count++;
    else { slot = this.hand; const old = this.keys[slot]; if (old !== undefined) this.index.delete(old); this.hand = (this.hand + 1) & (this.capacity - 1); }
    this.keys[slot] = key; this.index.set(key, slot);
  }
}

const MS_EMPTY = new RouterMissCache(1000);
const MS_HALF = new RouterMissCache(1000);
for (let i = 0; i < 500; i++) MS_HALF.add(`/junk/path/${i}`);
const MS_FULL = new RouterMissCache(1000);
for (let i = 0; i < 1000; i++) MS_FULL.add(`/junk/path/${i}`);

const SP = '/api/v1/users/42';

function variantA(ms: RouterMissCache | undefined, sp: string): number {
  if (ms !== undefined && ms.has(sp)) return -1;
  return sp.charCodeAt(0); // sentinel
}
function variantB(_ms: RouterMissCache | undefined, sp: string): number {
  return sp.charCodeAt(0);
}

const CASES: Array<[string, RouterMissCache]> = [
  ['empty', MS_EMPTY],
  ['half', MS_HALF],
  ['full', MS_FULL],
];

for (const [label, ms] of CASES) {
  summary(() => {
    bench(`F9 ${label}: A with has()`, () => {
      do_not_optimize(variantA(ms, SP));
    });
    bench(`F9 ${label}: B no check`, () => {
      do_not_optimize(variantB(ms, SP));
    });
  });
}

// undefined-miss-cache case (cold)
summary(() => {
  bench('F9 undef: A with check (ms=undefined)', () => {
    do_not_optimize(variantA(undefined, SP));
  });
  bench('F9 undef: B no check', () => {
    do_not_optimize(variantB(undefined, SP));
  });
});

await run();
