import { RAW } from '../symbols';
import type { RawClassMeta } from '../types';
import type { SealOptions } from '../interfaces';

/**
 * 순환 참조 정적 분석 (§4.6)
 *
 * - enableCircularCheck: true → 항상 true
 * - enableCircularCheck: false → 항상 false
 * - 'auto' (기본) → @Type 참조 그래프를 DFS로 탐색해 순환 감지
 *
 * 순환 없는 flat DTO → false (WeakSet 오버헤드 0)
 * 순환 있는 DTO → true (WeakSet 자동 삽입)
 */
export function analyzeCircular(
  Class: Function,
  _merged: RawClassMeta,
  options?: SealOptions,
): boolean {
  if (options?.enableCircularCheck === true) return true;
  if (options?.enableCircularCheck === false) return false;

  // auto mode: @Type 참조 그래프 DFS — visited set으로 back-edge 감지
  const visited = new Set<Function>();

  function walk(cls: Function): boolean {
    if (visited.has(cls)) return true; // back-edge → 순환

    visited.add(cls);

    const raw = (cls as any)[RAW] as RawClassMeta | undefined;
    if (raw) {
      for (const meta of Object.values(raw)) {
        // 단순 @Type
        if (meta.type?.fn) {
          const nested = meta.type.fn();
          if (walk(nested)) return true;
        }
        // discriminator subTypes
        if (meta.type?.discriminator) {
          for (const sub of meta.type.discriminator.subTypes) {
            if (walk(sub.value)) return true;
          }
        }
      }
    }

    visited.delete(cls); // 트리 엣지 해제 — 다이아몬드 패턴 false positive 방지
    return false;
  }

  return walk(Class);
}
