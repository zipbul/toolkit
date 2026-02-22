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
});
