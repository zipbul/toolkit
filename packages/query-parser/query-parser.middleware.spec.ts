import { describe, expect, it } from 'bun:test';

import type { HttpAdapter } from '../../adapter/http-adapter';
import type { RequestQueryMap } from '../../types';

import { BunnerHttpContext } from '../../adapter';
import { BunnerRequest } from '../../bunner-request';
import { BunnerResponse } from '../../bunner-response';
import { BadRequestError } from '../../errors/errors';
import { QueryParserMiddleware } from './query-parser.middleware';

describe('query-parser.middleware', () => {
  const createContext = (url: string): BunnerHttpContext => {
    const request = new BunnerRequest({
      url,
      httpMethod: 'GET',
      headers: {},
      params: {},
      query: {} as RequestQueryMap,
      body: null,
      isTrustedProxy: false,
      ip: null,
      ips: [],
    });
    const response = new BunnerResponse(request, new Response());
    const adapter: HttpAdapter = {
      getRequest: () => request,
      getResponse: () => response,
      setHeader: () => {},
      setStatus: () => {},
    };

    return new BunnerHttpContext(adapter);
  };

  // ============================================
  // 1. Basic Parsing
  // ============================================
  describe('Basic Parsing', () => {
    it('should parse simple query string when parameters are present', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({});
      const ctx = createContext('http://localhost/path?name=value&age=30');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ name: 'value', age: '30' });
    });

    it('should return empty object when query string is missing', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({});
      const ctx = createContext('http://localhost/path');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({});
    });

    it('should return empty object when query string is empty after ?', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({});
      const ctx = createContext('http://localhost/path?');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({});
    });
  });

  // ============================================
  // 3. Option Passthrough
  // ============================================
  describe('Option Passthrough', () => {
    it('should parse nested objects when parseArrays is true', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ parseArrays: true });
      const ctx = createContext('http://localhost/?user[name]=alice&user[age]=30');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ user: { name: 'alice', age: '30' } });
    });

    it('should respect depth option when parseArrays is true', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ parseArrays: true, depth: 1 });
      const ctx = createContext('http://localhost/?a[b][c]=d');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ a: { b: {} } });
    });

    it('should respect parameterLimit option when limit is exceeded', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ parameterLimit: 2 });
      const ctx = createContext('http://localhost/?a=1&b=2&c=3&d=4');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ a: '1', b: '2' });
    });

    it('should respect hppMode option when duplicate keys are present', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ hppMode: 'last' });
      const ctx = createContext('http://localhost/?id=1&id=2&id=3');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ id: '3' });
    });
  });

  // ============================================
  // 4. Strict Mode Error Handling
  // ============================================
  describe('Strict Mode Error Handling', () => {
    it('should throw on unbalanced brackets when strictMode is true', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ strictMode: true });
      const ctx = createContext('http://localhost/?a[b=1');

      const act = () => {
        middleware.handle(ctx);
      };

      // Act
      const run = act;

      // Assert
      expect(run).toThrow(BadRequestError);
    });

    it('should throw on mixed scalar and nested keys when strictMode is true', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ strictMode: true, parseArrays: true });
      const ctx = createContext('http://localhost/?a=1&a[b]=2');

      const act = () => {
        middleware.handle(ctx);
      };

      // Act
      const run = act;

      // Assert
      expect(run).toThrow(BadRequestError);
    });

    it('should not throw on malformed query when strictMode is false', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ strictMode: false });
      const ctx = createContext('http://localhost/?a[b=1');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ 'a[b': '1' });
    });
  });

  // ============================================
  // 5. Security (Prototype Pollution)
  // ============================================
  describe('Security', () => {
    it('should block __proto__ pollution when parsing query', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ parseArrays: true });
      const ctx = createContext('http://localhost/?__proto__[polluted]=true');

      // Act
      middleware.handle(ctx);

      const query = ctx.request.query;

      // Assert
      expect(Object.prototype.hasOwnProperty.call(query, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
    });

    it('should block constructor pollution when parsing query', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({ parseArrays: true });
      const ctx = createContext('http://localhost/?constructor[prototype][foo]=bar');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(Object.prototype.hasOwnProperty.call(ctx.request.query, 'constructor')).toBe(false);
    });
  });

  // ============================================
  // 6. Encoding
  // ============================================
  describe('Encoding', () => {
    it('should decode percent-encoded keys and values when present', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({});
      const ctx = createContext('http://localhost/?%ED%95%9C%EA%B8%80=%ED%85%8C%EC%8A%A4%ED%8A%B8');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ 한글: '테스트' });
    });

    it('should handle special characters when decoding values', () => {
      // Arrange
      const middleware = new QueryParserMiddleware({});
      const ctx = createContext('http://localhost/?eq=%3D&amp=%26');

      // Act
      middleware.handle(ctx);

      // Assert
      expect(ctx.request.query).toEqual({ eq: '=', amp: '&' });
    });
  });
});
