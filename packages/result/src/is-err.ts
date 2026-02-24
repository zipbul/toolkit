import type { Err } from './types';
import { getMarkerKey } from './constants';

/**
 * Type guard that checks whether a value is an {@link Err}.
 *
 * Returns `true` when `value` is a non-null object whose current marker
 * property is strictly `true`. This function **never throws** — it safely
 * handles `null`, `undefined`, primitives, and even hostile Proxy objects.
 *
 * **Note:** The generic `E` is a compile-time assertion only. It does **not**
 * validate the shape of `data` at runtime — callers must ensure `E` matches
 * the actual error type.
 *
 * @typeParam E - Expected error data type (default: `unknown`).
 * @param value - The value to check. Can be anything.
 * @returns `true` if `value` is an `Err`, allowing TypeScript to narrow the type.
 *
 * @example
 * ```ts
 * const result: Result<number, string> = doSomething();
 *
 * if (isErr(result)) {
 *   console.error(result.data); // string
 * } else {
 *   console.log(result + 1);    // number
 * }
 * ```
 */
export function isErr<E = unknown>(
  value: unknown,
): value is Err<E> {
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
