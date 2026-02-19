import type { Error } from './types';
import { getMarkerKey } from './constants';

/**
 * 값이 Error인지 판별하는 타입 가드.
 * 현재 설정된 마커 키(`getMarkerKey()`)에 해당하는 프로퍼티가
 * `=== true`인 경우에만 true를 반환한다 (COMMON-RESULT-R-002).
 * 절대 throw하지 않는다 (COMMON-RESULT-R-006).
 *
 * 주의: 제네릭 E는 런타임 검증 없이 타입 단언만 제공한다.
 * data의 구조는 호출자가 보장해야 한다.
 *
 * @param value - 판별 대상. 타입 무관.
 * @returns value가 Error이면 true
 */
export function isError<E extends object = Record<string, never>>(
  value: unknown,
): value is Error<E> {
  // try-catch로 감싸서 hostile input(Proxy 등)에도 throw하지 않음 (R-006).
  try {
    return (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      (value as Record<string, unknown>)[getMarkerKey()] === true
    );
  } catch {
    return false;
  }
}
