/**
 * P) `url.indexOf('/', pos)` is called once per segment in the walker.
 * Test alternatives:
 *   1. current — `url.indexOf('/', pos)`
 *   2. charCode loop — `for (let i = pos; i < len; i++) if (url.charCodeAt(i) === 47) break`
 *   3. precomputed — single pass at start to record all slash offsets
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

const PATHS = [
  '/',                                    // 1 seg
  '/foo',                                 // 2
  '/foo/bar',                             // 3
  '/foo/bar/baz',                         // 4
  '/api/v1/users/12345/orders/678/items', // 7
  '/' + 'seg/'.repeat(15) + 'last',       // 16
  '/' + 'seg/'.repeat(31) + 'last',       // 32
];

const SLASH = 47;

function indexOfWalk(url: string): number {
  const len = url.length;
  let pos = 1;
  let count = 0;
  while (pos < len) {
    const next = url.indexOf('/', pos);
    const end = next === -1 ? len : next;
    count += end - pos;
    pos = end === len ? len : end + 1;
  }
  return count;
}

function charCodeWalk(url: string): number {
  const len = url.length;
  let pos = 1;
  let count = 0;
  while (pos < len) {
    let end = pos;
    while (end < len && url.charCodeAt(end) !== SLASH) end++;
    count += end - pos;
    pos = end === len ? len : end + 1;
  }
  return count;
}

function precomputedWalk(url: string, scratch: Int32Array): number {
  const len = url.length;
  let nSlashes = 0;
  for (let i = 0; i < len; i++) {
    if (url.charCodeAt(i) === SLASH) {
      scratch[nSlashes++] = i;
    }
  }
  let count = 0;
  let pos = 1;
  for (let s = 1; s <= nSlashes; s++) {
    const end = s < nSlashes ? scratch[s]! : len;
    count += end - pos;
    pos = end === len ? len : end + 1;
  }
  return count;
}

async function main() {
  const N = 1000;
  const scratch = new Int32Array(64);

  for (const path of PATHS) {
    console.log(`\n=== "${path.length > 40 ? path.slice(0, 30) + '…' : path}" (${path.length} chars) ===`);
    summary(() => {
      bench('indexOf (current)', () => {
        let s = 0;
        for (let i = 0; i < N; i++) s += indexOfWalk(path);
        do_not_optimize(s);
      });
      bench('charCodeAt loop', () => {
        let s = 0;
        for (let i = 0; i < N; i++) s += charCodeWalk(path);
        do_not_optimize(s);
      });
      bench('precomputed slash offsets', () => {
        let s = 0;
        for (let i = 0; i < N; i++) s += precomputedWalk(path, scratch);
        do_not_optimize(s);
      });
    });
  }

  await run();
}

main();
