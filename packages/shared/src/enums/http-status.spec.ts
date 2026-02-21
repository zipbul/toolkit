import { describe, expect, it } from 'bun:test';

import { HttpStatus } from './http-status';

describe('HttpStatus', () => {
  describe('happy path', () => {
    it('should have Ok equal to 200', () => {
      expect(HttpStatus.Ok).toBe(200);
    });

    it('should have NoContent equal to 204', () => {
      expect(HttpStatus.NoContent).toBe(204);
    });
  });

  describe('edge cases', () => {
    it('should have exactly 2 members', () => {
      const values = Object.values(HttpStatus).filter(
        (v) => typeof v === 'number',
      );
      expect(values).toHaveLength(2);
    });

    it('should have all positive integer values', () => {
      const values = Object.values(HttpStatus).filter(
        (v) => typeof v === 'number',
      );
      for (const v of values) {
        expect(v).toBeGreaterThan(0);
        expect(Number.isInteger(v)).toBe(true);
      }
    });

    it('should have no duplicate values', () => {
      const values = Object.values(HttpStatus).filter(
        (v) => typeof v === 'number',
      );
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
