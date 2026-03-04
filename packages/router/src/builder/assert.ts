/**
 * assertDefined — invariant violation helper.
 *
 * Use for values that should be defined by construction
 * (programming error, not user input). If `value` is `undefined`,
 * the router has a bug and crashing is the correct behavior.
 */
export function assertDefined<T>(value: T | undefined, msg: string): asserts value is T {
  if (value === undefined) throw new Error(msg); // internal invariant violation — unrecoverable
}
