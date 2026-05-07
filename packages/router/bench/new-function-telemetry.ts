/* §14.5 line 2171: new Function compile time / first-call latency / code-cache pressure proxy */
/* eslint-disable no-console */
export {};

function makeSource(nodes: number): string {
  let body = 'return function match(url, state) { state.paramCount = 0;';
  for (let i = 0; i < nodes; i++) {
    body += `if (url === '/route/${i}') { state.handlerIndex = ${i}; return true; }`;
  }
  body += 'return false; };';
  return body;
}

function probe(label: string, nodes: number): void {
  const src = makeSource(nodes);
  const srcBytes = src.length;

  const tCompile0 = Bun.nanoseconds();
  const fn = new Function(src)() as (url: string, state: { paramCount: number; handlerIndex: number }) => boolean;
  const tCompile1 = Bun.nanoseconds();
  const compileMs = (tCompile1 - tCompile0) / 1_000_000;

  const state = { paramCount: 0, handlerIndex: -1 };
  const tFirst0 = Bun.nanoseconds();
  fn(`/route/${nodes - 1}`, state);
  const tFirst1 = Bun.nanoseconds();
  const firstNs = tFirst1 - tFirst0;

  // warmed
  for (let i = 0; i < 100_000; i++) fn(`/route/${i % nodes}`, state);
  const ITERS = 1_000_000;
  const tWarm0 = Bun.nanoseconds();
  for (let i = 0; i < ITERS; i++) fn(`/route/${i % nodes}`, state);
  const tWarm1 = Bun.nanoseconds();
  const warmNs = (tWarm1 - tWarm0) / ITERS;

  console.log(
    label.padEnd(20),
    'src=' + (srcBytes / 1024).toFixed(1) + 'KiB',
    'compile=' + compileMs.toFixed(2) + 'ms',
    'first=' + firstNs + 'ns',
    'warm=' + warmNs.toFixed(2) + 'ns/op'
  );
}

probe('  16 nodes', 16);
probe('  64 nodes', 64);
probe(' 256 nodes', 256);
probe('1024 nodes', 1024);
probe('4096 nodes', 4096);

// RSS delta after compiling N functions of fixed size (code-cache pressure proxy)
const baseRss = process.memoryUsage().rss;
const compiled: Function[] = [];
for (let i = 0; i < 200; i++) {
  const src = makeSource(64);
  compiled.push(new Function(src)());
}
const afterRss = process.memoryUsage().rss;
console.log('200 compiled fns of 64 nodes — RSS delta', ((afterRss - baseRss) / 1024).toFixed(0), 'KiB',
  '(', ((afterRss - baseRss) / 200 / 1024).toFixed(2), 'KiB/fn)');
