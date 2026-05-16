import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { PathParser } from './path-parser';
import type { PathParserConfig } from './path-parser';
import type { PathPart } from '../tree';

function defaultConfig(overrides: Partial<PathParserConfig> = {}): PathParserConfig {
  return {
    caseSensitive: true,
    ignoreTrailingSlash: true,
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
        if (isErr(result)) expect(result.data.kind).toBe('path-empty-segment');
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

    it('should reject anchored regex pattern sources at parse time', () => {
      const result = parse('/users/:id(^\\d+$)');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
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

    it('should reject whitespace-only regex `(   )` as parse error', () => {
      // Whitespace-only patterns are silently-typo cases — the user almost
      // certainly meant to omit the parentheses entirely. Reject so the
      // intent is explicit.
      const result = parse('/users/:id(   )');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
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

    it('should reject :name+ colon-form wildcard sugar (use *name+ instead)', () => {
      const result = parse('/files/:path+');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
    });

    it('should reject :name* colon-form wildcard sugar (use *name instead)', () => {
      const result = parse('/files/:path*');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) expect(result.data.kind).toBe('route-parse');
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

});

import {
  stripOptionalDecorator,
  rejectColonWildcardSugar,
  extractNameAndPattern,
} from './path-parser';

describe('stripOptionalDecorator', () => {
  it('returns isOptional=false when there is no trailing `?`', () => {
    expect(stripOptionalDecorator(':id', ':id', '/users/:id')).toEqual({ core: ':id', isOptional: false });
  });

  it('peels the trailing `?` and reports isOptional=true', () => {
    expect(stripOptionalDecorator(':id?', ':id?', '/users/:id?')).toEqual({ core: ':id', isOptional: true });
  });

  it('rejects `:name+?` combinations', () => {
    const result = stripOptionalDecorator(':id+?', ':id+?', '/users/:id+?');
    expect('kind' in result).toBe(true);
    if ('kind' in result) expect(result.kind).toBe('route-parse');
  });

  it('rejects `:name*?` combinations', () => {
    const result = stripOptionalDecorator(':id*?', ':id*?', '/users/:id*?');
    expect('kind' in result).toBe(true);
  });
});

describe('rejectColonWildcardSugar', () => {
  it('returns undefined when core has no trailing `+` or `*`', () => {
    expect(rejectColonWildcardSugar(':id', ':id', '/users/:id')).toBeUndefined();
  });

  it('returns undefined when the segment contains a regex group (the regex shape is valid)', () => {
    expect(rejectColonWildcardSugar(':id(a+)', ':id(a+)', '/users/:id(a+)')).toBeUndefined();
  });

  it('rejects `:name+` and suggests the canonical `*name+` form', () => {
    const result = rejectColonWildcardSugar(':rest+', ':rest+', '/files/:rest+');
    expect(result).toBeDefined();
    if (result) {
      expect(result.kind).toBe('route-parse');
      expect(result.message).toContain('*rest+');
    }
  });

  it('rejects `:name*` and suggests the canonical `*name` form', () => {
    const result = rejectColonWildcardSugar(':rest*', ':rest*', '/files/:rest*');
    expect(result).toBeDefined();
    if (result) {
      expect(result.kind).toBe('route-parse');
      expect(result.message).toContain('*rest');
    }
  });
});

describe('extractNameAndPattern', () => {
  it('returns the bare name when there is no regex group', () => {
    expect(extractNameAndPattern(':id', '/users/:id')).toEqual({ name: 'id', pattern: null });
  });

  it('extracts both name and pattern from `:name(pattern)`', () => {
    expect(extractNameAndPattern(':id(\\d+)', '/users/:id(\\d+)')).toEqual({ name: 'id', pattern: '\\d+' });
  });

  it('returns route-parse error for an unclosed regex group', () => {
    const result = extractNameAndPattern(':id(\\d+', '/users/:id(\\d+');
    expect('kind' in result).toBe(true);
    if ('kind' in result) {
      expect(result.kind).toBe('route-parse');
      expect(result.message).toContain('Unclosed');
    }
  });

  it('returns route-parse error for a whitespace-only pattern', () => {
    const result = extractNameAndPattern(':id(   )', '/users/:id(   )');
    expect('kind' in result).toBe(true);
    if ('kind' in result) {
      expect(result.kind).toBe('route-parse');
      expect(result.message).toContain('Empty regex');
    }
  });

  it('returns route-parse error for an anchored pattern', () => {
    const result = extractNameAndPattern(':id(^\\d+$)', '/users/:id(^\\d+$)');
    expect('kind' in result).toBe(true);
    if ('kind' in result) {
      expect(result.kind).toBe('route-parse');
      expect(result.message).toContain('Anchored');
    }
  });
});
