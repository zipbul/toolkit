/**
 * Unit spec for `optional-param-defaults.ts`. The tracker is small —
 * record / snapshot / restore — but it backs the rollback path so the
 * cross-state invariants need explicit pinning.
 */
import { describe, expect, it } from 'bun:test';

import { OptionalParamDefaults } from './optional-param-defaults';

describe('OptionalParamDefaults — `omit` behavior', () => {
  it('record() is a no-op (the omit policy never materializes defaults)', () => {
    const tracker = new OptionalParamDefaults('omit');
    tracker.record(1, ['id']);
    const snap = tracker.snapshot();
    expect(snap.entries).toEqual([]);
  });
});

describe('OptionalParamDefaults — `set-undefined` behavior', () => {
  it('record() registers per-key defaults', () => {
    const tracker = new OptionalParamDefaults('set-undefined');
    tracker.record(7, ['a', 'b']);
    expect(tracker.snapshot().entries).toEqual([[7, ['a', 'b']]]);
  });

  it('record() overwrites the entry for an existing key', () => {
    const tracker = new OptionalParamDefaults('set-undefined');
    tracker.record(1, ['a']);
    tracker.record(1, ['a', 'b']);
    expect(tracker.snapshot().entries).toEqual([[1, ['a', 'b']]]);
  });
});

describe('OptionalParamDefaults — snapshot/restore', () => {
  it('empty snapshot returns the singleton EMPTY_SNAPSHOT (object identity stable)', () => {
    const a = new OptionalParamDefaults('set-undefined').snapshot();
    const b = new OptionalParamDefaults('set-undefined').snapshot();
    expect(a).toBe(b);
  });

  it('restore() replaces the entire map with the snapshot contents', () => {
    const tracker = new OptionalParamDefaults('set-undefined');
    tracker.record(1, ['a']);
    tracker.record(2, ['b']);
    const snap = tracker.snapshot();

    tracker.record(3, ['c']);
    expect(tracker.snapshot().entries.length).toBe(3);

    tracker.restore(snap);
    const restored = tracker.snapshot().entries;
    expect(restored.length).toBe(2);
    expect(restored.find(([k]) => k === 3)).toBeUndefined();
  });

  it('restore(emptySnapshot) clears all entries', () => {
    const tracker = new OptionalParamDefaults('set-undefined');
    tracker.record(1, ['a']);
    tracker.restore({ entries: [] });
    expect(tracker.snapshot().entries).toEqual([]);
  });
});
