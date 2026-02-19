/**
 * 기본 에러 마커 키.
 * 에러 객체의 판별 프로퍼티명으로 사용된다.
 * zipbul 프레임워크와 무관한 유니크한 값으로, 충돌 가능성을 최소화한다.
 */
export const DEFAULT_MARKER_KEY = '__$$e_9f4a1c7b__';

let currentMarkerKey: string = DEFAULT_MARKER_KEY;

/**
 * 현재 설정된 마커 키를 반환한다.
 *
 * @returns 현재 마커 키 문자열
 */
export function getMarkerKey(): string {
  return currentMarkerKey;
}

/**
 * 마커 키를 변경한다.
 * error()와 isError()가 이 키를 참조하여 에러를 판별한다.
 * 빈 문자열 및 공백만으로 이루어진 문자열은 허용하지 않는다.
 *
 * @param key - 새 마커 키. 비어있지 않은(공백 제외) 문자열이어야 한다.
 * @throws {TypeError} key가 빈/공백 문자열인 경우
 */
export function setMarkerKey(key: string): void {
  if (key.trim().length === 0) {
    throw new TypeError('Marker key must be a non-empty string');
  }
  currentMarkerKey = key;
}
