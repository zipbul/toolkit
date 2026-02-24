import type { Err } from './types';
import { getMarkerKey } from './constants';

/**
 * Creates an immutable {@link Err} value with no attached data.
 *
 * The returned object is `Object.freeze()`-d and includes a stack trace
 * captured at the call site. This function **never throws**.
 *
 * @returns A frozen `Err` with `data` typed as `never`.
 *
 * @example
 * ```ts
 * const e = err();
 * console.log(e.stack); // stack trace
 * ```
 */
export function err(): Err;
/**
 * Creates an immutable {@link Err} value carrying the given data.
 *
 * The returned object is `Object.freeze()`-d and includes a stack trace
 * captured at the call site. This function **never throws**.
 *
 * @param data - Any value describing the error (string, object, number, etc.).
 * @returns A frozen `Err<E>` with `data` set to the provided value.
 *
 * @example
 * ```ts
 * const e = err({ code: 'TIMEOUT', retryAfter: 3000 });
 * console.log(e.data.code); // 'TIMEOUT'
 * ```
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
