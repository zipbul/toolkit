/**
 * The error type returned by {@link err}.
 *
 * Every `Err` carries an optional `data` payload describing what went wrong.
 * The hidden marker property used for detection is intentionally excluded
 * from the type — it is managed internally by `err()` and checked only
 * through `isErr()`.
 *
 * @template E - The type of the attached error data. Defaults to `never`.
 *
 * @example
 * ```ts
 * const e: Err<string> = err('not found');
 * console.log(e.data);  // 'not found'
 * ```
 */
export type Err<E = never> = {
  data: E;
};

/**
 * A plain union representing either a success value (`T`) or an error (`Err<E>`).
 *
 * Unlike wrapper-class approaches, `Result` is just `T | Err<E>` — zero
 * runtime overhead, full type safety. Use {@link isErr} to narrow the type.
 *
 * @template T - The success value type.
 * @template E - The error data type. Defaults to `never`.
 *
 * @example
 * ```ts
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err('division by zero');
 *   return a / b;
 * }
 * ```
 */
export type Result<T, E = never> = T | Err<E>;

/**
 * A convenient type alias for asynchronous results.
 *
 * This is simply `Promise<Result<T, E>>` — no wrapper class, no extra
 * abstraction. Use it as a return type for async functions that may fail.
 *
 * @template T - The success value type.
 * @template E - The error data type. Defaults to `never`.
 *
 * @example
 * ```ts
 * async function fetchUser(id: number): ResultAsync<User, string> {
 *   const res = await fetch(`/api/users/${id}`);
 *   if (!res.ok) return err(res.statusText);
 *   return await res.json();
 * }
 * ```
 */
export type ResultAsync<T, E = never> = Promise<Result<T, E>>;
