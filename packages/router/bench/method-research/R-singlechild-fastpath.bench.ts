/**
 * R) Measure the cost-benefit of the `singleChildKey` fast path. The
 * walker probes:
 *   if (sck !== null && next !== null && sck.length === segLen && url.startsWith(sck, pos))
 *
 * Trade-off: when the node has only one static child, this saves a
 * substring + Record lookup. When the node has multiple static children,
 * the fast path always misses (sck is null), so it costs only a single
 * extra branch (`sck !== null`).
 *
 * Test:
 *   1. node with 1 static child — fast path SHOULD fire
 *   2. node with 5 static children — fast path miss, fall through
 *   3. branch overhead measured separately on a fully-dynamic node
 *      (no static children)
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

interface Node {
  staticChildren: Record<string, Node> | null;
  singleChildKey: string | null;
  singleChildNext: Node | null;
}

function makeLeaf(): Node { return { staticChildren: null, singleChildKey: null, singleChildNext: null }; }

function makeSingleStatic(key: string): Node {
  const child = makeLeaf();
  return {
    staticChildren: Object.assign(Object.create(null), { [key]: child }),
    singleChildKey: key,
    singleChildNext: child,
  };
}

function makeMultiStatic(keys: string[]): Node {
  const children: Record<string, Node> = Object.create(null);
  for (const k of keys) children[k] = makeLeaf();
  return { staticChildren: children, singleChildKey: null, singleChildNext: null };
}

function makeNoStatic(): Node {
  return { staticChildren: null, singleChildKey: null, singleChildNext: null };
}

// Walker variants
function walkWithFastPath(url: string, pos: number, end: number, node: Node): boolean {
  const segLen = end - pos;
  const sck = node.singleChildKey;
  if (sck !== null && node.singleChildNext !== null && sck.length === segLen && url.startsWith(sck, pos)) {
    return true; // fast path hit
  }
  if (node.staticChildren !== null) {
    const seg = url.substring(pos, end);
    return node.staticChildren[seg] !== undefined;
  }
  return false;
}

function walkRecordOnly(url: string, pos: number, end: number, node: Node): boolean {
  if (node.staticChildren !== null) {
    const seg = url.substring(pos, end);
    return node.staticChildren[seg] !== undefined;
  }
  return false;
}

async function main() {
  const single = makeSingleStatic('users');
  const multi = makeMultiStatic(['users','posts','orders','items','products']);
  const none = makeNoStatic();
  const url = '/api/users/data';

  for (const [label, node, pos, end] of [
    ['1 static child — HIT (fast path fires)', single, 5, 10],
    ['1 static child — MISS', single, 5, 8],            // 'use' instead of 'users'
    ['5 static children — HIT (1st)',         multi, 5, 10],
    ['5 static children — HIT (last)',        multi, 5, 13], // 'products' offset
    ['5 static children — MISS',              multi, 5, 8],
    ['no static children (fast path branch)', none, 5, 10],
  ] as const) {
    // Adjust URL for last-key probe.
    const u = label.includes('last') ? '/api/products/data' : url;

    console.log(`\n=== ${label} ===`);
    summary(() => {
      bench('walker with fast path (current)', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) if (walkWithFastPath(u, pos, end, node)) s++;
        do_not_optimize(s);
      });
      bench('walker without fast path', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) if (walkRecordOnly(u, pos, end, node)) s++;
        do_not_optimize(s);
      });
    });
  }

  await run();
}

main();
