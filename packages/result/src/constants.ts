/**
 * The default marker key used to identify {@link Err} objects.
 *
 * This collision-resistant string is set as a hidden property on every `Err`
 * created by `err()`. You rarely need to reference it directly — it is
 * provided for advanced use cases like cross-module error domain isolation.
 *
 * @example
 * ```ts
 * import { DEFAULT_MARKER_KEY } from '@zipbul/result';
 * console.log(DEFAULT_MARKER_KEY); // '__$$e_9f4a1c7b__'
 * ```
 */
export const DEFAULT_MARKER_KEY = '__$$e_9f4a1c7b__';

let currentMarkerKey: string = DEFAULT_MARKER_KEY;

/**
 * Returns the marker key currently in use.
 *
 * Both `err()` and `isErr()` rely on this key to tag and detect error objects.
 *
 * @returns The current marker key string.
 *
 * @example
 * ```ts
 * console.log(getMarkerKey()); // '__$$e_9f4a1c7b__'
 * ```
 */
export function getMarkerKey(): string {
  return currentMarkerKey;
}

/**
 * Replaces the marker key used by `err()` and `isErr()`.
 *
 * After calling this, newly-created `Err` objects will use the new key, and
 * `isErr()` will only recognise objects carrying the new key. Previously
 * created `Err` objects will **no longer** be detected.
 *
 * Only change this if you need to isolate error domains across independent
 * modules — in most applications the default key is perfectly fine.
 *
 * @param key - A non-empty, non-whitespace-only string to use as the new key.
 * @throws {TypeError} If `key` is empty or contains only whitespace.
 *
 * @example
 * ```ts
 * setMarkerKey('__my_app_err__');
 * console.log(getMarkerKey()); // '__my_app_err__'
 * ```
 */
export function setMarkerKey(key: string): void {
  if (key.trim().length === 0) {
    throw new TypeError('Marker key must be a non-empty string');
  }
  currentMarkerKey = key;
}
