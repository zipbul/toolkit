import type { Err } from './types';
import { getMarkerKey } from './constants';

/**
 * Err를 생성한다.
 * 절대 throw하지 않는다.
 * 반환 전 Object.freeze를 적용한다.
 *
 * @returns 동결(frozen)된 Err (data 없음)
 */
export function err(): Err;
/**
 * @param data - 에러에 첨부할 데이터. 타입 무관.
 * @returns 동결(frozen)된 Err<E>
 */
export function err<E>(data: E): Err<E>;
export function err<E = never>(data?: E): Err<E> {
  let stack: string;
  try {
    stack = new Error().stack ?? '';
  } catch {
    stack = '';
  }

  const result = {
    [getMarkerKey()]: true,
    stack,
    data: data as E,
  };

  return Object.freeze(result) as Err<E>;
}
