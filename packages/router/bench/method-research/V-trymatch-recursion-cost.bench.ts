/**
 * V) Compare recursive `tryMatchParam` (createSegmentWalker fallback for
 * ambiguous trees) vs an iterative simulation. Measures the JS function-
 * call + closure-scope cost when backtracking through deep param chains.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

interface State { handlerIndex: number; paramCount: number; paramOffsets: Int32Array }
const SLASH = 47;

function makeState(): State { return { handlerIndex: -1, paramCount: 0, paramOffsets: new Int32Array(64) }; }

// Mock node tree: depth D, each level has paramChild that always rejects
// the first N-1 of N siblings, accepts last (forces full walk).
interface Node { paramChildren: Array<{ tester: ((s: string) => boolean) | null; next: Node | null }>; store: number | null }

function makeAmbiguousTree(depth: number, siblings: number): Node {
  let cur: Node | null = { paramChildren: [], store: 99 };
  for (let d = 0; d < depth; d++) {
    const children: Node['paramChildren'] = [];
    for (let s = 0; s < siblings; s++) {
      const accept = s === siblings - 1;
      children.push({ tester: accept ? null : (() => false), next: cur });
    }
    cur = { paramChildren: children, store: null };
  }
  return cur!;
}

// Recursive (current shape)
function matchRecursive(node: Node, path: string, pos: number, state: State): boolean {
  const len = path.length;
  if (pos >= len) {
    if (node.store !== null) { state.handlerIndex = node.store; return true; }
    return false;
  }
  let end = pos;
  while (end < len && path.charCodeAt(end) !== SLASH) end++;

  for (let i = 0; i < node.paramChildren.length; i++) {
    const p = node.paramChildren[i]!;
    if (p.tester !== null && !p.tester(path.substring(pos, end))) continue;
    const mark = state.paramCount;
    const pc = mark * 2;
    state.paramOffsets[pc] = pos;
    state.paramOffsets[pc + 1] = end;
    state.paramCount++;
    if (p.next === null) {
      if (end === len && node.store === null) {
        // continue, this branch returns at top
      } else if (end === len) {
        state.handlerIndex = node.store ?? -1;
        return true;
      }
      // fall through to backtrack
    } else if (matchRecursive(p.next, path, end === len ? len : end + 1, state)) return true;
    state.paramCount = mark;
  }
  return false;
}

// Iterative simulation with explicit stack
function matchIterative(root: Node, path: string, state: State): boolean {
  const len = path.length;
  interface Frame { node: Node; pos: number; childIdx: number; mark: number }
  const stack: Frame[] = [{ node: root, pos: 1, childIdx: 0, mark: 0 }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.pos >= len) {
      if (top.node.store !== null) { state.handlerIndex = top.node.store; return true; }
      stack.pop();
      continue;
    }
    let end = top.pos;
    while (end < len && path.charCodeAt(end) !== SLASH) end++;
    if (top.childIdx >= top.node.paramChildren.length) {
      state.paramCount = top.mark;
      stack.pop();
      continue;
    }
    const p = top.node.paramChildren[top.childIdx]!;
    top.childIdx++;
    if (p.tester !== null && !p.tester(path.substring(top.pos, end))) continue;
    const mark = state.paramCount;
    const pc = mark * 2;
    state.paramOffsets[pc] = top.pos;
    state.paramOffsets[pc + 1] = end;
    state.paramCount++;
    if (p.next === null) continue;
    stack.push({ node: p.next, pos: end === len ? len : end + 1, childIdx: 0, mark });
  }
  return false;
}

async function main() {
  const state = makeState();
  for (const [depth, siblings] of [[2, 3], [3, 3], [4, 3], [3, 5], [5, 1]] as const) {
    const tree = makeAmbiguousTree(depth, siblings);
    const segs: string[] = [];
    for (let i = 0; i < depth; i++) segs.push('seg' + i);
    const path = '/' + segs.join('/');
    // sanity
    state.paramCount = 0;
    if (!matchRecursive(tree, path, 1, state)) console.warn('recursive miss', depth, siblings);
    state.paramCount = 0;
    if (!matchIterative(tree, path, state)) console.warn('iterative miss', depth, siblings);

    console.log(`\n=== depth=${depth}, siblings=${siblings} ===`);
    summary(() => {
      bench('recursive (current shape)', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) {
          state.paramCount = 0;
          if (matchRecursive(tree, path, 1, state)) s++;
        }
        do_not_optimize(s);
      });
      bench('iterative + explicit stack', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) {
          state.paramCount = 0;
          if (matchIterative(tree, path, state)) s++;
        }
        do_not_optimize(s);
      });
    });
  }
  await run();
}

main();
