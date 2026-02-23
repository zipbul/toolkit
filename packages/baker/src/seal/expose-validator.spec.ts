import { describe, it, expect } from 'bun:test';
import { validateExposeStacks } from './expose-validator';
import { SealError } from '../errors';
import type { RawClassMeta } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fieldWithExpose(...exposeDefs: Array<{
  name?: string;
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
  groups?: string[];
}>): RawClassMeta {
  return {
    field: {
      validation: [],
      transform: [],
      expose: exposeDefs,
      exclude: null,
      type: null,
      flags: {},
    },
  };
}

describe('validateExposeStacks', () => {
  // ── Happy Path ─────────────────────────────────────────────────────────────

  it('should not throw when expose stack is empty (no @Expose decorator)', () => {
    // Arrange
    const merged: RawClassMeta = {
      name: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when @Expose has deserializeOnly: true only', () => {
    // Arrange
    const merged = fieldWithExpose({ deserializeOnly: true });
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when @Expose has serializeOnly: true only', () => {
    // Arrange
    const merged = fieldWithExpose({ serializeOnly: true });
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when multiple @Expose entries are all valid', () => {
    // Arrange — §4.11 pattern: separate entries per direction
    const merged = fieldWithExpose(
      { name: 'user_name', deserializeOnly: true },
      { name: 'userName', serializeOnly: true },
    );
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  // ── Negative / Error ───────────────────────────────────────────────────────

  it('should throw SealError when a single @Expose entry has both deserializeOnly and serializeOnly', () => {
    // Arrange
    const merged = fieldWithExpose({ deserializeOnly: true, serializeOnly: true });
    // Act / Assert
    expect(() => validateExposeStacks(merged)).toThrow(SealError);
  });

  it('should throw SealError when one of multiple fields has an invalid @Expose entry', () => {
    // Arrange
    const merged: RawClassMeta = {
      name: {
        validation: [],
        transform: [],
        expose: [{ deserializeOnly: false, serializeOnly: false }],
        exclude: null,
        type: null,
        flags: {},
      },
      email: {
        validation: [],
        transform: [],
        expose: [{ deserializeOnly: true, serializeOnly: true }], // invalid
        exclude: null,
        type: null,
        flags: {},
      },
    };
    // Act / Assert
    expect(() => validateExposeStacks(merged)).toThrow(SealError);
  });

  // ── Edge ───────────────────────────────────────────────────────────────────

  it('should not throw when merged object is empty (no fields)', () => {
    // Arrange
    const merged: RawClassMeta = {};
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when a field has no @Expose entries at all', () => {
    // Arrange
    const merged: RawClassMeta = {
      field: { validation: [], transform: [], expose: [], exclude: null, type: null, flags: {} },
    };
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  // ── H3: Multi-entry @Expose conflict detection ─────────────────────────────

  it('should throw SealError when two @Expose entries have same direction and both ungrouped (groups=[])', () => {
    // Arrange — two deserialization-direction entries, both with no groups
    const merged = fieldWithExpose(
      { deserializeOnly: true },   // groups = undefined → []
      { deserializeOnly: true },   // same direction, same ungrouped
    );
    // Act / Assert
    expect(() => validateExposeStacks(merged)).toThrow(SealError);
  });

  it('should throw SealError when two @Expose entries have same direction with overlapping groups', () => {
    // Arrange — two serialize entries, both include 'admin' group
    const merged = fieldWithExpose(
      { serializeOnly: true, groups: ['admin'] },
      { serializeOnly: true, groups: ['admin', 'superadmin'] },
    );
    // Act / Assert
    expect(() => validateExposeStacks(merged)).toThrow(SealError);
  });

  it('should not throw when two @Expose entries have same direction with non-overlapping groups', () => {
    // Arrange — same direction but ['admin'] vs ['user'] → no overlap
    const merged = fieldWithExpose(
      { deserializeOnly: true, groups: ['admin'] },
      { deserializeOnly: true, groups: ['user'] },
    );
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when two @Expose entries have different directions (desOnly + serOnly)', () => {
    // Arrange — different directions: not a conflict
    const merged = fieldWithExpose(
      { deserializeOnly: true },
      { serializeOnly: true },
    );
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when same direction has ungrouped and grouped entries (different scopes)', () => {
    // Arrange — one desEntry with no groups, one with ['admin'] → different scopes
    const merged = fieldWithExpose(
      { deserializeOnly: true, groups: [] },    // ungrouped default
      { deserializeOnly: true, groups: ['admin'] }, // specific group
    );
    // Act / Assert — no conflict: one is default scope, other is admin scope
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });

  it('should not throw when each direction has exactly one entry', () => {
    // Arrange — one desOnly, one serOnly → each direction single entry, no conflict
    const merged = fieldWithExpose(
      { deserializeOnly: true, name: 'des_name' },
      { serializeOnly: true, name: 'ser_name' },
    );
    // Act / Assert
    expect(() => validateExposeStacks(merged)).not.toThrow();
  });
});
