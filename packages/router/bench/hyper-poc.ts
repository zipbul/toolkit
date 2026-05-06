import { bench, run } from "mitata";

const N = 10000;
const targetPath = "/api/v1/users/profile/settings/security/keys/generate";

// 1. Object pointer chasing
interface Node {
  children: Record<string, Node>;
  handler?: number;
}

let root: Node = { children: {} };
let curr = root;
const segs = targetPath.split("/").slice(1);
for (let i = 0; i < segs.length; i++) {
  curr.children[segs[i]] = { children: {} };
  curr = curr.children[segs[i]];
}
curr.handler = 42;

function testObjectWalk(path: string) {
  const parts = path.split("/").slice(1);
  let n = root;
  for (let i = 0; i < parts.length; i++) {
    n = n.children[parts[i]];
    if (!n) return -1;
  }
  return n.handler ?? -1;
}

// 2. TypedArray walk (Simulated flat structure)
// Simplification for benchmark: each node has 1 child, we store the string char codes
const MAX_DEPTH = 30;
const buffer = new Int32Array(MAX_DEPTH * 2); 
// [char_code, next_node_index]
let bufIdx = 0;
for (let i = 1; i < targetPath.length; i++) {
  const c = targetPath.charCodeAt(i);
  if (c !== 47) { // skip slash for this simple test
    buffer[bufIdx * 2] = c;
    buffer[bufIdx * 2 + 1] = i === targetPath.length - 1 ? -42 : bufIdx + 1;
    bufIdx++;
  }
}

function testBufferWalk(path: string) {
  let idx = 0;
  for (let i = 1; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 47) continue;
    
    if (buffer[idx * 2] === c) {
      const next = buffer[idx * 2 + 1];
      if (next === -42) return 42;
      idx = next;
    } else {
      return -1;
    }
  }
  return -1;
}

// 3. JIT Inline Cache
const jitMatch = new Function("path", `
  if (path === "${targetPath}") return 42;
  return -1;
`) as (p: string) => number;


bench("1. Object Walk (String split + Record lookup)", () => {
  testObjectWalk(targetPath);
});

bench("2. Int Buffer Automaton (charCodeAt + Int32Array lookup)", () => {
  testBufferWalk(targetPath);
});

bench("3. JIT Inline Cache (Exact string match)", () => {
  jitMatch(targetPath);
});

await run();
