/**
 * Q) `path.substring(pos, end)` alloc cost in the staticChildren miss
 * path. The walker only allocates substring when the singleChildKey
 * fast-path doesn't fire.
 *
 * Test alternatives:
 *   1. current — substring + Record[seg] lookup
 *   2. avoid alloc when only one static key exists at this node (already
 *      done via singleChildKey fast path)
 *   3. compare against startsWith probes for small static-children sets
 *      (linear scan)
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

// Build prototype-less Record of a few static children.
function buildChildren(keys: ReadonlyArray<string>): Record<string, number> {
  const r = Object.create(null) as Record<string, number>;
  for (let i = 0; i < keys.length; i++) r[keys[i]!] = i + 1;
  return r;
}

const KEYS_2 = ['users', 'posts'];
const KEYS_4 = ['users', 'posts', 'orders', 'items'];
const KEYS_8 = ['users', 'posts', 'orders', 'items', 'products', 'categories', 'reviews', 'tags'];

function lookupSubstring(url: string, pos: number, end: number, children: Record<string, number>): number {
  const seg = url.substring(pos, end);
  return children[seg] ?? -1;
}

function lookupStartsWith(url: string, pos: number, end: number, keysList: string[], values: number[]): number {
  const segLen = end - pos;
  for (let i = 0; i < keysList.length; i++) {
    const k = keysList[i]!;
    if (k.length === segLen && url.startsWith(k, pos)) return values[i]!;
  }
  return -1;
}

async function main() {
  for (const [label, keys] of [
    ['2 children', KEYS_2],
    ['4 children', KEYS_4],
    ['8 children', KEYS_8],
  ] as const) {
    const record = buildChildren(keys);
    const keysList = keys.slice();
    const values = keysList.map((_, i) => i + 1);
    // URL where 'users' is at offset 5 (after '/api/').
    const url = '/api/users/data/and/more';
    const pos = 5;
    const end = 10; // 'users'

    console.log(`\n=== ${label} — hit on first key ('users') ===`);
    summary(() => {
      bench('substring + Record[seg]', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += lookupSubstring(url, pos, end, record);
        do_not_optimize(s);
      });
      bench('linear startsWith scan', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += lookupStartsWith(url, pos, end, keysList, values);
        do_not_optimize(s);
      });
    });

    // Worst case — last key.
    const lastKey = keys[keys.length - 1]!;
    const url2 = '/api/' + lastKey + '/data';
    const pos2 = 5;
    const end2 = pos2 + lastKey.length;

    console.log(`\n=== ${label} — hit on last key ('${lastKey}') ===`);
    summary(() => {
      bench('substring + Record[seg]', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += lookupSubstring(url2, pos2, end2, record);
        do_not_optimize(s);
      });
      bench('linear startsWith scan', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += lookupStartsWith(url2, pos2, end2, keysList, values);
        do_not_optimize(s);
      });
    });
  }

  await run();
}

main();
