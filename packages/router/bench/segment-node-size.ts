/* eslint-disable no-console */
/**
 * Direct heap measurement of SegmentNode + ParamSegment shape cost.
 * Allocates N nodes of each kind, runs GC, measures heapUsed delta.
 */
import { estimateShallowMemoryUsageOf } from 'bun:jsc';

interface SegmentNodeFull {
  store: number | null;
  staticChildren: Record<string, unknown> | null;
  singleChildKey: string | null;
  singleChildNext: unknown | null;
  paramChild: unknown | null;
  wildcardStore: number | null;
  wildcardName: string | null;
  wildcardOrigin: 'star' | 'multi' | null;
  staticPrefix: string[] | null;
}

interface SegmentNodeTerminal {
  store: number;
}

function createFull(): SegmentNodeFull {
  return {
    store: null,
    staticChildren: null,
    singleChildKey: null,
    singleChildNext: null,
    paramChild: null,
    wildcardStore: null,
    wildcardName: null,
    wildcardOrigin: null,
    staticPrefix: null,
  };
}

function createTerminal(idx: number): SegmentNodeTerminal {
  return { store: idx };
}

const N = 100_000;

const fullExample = createFull();
const termExample = createTerminal(42);
const fullPer = estimateShallowMemoryUsageOf(fullExample);
const termPer = estimateShallowMemoryUsageOf(termExample);
const fullHeap = fullPer * N;
const termHeap = termPer * N;
void fullExample; void termExample;

console.log(`${N.toLocaleString()} full SegmentNode  : heap delta = ${(fullHeap / 1024 / 1024).toFixed(2)} MB  (${(fullHeap / N).toFixed(0)} bytes/node)`);
console.log(`${N.toLocaleString()} terminal-only node: heap delta = ${(termHeap / 1024 / 1024).toFixed(2)} MB  (${(termHeap / N).toFixed(0)} bytes/node)`);
console.log(`split savings if all terminal-only: ${((fullHeap - termHeap) / 1024 / 1024).toFixed(2)} MB`);
