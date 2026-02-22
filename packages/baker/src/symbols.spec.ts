import { describe, it, expect } from 'bun:test';
import { RAW, SEALED } from './symbols';

describe('symbols', () => {
  it('should be symbol type when accessing RAW', () => {
    // Arrange / Act / Assert
    expect(typeof RAW).toBe('symbol');
  });

  it('should be symbol type when accessing SEALED', () => {
    expect(typeof SEALED).toBe('symbol');
  });

  it('should be different symbols when comparing RAW and SEALED', () => {
    expect(RAW).not.toBe(SEALED);
  });

  it("should have description 'baker:raw' when reading RAW.description", () => {
    expect(RAW.description).toBe('baker:raw');
  });

  it("should have description 'baker:sealed' when reading SEALED.description", () => {
    expect(SEALED.description).toBe('baker:sealed');
  });

  it("should equal Symbol.for('baker:raw') when comparing RAW", () => {
    expect(RAW).toBe(Symbol.for('baker:raw'));
  });

  it("should equal Symbol.for('baker:sealed') when comparing SEALED", () => {
    expect(SEALED).toBe(Symbol.for('baker:sealed'));
  });

  it('should return the same symbol reference when accessing RAW multiple times', () => {
    // Arrange
    const first = RAW;
    // Act
    const second = RAW;
    // Assert
    expect(first).toBe(second);
  });
});
