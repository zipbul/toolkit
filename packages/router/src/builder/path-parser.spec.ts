import { isErr } from '@zipbul/result';
import { describe, it, expect } from 'bun:test';

import type { PathPart } from '../tree';
import type { PathParserConfig } from './path-parser';

import { PathPartType, WildcardOrigin } from '../tree';
import { RouterErrorKind } from '../types';
import { extractNameAndPattern, PathParser, rejectColonWildcardSugar, stripOptionalDecorator } from './path-parser';

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
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.PathMissingLeadingSlash);
      }
    });

    it('should reject path not starting with /', () => {
      const result = parse('users');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.PathMissingLeadingSlash);
      }
    });

    it('should accept root path /', () => {
      const result = parse('/');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/');
        expect(result.isDynamic).toBe(false);
        expect(result.parts).toEqual([{ type: PathPartType.Static, value: '/', segments: [] }]);
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
        expect(result.parts).toEqual([{ type: PathPartType.Static, value: '/users', segments: ['users'] }]);
      }
    });

    it('should parse multi-segment static path', () => {
      const result = parse('/api/v1/users');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.normalized).toBe('/api/v1/users');
        expect(result.parts).toEqual([{ type: PathPartType.Static, value: '/api/v1/users', segments: ['api', 'v1', 'users'] }]);
      }
    });

    it('should reject repeated slashes that create empty segments', () => {
      for (const path of ['/api//users', '//', '/a///b']) {
        const result = parse(path);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect(result.data.kind).toBe(RouterErrorKind.PathEmptySegment);
        }
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
          { type: PathPartType.Static, value: '/users/', segments: ['users'] },
          { type: PathPartType.Param, name: 'id', pattern: null, optional: false },
        ]);
      }
    });

    it('should parse multiple params', () => {
      const result = parse('/users/:userId/posts/:postId');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.isDynamic).toBe(true);
        expect(result.parts.length).toBe(4);
        expect(result.parts[1]).toEqual({ type: PathPartType.Param, name: 'userId', pattern: null, optional: false });
        expect(result.parts[3]).toEqual({ type: PathPartType.Param, name: 'postId', pattern: null, optional: false });
      }
    });

    it('should parse param with regex pattern', () => {
      const result = parse('/users/:id(\\d+)');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.isDynamic).toBe(true);
        const paramPart = result.parts.find(p => p.type === PathPartType.Param) as Extract<
          PathPart,
          { type: PathPartType.Param }
        >;
        expect(paramPart.name).toBe('id');
        expect(paramPart.pattern).toBe('\\d+');
      }
    });

    it('should reject anchored regex pattern sources at parse time', () => {
      const result = parse('/users/:id(^\\d+$)');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should parse optional param', () => {
      const result = parse('/users/:id?');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        const paramPart = result.parts.find(p => p.type === PathPartType.Param) as Extract<
          PathPart,
          { type: PathPartType.Param }
        >;
        expect(paramPart.optional).toBe(true);
      }
    });

    it('should reject duplicate param names', () => {
      const result = parse('/users/:id/posts/:id');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.ParamDuplicate);
      }
    });

    it('should reject empty param name', () => {
      const result = parse('/users/:');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should reject unclosed regex pattern', () => {
      const result = parse('/users/:id(\\d+');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should reject whitespace-only regex `(   )` as parse error', () => {
      // Whitespace-only patterns are silently-typo cases — the user almost
      // certainly meant to omit the parentheses entirely. Reject so the
      // intent is explicit.
      const result = parse('/users/:id(   )');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
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
          type: PathPartType.Wildcard,
          name: 'path',
          origin: WildcardOrigin.Star,
        });
      }
    });

    it('should parse multi wildcard with +', () => {
      const result = parse('/files/*path+');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: PathPartType.Wildcard,
          name: 'path',
          origin: WildcardOrigin.Multi,
        });
      }
    });

    it('should use * as default wildcard name', () => {
      const result = parse('/files/*');
      expect(isErr(result)).toBe(false);
      if (!isErr(result)) {
        expect(result.parts[result.parts.length - 1]).toEqual({
          type: PathPartType.Wildcard,
          name: '*',
          origin: WildcardOrigin.Star,
        });
      }
    });

    it('should reject wildcard not at last segment', () => {
      const result = parse('/files/*path/extra');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should reject :name+ colon-form wildcard sugar (use *name+ instead)', () => {
      const result = parse('/files/:path+');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should reject :name* colon-form wildcard sugar (use *name instead)', () => {
      const result = parse('/files/:path*');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should reject :name+ not at last segment', () => {
      const result = parse('/files/:path+/extra');
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe(RouterErrorKind.RouteParse);
      }
    });

    it('should reject mixed optional and wildcard decorators', () => {
      for (const path of ['/:a+?', '/:a*?', '/:a?+', '/:a?*']) {
        const result = parse(path);
        expect(isErr(result)).toBe(true);
        if (isErr(result)) {
          expect([RouterErrorKind.RouteParse, RouterErrorKind.PathQuery]).toContain(result.data.kind);
        }
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
        const paramPart = result.parts.find(p => p.type === PathPartType.Param) as Extract<
          PathPart,
          { type: PathPartType.Param }
        >;
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

  describe('regex pattern body — router accepts any syntactically valid regex', () => {
    // ReDoS prevention is the framework / user's responsibility (use a
    // normalizer plug-in such as `re2` ahead of the router). The router
    // only rejects regex shapes that fail to compile via `new RegExp()`
    // at build time, surfaced as `route-parse`.

    it('accepts a vulnerable nested-quantifier pattern (user responsibility)', () => {
      const result = parse('/test/:val((?:a+)+)');
      expect(isErr(result)).toBe(false);
    });

    it('accepts a backreference pattern (user responsibility)', () => {
      const result = parse('/test/:val((?:\\w+)\\1)');
      expect(isErr(result)).toBe(false);
    });

    it('accepts a standard digit-only constraint', () => {
      const result = parse('/test/:val(\\d+)');
      expect(isErr(result)).toBe(false);
    });
  });
});

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
    if ('kind' in result) {
      expect(result.kind).toBe(RouterErrorKind.RouteParse);
    }
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
      expect(result.kind).toBe(RouterErrorKind.RouteParse);
      expect(result.message).toContain('*rest+');
    }
  });

  it('rejects `:name*` and suggests the canonical `*name` form', () => {
    const result = rejectColonWildcardSugar(':rest*', ':rest*', '/files/:rest*');
    expect(result).toBeDefined();
    if (result) {
      expect(result.kind).toBe(RouterErrorKind.RouteParse);
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
      expect(result.kind).toBe(RouterErrorKind.RouteParse);
      expect(result.message).toContain('Unclosed');
    }
  });

  it('returns route-parse error for a whitespace-only pattern', () => {
    const result = extractNameAndPattern(':id(   )', '/users/:id(   )');
    expect('kind' in result).toBe(true);
    if ('kind' in result) {
      expect(result.kind).toBe(RouterErrorKind.RouteParse);
      expect(result.message).toContain('Empty regex');
    }
  });

  it('returns route-parse error for an anchored pattern', () => {
    const result = extractNameAndPattern(':id(^\\d+$)', '/users/:id(^\\d+$)');
    expect('kind' in result).toBe(true);
    if ('kind' in result) {
      expect(result.kind).toBe(RouterErrorKind.RouteParse);
      expect(result.message).toContain('Anchored');
    }
  });
});
