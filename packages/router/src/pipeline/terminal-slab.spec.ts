/**
 * Unit spec for `terminal-slab.ts`. The packed layout is shared with
 * codegen/emitter.ts (which hard-codes `*3+1` / `*3+2`); pin the
 * constants and packer behavior here so any drift is caught.
 */
import { describe, expect, it } from 'bun:test';

import {
  TERMINAL_HANDLER_OFFSET,
  TERMINAL_IS_WILDCARD_OFFSET,
  TERMINAL_PRESENT_BITMASK_OFFSET,
  TERMINAL_SLOTS,
  packTerminalSlab,
} from './terminal-slab';

describe('terminal-slab layout constants', () => {
  it('uses 3 slots per terminal', () => {
    expect(TERMINAL_SLOTS).toBe(3);
  });

  it('handler offset is 0, isWildcard is 1, presentBitmask is 2', () => {
    expect(TERMINAL_HANDLER_OFFSET).toBe(0);
    expect(TERMINAL_IS_WILDCARD_OFFSET).toBe(1);
    expect(TERMINAL_PRESENT_BITMASK_OFFSET).toBe(2);
  });
});

describe('packTerminalSlab', () => {
  it('returns an empty Int32Array for an empty input', () => {
    const slab = packTerminalSlab([], [], []);
    expect(slab).toBeInstanceOf(Int32Array);
    expect(slab.length).toBe(0);
  });

  it('packs a single terminal in slot order [handler, isWildcard, bitmask]', () => {
    const slab = packTerminalSlab([42], [false], [0b101]);
    expect(slab.length).toBe(3);
    expect(slab[0]).toBe(42);
    expect(slab[1]).toBe(0);
    expect(slab[2]).toBe(0b101);
  });

  it('converts true/false to 1/0 in the isWildcard slot', () => {
    const slab = packTerminalSlab([1, 2], [true, false], [0, 0]);
    expect(slab[TERMINAL_IS_WILDCARD_OFFSET]).toBe(1);
    expect(slab[TERMINAL_SLOTS + TERMINAL_IS_WILDCARD_OFFSET]).toBe(0);
  });

  it('defaults a missing presentBitmask entry to 0', () => {
    const sparseBitmasks: number[] = [];
    sparseBitmasks.length = 2;
    sparseBitmasks[1] = 0b11;
    const slab = packTerminalSlab([7, 8], [false, false], sparseBitmasks);
    expect(slab[0 + TERMINAL_PRESENT_BITMASK_OFFSET]).toBe(0);
    expect(slab[1 * TERMINAL_SLOTS + TERMINAL_PRESENT_BITMASK_OFFSET]).toBe(0b11);
  });

  it('packs multiple terminals with stable slot ordering', () => {
    const slab = packTerminalSlab([10, 20, 30], [false, true, false], [0, 0b10, 0b1]);
    expect(slab.length).toBe(9);
    expect(slab[0]).toBe(10);
    expect(slab[1]).toBe(0);
    expect(slab[2]).toBe(0);
    expect(slab[3]).toBe(20);
    expect(slab[4]).toBe(1);
    expect(slab[5]).toBe(0b10);
    expect(slab[6]).toBe(30);
    expect(slab[7]).toBe(0);
    expect(slab[8]).toBe(0b1);
  });
});
