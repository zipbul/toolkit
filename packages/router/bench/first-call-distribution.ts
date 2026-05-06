/* D — first-call latency distribution (100 fresh compiles per node count) */
/* eslint-disable no-console */

function makeSource(nodes: number): string {
  let body = 'return function match(url, state) { state.paramCount = 0;';
  for (let i = 0; i < nodes; i++) {
    body += `if (url === '/route/${i}') { state.handlerIndex = ${i}; return true; }`;
  }
  body += 'return false; };';
  return body;
}

function pct(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

function probe(nodes: number, samples = 100): void {
  const src = makeSource(nodes);
  const firstNs: number[] = [];
  const secondNs: number[] = [];
  const tenthNs: number[] = [];

  for (let s = 0; s < samples; s++) {
    const fn = new Function(src)() as (url: string, state: { paramCount: number; handlerIndex: number }) => boolean;
    const state = { paramCount: 0, handlerIndex: -1 };

    const t0 = Bun.nanoseconds();
    fn(`/route/${nodes - 1}`, state);
    const t1 = Bun.nanoseconds();
    firstNs.push(t1 - t0);

    const t2 = Bun.nanoseconds();
    fn(`/route/${nodes - 1}`, state);
    const t3 = Bun.nanoseconds();
    secondNs.push(t3 - t2);

    for (let i = 0; i < 7; i++) fn(`/route/${nodes - 1}`, state);
    const t4 = Bun.nanoseconds();
    fn(`/route/${nodes - 1}`, state);
    const t5 = Bun.nanoseconds();
    tenthNs.push(t5 - t4);
  }

  const fmt = (a: number[]): string =>
    `med=${pct(a, 50).toFixed(0)}ns p75=${pct(a, 75).toFixed(0)}ns p99=${pct(a, 99).toFixed(0)}ns max=${Math.max(...a).toFixed(0)}ns`;

  console.log(`${nodes.toString().padStart(5)} nodes`);
  console.log('  first call: ' + fmt(firstNs));
  console.log('  second call:' + fmt(secondNs));
  console.log('  10th call:  ' + fmt(tenthNs));
}

probe(16);
probe(64);
probe(256);
probe(1024);
