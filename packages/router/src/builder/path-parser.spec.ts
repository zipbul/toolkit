import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { PathParser } from './path-parser';
import type { PathParserConfig, PathPart } from './path-parser';

function defaultConfig(overrides: Partial<PathParserConfig> = {}): PathParserConfig {
  return {
    caseSensitive: true,
    ignoreTrailingSlash: true,
    maxSegmentLength: 256,
    ...overrides,
  };
}

function parse(path: string, config?: Partial<PathParserConfig>) {
  const parser = new PathParser(defaultConfig(config));
  return parser.parse(path);
}

describe('PathParser', () => {
  describe('basic validation', () => {
    it('should reject empty path', () => {
      const result = parse('');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('path-missing-leading-slash');
    });

    it('should reject path not starting with /', () => {
      const result = parse('users');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('path-missing-leading-slash');
    });

    it('should accept root path /', () => {
      const result = parse('/');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/');
        expect(result.isDynamic).toBe(false);
        expect(result.parts).toEqual([{ type: 'static', value: '/', segments: [] }]);
      }
    });
  });

  describe('static paths', () => {
    it('should parse simple static path', () => {
      const result = parse('/users');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/users');
        expect(result.isDynamic).toBe(false);
        expect(result.parts).toEqual([{ type: 'static', value: '/users', segments: ['users'] }]);
      }
    });

    it('should parse multi-segment static path', () => {
      const result = parse('/api/v1/users');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/api/v1/users');
        expect(result.parts).toEqual([{ type: 'static', value: '/api/v1/users', segments: ['api', 'v1', 'users'] }]);
      }
    });

    it('should reject repeated slashes that create empty segments', () => {
      for (const path of ['/api//users', '//', '/a///b']) {
        const result = parse(path);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) expect(result.data.kind).toBe('route-parse');
      }
    });
  });

  describe('param paths', () => {
    it('should parse single param', () => {
      const result = parse('/users/:id');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.isDynamic).toBe(true);
        expect(result.parts).toEqual([
          { type: 'static', value: '/users/', segments: ['users'] },
          { type: 'param', name: 'id', pattern: null, optional: false },
        ]);
      }
    });

    it('should parse multiple params', () => {
      const result = parse('/users/:userId/posts/:postId');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.isDynamic).toBe(true);
        expect(result.parts.length).toBe(4);
        expect(result.parts[1]).toEqual({ type: 'param', name: 'userId', pattern: null, optional: false });
        expect(result.parts[3]).toEqual({ type: 'param', name: 'postId', pattern: null, optional: false });
      }
    });

    it('should parse param with regex pattern', () => {
      const result = parse('/users/:id(\\d+)');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.isDynamic).toBe(true);
        const paramPart = result.parts.find(p => p.type === 'param') as Extract<PathPart, { type: 'param' }>;
        expect(paramPart.name).toBe('id');
        expect(paramPart.pattern).toBe('\\d+');
      }
    });

    it('should store normalized regex pattern sources after anchor stripping', () => {
      const result = parse('/users/:id(^\\d+$)');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const paramPart = result.parts.find(p => p.type === 'param') as Extract<PathPart, { type: 'param' }>;
        expect(paramPart.pattern).toBe('\\d+');
      }
    });

    it('should parse optional param', () => {
      const result = parse('/users/:id?');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const paramPart = result.parts.find(p => p.type === 'param') as Extract<PathPart, { type: 'param' }>;
        expect(paramPart.optional).toBe(true);
      }
    });

    it('should reject duplicate param names', () => {
      const result = parse('/users/:id/posts/:id');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('param-duplicate');
    });

    it('should reject empty param name', () => {
      const result = parse('/users/:');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
    });

    it('should reject unclosed regex pattern', () => {
      const result = parse('/users/:id(\\d+');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
    });

    it('should treat whitespace-only regex `(   )` as no-pattern (F15 contract)', () => {
      // Without this, the matcher would compile a literal-whitespace regex —
      // almost certainly a typo. Empty `()` and whitespace-only `(   )` collapse
      // to the same no-pattern shape.
      const result = parse('/users/:id(   )');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const idPart = result.parts.find(p => p.type === 'param' && p.name === 'id');
        expect(idPart).toBeDefined();
        expect((idPart as { pattern: string | null }).pattern).toBeNull();
      }
    });
  });

  describe('wildcard paths', () => {
    it('should parse star wildcard', () => {
      const result = parse('/files/*path');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.isDynamic).toBe(true);
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: 'wildcard', name: 'path', origin: 'star',
        });
      }
    });

    it('should parse multi wildcard with +', () => {
      const result = parse('/files/*path+');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: 'wildcard', name: 'path', origin: 'multi',
        });
      }
    });

    it('should use * as default wildcard name', () => {
      const result = parse('/files/*');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: 'wildcard', name: '*', origin: 'star',
        });
      }
    });

    it('should reject wildcard not at last segment', () => {
      const result = parse('/files/*path/extra');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
    });

    it('should parse :name+ as multi wildcard', () => {
      const result = parse('/files/:path+');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: 'wildcard', name: 'path', origin: 'multi',
        });
      }
    });

    it('should parse :name* as star wildcard', () => {
      const result = parse('/files/:path*');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: 'wildcard', name: 'path', origin: 'star',
        });
      }
    });

    it('should reject :name+ not at last segment', () => {
      const result = parse('/files/:path+/extra');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
    });

    it('should reject mixed optional and wildcard decorators', () => {
      for (const path of ['/:a+?', '/:a*?', '/:a?+', '/:a?*']) {
        const result = parse(path);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) expect(['route-parse', 'path-query']).toContain(result.data.kind);
      }
    });
  });

  describe('normalization', () => {
    it('should case-fold static segments when caseSensitive=false', () => {
      const result = parse('/Users/Profile', { caseSensitive: false });
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/users/profile');
      }
    });

    it('should preserve param name case when caseSensitive=false', () => {
      const result = parse('/users/:UserId', { caseSensitive: false });
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const paramPart = result.parts.find(p => p.type === 'param') as Extract<PathPart, { type: 'param' }>;
        expect(paramPart.name).toBe('UserId');
      }
    });

    it('should remove trailing slash when ignoreTrailingSlash=true', () => {
      const result = parse('/users/', { ignoreTrailingSlash: true });
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/users');
      }
    });

    it('should reject static segment exceeding maxSegmentLength', () => {
      const result = parse('/a/' + 'x'.repeat(300), { maxSegmentLength: 256 });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('segment-limit');
    });

    it('should not enforce maxSegmentLength on param segments', () => {
      const longName = 'a'.repeat(300);
      const result = parse(`/users/:${longName}`, { maxSegmentLength: 256 });
      // Param segment names are not checked against maxSegmentLength
      expect(isErr(result)).toBe(false);
    });
  });

  describe('regex safety (always-on hardcoded guards)', () => {
    it('should reject unsafe regex patterns (nested unlimited quantifiers)', () => {
      const result = parse('/test/:val((a+)+)');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('regex-unsafe');
    });

    it('should reject backreferences', () => {
      const result = parse('/test/:val((\\w+)\\1)');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('regex-unsafe');
    });

    it('should allow safe regex patterns', () => {
      const result = parse('/test/:val(\\d+)');
      expect(isErr(result)).toBe(false);
    });
  });

  describe('segment/param limits', () => {
    it('should reject paths with more than 64 segments', () => {
      const path = '/' + Array.from({ length: 65 }, (_, i) => `s${i}`).join('/');
      const result = parse(path);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('segment-limit');
    });
  });
});
