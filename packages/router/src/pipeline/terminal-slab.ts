export const TERMINAL_SLOTS = 3;
export const TERMINAL_HANDLER_OFFSET = 0;
export const TERMINAL_IS_WILDCARD_OFFSET = 1;
export const TERMINAL_PRESENT_BITMASK_OFFSET = 2;

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
