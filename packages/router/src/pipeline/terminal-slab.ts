/**
 * Packed Int32Array layout for per-terminal metadata. Three slots per
 * terminal index `t`:
 *
 *   t*3 + 0  →  handler index (into snapshot.handlers)
 *   t*3 + 1  →  1 if this terminal is a wildcard, 0 otherwise
 *   t*3 + 2  →  present-param bitmask (bit i set ⇔ originalNames[i] is
 *               captured in this expansion variant)
 *
 * Single source of truth for both the writer (registration.ts) and the
 * reader (codegen/emitter.ts). The codegen emitter still hard-codes
 * `*3 + 1` / `*3 + 2` because those expressions are inlined into a
 * generated function body — keep this file's constants in sync if you
 * ever change the layout.
 */
export const TERMINAL_SLOTS = 3;
export const TERMINAL_HANDLER_OFFSET = 0;
export const TERMINAL_IS_WILDCARD_OFFSET = 1;
export const TERMINAL_PRESENT_BITMASK_OFFSET = 2;

/**
 * Pack the build-time growable parallel arrays into the packed slab the
 * runtime consumes. All three input arrays must be the same length —
 * caller's invariant, not asserted on the hot path. Missing entries in
 * `presentBitmaskByTerminal` (sparse during build) default to `0`.
 */
export function packTerminalSlab(
  terminalHandlers: ReadonlyArray<number>,
  isWildcardByTerminal: ReadonlyArray<boolean>,
  presentBitmaskByTerminal: ReadonlyArray<number>,
): Int32Array {
  const terminalCount = terminalHandlers.length;
  const slab = new Int32Array(terminalCount * TERMINAL_SLOTS);
  for (let t = 0; t < terminalCount; t++) {
    slab[t * TERMINAL_SLOTS + TERMINAL_HANDLER_OFFSET] = terminalHandlers[t]!;
    slab[t * TERMINAL_SLOTS + TERMINAL_IS_WILDCARD_OFFSET] = isWildcardByTerminal[t] ? 1 : 0;
    slab[t * TERMINAL_SLOTS + TERMINAL_PRESENT_BITMASK_OFFSET] = presentBitmaskByTerminal[t] ?? 0;
  }
  return slab;
}
