import type { Error } from './types';
import { getMarkerKey } from './constants';

/**
 * Error를 생성한다.
 * 절대 throw하지 않는다 (COMMON-RESULT-R-005).
 * 반환 전 Object.freeze를 적용한다 (COMMON-RESULT-R-004).
 *
 * @param cause - 에러의 원인. 타입 무관. 그대로 cause 필드에 저장.
 * @returns 동결(frozen)된 Error
 */
export function error(cause: unknown): Error;
/**
 * @param cause - 에러의 원인.
 * @param data - 에러에 첨부할 추가 데이터.
 * @returns 동결(frozen)된 Error<E>
 */
export function error<E extends object>(cause: unknown, data: E): Error<E>;
export function error<E extends object = Record<string, never>>(
  cause: unknown,
  data?: E,
): Error<E> {
  // ── 1. stack 결정 (R-004) ──
  // cause가 globalThis.Error이고 stack이 비어있지 않은 문자열이면 그것을 사용.
  // 아니면 생성 시점의 스택을 캡처.
  // try-catch로 감싸서 hostile input(Proxy 등)에도 throw하지 않음 (R-005).
  let stack: string;
  try {
    if (
      cause instanceof globalThis.Error &&
      typeof cause.stack === 'string' &&
      cause.stack.length > 0
    ) {
      stack = cause.stack;
    } else {
      stack = new globalThis.Error().stack ?? '';
    }
  } catch {
    stack = new globalThis.Error().stack ?? '';
  }

  // ── 2. Error 객체 생성 (마커 키 동적 추가) ──
  const err = {
    [getMarkerKey()]: true,
    stack,
    cause,
    data: (data ?? {}) as E,
  };

  // ── 3. 동결 후 반환 (R-004: freeze-before-expose) ──
  return Object.freeze(err) as Error<E>;
}
