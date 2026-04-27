import { run, bench, summary, do_not_optimize } from 'mitata';

const decoder = (raw: string): string => {
  if (!raw.includes('%')) return raw;
  try { return decodeURIComponent(raw); } catch { return raw; }
};

const SIZE = 1024;
const samples: string[] = new Array(SIZE);
for (let i = 0; i < SIZE; i++) samples[i] = `item${i}`;
// 5% encoded
for (let i = 0; i < 50; i++) samples[i * 20] = `val%20${i}`;

let cursor = 0;

summary(() => {
  bench('via decoder() — gate-then-call', () => {
    const s = samples[(cursor++) & (SIZE - 1)]!;
    const r = s.indexOf('%') !== -1 ? decoder(s) : s;
    do_not_optimize(r);
  });

  bench('via decoder() — decoder-only', () => {
    const s = samples[(cursor++) & (SIZE - 1)]!;
    const r = decoder(s);
    do_not_optimize(r);
  });

  bench('inline decodeURIComponent — gate-then-call', () => {
    const s = samples[(cursor++) & (SIZE - 1)]!;
    let r = s;
    if (s.indexOf('%') !== -1) { try { r = decodeURIComponent(s); } catch {} }
    do_not_optimize(r);
  });

  bench('inline decodeURIComponent — no gate', () => {
    const s = samples[(cursor++) & (SIZE - 1)]!;
    let r = s;
    try { r = decodeURIComponent(s); } catch {}
    do_not_optimize(r);
  });
});

await run();
