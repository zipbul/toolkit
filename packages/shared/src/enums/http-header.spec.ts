import { describe, expect, it } from 'bun:test';

import { HttpHeader } from './http-header';

describe('HttpHeader', () => {
  describe('happy path', () => {
    it('should have Origin equal to origin', () => {
      expect(HttpHeader.Origin).toBe('origin');
    });

    it('should have Vary equal to vary', () => {
      expect(HttpHeader.Vary).toBe('vary');
    });

    it('should have AccessControlAllowOrigin equal to access-control-allow-origin', () => {
      expect(HttpHeader.AccessControlAllowOrigin).toBe(
        'access-control-allow-origin',
      );
    });

    it('should have AccessControlAllowMethods equal to access-control-allow-methods', () => {
      expect(HttpHeader.AccessControlAllowMethods).toBe(
        'access-control-allow-methods',
      );
    });

    it('should have AccessControlAllowHeaders equal to access-control-allow-headers', () => {
      expect(HttpHeader.AccessControlAllowHeaders).toBe(
        'access-control-allow-headers',
      );
    });

    it('should have AccessControlAllowCredentials equal to access-control-allow-credentials', () => {
      expect(HttpHeader.AccessControlAllowCredentials).toBe(
        'access-control-allow-credentials',
      );
    });

    it('should have AccessControlExposeHeaders equal to access-control-expose-headers', () => {
      expect(HttpHeader.AccessControlExposeHeaders).toBe(
        'access-control-expose-headers',
      );
    });

    it('should have AccessControlMaxAge equal to access-control-max-age', () => {
      expect(HttpHeader.AccessControlMaxAge).toBe('access-control-max-age');
    });

    it('should have AccessControlRequestMethod equal to access-control-request-method', () => {
      expect(HttpHeader.AccessControlRequestMethod).toBe(
        'access-control-request-method',
      );
    });

    it('should have AccessControlRequestHeaders equal to access-control-request-headers', () => {
      expect(HttpHeader.AccessControlRequestHeaders).toBe(
        'access-control-request-headers',
      );
    });
  });

  describe('edge cases', () => {
    it('should have exactly 10 members', () => {
      const values = Object.values(HttpHeader).filter(
        (v) => typeof v === 'string',
      );
      expect(values).toHaveLength(10);
    });

    it('should have all lowercase string values', () => {
      const values = Object.values(HttpHeader).filter(
        (v) => typeof v === 'string',
      );
      for (const v of values) {
        expect(v).toBe(v.toLowerCase());
      }
    });

    it('should have no duplicate values', () => {
      const values = Object.values(HttpHeader).filter(
        (v) => typeof v === 'string',
      );
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
