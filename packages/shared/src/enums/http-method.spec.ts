import { describe, expect, it } from 'bun:test';

import { HttpMethod } from './http-method';

describe('HttpMethod', () => {
  describe('happy path', () => {
    it('should have Get equal to GET', () => {
      expect(HttpMethod.Get).toBe('GET');
    });

    it('should have Head equal to HEAD', () => {
      expect(HttpMethod.Head).toBe('HEAD');
    });

    it('should have Post equal to POST', () => {
      expect(HttpMethod.Post).toBe('POST');
    });

    it('should have Put equal to PUT', () => {
      expect(HttpMethod.Put).toBe('PUT');
    });

    it('should have Patch equal to PATCH', () => {
      expect(HttpMethod.Patch).toBe('PATCH');
    });

    it('should have Delete equal to DELETE', () => {
      expect(HttpMethod.Delete).toBe('DELETE');
    });

    it('should have Options equal to OPTIONS', () => {
      expect(HttpMethod.Options).toBe('OPTIONS');
    });
  });

  describe('edge cases', () => {
    it('should have exactly 7 members', () => {
      const values = Object.values(HttpMethod).filter(
        (v) => typeof v === 'string',
      );
      expect(values).toHaveLength(7);
    });

    it('should have all uppercase string values', () => {
      const values = Object.values(HttpMethod).filter(
        (v) => typeof v === 'string',
      );
      for (const v of values) {
        expect(v).toBe(v.toUpperCase());
      }
    });

    it('should have no duplicate values', () => {
      const values = Object.values(HttpMethod).filter(
        (v) => typeof v === 'string',
      );
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
