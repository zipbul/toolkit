/**
 * 전역 레지스트리 — 데코레이터가 1개라도 부착된 클래스를 자동 등록
 *
 * - ensureMeta()에서 자동 호출
 * - seal()이 이 Set을 순회하여 모든 DTO를 봉인
 * - 메타데이터는 여기에 저장되지 않음 — 인덱스(어떤 클래스가 등록되었는지)로만 사용
 */
export const globalRegistry = new Set<Function>();

/**
 * 클래스를 레지스트리에서 제거한다.
 * seal() 후 더 이상 필요 없는 DTO를 GC 대상으로 돌린다 (§L1).
 *
 * @param cls 제거할 클래스 생성자
 * @returns 세트에 존재했는지 여부
 */
export function unregister(cls: Function): boolean {
  return globalRegistry.delete(cls);
}
