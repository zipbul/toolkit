import { run, bench } from 'mitata';

const NODE_COUNT = 100000;

// 1. Current: JS Objects
function currentStrategy() {
  const nodes = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    nodes.push({
      store: i,
      staticChildren: null,
      paramChild: null,
      wildcardStore: null,
      wildcardName: null,
      wildcardOrigin: null
    });
  }
  return nodes;
}

// 2. Proposed: Flat Int32Array (32 bytes per node)
function flatStrategy() {
  return new Int32Array(NODE_COUNT * 8);
}

// 3. Ultimate: Bit-packed Int32Array (12 bytes per node)
function ultimateStrategy() {
  return new Int32Array(NODE_COUNT * 3);
}

// Memory measurement helper
const getMem = () => {
  if (globalThis.Bun) Bun.gc(true);
  return process.memoryUsage().heapUsed;
};

console.log('--- Memory Fact Check (100,000 nodes) ---');

const base = getMem();
const currentNodes = currentStrategy();
const currentMem = getMem() - base;
console.log('1. Current (Objects):    ' + (currentMem / 1024 / 1024).toFixed(2) + ' MB');

const base2 = getMem();
const flatNodes = flatStrategy();
const flatMem = getMem() - base2;
console.log('2. Flat (32B/node):     ' + (flatMem / 1024 / 1024).toFixed(2) + ' MB');

const base3 = getMem();
const ultimateNodes = ultimateStrategy();
const ultimateMem = getMem() - base3;
console.log('3. Ultimate (12B/node): ' + (ultimateMem / 1024 / 1024).toFixed(2) + ' MB');

console.log('\n--- Traversal Speed Check ---');

// Mock Traversal
const targetIdx = NODE_COUNT - 1;

bench('Current Object Traversal', () => {
  let curr = currentNodes[0];
  for(let i=0; i < 100; i++) {
    // Simulating deep walk
    curr = currentNodes[i];
    if (curr.store === targetIdx) break;
  }
});

bench('Ultimate Buffer Traversal', () => {
  const buf = ultimateNodes;
  let curr = 0;
  for(let i=0; i < 100; i++) {
    // Simulating deep walk via offset
    curr = i * 3;
    const store = buf[curr];
    if (store === targetIdx) break;
  }
});

await run();
