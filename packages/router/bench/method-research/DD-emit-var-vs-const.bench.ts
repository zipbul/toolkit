/**
 * DD) Compare `var` vs `const`/`let` in JIT-compiled match function
 * source. JSC may treat them identically, may not.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';

const PATHS = ['/api/users/42', '/api/posts/100', '/api/orders/7'];

function makeWalkerVar(): (path: string) => number {
  return new Function('path', `
    'use strict';
    var len = path.length;
    var pos = 1;
    var slash1 = path.indexOf('/', pos);
    var seg1End = slash1 === -1 ? len : slash1;
    var seg1 = path.substring(pos, seg1End);
    if (seg1 !== 'api') return -1;
    pos = seg1End + 1;
    var slash2 = path.indexOf('/', pos);
    var seg2End = slash2 === -1 ? len : slash2;
    var seg2 = path.substring(pos, seg2End);
    if (seg2 === 'users') return 1;
    if (seg2 === 'posts') return 2;
    if (seg2 === 'orders') return 3;
    return -1;
  `) as (path: string) => number;
}

function makeWalkerConst(): (path: string) => number {
  return new Function('path', `
    'use strict';
    const len = path.length;
    let pos = 1;
    const slash1 = path.indexOf('/', pos);
    const seg1End = slash1 === -1 ? len : slash1;
    const seg1 = path.substring(pos, seg1End);
    if (seg1 !== 'api') return -1;
    pos = seg1End + 1;
    const slash2 = path.indexOf('/', pos);
    const seg2End = slash2 === -1 ? len : slash2;
    const seg2 = path.substring(pos, seg2End);
    if (seg2 === 'users') return 1;
    if (seg2 === 'posts') return 2;
    if (seg2 === 'orders') return 3;
    return -1;
  `) as (path: string) => number;
}

async function main() {
  const v = makeWalkerVar();
  const c = makeWalkerConst();
  // sanity
  for (const p of PATHS) if (v(p) !== c(p)) console.warn('disagree on', p);

  console.log('=== var vs const/let in emitted matchers ===');
  summary(() => {
    bench('var (current)', () => {
      let s = 0;
      for (let i = 0; i < 1024; i++) s += v(PATHS[i % PATHS.length]!);
      do_not_optimize(s);
    });
    bench('const/let', () => {
      let s = 0;
      for (let i = 0; i < 1024; i++) s += c(PATHS[i % PATHS.length]!);
      do_not_optimize(s);
    });
  });
  await run();
}

main();
