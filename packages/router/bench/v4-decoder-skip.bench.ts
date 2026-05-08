/**
 * V4: decoder skip when tester=null.
 *
 * Scenario: segment-walk.ts:323 calls decoder(seg). For no-percent input,
 * decoder does `seg.includes('%')` then returns raw seg.
 *   - baseline: var decoded = decoder(seg)
 *   - proposed: skip decoder when tester=null
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

// Random ASCII 8-char param values (no '%')
const N = 1024;
const SEGS: string[] = new Array(N);
{
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  let seed = 12345;
  for (let i = 0; i < N; i++) {
    let s = '';
    for (let j = 0; j < 8; j++) {
      seed = (seed * 1664525 + 1013904223) | 0;
      s += charset[(seed >>> 0) % charset.length];
    }
    SEGS[i] = s;
  }
}

function decoder(seg: string): string {
  if (seg.indexOf('%') === -1) return seg;
  return decodeURIComponent(seg);
}

let cursor = 0;

summary(() => {
  bench('V4 baseline: decoder(seg) (always called)', () => {
    const seg = SEGS[cursor++ & (N - 1)];
    const decoded = decoder(seg);
    do_not_optimize(decoded);
  });
  bench('V4 proposed: skip decoder (tester=null)', () => {
    const seg = SEGS[cursor++ & (N - 1)];
    // tester=null branch: no decode, raw seg passes through
    do_not_optimize(seg);
  });
});

await run();
