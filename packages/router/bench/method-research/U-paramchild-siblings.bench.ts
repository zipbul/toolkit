/**
 * U) paramChild.nextSibling linked-list iteration cost. The walker
 * (recursive `match`) iterates `head.nextSibling` to try each param
 * candidate. With N siblings, average walks N/2 before hit (or N before
 * miss).
 *
 * Hypothesis: linked list pointer chasing is slower than a pre-built
 * array of siblings, especially when N > 3.
 *
 * Tested for N = 1, 3, 5, 10. The current limit is
 * MAX_REGEX_SIBLINGS_PER_SEGMENT = 32.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

interface ParamLink {
  pattern: string;
  nextSibling: ParamLink | null;
}

interface ParamArrayed {
  patterns: string[];
}

function makeLinked(n: number): ParamLink {
  let head: ParamLink | null = null;
  for (let i = n - 1; i >= 0; i--) {
    head = { pattern: `pattern_${i}`, nextSibling: head };
  }
  return head!;
}

function makeArrayed(n: number): ParamArrayed {
  const ps: string[] = [];
  for (let i = 0; i < n; i++) ps.push(`pattern_${i}`);
  return { patterns: ps };
}

// Walk-and-match: returns the matching index. Simulates testers (always reject
// first N-1, hit last) so we walk the full chain.
function walkLinked(head: ParamLink, target: string): number {
  let p: ParamLink | null = head;
  let i = 0;
  while (p !== null) {
    if (p.pattern === target) return i;
    p = p.nextSibling;
    i++;
  }
  return -1;
}

function walkArrayed(node: ParamArrayed, target: string): number {
  const ps = node.patterns;
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] === target) return i;
  }
  return -1;
}

async function main() {
  for (const n of [1, 3, 5, 10] as const) {
    const linked = makeLinked(n);
    const arrayed = makeArrayed(n);
    const target = `pattern_${n - 1}`; // last → full walk

    console.log(`\n=== ${n} siblings — walk to last match ===`);
    summary(() => {
      bench('linked list walk', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += walkLinked(linked, target);
        do_not_optimize(s);
      });
      bench('array walk', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += walkArrayed(arrayed, target);
        do_not_optimize(s);
      });
    });

    // Hit on first
    const target2 = 'pattern_0';
    console.log(`\n=== ${n} siblings — hit on first ===`);
    summary(() => {
      bench('linked list', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += walkLinked(linked, target2);
        do_not_optimize(s);
      });
      bench('array', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) s += walkArrayed(arrayed, target2);
        do_not_optimize(s);
      });
    });
  }

  await run();
}

main();
