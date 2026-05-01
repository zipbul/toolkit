import { run, bench } from 'mitata';

const url = '/api/v1/users/12345/posts/67890/comments/active';
const parts = [
  { start: 8, end: 13 }, // 12345
  { start: 20, end: 25 }, // 67890
  { start: 35, end: 41 }  // active
];

// 1. 할당 방식: 매칭 단계마다 substring() 수행 (현재 우리 방식)
function useAllocation() {
  const params = [];
  for (let i = 0; i < parts.length; i++) {
    params.push(url.substring(parts[i].start, parts[i].end));
  }
  return params;
}

// 2. 오프셋 방식: 인덱스만 저장하고 마지막에 한 번만 할당 (개선 방향)
const offsetBuffer = new Int32Array(6); // [start0, end0, start1, end1, ...]
function useOffsets() {
  for (let i = 0; i < parts.length; i++) {
    offsetBuffer[i * 2] = parts[i].start;
    offsetBuffer[i * 2 + 1] = parts[i].end;
  }
  
  // 성공 시에만 materialization
  const params = [];
  for (let i = 0; i < parts.length; i++) {
    params.push(url.substring(offsetBuffer[i * 2], offsetBuffer[i * 2 + 1]));
  }
  return params;
}

// 3. 404 Case: 할당 방식 (실패해도 이미 substring은 수행됨)
function failAllocation() {
  const p1 = url.substring(8, 13);
  const p2 = url.substring(20, 25);
  return null; // 결국 매칭 실패
}

// 4. 404 Case: 오프셋 방식 (실패 시 할당 0)
function failOffsets() {
  offsetBuffer[0] = 8;
  offsetBuffer[1] = 13;
  offsetBuffer[2] = 20;
  offsetBuffer[3] = 25;
  return null; // 매칭 실패 (할당 발생 안 함)
}

bench('Success: Substring Allocation (Current)', () => { useAllocation(); });
bench('Success: Offset Tracking (Target)', () => { useOffsets(); });
bench('404 Fail: Substring Allocation (Current)', () => { failAllocation(); });
bench('404 Fail: Offset Tracking (Target)', () => { failOffsets(); });

await run();
